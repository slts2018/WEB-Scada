package com.webscada.server.device.modbus;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** 按设备轮询 Modbus 变量地址，写入 Tag 运行时（变量表实时值）。 */
@Service
public class ModbusPollService {
  private static final Logger log = LoggerFactory.getLogger(ModbusPollService.class);

  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final ModbusTagIo io;
  private final ScadaProperties props;
  private final AtomicBoolean busy = new AtomicBoolean(false);
  private final ModbusAcqLog acqLog = new ModbusAcqLog();
  /** deviceId → 上一轮是否在线（用于掉线/恢复 INFO） */
  private final ConcurrentHashMap<String, Boolean> lastOnline = new ConcurrentHashMap<>();

  public ModbusPollService(
      DeviceFileStore devices, TagRuntimeService runtime, ModbusTagIo io, ScadaProperties props) {
    this.devices = devices;
    this.runtime = runtime;
    this.io = io;
    this.props = props;
  }

  @Scheduled(fixedDelayString = "${webscada.modbus.poll-ms:1000}", initialDelay = 2500)
  public void poll() {
    if (!io.enabled()) return;
    if (!busy.compareAndSet(false, true)) return;
    try {
      doPoll();
    } catch (Exception e) {
      acqLog.warn(log, "poll-loop", "modbus poll loop failed: {}", e.toString());
    } finally {
      busy.set(false);
    }
  }

  private void doPoll() throws Exception {
    List<DeviceMeta> all = devices.list();
    Map<String, DeviceMeta> modbusDevs = new HashMap<>();
    for (DeviceMeta d : all) {
      if (d.enabled() && ModbusTagIo.isModbusProtocol(d.protocol())) {
        modbusDevs.put(d.deviceId(), d);
      }
    }
    if (modbusDevs.isEmpty()) return;

    Map<String, List<TagMeta>> byDevice = new HashMap<>();
    for (TagMeta meta : runtime.getMetas()) {
      if (meta.deviceId() == null || !modbusDevs.containsKey(meta.deviceId())) continue;
      if (ModbusAddress.parse(meta.address()) == null) continue;
      byDevice.computeIfAbsent(meta.deviceId(), k -> new ArrayList<>()).add(meta);
    }

    boolean trace = props.getModbus().isTrace();
    for (DeviceMeta dev : modbusDevs.values()) {
      String deviceId = dev.deviceId();
      List<TagMeta> tags = byDevice.getOrDefault(deviceId, List.of());
      long t0 = System.currentTimeMillis();

      if (tags.isEmpty()) {
        try {
          io.pingDevice(dev);
          noteOnline(deviceId, true, "connected (no tags)");
          io.reportOnline(deviceId, true, "已连接（无采集点）");
        } catch (Exception ex) {
          io.invalidateOnError(deviceId, ex);
          noteOnline(deviceId, false, shortMsg(ex));
          io.reportOnline(deviceId, false, ex.getMessage());
        }
        continue;
      }

      int ok = 0;
      int fail = 0;
      String lastErr = null;
      boolean needReset = false;
      for (TagMeta meta : tags) {
        try {
          ModbusTagIo.ReadOk r = io.read(meta);
          Object v = coerce(meta.dataType(), r.value());
          runtime.setTagValue(meta.tagId(), v, r.quality());
          ok++;
          if (trace && log.isDebugEnabled()) {
            log.debug(
                "modbus read ok device={} tag={} addr={} value={}",
                deviceId,
                meta.tagId(),
                meta.address(),
                v);
          }
        } catch (Exception ex) {
          fail++;
          lastErr = shortMsg(ex);
          needReset = true;
          markBad(meta);
          acqLog.warn(
              log,
              "read:" + meta.tagId(),
              "modbus read fail device={} tag={} addr={} err={}",
              deviceId,
              meta.tagId(),
              meta.address(),
              lastErr);
        }
      }
      if (needReset) {
        io.invalidateOnError(deviceId, new Exception(lastErr != null ? lastErr : "point fail"));
      }

      long cost = System.currentTimeMillis() - t0;
      if (ok > 0 && fail == 0) {
        noteOnline(deviceId, true, "poll ok " + ok + " pts " + cost + "ms");
        io.reportOnline(deviceId, true, "已采集 " + ok + " 点");
        if (trace) {
          log.debug("modbus poll ok device={} points={} costMs={}", deviceId, ok, cost);
        } else {
          // 全成功：约 30s 一条心跳，避免每秒刷屏
          acqLog.info(
              log,
              "round:" + deviceId,
              30_000,
              "modbus poll ok device={} points={} costMs={}",
              deviceId,
              ok,
              cost);
        }
      } else if (ok > 0) {
        noteOnline(deviceId, true, "partial " + ok + "/" + (ok + fail));
        io.reportOnline(deviceId, true, "部分成功 " + ok + "/" + (ok + fail));
        acqLog.warn(
            log,
            "partial:" + deviceId,
            "modbus poll partial device={} ok={} fail={} lastErr={} costMs={}",
            deviceId,
            ok,
            fail,
            lastErr,
            cost);
      } else {
        noteOnline(deviceId, false, lastErr != null ? lastErr : "all points failed");
        io.reportOnline(deviceId, false, lastErr != null ? lastErr : "采集失败");
      }
    }
  }

  private void noteOnline(String deviceId, boolean online, String detail) {
    Boolean prev = lastOnline.put(deviceId, online);
    if (prev != null && prev == online) return;
    if (online) {
      log.info("modbus device online device={} detail={}", deviceId, detail);
    } else {
      log.warn("modbus device offline device={} detail={}", deviceId, detail);
    }
  }

  private static String shortMsg(Exception e) {
    String m = e.getMessage();
    if (m == null || m.isBlank()) return e.getClass().getSimpleName();
    return m.length() > 160 ? m.substring(0, 160) + "…" : m;
  }

  private void markBad(TagMeta meta) {
    TagValue cur = runtime.getTagValue(meta.tagId());
    Object v = cur != null ? cur.value() : defaultVal(meta.dataType());
    runtime.setTagValue(meta.tagId(), v, "Bad");
  }

  private static Object coerce(String dataType, Object raw) {
    if (raw == null) return defaultVal(dataType);
    String dt = dataType == null ? "float" : dataType;
    return switch (dt) {
      case "bool" -> {
        if (raw instanceof Boolean b) yield b;
        if (raw instanceof Number n) yield n.doubleValue() != 0;
        yield Boolean.parseBoolean(String.valueOf(raw));
      }
      case "byte", "short", "word", "int", "long", "dword", "llong", "qword" -> {
        if (raw instanceof Number n) yield n.longValue();
        yield (long) Math.rint(Double.parseDouble(String.valueOf(raw)));
      }
      case "char", "string" -> String.valueOf(raw);
      case "float", "double" -> {
        if (raw instanceof Number n) yield n.doubleValue();
        yield Double.parseDouble(String.valueOf(raw));
      }
      default -> {
        if (raw instanceof Number n) yield n.doubleValue();
        yield Double.parseDouble(String.valueOf(raw));
      }
    };
  }

  private static Object defaultVal(String dataType) {
    return switch (dataType == null ? "float" : dataType) {
      case "bool" -> false;
      case "char", "string" -> "";
      case "float", "double" -> 0.0;
      default -> 0;
    };
  }
}
