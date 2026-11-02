package com.webscada.server.device.modbus;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.store.DeviceFileStore;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Modbus TCP 变量读写（按 Tag.address 解析），不依赖 webscada.comm 骨架。 */
@Service
public class ModbusTagIo {
  private static final Logger log = LoggerFactory.getLogger(ModbusTagIo.class);

  private final DeviceFileStore devices;
  private final DeviceStatusService status;
  private final ScadaProperties props;
  private final ConcurrentHashMap<String, ModbusTcpClient> clients = new ConcurrentHashMap<>();
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
    return "modbus_tcp".equals(p) || "modbus-tcp".equals(p);
  }

  public record ReadOk(Object value, String quality) {}

  public ReadOk read(TagMeta meta) throws Exception {
    DeviceMeta dev = devices.get(meta.deviceId());
    if (dev == null) throw new IllegalStateException("device not found");
    ModbusAddress addr = ModbusAddress.parse(meta.address());
    if (addr == null) throw new IllegalArgumentException("bad address: " + meta.address());
    ModbusTcpClient client = clientFor(dev);
    Object value = readValue(client, meta, addr);
    return new ReadOk(value, "Good");
  }

  public void write(TagMeta meta, Object value) throws Exception {
    DeviceMeta dev = devices.get(meta.deviceId());
    if (dev == null) throw new IllegalStateException("device not found");
    ModbusAddress addr = ModbusAddress.parse(meta.address());
    if (addr == null) throw new IllegalArgumentException("bad address: " + meta.address());
    if (!addr.writableArea()) {
      throw new IllegalStateException("area not writable: " + addr.area());
    }
    try {
      ModbusTcpClient client = clientFor(dev);
      writeValue(client, meta, addr, value);
      log.info(
          "modbus write ok device={} tag={} addr={} value={}",
          meta.deviceId(),
          meta.tagId(),
          meta.address(),
          value);
    } catch (Exception e) {
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

  public void reportOnline(String deviceId, boolean online, String message) {
    status.report(deviceId, online, online ? "online" : "offline", message);
  }

  public void dropClient(String deviceId) {
    ModbusTcpClient c = clients.remove(deviceId);
    if (c != null) {
      c.close();
      acqLog.info(log, "close:" + deviceId, "modbus session closed device={}", deviceId);
    }
  }

  private ModbusTcpClient clientFor(DeviceMeta dev) throws Exception {
    HostPort hp = HostPort.parse(dev.channel());
    if (hp == null) throw new IllegalStateException("invalid channel");
    ScadaProperties.Modbus cfg = props.getModbus();
    String key = dev.deviceId();
    ModbusTcpClient existing = clients.get(key);
    if (existing != null) return existing;
    ModbusTcpClient created =
        new ModbusTcpClient(
            hp.host,
            hp.port,
            cfg.getUnitId(),
            cfg.getConnectTimeoutMs(),
            cfg.getResponseTimeoutMs());
    ModbusTcpClient prev = clients.putIfAbsent(key, created);
    if (prev != null) {
      created.close();
      return prev;
    }
    acqLog.info(
        log,
        "open:" + key,
        "modbus session open device={} {}:{} unit={}",
        key,
        hp.host,
        hp.port,
        cfg.getUnitId());
    return created;
  }

  private Object readValue(ModbusTcpClient client, TagMeta meta, ModbusAddress addr)
      throws Exception {
    String dt = meta.dataType() == null ? "float" : meta.dataType();
    if (addr.isCoilSpace()) {
      boolean[] bits = client.readBits(addr.readFc(), addr.offset(), 1);
      boolean on = bits.length > 0 && bits[0];
      return "bool".equals(dt) ? on : (on ? 1 : 0);
    }
    if ("bool".equals(dt) || addr.bit() != null) {
      int[] regs = client.readRegisters(addr.readFc(), addr.offset(), 1);
      int word = regs[0] & 0xffff;
      int bit = addr.bit() != null ? addr.bit() : 0;
      boolean on = ((word >> bit) & 1) != 0;
      return "bool".equals(dt) ? on : (on ? 1 : 0);
    }
    if ("float".equals(dt)) {
      int[] regs = client.readRegisters(addr.readFc(), addr.offset(), 2);
      return decodeFloat32(regs[0], regs[1], props.getModbus().isLowWordFirst());
    }
    // int / string → 单寄存器
    int[] regs = client.readRegisters(addr.readFc(), addr.offset(), 1);
    int raw = regs[0] & 0xffff;
    if ("string".equals(dt)) return String.valueOf(raw);
    // 有符号 int16
    return (raw & 0x8000) != 0 ? raw - 65536 : raw;
  }

  private void writeValue(ModbusTcpClient client, TagMeta meta, ModbusAddress addr, Object value)
      throws Exception {
    String dt = meta.dataType() == null ? "float" : meta.dataType();
    if ("coil".equals(addr.area())) {
      client.writeCoil(addr.offset(), toBool(value));
      return;
    }
    // holding
    if ("bool".equals(dt) || addr.bit() != null) {
      int bit = addr.bit() != null ? addr.bit() : 0;
      int[] regs = client.readRegisters(3, addr.offset(), 1);
      int word = regs[0] & 0xffff;
      int mask = 1 << bit;
      word = toBool(value) ? (word | mask) : (word & ~mask);
      client.writeSingleRegister(addr.offset(), word);
      return;
    }
    if ("float".equals(dt)) {
      int[] words = encodeFloat32(toDouble(value), props.getModbus().isLowWordFirst());
      client.writeRegisters(addr.offset(), words);
      return;
    }
    int v = (int) Math.rint(toDouble(value));
    client.writeSingleRegister(addr.offset(), v & 0xffff);
  }

  static double decodeFloat32(int reg0, int reg1, boolean lowWordFirst) {
    int hi = lowWordFirst ? (reg1 & 0xffff) : (reg0 & 0xffff);
    int lo = lowWordFirst ? (reg0 & 0xffff) : (reg1 & 0xffff);
    int bits = (hi << 16) | lo;
    return Float.intBitsToFloat(bits);
  }

  static int[] encodeFloat32(double value, boolean lowWordFirst) {
    int bits = Float.floatToIntBits((float) value);
    int hi = (bits >>> 16) & 0xffff;
    int lo = bits & 0xffff;
    return lowWordFirst ? new int[] {lo, hi} : new int[] {hi, lo};
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

  public void invalidateOnError(String deviceId, Exception e) {
    dropClient(deviceId);
    log.debug("modbus client reset {}: {}", deviceId, e.toString());
  }

  /** 仅探测 TCP 会话能否建立（无变量时用）。 */
  public void pingDevice(DeviceMeta dev) throws Exception {
    ModbusTcpClient client = clientFor(dev);
    client.ensureConnected();
  }

  private record HostPort(String host, int port) {
    static HostPort parse(String channel) {
      if (channel == null || channel.isBlank()) return null;
      String s = channel.trim();
      int colon = s.lastIndexOf(':');
      if (colon <= 0 || colon >= s.length() - 1) return null;
      try {
        int port = Integer.parseInt(s.substring(colon + 1).trim());
        String host = s.substring(0, colon).trim();
        if (host.isEmpty() || port < 1 || port > 65535) return null;
        return new HostPort(host, port);
      } catch (NumberFormatException e) {
        return null;
      }
    }
  }
}
