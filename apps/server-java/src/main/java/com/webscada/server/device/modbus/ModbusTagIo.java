package com.webscada.server.device.modbus;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.store.DeviceFileStore;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Modbus TCP/UDP 变量读写（按 Tag.address 解析），对齐 Flight 类型/长度/字序。 */
@Service
public class ModbusTagIo {
  private static final Logger log = LoggerFactory.getLogger(ModbusTagIo.class);

  private final DeviceFileStore devices;
  private final DeviceStatusService status;
  private final ScadaProperties props;
  private final ConcurrentHashMap<String, ModbusClient> clients = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, ModbusChannel> channels = new ConcurrentHashMap<>();
  /** 当前停在备用地址。只有另一侧本次读写成功才记下；备通着不主动切回主。 */
  private final ConcurrentHashMap<String, Boolean> preferBackup = new ConcurrentHashMap<>();
  /** 连续整批没有好点的次数。TCP 和 UDP 共用。有好点或设备已应答就清零。满 3 次当场换口。 */
  private final ConcurrentHashMap<String, Integer> badRounds = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Object> gates = new ConcurrentHashMap<>();
  private final ModbusAcqLog acqLog = new ModbusAcqLog();

  public ModbusTagIo(DeviceFileStore devices, DeviceStatusService status, ScadaProperties props) {
    this.devices = devices;
    this.status = status;
    this.props = props;
  }

  public boolean enabled() {
    return props.getModbus().isEnabled();
  }

  public boolean drivesDevice(String deviceId) {
    if (!enabled() || deviceId == null) return false;
    try {
      DeviceMeta d = devices.get(deviceId);
      return d != null && d.enabled() && isModbusProtocol(d.protocol());
    } catch (Exception e) {
      return false;
    }
  }

  public static boolean isModbusProtocol(String protocol) {
    if (protocol == null) return false;
    String p = protocol.trim().toLowerCase(Locale.ROOT);
    return "modbus_tcp".equals(p)
        || "modbus-tcp".equals(p)
        || "modbus_udp".equals(p)
        || "modbus-udp".equals(p);
  }

  public static boolean isUdpProtocol(String protocol) {
    if (protocol == null) return false;
    String p = protocol.trim().toLowerCase(Locale.ROOT);
    return "modbus_udp".equals(p) || "modbus-udp".equals(p);
  }

  public record ReadOk(Object value, String quality) {}

  public ReadOk read(TagMeta meta) throws Exception {
    DeviceMeta dev = devices.get(meta.deviceId());
    if (dev == null) throw new IllegalStateException("device not found");
    ModbusAddress addr = ModbusAddress.parse(meta.address());
    if (addr == null) throw new IllegalArgumentException("bad address: " + meta.address());
    ModbusChannel ch = channelFor(dev);
    synchronized (gate(dev.deviceId())) {
      return withLink(
          dev,
          ch,
          client -> {
            Object value = readValue(client, ch, meta, addr);
            return new ReadOk(value, "Good");
          });
    }
  }

  public void write(TagMeta meta, Object value) throws Exception {
    DeviceMeta dev = devices.get(meta.deviceId());
    if (dev == null) throw new IllegalStateException("device not found");
    if (!dev.enabled()) throw new IllegalStateException("设备已停用");
    ModbusAddress addr = ModbusAddress.parse(meta.address());
    if (addr == null) throw new IllegalArgumentException("bad address: " + meta.address());
    if (!addr.writableArea()) {
      throw new IllegalStateException("area not writable: " + addr.area());
    }
    try {
      ModbusChannel ch = channelFor(dev);
      synchronized (gate(dev.deviceId())) {
        withLink(
            dev,
            ch,
            client -> {
              writeValue(client, ch, meta, addr, value);
              return null;
            });
      }
      log.info(
          "modbus write ok device={} tag={} addr={} value={}",
          meta.deviceId(),
          meta.tagId(),
          meta.address(),
          value);
    } catch (Exception e) {
      if (classify(e) == FailKind.TIMEOUT && confirmWrite(dev, meta, addr, value)) {
        log.info(
            "modbus write ok after timeout (read-back confirmed) device={} tag={} addr={} value={}",
            meta.deviceId(),
            meta.tagId(),
            meta.address(),
            value);
        return;
      }
      String err = e.getMessage() == null ? e.toString() : e.getMessage();
      log.warn(
          "modbus write fail device={} tag={} addr={} value={} err={}",
          meta.deviceId(),
          meta.tagId(),
          meta.address(),
          value,
          err);
      throw e;
    }
  }

  /** 写请求超时后回读一次：若目标值已在设备上，按成功返回，避免提示失败却实际已写入。 */
  private boolean confirmWrite(DeviceMeta dev, TagMeta meta, ModbusAddress addr, Object value) {
    try {
      ModbusChannel ch = channelFor(dev);
      Object got;
      synchronized (gate(dev.deviceId())) {
        got =
            withLink(
                dev,
                ch,
                client -> readValue(client, ch, meta, addr));
      }
      if (valuesMatch(got, value, meta)) return true;
      log.info(
          "modbus write timeout read-back mismatch device={} tag={} written={} read={}",
          meta.deviceId(),
          meta.tagId(),
          value,
          got);
      return false;
    } catch (Exception ex) {
      log.info(
          "modbus write timeout read-back failed device={} tag={} err={}",
          meta.deviceId(),
          meta.tagId(),
          ex.toString());
      return false;
    }
  }

  static boolean valuesMatch(Object read, Object written, TagMeta meta) {
    if (read == null || written == null) return false;
    String dt = normalizeType(meta.dataType());
    if ("bool".equals(dt) || read instanceof Boolean || written instanceof Boolean) {
      return toBool(read) == toBool(written);
    }
    if (read instanceof Number rn && written instanceof Number wn) {
      if (isIntegerDataType(dt)) {
        return rn.longValue() == Math.round(wn.doubleValue());
      }
      return Math.abs(rn.doubleValue() - wn.doubleValue()) < 1e-4;
    }
    return String.valueOf(read).equals(String.valueOf(written));
  }

  private static boolean isIntegerDataType(String dt) {
    return "byte".equals(dt)
        || "short".equals(dt)
        || "word".equals(dt)
        || "int".equals(dt)
        || "long".equals(dt)
        || "dword".equals(dt)
        || "llong".equals(dt)
        || "qword".equals(dt);
  }

  public void reportOnline(String deviceId, boolean online, String message) {
    status.report(deviceId, online, online ? "online" : "offline", message);
  }

  public void dropClient(String deviceId) {
    synchronized (gate(deviceId)) {
      dropSocket(deviceId);
    }
  }

  private void dropSocket(String deviceId) {
    ModbusClient c = clients.remove(deviceId);
    channels.remove(deviceId);
    if (c != null) {
      c.close();
      acqLog.info(log, "close:" + deviceId, "modbus session closed device={}", deviceId);
    }
  }

  private ModbusChannel channelFor(DeviceMeta dev) {
    ModbusChannel ch = ModbusChannel.parse(dev.channel());
    if (ch == null) throw new IllegalStateException("invalid channel");
    // 若全局仍配置 lowWordFirst=false，且 channel 未显式写排序，则双字用 SwapNone
    if (dev.channel() != null && !dev.channel().contains("|") && !props.getModbus().isLowWordFirst()) {
      ch =
          new ModbusChannel(
              ch.host(),
              ch.port(),
              ch.wordSwap(),
              ModbusSwap.SwapNone,
              ch.backupHost(),
              ch.backupPort());
    }
    return ch;
  }

  private Object gate(String deviceId) {
    return gates.computeIfAbsent(deviceId, k -> new Object());
  }

  @FunctionalInterface
  private interface IoCall<T> {
    T run(ModbusClient client) throws Exception;
  }

  /**
   * 写值和单点读走当前口。这里不计轮次，也不切备用。
   * 对端断开或连不上时丢掉套接字；读超时留着。
   */
  private <T> T withLink(DeviceMeta dev, ModbusChannel ch, IoCall<T> call) throws Exception {
    String id = dev.deviceId();
    try {
      return call.run(clientFor(dev, ch));
    } catch (IOException ex) {
      FailKind kind = classify(ex);
      if (kind == FailKind.CONNECT || kind == FailKind.BROKEN) dropSocket(id);
      throw ex;
    }
  }

  private enum FailKind {
    TIMEOUT,
    CONNECT,
    BROKEN,
    ANSWER
  }

  /** 超时留着连接。连不上、对端断开才算断。异常码说明设备还在应答。 */
  private static FailKind classify(Exception e) {
    if (e instanceof SocketTimeoutException) {
      String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase(Locale.ROOT);
      return m.contains("connect") ? FailKind.CONNECT : FailKind.TIMEOUT;
    }
    if (!(e instanceof IOException)) return FailKind.ANSWER;
    String m = e.getMessage() == null ? "" : e.getMessage();
    if (m.startsWith("modbus exception")
        || m.startsWith("fc mismatch")
        || m.startsWith("length mismatch")
        || m.startsWith("short pdu")) {
      return FailKind.ANSWER;
    }
    String low = m.toLowerCase(Locale.ROOT);
    if ("udp timeout".equals(m) || low.contains("read timed out")) return FailKind.TIMEOUT;
    if (low.contains("connection refused")
        || low.contains("connect timed out")
        || low.contains("connect failed")
        || low.contains("no route")
        || low.contains("unreachable")
        || low.contains("udp send failed")) {
      return FailKind.CONNECT;
    }
    return FailKind.BROKEN;
  }

  /** 状态栏用。没配备用时返回空串。 */
  public String activeSideNote(DeviceMeta dev) {
    ModbusChannel ch;
    try {
      ch = channelFor(dev);
    } catch (Exception e) {
      return "";
    }
    if (!ch.hasBackup()) return "";
    boolean backup = Boolean.TRUE.equals(preferBackup.get(dev.deviceId()));
    String side = backup ? "备" : "主";
    return side + " " + ch.activeHost(backup) + ":" + ch.activePort(backup);
  }

  private ModbusClient clientFor(DeviceMeta dev, ModbusChannel ch) throws Exception {
    ScadaProperties.Modbus cfg = props.getModbus();
    String key = dev.deviceId();
    if (!ch.hasBackup()) {
      preferBackup.remove(key);
    }
    boolean backup = Boolean.TRUE.equals(preferBackup.get(key)) && ch.hasBackup();
    String host = ch.activeHost(backup);
    int port = ch.activePort(backup);
    ModbusChannel prevCh = channels.get(key);
    if (prevCh != null
        && (!prevCh.host().equals(ch.host())
            || prevCh.port() != ch.port()
            || prevCh.wordSwap() != ch.wordSwap()
            || prevCh.dwordSwap() != ch.dwordSwap()
            || !sameBackup(prevCh, ch))) {
      dropSocket(key);
      badRounds.remove(key);
    }
    boolean udp = isUdpProtocol(dev.protocol());
    ModbusClient existing = clients.get(key);
    if (existing != null
        && existing.host().equals(host)
        && existing.port() == port
        && udp == (existing instanceof ModbusUdpClient)) {
      return existing;
    }
    if (existing != null) dropSocket(key);
    ModbusClient created =
        udp
            ? new ModbusUdpClient(host, port, cfg.getUnitId(), cfg.getResponseTimeoutMs())
            : new ModbusTcpClient(
                host,
                port,
                cfg.getUnitId(),
                cfg.getConnectTimeoutMs(),
                cfg.getResponseTimeoutMs());
    ModbusClient prev = clients.putIfAbsent(key, created);
    if (prev != null) {
      created.close();
      return prev;
    }
    channels.put(key, ch);
    acqLog.info(
        log,
        "open:" + key,
        "modbus session open device={} {}:{} side={} unit={} word={} dword={}",
        key,
        host,
        port,
        backup ? "backup" : "primary",
        cfg.getUnitId(),
        ch.wordSwap(),
        ch.dwordSwap());
    return created;
  }

  private static boolean sameBackup(ModbusChannel a, ModbusChannel b) {
    if (a.hasBackup() != b.hasBackup()) return false;
    if (!a.hasBackup()) return true;
    return a.backupHost().equals(b.backupHost()) && a.backupPort() == b.backupPort();
  }

  static String normalizeType(String dataType) {
    if (dataType == null || dataType.isBlank()) return "float";
    return dataType.trim().toLowerCase(Locale.ROOT);
  }

  /** 旧 int ≡ short；字数可由地址 #len 覆盖 */
  static int resolveLength(String dt, ModbusAddress addr) {
    if (addr.bit() != null) return 1;
    if (addr.length() != null) return addr.length();
    return switch (normalizeType(dt)) {
      case "bool", "byte", "char", "short", "word", "int", "string" -> 1;
      case "float", "long", "dword" -> 2;
      case "double", "llong", "qword" -> 4;
      default -> 1;
    };
  }

  private Object readValue(
      ModbusClient client, ModbusChannel ch, TagMeta meta, ModbusAddress addr) throws Exception {
    String dt = normalizeType(meta.dataType());
    if (addr.isCoilSpace()) {
      boolean[] bits = client.readBits(addr.readFc(), addr.offset(), 1);
      return decodeCoilBit(dt, bits.length > 0 && bits[0]);
    }
    if ("bool".equals(dt) || addr.bit() != null) {
      int[] regs = client.readRegisters(addr.readFc(), addr.offset(), 1);
      return decodeRegisterBit(ch, dt, addr, regs);
    }

    int len = resolveLength(dt, addr);
    int[] regs = client.readRegisters(addr.readFc(), addr.offset(), len);
    return decodeRegisters(ch, dt, len, regs);
  }

  /** 一次轮询的结果。connect 只描述套接字能不能连上，读超时不算。 */
  public record BatchRead(List<ReadOk> values, ConnectSignal connect) {}

  public enum ConnectSignal {
    /** 这次连上了，或只是没回包。清掉连不上的累计。 */
    CLEAR,
    /** 当前口又连不上一次。 */
    FAIL,
    /** 刚换到另一侧，另一侧这一下没连上。旧的累计清掉，从 1 再计。 */
    RESTART
  }

  /**
   * 同一次轮询里到期的点合成一批，只计 1 轮。一组没回包就读下一组，已经读到的好点留下。
   * 对端断开或连不上时，剩下的组不再等。
   */
  public BatchRead readBatch(DeviceMeta dev, List<TagMeta> due) throws Exception {
    if (due == null || due.isEmpty()) return new BatchRead(List.of(), ConnectSignal.CLEAR);
    ModbusChannel ch = channelFor(dev);
    List<ModbusReadPlan.Group> groups = ModbusReadPlan.plan(due);
    List<ReadOk> out = new ArrayList<>(due.size());
    java.util.LinkedHashMap<String, ReadOk> byId = new java.util.LinkedHashMap<>();
    boolean sawGood = false;
    boolean sawLinkFail = false;
    boolean sawAnswer = false;
    boolean sawConnect = false;
    boolean skipRest = false;
    ConnectSignal connect;
    java.util.ArrayList<ModbusReadPlan.Group> timeoutGroups = new java.util.ArrayList<>();
    synchronized (gate(dev.deviceId())) {
      for (ModbusReadPlan.Group g : groups) {
        if (skipRest) {
          markGroupBad(g, byId);
          continue;
        }
        try {
          readGroup(clientFor(dev, ch), ch, g, byId);
          sawGood = true;
        } catch (Exception ex) {
          switch (classify(ex)) {
            case ANSWER -> {
              markGroupBad(g, byId);
              if (groupHasGood(g, byId)) sawGood = true;
              sawAnswer = true;
            }
            case TIMEOUT -> {
              sawLinkFail = true;
              timeoutGroups.add(g);
            }
            case CONNECT -> {
              markGroupBad(g, byId);
              sawLinkFail = true;
              sawConnect = true;
              skipRest = true;
              dropSocket(dev.deviceId());
            }
            case BROKEN -> {
              markGroupBad(g, byId);
              sawLinkFail = true;
              skipRest = true;
              dropSocket(dev.deviceId());
            }
          }
        }
      }
      // 同轮已有成功组时，对超时组再读一次，缩小丢包造成的线圈/寄存器品质窗口。
      // 整台设备都没读到则不再重试，以免把掉线检测拖成两次超时。
      if (!timeoutGroups.isEmpty()) {
        if (sawGood && !skipRest) {
          for (ModbusReadPlan.Group g : timeoutGroups) {
            try {
              readGroup(clientFor(dev, ch), ch, g, byId);
              sawGood = true;
            } catch (Exception ex) {
              markGroupBad(g, byId);
              if (groupHasGood(g, byId)) sawGood = true;
              switch (classify(ex)) {
                case ANSWER -> sawAnswer = true;
                case TIMEOUT -> sawLinkFail = true;
                case CONNECT -> {
                  sawLinkFail = true;
                  sawConnect = true;
                  dropSocket(dev.deviceId());
                }
                case BROKEN -> {
                  sawLinkFail = true;
                  dropSocket(dev.deviceId());
                }
              }
            }
          }
        } else {
          for (ModbusReadPlan.Group g : timeoutGroups) markGroupBad(g, byId);
        }
      }
      connect = noteRound(dev, ch, sawGood, sawLinkFail, sawAnswer, sawConnect);
    }
    for (TagMeta meta : due) {
      ReadOk r = byId.get(meta.tagId());
      if (r != null) out.add(r);
      else throw new IllegalStateException("batch miss tag=" + meta.tagId());
    }
    return new BatchRead(out, connect);
  }

  private void readGroup(
      ModbusClient client,
      ModbusChannel ch,
      ModbusReadPlan.Group g,
      java.util.Map<String, ReadOk> byId)
      throws Exception {
    if (g.bitSpace()) {
      boolean[] bits = client.readBits(g.fc(), g.start(), g.quantity());
      for (ModbusReadPlan.Slot slot : g.slots()) {
        int idx = slot.offset() - g.start();
        boolean on = idx >= 0 && idx < bits.length && bits[idx];
        String dt = normalizeType(slot.meta().dataType());
        byId.put(slot.meta().tagId(), new ReadOk(decodeCoilBit(dt, on), "Good"));
      }
      return;
    }
    int[] regs = client.readRegisters(g.fc(), g.start(), g.quantity());
    for (ModbusReadPlan.Slot slot : g.slots()) {
      String dt = normalizeType(slot.meta().dataType());
      int rel = slot.offset() - g.start();
      if ("bool".equals(dt) || slot.addr().bit() != null) {
        int[] one = sliceRegs(regs, rel, 1);
        byId.put(
            slot.meta().tagId(), new ReadOk(decodeRegisterBit(ch, dt, slot.addr(), one), "Good"));
      } else {
        int len = slot.length();
        int[] slice = sliceRegs(regs, rel, len);
        byId.put(slot.meta().tagId(), new ReadOk(decodeRegisters(ch, dt, len, slice), "Good"));
      }
    }
  }

  private static void markGroupBad(ModbusReadPlan.Group g, java.util.Map<String, ReadOk> byId) {
    for (ModbusReadPlan.Slot slot : g.slots()) {
      byId.putIfAbsent(slot.meta().tagId(), new ReadOk(null, "Bad"));
    }
  }

  private static boolean groupHasGood(ModbusReadPlan.Group g, java.util.Map<String, ReadOk> byId) {
    for (ModbusReadPlan.Slot slot : g.slots()) {
      ReadOk got = byId.get(slot.meta().tagId());
      if (got != null && "Good".equals(got.quality())) return true;
    }
    return false;
  }

  /**
   * 整批没有好点才加 1。满 3 次就换到另一侧，并马上连接。有好点或设备已应答则清零。
   * 备用通着不切回主。
   */
  private ConnectSignal noteRound(
      DeviceMeta dev,
      ModbusChannel ch,
      boolean sawGood,
      boolean sawLinkFail,
      boolean sawAnswer,
      boolean sawConnect) {
    String id = dev.deviceId();
    if (sawGood || sawAnswer || !sawLinkFail) {
      badRounds.remove(id);
      return ConnectSignal.CLEAR;
    }
    int rounds = badRounds.merge(id, 1, Integer::sum);
    boolean backup = Boolean.TRUE.equals(preferBackup.get(id));
    if (rounds < 3) {
      acqLog.warn(
          log,
          "round:" + id,
          "modbus device={} side={} badRounds={}",
          id,
          backup ? "backup" : "primary",
          rounds);
      return sawConnect ? ConnectSignal.FAIL : ConnectSignal.CLEAR;
    }
    badRounds.remove(id);
    if (!ch.hasBackup()) {
      acqLog.warn(
          log,
          "round:" + id,
          "modbus device={} {} bad rounds, no backup",
          id,
          rounds);
      return sawConnect ? ConnectSignal.FAIL : ConnectSignal.CLEAR;
    }
    preferBackup.put(id, !backup);
    dropSocket(id);
    String next = ch.activeHost(!backup) + ":" + ch.activePort(!backup);
    try {
      clientFor(dev, ch).ensureConnected();
      acqLog.warn(
          log,
          "failover:" + id,
          "modbus failover device={} {} -> {} after {} bad rounds",
          id,
          backup ? "backup" : "primary",
          next,
          rounds);
      return ConnectSignal.CLEAR;
    } catch (Exception ex) {
      dropSocket(id);
      acqLog.warn(
          log,
          "failover:" + id,
          "modbus failover device={} {} -> {} connect failed",
          id,
          backup ? "backup" : "primary",
          next);
      return classify(ex) == FailKind.CONNECT ? ConnectSignal.RESTART : ConnectSignal.CLEAR;
    }
  }

  private static int[] sliceRegs(int[] regs, int rel, int len) {
    int[] slice = new int[len];
    for (int i = 0; i < len; i++) {
      int idx = rel + i;
      slice[i] = (idx >= 0 && idx < regs.length) ? regs[idx] : 0;
    }
    return slice;
  }

  private static Object decodeCoilBit(String dt, boolean on) {
    return "bool".equals(dt) ? on : (on ? 1 : 0);
  }

  private Object decodeRegisterBit(
      ModbusChannel ch, String dt, ModbusAddress addr, int[] regs) {
    int[] ordered = applyWordSwap(regs, ch.wordSwap());
    int word = ordered.length > 0 ? ordered[0] & 0xffff : 0;
    int bit = addr.bit() != null ? addr.bit() : 0;
    boolean on = ((word >> bit) & 1) != 0;
    return "bool".equals(dt) ? on : (on ? 1 : 0);
  }

  private Object decodeRegisters(ModbusChannel ch, String dt, int len, int[] regs) {
    ModbusSwap swap = len >= 2 ? ch.dwordSwap() : ch.wordSwap();
    int[] ordered = applySwap(regs, swap);
    return switch (dt) {
      case "byte" -> ordered[0] & 0xff;
      case "char" -> String.valueOf((char) (ordered[0] & 0xff));
      case "word" -> ordered[0] & 0xffff;
      case "short", "int" -> {
        int raw = ordered[0] & 0xffff;
        yield (raw & 0x8000) != 0 ? raw - 65536 : raw;
      }
      case "float" -> decodeFloat32(ordered[0], ordered.length > 1 ? ordered[1] : 0);
      case "long" -> decodeInt32(ordered, true);
      case "dword" -> decodeInt32(ordered, false);
      case "double" -> decodeFloat64(ordered);
      case "llong" -> decodeInt64(ordered, true);
      case "qword" -> decodeInt64(ordered, false);
      case "string" -> decodeString(ordered);
      default -> {
        int raw = ordered[0] & 0xffff;
        yield (raw & 0x8000) != 0 ? raw - 65536 : raw;
      }
    };
  }

  private void writeValue(
      ModbusClient client, ModbusChannel ch, TagMeta meta, ModbusAddress addr, Object value)
      throws Exception {
    String dt = normalizeType(meta.dataType());
    if ("coil".equals(addr.area())) {
      client.writeCoil(addr.offset(), toBool(value));
      return;
    }
    if ("bool".equals(dt) || addr.bit() != null) {
      int bit = addr.bit() != null ? addr.bit() : 0;
      int[] regs = client.readRegisters(3, addr.offset(), 1);
      int[] ordered = applyWordSwap(regs, ch.wordSwap());
      int word = ordered[0] & 0xffff;
      int mask = 1 << bit;
      word = toBool(value) ? (word | mask) : (word & ~mask);
      int[] wire = applyWordSwap(new int[] {word}, ch.wordSwap()); // swap is involution for bytes
      client.writeSingleRegister(addr.offset(), wire[0] & 0xffff);
      return;
    }

    int len = resolveLength(dt, addr);
    int[] logical =
        switch (dt) {
          case "byte" -> new int[] {((int) Math.rint(toDouble(value))) & 0xff};
          case "char" -> {
            String s = String.valueOf(value);
            int c = s.isEmpty() ? 0 : s.charAt(0) & 0xff;
            yield new int[] {c};
          }
          case "word" -> new int[] {((int) Math.rint(toDouble(value))) & 0xffff};
          case "short", "int" -> new int[] {((int) Math.rint(toDouble(value))) & 0xffff};
          case "float" -> encodeFloat32(toDouble(value));
          case "long" -> encodeInt32((long) Math.rint(toDouble(value)), true);
          case "dword" -> encodeInt32((long) Math.rint(toDouble(value)), false);
          case "double" -> encodeFloat64(toDouble(value));
          case "llong" -> encodeInt64(toLong(value), true);
          case "qword" -> encodeInt64(toLong(value), false);
          case "string" -> encodeString(String.valueOf(value), len);
          default -> new int[] {((int) Math.rint(toDouble(value))) & 0xffff};
        };

    ModbusSwap swap = len >= 2 ? ch.dwordSwap() : ch.wordSwap();
    int[] wire = applySwap(logical, swap);
    if (wire.length == 1) {
      client.writeSingleRegister(addr.offset(), wire[0] & 0xffff);
    } else {
      client.writeRegisters(addr.offset(), wire);
    }
  }

  private static int[] applyWordSwap(int[] regs, ModbusSwap swap) {
    byte[] bytes = ModbusSwap.regsToBytes(regs);
    bytes = swap.apply(bytes, regs.length);
    return ModbusSwap.bytesToRegs(bytes);
  }

  private static int[] applySwap(int[] regs, ModbusSwap swap) {
    byte[] bytes = ModbusSwap.regsToBytes(regs);
    bytes = swap.apply(bytes, regs.length);
    return ModbusSwap.bytesToRegs(bytes);
  }

  static double decodeFloat32(int reg0, int reg1) {
    int bits = ((reg0 & 0xffff) << 16) | (reg1 & 0xffff);
    return Float.intBitsToFloat(bits);
  }

  static int[] encodeFloat32(double value) {
    int bits = Float.floatToIntBits((float) value);
    return new int[] {(bits >>> 16) & 0xffff, bits & 0xffff};
  }

  static long decodeInt32(int[] regs, boolean signed) {
    long v = (((long) (regs[0] & 0xffff)) << 16) | (regs[1] & 0xffff);
    if (!signed) return v;
    if ((v & 0x8000_0000L) != 0) v -= 0x1_0000_0000L;
    return v;
  }

  static int[] encodeInt32(long value, boolean signed) {
    long v = signed ? value : (value & 0xffff_ffffL);
    return new int[] {(int) ((v >>> 16) & 0xffff), (int) (v & 0xffff)};
  }

  static double decodeFloat64(int[] regs) {
    long bits = 0;
    for (int i = 0; i < 4 && i < regs.length; i++) {
      bits = (bits << 16) | (regs[i] & 0xffff);
    }
    return Double.longBitsToDouble(bits);
  }

  static int[] encodeFloat64(double value) {
    long bits = Double.doubleToLongBits(value);
    return new int[] {
      (int) ((bits >>> 48) & 0xffff),
      (int) ((bits >>> 32) & 0xffff),
      (int) ((bits >>> 16) & 0xffff),
      (int) (bits & 0xffff)
    };
  }

  static Object decodeInt64(int[] regs, boolean signed) {
    long bits = 0;
    for (int i = 0; i < 4 && i < regs.length; i++) {
      bits = (bits << 16) | (regs[i] & 0xffff);
    }
    if (!signed) {
      // JS/JSON 安全：大无符号用 double 可能丢精度；仍返回 long，Jackson 会序列化
      return bits;
    }
    return bits;
  }

  static int[] encodeInt64(long value, boolean signed) {
    long v = value;
    return new int[] {
      (int) ((v >>> 48) & 0xffff),
      (int) ((v >>> 32) & 0xffff),
      (int) ((v >>> 16) & 0xffff),
      (int) (v & 0xffff)
    };
  }

  static String decodeString(int[] regs) {
    byte[] raw = ModbusSwap.regsToBytes(regs);
    int end = raw.length;
    while (end > 0 && raw[end - 1] == 0) end--;
    return new String(raw, 0, end, StandardCharsets.ISO_8859_1);
  }

  static int[] encodeString(String s, int words) {
    byte[] raw = (s == null ? "" : s).getBytes(StandardCharsets.ISO_8859_1);
    byte[] buf = new byte[words * 2];
    System.arraycopy(raw, 0, buf, 0, Math.min(raw.length, buf.length));
    return ModbusSwap.bytesToRegs(buf);
  }

  private static boolean toBool(Object v) {
    if (v instanceof Boolean b) return b;
    if (v instanceof Number n) return n.doubleValue() != 0;
    String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
    return "true".equals(s) || "1".equals(s) || "on".equals(s);
  }

  private static double toDouble(Object v) {
    if (v instanceof Number n) return n.doubleValue();
    return Double.parseDouble(String.valueOf(v));
  }

  private static long toLong(Object v) {
    if (v instanceof Number n) return n.longValue();
    return Long.parseLong(String.valueOf(v).trim());
  }

  public void invalidateOnError(String deviceId, Exception e) {
    synchronized (gate(deviceId)) {
      ModbusClient c = clients.get(deviceId);
      if (c instanceof ModbusUdpClient) {
        log.debug("modbus udp keep session {}: {}", deviceId, e.toString());
        return;
      }
    }
    dropClient(deviceId);
    log.debug("modbus client reset {}: {}", deviceId, e.toString());
  }

  public void pingDevice(DeviceMeta dev) throws Exception {
    ModbusChannel ch = channelFor(dev);
    synchronized (gate(dev.deviceId())) {
      withLink(
          dev,
          ch,
          client -> {
            client.ensureConnected();
            return null;
          });
    }
  }
}
