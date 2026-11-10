package com.webscada.server.device.modbus;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 按每个变量自己的扫描周期读 Modbus 点，写入 Tag 运行时。
 *
 * <p>默认 {@code isolated}：每设备独立单线程队列，坏设备冷却不拖累其它设备；同设备到期点批量合并读。
 * {@code legacy}：全局单线程串行（回滚）。
 */
@Service
public class ModbusPollService {
  private static final Logger log = LoggerFactory.getLogger(ModbusPollService.class);

  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final ModbusTagIo io;
  private final ScadaProperties props;
  private final AtomicBoolean legacyBusy = new AtomicBoolean(false);
  private final ModbusAcqLog acqLog = new ModbusAcqLog();
  private final ModbusDeviceHealth health = new ModbusDeviceHealth();
  /** deviceId → 上一轮是否在线（用于掉线/恢复 INFO） */
  private final ConcurrentHashMap<String, Boolean> lastOnline = new ConcurrentHashMap<>();
  /** tagId 或探测键 → 上次发起读取的时间 */
  private final ConcurrentHashMap<String, Long> lastScanAt = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, DeviceWorker> workers = new ConcurrentHashMap<>();

  public ModbusPollService(
      DeviceFileStore devices, TagRuntimeService runtime, ModbusTagIo io, ScadaProperties props) {
    this.devices = devices;
    this.runtime = runtime;
    this.io = io;
    this.props = props;
  }

  @Scheduled(fixedDelay = 50, initialDelay = 2500)
  public void poll() {
    if (!io.enabled()) return;
    if (props.getModbus().isLegacyScheduler()) {
      if (!legacyBusy.compareAndSet(false, true)) return;
      try {
        dispatchAll(true);
      } catch (Exception e) {
        acqLog.warn(log, "poll-loop", "modbus poll loop failed: {}", e.toString());
      } finally {
        legacyBusy.set(false);
      }
      return;
    }

    try {
      dispatchAll(false);
    } catch (Exception e) {
      acqLog.warn(log, "poll-loop", "modbus poll dispatch failed: {}", e.toString());
    }
  }

  @PreDestroy
  public void shutdown() {
    for (DeviceWorker w : workers.values()) {
      w.shutdown();
    }
    workers.clear();
  }

  private void dispatchAll(boolean legacyInline) throws Exception {
    List<DeviceMeta> all = devices.list();
    Map<String, DeviceMeta> modbusDevs = new HashMap<>();
    for (DeviceMeta d : all) {
      if (d.enabled() && ModbusTagIo.isModbusProtocol(d.protocol())) {
        modbusDevs.put(d.deviceId(), d);
      }
    }
    if (modbusDevs.isEmpty()) {
      pruneWorkers(Set.of());
      return;
    }

    Map<String, List<TagMeta>> byDevice = new HashMap<>();
    for (TagMeta meta : runtime.getMetas()) {
      if (meta.deviceId() == null || !modbusDevs.containsKey(meta.deviceId())) continue;
      if (ModbusAddress.parse(meta.address()) == null) continue;
      byDevice.computeIfAbsent(meta.deviceId(), k -> new ArrayList<>()).add(meta);
    }

    pruneWorkers(modbusDevs.keySet());

    for (DeviceMeta dev : modbusDevs.values()) {
      String deviceId = dev.deviceId();
      List<TagMeta> tags = byDevice.getOrDefault(deviceId, List.of());
      if (legacyInline) {
        pollOneDevice(dev, tags);
      } else {
        DeviceWorker worker =
            workers.computeIfAbsent(deviceId, id -> new DeviceWorker(id));
        List<TagMeta> snapshot = List.copyOf(tags);
        worker.tryRun(() -> pollOneDevice(dev, snapshot));
      }
    }
  }

  private void pruneWorkers(Set<String> liveIds) {
    Set<String> known = new HashSet<>(workers.keySet());
    for (String id : known) {
      if (!liveIds.contains(id)) {
        DeviceWorker w = workers.remove(id);
        if (w != null) w.shutdown();
        health.clear(id);
        lastOnline.remove(id);
      }
    }
  }

  private void pollOneDevice(DeviceMeta dev, List<TagMeta> tags) {
    String deviceId = dev.deviceId();
    long now = System.currentTimeMillis();
    long t0 = now;
    boolean trace = props.getModbus().isTrace();
    long pingEvery = Math.max(1000L, props.getModbus().getPollMs());
    long cooldownMs = props.getModbus().getDeviceCooldownMs();
    int maxFail = props.getModbus().getMaxFailBeforeCooldown();

    if (health.inCooldown(deviceId, now)) {
      if (!tags.isEmpty()) {
        List<TagMeta> due = collectDue(tags, now);
        for (TagMeta meta : due) {
          markBad(meta);
        }
        if (!due.isEmpty()) {
          noteOnline(deviceId, false, "cooldown " + health.cooldownRemainingMs(deviceId, now) + "ms");
          io.reportOnline(
              deviceId,
              false,
              withSide(dev, "冷却中 " + health.cooldownRemainingMs(deviceId, now) + "ms"));
        }
      }
      return;
    }

    if (tags.isEmpty()) {
      if (!scanDue("ping:" + deviceId, pingEvery, now)) return;
      lastScanAt.put("ping:" + deviceId, now);
      try {
        io.pingDevice(dev);
        health.onSuccess(deviceId);
        noteOnline(deviceId, true, "connected (no tags)");
        io.reportOnline(deviceId, true, withSide(dev, "已连接（无采集点）"));
      } catch (Exception ex) {
        io.invalidateOnError(deviceId, ex);
        health.onFailure(deviceId, System.currentTimeMillis(), cooldownMs, maxFail);
        noteOnline(deviceId, false, shortMsg(ex));
        io.reportOnline(deviceId, false, ex.getMessage());
      }
      return;
    }

    List<TagMeta> due = collectDue(tags, now);
    if (due.isEmpty()) return;

    int ok = 0;
    int fail = 0;
    String lastErr = null;
    boolean needReset = false;
    try {
      List<ModbusTagIo.ReadOk> results = io.readBatch(dev, due);
      for (int i = 0; i < due.size(); i++) {
        TagMeta meta = due.get(i);
        try {
          ModbusTagIo.ReadOk r = results.get(i);
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
    } catch (Exception ex) {
      needReset = true;
      lastErr = shortMsg(ex);
      for (TagMeta meta : due) {
        fail++;
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
      health.onSuccess(deviceId);
      noteOnline(deviceId, true, "poll ok " + ok + " pts " + cost + "ms");
      io.reportOnline(deviceId, true, withSide(dev, "已采集 " + ok + " 点"));
      if (trace) {
        log.debug("modbus poll ok device={} points={} costMs={}", deviceId, ok, cost);
      } else {
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
      health.onSuccess(deviceId);
      noteOnline(deviceId, true, "partial " + ok + "/" + (ok + fail));
      io.reportOnline(deviceId, true, withSide(dev, "部分成功 " + ok + "/" + (ok + fail)));
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
      health.onFailure(deviceId, System.currentTimeMillis(), cooldownMs, maxFail);
      noteOnline(deviceId, false, lastErr != null ? lastErr : "all points failed");
      io.reportOnline(deviceId, false, lastErr != null ? lastErr : "采集失败");
    }
  }

  private List<TagMeta> collectDue(List<TagMeta> tags, long now) {
    List<TagMeta> due = new ArrayList<>();
    for (TagMeta meta : tags) {
      if (!scanDue(meta.tagId(), scanPeriod(meta), now)) continue;
      due.add(meta);
      lastScanAt.put(meta.tagId(), now);
    }
    return due;
  }

  /** 变量扫描周期。缺省 1 秒，与界面默认一致，最小 50 毫秒。 */
  private static int scanPeriod(TagMeta meta) {
    int ms = meta.scanPeriodMs() == null ? 1000 : meta.scanPeriodMs();
    return Math.max(50, ms);
  }

  private boolean scanDue(String key, long periodMs, long now) {
    long last = lastScanAt.getOrDefault(key, 0L);
    return last == 0L || now - last >= periodMs;
  }

  private String withSide(DeviceMeta dev, String message) {
    String side = io.activeSideNote(dev);
    if (side.isEmpty()) return message;
    return message + " · " + side;
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

  /** 每设备单线程；上一轮未完成则跳过本轮派发（避免堆积）。 */
  private static final class DeviceWorker {
    private static final AtomicInteger SEQ = new AtomicInteger();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final ExecutorService exec;

    DeviceWorker(String deviceId) {
      ThreadFactory tf =
          r -> {
            Thread t = new Thread(r, "modbus-dev-" + deviceId + "-" + SEQ.incrementAndGet());
            t.setDaemon(true);
            return t;
          };
      this.exec = Executors.newSingleThreadExecutor(tf);
    }

    void tryRun(Runnable task) {
      if (!busy.compareAndSet(false, true)) return;
      exec.execute(
          () -> {
            try {
              task.run();
            } catch (Exception e) {
              LoggerFactory.getLogger(ModbusPollService.class)
                  .warn("modbus device worker failed: {}", e.toString());
            } finally {
              busy.set(false);
            }
          });
    }

    void shutdown() {
      exec.shutdownNow();
    }
  }
}
