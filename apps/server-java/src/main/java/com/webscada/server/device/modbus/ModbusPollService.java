package com.webscada.server.device.modbus;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.CommsEventLogService;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import jakarta.annotation.PostConstruct;
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
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 按每个变量自己的扫描周期读 Modbus 点，写入 Tag 运行时。
 *
 * <p>默认：独立节拍调度（每个变量 {@code nextDue += scanPeriodMs}），采集组互斥，
 * 同一设备的请求在通信层串行排队。调度线程不做设备 IO。
 * {@code legacy}：全局 {@code fixedDelay=50} + 每设备单线程（回滚）。
 */
@Service
public class ModbusPollService {
  private static final Logger log = LoggerFactory.getLogger(ModbusPollService.class);
  private static final long ROSTER_REFRESH_MS = 250L;
  private static final long IDLE_PARK_NS = 50_000_000L;

  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final ModbusTagIo io;
  private final ScadaProperties props;
  private final AtomicBoolean legacyBusy = new AtomicBoolean(false);
  private final ModbusAcqLog acqLog = new ModbusAcqLog();
  private final ModbusDeviceHealth health = new ModbusDeviceHealth();
  /** deviceId → 上一轮是否在线（用于掉线/恢复 INFO） */
  private final ConcurrentHashMap<String, Boolean> lastOnline = new ConcurrentHashMap<>();
  /** tagId 或探测键 → 上次发起读取的时间（仅 legacy） */
  private final ConcurrentHashMap<String, Long> lastScanAt = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, DeviceWorker> workers = new ConcurrentHashMap<>();
  /** deviceId → 上一轮是否启用，用于启停采集事件（停用检查每轮都会跑，必须边沿触发）。 */
  private final ConcurrentHashMap<String, Boolean> lastEnabled = new ConcurrentHashMap<>();
  private final CommsEventLogService commsLog;

  private final ConcurrentHashMap<String, TagBeat> beats = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Long> pingDueNs = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, AtomicBoolean> groupLocks = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, DeviceMeta> enabledDevs = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, List<TagMeta>> tagsByDevice = new ConcurrentHashMap<>();
  private final ModbusCommQueue commQueue = new ModbusCommQueue();
  private final ModbusSchedMetrics metrics = new ModbusSchedMetrics();
  private final AtomicBoolean independentRunning = new AtomicBoolean(false);
  private final Object beatLock = new Object();
  private volatile Thread schedThread;
  private ExecutorService groupExec;
  private ScheduledExecutorService rosterExec;
  /** 采集结果写入运行时/Influx：立即提交、不攒批；不占用采集组互斥，也不跑在调度线程上。 */
  private ExecutorService writeExec;

  public ModbusPollService(
      DeviceFileStore devices,
      TagRuntimeService runtime,
      ModbusTagIo io,
      ScadaProperties props,
      CommsEventLogService commsLog) {
    this.devices = devices;
    this.runtime = runtime;
    this.io = io;
    this.props = props;
    this.commsLog = commsLog;
  }

  @PostConstruct
  public void startIndependent() {
    if (props.getModbus().isLegacyScheduler()) return;
    if (!independentRunning.compareAndSet(false, true)) return;
    AtomicInteger groupSeq = new AtomicInteger();
    ThreadFactory groupTf =
        r -> {
          Thread t = new Thread(r, "modbus-group-" + groupSeq.incrementAndGet());
          t.setDaemon(true);
          return t;
        };
    groupExec = Executors.newCachedThreadPool(groupTf);
    AtomicInteger writeSeq = new AtomicInteger();
    writeExec =
        Executors.newSingleThreadExecutor(
            r -> {
              Thread t = new Thread(r, "modbus-write-" + writeSeq.incrementAndGet());
              t.setDaemon(true);
              return t;
            });
    rosterExec =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "modbus-roster");
              t.setDaemon(true);
              return t;
            });
    rosterExec.scheduleAtFixedRate(
        () -> {
          try {
            refreshRoster();
          } catch (Exception e) {
            acqLog.warn(log, "roster", "modbus roster refresh failed: {}", e.toString());
          }
        },
        0,
        ROSTER_REFRESH_MS,
        TimeUnit.MILLISECONDS);
    Thread t = new Thread(this::schedulerLoop, "modbus-sched");
    t.setDaemon(true);
    schedThread = t;
    t.start();
    log.info("modbus independent scheduler started (per-tag beat, group mutex, comm queue)");
  }

  @Scheduled(fixedDelay = 50, initialDelay = 2500)
  public void poll() {
    if (!io.enabled()) return;
    if (!props.getModbus().isLegacyScheduler()) {
      return;
    }
    if (!legacyBusy.compareAndSet(false, true)) return;
    try {
      dispatchAll(true);
    } catch (Exception e) {
      acqLog.warn(log, "poll-loop", "modbus poll loop failed: {}", e.toString());
    } finally {
      legacyBusy.set(false);
    }
  }

  @PreDestroy
  public void shutdown() {
    independentRunning.set(false);
    wakeup();
    Thread st = schedThread;
    if (st != null) {
      st.interrupt();
      try {
        st.join(1000);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    if (rosterExec != null) {
      rosterExec.shutdownNow();
    }
    if (groupExec != null) {
      groupExec.shutdownNow();
    }
    if (writeExec != null) {
      writeExec.shutdown();
    }
    commQueue.shutdown();
    for (DeviceWorker w : workers.values()) {
      w.shutdown();
    }
    workers.clear();
    groupLocks.clear();
  }

  private void schedulerLoop() {
    while (independentRunning.get()) {
      try {
        maybeLogMetrics();
        if (!io.enabled()) {
          parkFor(IDLE_PARK_NS);
          continue;
        }
        long waitNs;
        synchronized (beatLock) {
          waitNs = dispatchDueLocked(System.nanoTime());
        }
        if (!independentRunning.get()) break;
        if (waitNs > 0) {
          parkUntil(System.nanoTime() + waitNs);
        }
      } catch (Exception e) {
        acqLog.warn(log, "poll-loop", "modbus poll dispatch failed: {}", e.toString());
        parkFor(5_000_000L);
      }
    }
  }

  private void parkFor(long ns) {
    parkUntil(System.nanoTime() + Math.max(0L, ns));
  }

  private void parkUntil(long deadlineNs) {
    while (independentRunning.get()) {
      long left = deadlineNs - System.nanoTime();
      if (left <= 0L) return;
      if (left > 2_000_000L) {
        LockSupport.parkNanos(left - 1_000_000L);
      } else {
        LockSupport.parkNanos(Math.min(left, 200_000L));
      }
    }
  }

  private void wakeup() {
    Thread t = schedThread;
    if (t != null) LockSupport.unpark(t);
  }

  private void maybeLogMetrics() {
    if (!acqLog.allow("sched-metrics", 30_000)) return;
    ModbusSchedMetrics.Snapshot snap = metrics.snapshotAndReset();
    if (snap.n() <= 0) return;
    log.info(
        "modbus sched metrics n={} schedDelayMs p50={} p95={} max={} queueDelayMs p50={} p95={} max={} commExecMs p50={} p95={} max={}",
        snap.n(),
        snap.sched().p50Ms(),
        snap.sched().p95Ms(),
        snap.sched().maxMs(),
        snap.queue().p50Ms(),
        snap.queue().p95Ms(),
        snap.queue().maxMs(),
        snap.comm().p50Ms(),
        snap.comm().p95Ms(),
        snap.comm().maxMs());
  }

  private void refreshRoster() throws Exception {
    List<DeviceMeta> all = devices.list();
    Map<String, DeviceMeta> modbusDevs = new HashMap<>();
    Set<String> disabledModbus = new HashSet<>();
    for (DeviceMeta d : all) {
      if (!ModbusTagIo.isModbusProtocol(d.protocol()) || d.deviceId() == null) continue;
      if (d.enabled()) {
        modbusDevs.put(d.deviceId(), d);
        Boolean prevEn = lastEnabled.put(d.deviceId(), Boolean.TRUE);
        if (prevEn == null || !prevEn) {
          commsLog.deviceEnabledChanged(d, true);
        }
      } else {
        disabledModbus.add(d.deviceId());
      }
    }

    Map<String, List<TagMeta>> byDevice = new HashMap<>();
    for (TagMeta meta : runtime.getMetas()) {
      if (meta.deviceId() == null || !modbusDevs.containsKey(meta.deviceId())) continue;
      if (ModbusAddress.parse(meta.address()) == null) continue;
      byDevice.computeIfAbsent(meta.deviceId(), k -> new ArrayList<>()).add(meta);
    }

    long nowNs = System.nanoTime();
    synchronized (beatLock) {
      applyDisabledDeviceState(disabledModbus);
      enabledDevs.clear();
      enabledDevs.putAll(modbusDevs);
      tagsByDevice.clear();
      for (Map.Entry<String, List<TagMeta>> e : byDevice.entrySet()) {
        tagsByDevice.put(e.getKey(), List.copyOf(e.getValue()));
      }
      reconcileBeats(modbusDevs, byDevice, nowNs);
    }
    markDisabledTagsBad(disabledModbus);
    wakeup();
  }

  private void reconcileBeats(
      Map<String, DeviceMeta> modbusDevs, Map<String, List<TagMeta>> byDevice, long nowNs) {
    Set<String> liveIds = modbusDevs.keySet();
    Set<String> liveTags = new HashSet<>();
    for (List<TagMeta> tags : byDevice.values()) {
      for (TagMeta meta : tags) {
        liveTags.add(meta.tagId());
        int period = ModbusPollPlanner.scanPeriodMs(meta.scanPeriodMs());
        TagBeat prev = beats.get(meta.tagId());
        if (prev == null || prev.periodMs() != period || !meta.deviceId().equals(prev.deviceId())) {
          beats.put(meta.tagId(), new TagBeat(meta.tagId(), meta.deviceId(), period, nowNs, meta));
        } else {
          beats.put(
              meta.tagId(),
              new TagBeat(prev.tagId(), prev.deviceId(), prev.periodMs(), prev.nextDueNs(), meta));
        }
      }
    }
    beats.keySet().removeIf(id -> !liveTags.contains(id));

    for (String deviceId : liveIds) {
      List<TagMeta> tags = byDevice.getOrDefault(deviceId, List.of());
      if (tags.isEmpty()) {
        pingDueNs.putIfAbsent(deviceId, nowNs);
      } else {
        pingDueNs.remove(deviceId);
      }
    }
    pingDueNs.keySet().removeIf(id -> !liveIds.contains(id));

    Set<String> knownWorkers = new HashSet<>(workers.keySet());
    for (String id : knownWorkers) {
      if (!liveIds.contains(id)) {
        DeviceWorker w = workers.remove(id);
        if (w != null) w.shutdown();
      }
    }
    Set<String> knownLocks = new HashSet<>(groupLocks.keySet());
    for (String key : knownLocks) {
      String devId = key.contains("|") ? key.substring(0, key.indexOf('|')) : key;
      if (!liveIds.contains(devId) && !liveIds.contains(key)) {
        groupLocks.remove(key);
      }
    }
    Set<String> knownOnline = new HashSet<>(lastOnline.keySet());
    for (String id : knownOnline) {
      if (!liveIds.contains(id)) {
        health.clear(id);
        lastOnline.remove(id);
        commQueue.drop(id);
      }
    }
  }

  /**
   * 在 beatLock 内收集到期组并派发。返回距离下一次到期（含对齐等待）的纳秒。
   * 调度线程在此方法内不做设备 IO。
   */
  private long dispatchDueLocked(long nowNs) {
    long earliest = Long.MAX_VALUE;
    Map<String, List<TagBeat>> byGroup = new HashMap<>();
    for (TagBeat beat : beats.values()) {
      byGroup.computeIfAbsent(beat.groupKey(), k -> new ArrayList<>()).add(beat);
    }

    List<Runnable> submit = new ArrayList<>();
    for (Map.Entry<String, List<TagBeat>> e : byGroup.entrySet()) {
      String key = e.getKey();
      List<TagBeat> members = e.getValue();
      long[] dues = new long[members.size()];
      boolean anyDue = false;
      long groupEarliest = Long.MAX_VALUE;
      for (int i = 0; i < members.size(); i++) {
        long due = members.get(i).nextDueNs();
        dues[i] = due;
        if (due < groupEarliest) groupEarliest = due;
        if (ModbusPollPlanner.isDue(due, nowNs)) anyDue = true;
      }
      if (!anyDue) {
        if (groupEarliest < earliest) earliest = groupEarliest;
        continue;
      }
      long alignWait = ModbusPollPlanner.alignmentWaitNs(nowNs, dues);
      if (alignWait > 0L) {
        long wakeAt = nowNs + alignWait;
        if (wakeAt < earliest) earliest = wakeAt;
        continue;
      }

      List<TagBeat> dueBeats = new ArrayList<>();
      long scheduledMin = Long.MAX_VALUE;
      for (TagBeat b : members) {
        if (!ModbusPollPlanner.isDue(b.nextDueNs(), nowNs)) continue;
        dueBeats.add(b);
        if (b.nextDueNs() < scheduledMin) scheduledMin = b.nextDueNs();
      }
      if (dueBeats.isEmpty()) continue;

      AtomicBoolean lock = groupLocks.computeIfAbsent(key, k -> new AtomicBoolean(false));
      if (!lock.compareAndSet(false, true)) {
        continue;
      }

      List<TagMeta> dueMetas = new ArrayList<>(dueBeats.size());
      int periodMs = dueBeats.get(0).periodMs();
      String deviceId = dueBeats.get(0).deviceId();
      for (TagBeat b : dueBeats) {
        dueMetas.add(b.meta());
        long next = ModbusPollPlanner.nextBeat(b.nextDueNs(), b.periodNs(), nowNs);
        beats.put(b.tagId(), new TagBeat(b.tagId(), b.deviceId(), b.periodMs(), next, b.meta()));
        if (next < earliest) earliest = next;
      }
      long schedDelayNs = Math.max(0L, nowNs - scheduledMin);
      DeviceMeta dev = enabledDevs.get(deviceId);
      List<TagMeta> snapshot = List.copyOf(dueMetas);
      submit.add(
          new LockedTask(lock, () -> runGroupIsolated(lock, key, dev, snapshot, periodMs, schedDelayNs)));
    }

    long pingEveryMs = Math.max(1000L, props.getModbus().getPollMs());
    long pingEveryNs = pingEveryMs * 1_000_000L;
    for (Map.Entry<String, Long> e : pingDueNs.entrySet()) {
      String deviceId = e.getKey();
      if (tagsByDevice.containsKey(deviceId) && !tagsByDevice.get(deviceId).isEmpty()) continue;
      long due = e.getValue();
      if (!ModbusPollPlanner.isDue(due, nowNs)) {
        if (due < earliest) earliest = due;
        continue;
      }
      String key = "ping:" + deviceId;
      AtomicBoolean lock = groupLocks.computeIfAbsent(key, k -> new AtomicBoolean(false));
      if (!lock.compareAndSet(false, true)) continue;
      long next = ModbusPollPlanner.nextBeat(due, pingEveryNs, nowNs);
      pingDueNs.put(deviceId, next);
      if (next < earliest) earliest = next;
      DeviceMeta dev = enabledDevs.get(deviceId);
      long schedDelayNs = Math.max(0L, nowNs - due);
      submit.add(new LockedTask(lock, () -> runPingIsolated(lock, key, dev, deviceId, schedDelayNs)));
    }

    for (Runnable r : submit) {
      try {
        groupExec.execute(r);
      } catch (RuntimeException ex) {
        // Runnable 没跑起来时，其 finally 不会释放组互斥，必须在这里解开。
        log.warn("modbus group submit failed: {}", ex.toString());
        if (r instanceof LockedTask locked) {
          locked.release();
        }
      }
    }

    if (earliest == Long.MAX_VALUE) return IDLE_PARK_NS;
    return Math.max(0L, earliest - nowNs);
  }

  private void runGroupIsolated(
      AtomicBoolean lock,
      String groupKey,
      DeviceMeta dev,
      List<TagMeta> due,
      int periodMs,
      long schedDelayNs) {
    List<PendingWrite> pending = List.of();
    try {
      if (dev == null || due.isEmpty()) return;
      pending = pollGroup(dev, due, periodMs, schedDelayNs);
    } catch (Exception e) {
      LoggerFactory.getLogger(ModbusPollService.class)
          .warn("modbus group worker failed group={}: {}", groupKey, e.toString());
    } finally {
      lock.set(false);
      wakeup();
    }
    submitWrites(pending);
  }

  private void runPingIsolated(
      AtomicBoolean lock, String groupKey, DeviceMeta dev, String deviceId, long schedDelayNs) {
    try {
      if (dev == null) return;
      pingDevice(dev, schedDelayNs);
    } catch (Exception e) {
      LoggerFactory.getLogger(ModbusPollService.class)
          .warn("modbus ping worker failed group={}: {}", groupKey, e.toString());
    } finally {
      lock.set(false);
      wakeup();
    }
  }

  private void pingDevice(DeviceMeta dev, long schedDelayNs) {
    String deviceId = dev.deviceId();
    long now = System.currentTimeMillis();
    long cooldownMs = props.getModbus().getDeviceCooldownMs();
    int maxFail = props.getModbus().getMaxFailBeforeCooldown();
    if (health.inCooldown(deviceId, now)) {
      commsLog.rememberReason(deviceId, "设备冷却中");
      noteOnline(deviceId, false, "cooldown " + health.cooldownRemainingMs(deviceId, now) + "ms");
      io.reportOnline(
          deviceId,
          false,
          withSide(dev, "冷却中 " + health.cooldownRemainingMs(deviceId, now) + "ms"));
      return;
    }
    try {
      ModbusCommQueue.Timed<Void> timed =
          commQueue.submitTimed(
              deviceId,
              () -> {
                io.pingDevice(dev);
                return null;
              });
      metrics.record(deviceId, (int) Math.max(1000L, props.getModbus().getPollMs()), schedDelayNs, timed.queueNs(), timed.execNs());
      health.onSuccess(deviceId);
      noteOnline(deviceId, true, "connected (no tags)");
      io.reportOnline(deviceId, true, withSide(dev, "已连接（无采集点）"));
    } catch (Exception ex) {
      io.invalidateOnError(deviceId, ex);
      health.onFailure(deviceId, System.currentTimeMillis(), cooldownMs, maxFail);
      noteOnline(deviceId, false, shortMsg(ex));
      io.reportOnline(deviceId, false, ex.getMessage());
    }
  }

  private List<PendingWrite> pollGroup(DeviceMeta dev, List<TagMeta> due, int periodMs, long schedDelayNs) {
    String deviceId = dev.deviceId();
    long now = System.currentTimeMillis();
    long t0 = now;
    boolean trace = props.getModbus().isTrace();
    long cooldownMs = props.getModbus().getDeviceCooldownMs();
    int maxFail = props.getModbus().getMaxFailBeforeCooldown();

    List<PendingWrite> pending = new ArrayList<>();
    if (health.inCooldown(deviceId, now)) {
      for (TagMeta meta : due) {
        pending.add(pendingBad(meta, now));
      }
      commsLog.rememberReason(deviceId, "设备冷却中");
      noteOnline(deviceId, false, "cooldown " + health.cooldownRemainingMs(deviceId, now) + "ms");
      io.reportOnline(
          deviceId,
          false,
          withSide(dev, "冷却中 " + health.cooldownRemainingMs(deviceId, now) + "ms"));
      return pending;
    }

    int ok = 0;
    int fail = 0;
    String lastErr = null;
    boolean needReset = false;
    ModbusTagIo.BatchRead batch = null;
    long queueNs = 0L;
    long commNs = 0L;
    try {
      ModbusCommQueue.Timed<ModbusTagIo.BatchRead> timed =
          commQueue.submitTimed(deviceId, () -> io.readBatch(dev, due));
      queueNs = timed.queueNs();
      commNs = timed.execNs();
      batch = timed.result();
      List<ModbusTagIo.ReadOk> results = batch.values();
      for (int i = 0; i < due.size(); i++) {
        TagMeta meta = due.get(i);
        try {
          ModbusTagIo.ReadOk r = results.get(i);
          if ("Bad".equals(r.quality())) {
            fail++;
            lastErr = "no reply";
            pending.add(pendingBad(meta, now));
            acqLog.warn(
                log,
                "read:" + meta.tagId(),
                "modbus read fail device={} tag={} addr={} err={}",
                deviceId,
                meta.tagId(),
                meta.address(),
                lastErr);
            continue;
          }
          Object v = coerce(meta.dataType(), r.value());
          pending.add(new PendingWrite(meta, v, r.quality(), now));
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
          pending.add(pendingBad(meta, now));
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
      pending.clear();
      for (TagMeta meta : due) {
        fail++;
        pending.add(pendingBad(meta, now));
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

    metrics.record(deviceId, periodMs, schedDelayNs, queueNs, commNs);

    if (needReset) {
      io.invalidateOnError(deviceId, new Exception(lastErr != null ? lastErr : "point fail"));
    }

    long cost = System.currentTimeMillis() - t0;
    if (batch != null) {
      noteConnect(deviceId, batch.connect(), cooldownMs, maxFail);
    }
    if (ok > 0 && fail == 0) {
      health.onSuccess(deviceId);
      noteOnline(deviceId, true, "poll ok " + ok + " pts " + cost + "ms");
      io.reportOnline(deviceId, true, withSide(dev, "已采集 " + ok + " 点"));
      if (trace) {
        log.debug(
            "modbus poll ok device={} points={} costMs={} schedDelayMs={} queueDelayMs={}",
            deviceId,
            ok,
            cost,
            Math.round(schedDelayNs / 1_000_000.0),
            Math.round(queueNs / 1_000_000.0));
      } else {
        acqLog.info(
            log,
            "round:" + deviceId,
            30_000,
            "modbus poll ok device={} points={} costMs={} schedDelayMs={} queueDelayMs={}",
            deviceId,
            ok,
            cost,
            Math.round(schedDelayNs / 1_000_000.0),
            Math.round(queueNs / 1_000_000.0));
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
      noteOnline(deviceId, false, lastErr != null ? lastErr : "all points failed");
      io.reportOnline(deviceId, false, lastErr != null ? lastErr : "采集失败");
    }
    return pending;
  }

  private void submitWrites(List<PendingWrite> pending) {
    if (pending == null || pending.isEmpty() || writeExec == null) return;
    List<PendingWrite> snapshot = List.copyOf(pending);
    try {
      writeExec.execute(
          () -> {
            long t0 = System.nanoTime();
            for (PendingWrite w : snapshot) {
              if ("Bad".equals(w.quality())) {
                markBad(w.meta(), w.timestamp());
              } else {
                runtime.setTagValue(w.meta().tagId(), w.value(), w.quality(), w.timestamp());
              }
            }
            long applyMs = Math.round((System.nanoTime() - t0) / 1_000_000.0);
            if (applyMs >= 150) {
              acqLog.warn(
                  log,
                  "write-slow",
                  "modbus write path slow tags={} applyMs={}",
                  snapshot.size(),
                  applyMs);
            }
          });
    } catch (RuntimeException e) {
      log.warn("modbus write submit failed: {}", e.toString());
      for (PendingWrite w : snapshot) {
        if ("Bad".equals(w.quality())) markBad(w.meta(), w.timestamp());
        else runtime.setTagValue(w.meta().tagId(), w.value(), w.quality(), w.timestamp());
      }
    }
  }

  private PendingWrite pendingBad(TagMeta meta, long timestamp) {
    TagValue cur = runtime.getTagValue(meta.tagId());
    Object v = cur != null ? cur.value() : defaultVal(meta.dataType());
    return new PendingWrite(meta, v, "Bad", timestamp);
  }

  private void dispatchAll(boolean legacyInline) throws Exception {
    List<DeviceMeta> all = devices.list();
    Map<String, DeviceMeta> modbusDevs = new HashMap<>();
    Set<String> disabledModbus = new HashSet<>();
    for (DeviceMeta d : all) {
      if (!ModbusTagIo.isModbusProtocol(d.protocol()) || d.deviceId() == null) continue;
      if (d.enabled()) {
        modbusDevs.put(d.deviceId(), d);
        Boolean prevEn = lastEnabled.put(d.deviceId(), Boolean.TRUE);
        if (prevEn == null) {
          commsLog.deviceEnabledChanged(d, true);
        } else if (!prevEn) {
          commsLog.deviceEnabledChanged(d, true);
        }
      } else {
        disabledModbus.add(d.deviceId());
      }
    }
    applyDisabledDevices(disabledModbus);
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
        DeviceWorker worker = workers.computeIfAbsent(deviceId, id -> new DeviceWorker(id));
        List<TagMeta> snapshot = List.copyOf(tags);
        worker.tryRun(() -> pollOneDevice(dev, snapshot));
      }
    }
  }

  /** 设备停用后立刻丢掉连接，并把点标为 Bad（保持最后一值）。 */
  private void applyDisabledDevices(Set<String> disabledIds) {
    applyDisabledDeviceState(disabledIds);
    markDisabledTagsBad(disabledIds);
  }

  private void applyDisabledDeviceState(Set<String> disabledIds) {
    if (disabledIds == null || disabledIds.isEmpty()) return;
    for (String id : disabledIds) {
      Boolean prevEn = lastEnabled.put(id, Boolean.FALSE);
      if (prevEn == null || prevEn) {
        try {
          DeviceMeta dev = devices.get(id);
          commsLog.deviceEnabledChanged(dev != null ? dev : new DeviceMeta(id, id, "", "", false, null), false);
        } catch (Exception e) {
          commsLog.deviceEnabledChanged(new DeviceMeta(id, id, "", "", false, null), false);
        }
      }
      commsLog.rememberReason(id, "设备已停用");
      io.dropClient(id);
      health.clear(id);
      lastOnline.remove(id);
      commQueue.drop(id);
      pingDueNs.remove(id);
    }
    beats.values().removeIf(b -> disabledIds.contains(b.deviceId()));
  }

  private void markDisabledTagsBad(Set<String> disabledIds) {
    if (disabledIds == null || disabledIds.isEmpty()) return;
    for (TagMeta meta : runtime.getMetas()) {
      if (meta.deviceId() == null || !disabledIds.contains(meta.deviceId())) continue;
      TagValue cur = runtime.getTagValue(meta.tagId());
      if (cur != null && ("Bad".equals(cur.quality()) || "Offline".equals(cur.quality()))) continue;
      markBad(meta);
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
          commsLog.rememberReason(deviceId, "设备冷却中");
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
    ModbusTagIo.BatchRead batch = null;
    try {
      batch = io.readBatch(dev, due);
      List<ModbusTagIo.ReadOk> results = batch.values();
      for (int i = 0; i < due.size(); i++) {
        TagMeta meta = due.get(i);
        try {
          ModbusTagIo.ReadOk r = results.get(i);
          if ("Bad".equals(r.quality())) {
            fail++;
            lastErr = "no reply";
            markBad(meta);
            acqLog.warn(
                log,
                "read:" + meta.tagId(),
                "modbus read fail device={} tag={} addr={} err={}",
                deviceId,
                meta.tagId(),
                meta.address(),
                lastErr);
            continue;
          }
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
    if (batch != null) {
      noteConnect(deviceId, batch.connect(), cooldownMs, maxFail);
    }
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
      noteOnline(deviceId, false, lastErr != null ? lastErr : "all points failed");
      io.reportOnline(deviceId, false, lastErr != null ? lastErr : "采集失败");
    }
  }

  /** 读超时不加冷却。只有套接字连不上，连续达到次数才冷却。 */
  private boolean noteConnect(
      String deviceId, ModbusTagIo.ConnectSignal signal, long cooldownMs, int maxFail) {
    boolean cooled = false;
    switch (signal) {
      case FAIL ->
          cooled = health.onFailure(deviceId, System.currentTimeMillis(), cooldownMs, maxFail);
      case RESTART -> {
        health.clear(deviceId);
        cooled = health.onFailure(deviceId, System.currentTimeMillis(), cooldownMs, maxFail);
      }
      case CLEAR -> health.clear(deviceId);
    }
    return cooled;
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

  /** 变量扫描周期。缺省 50 毫秒，与界面默认一致，最小 50 毫秒。 */
  private static int scanPeriod(TagMeta meta) {
    return ModbusPollPlanner.scanPeriodMs(meta.scanPeriodMs());
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
    int fails = health.failCount(deviceId);
    boolean cooled = health.consumeEnteredCooldown(deviceId);
    commsLog.deviceOnlineChanged(deviceId, online, detail, fails, cooled);
  }

  private static String shortMsg(Exception e) {
    String m = e.getMessage();
    if (m == null || m.isBlank()) return e.getClass().getSimpleName();
    return m.length() > 160 ? m.substring(0, 160) + "…" : m;
  }

  private void markBad(TagMeta meta) {
    markBad(meta, System.currentTimeMillis());
  }

  private void markBad(TagMeta meta, long timestamp) {
    TagValue cur = runtime.getTagValue(meta.tagId());
    Object v = cur != null ? cur.value() : defaultVal(meta.dataType());
    runtime.setTagValue(meta.tagId(), v, "Bad", timestamp);
  }

  private static final class PendingWrite {
    private final TagMeta meta;
    private final Object value;
    private final String quality;
    private final long timestamp;

    PendingWrite(TagMeta meta, Object value, String quality, long timestamp) {
      this.meta = meta;
      this.value = value;
      this.quality = quality;
      this.timestamp = timestamp;
    }

    TagMeta meta() {
      return meta;
    }

    Object value() {
      return value;
    }

    String quality() {
      return quality;
    }

    long timestamp() {
      return timestamp;
    }
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

  private static final class TagBeat {
    private final String tagId;
    private final String deviceId;
    private final int periodMs;
    private final long nextDueNs;
    private final TagMeta meta;

    TagBeat(String tagId, String deviceId, int periodMs, long nextDueNs, TagMeta meta) {
      this.tagId = tagId;
      this.deviceId = deviceId;
      this.periodMs = periodMs;
      this.nextDueNs = nextDueNs;
      this.meta = meta;
    }

    String tagId() {
      return tagId;
    }

    String deviceId() {
      return deviceId;
    }

    int periodMs() {
      return periodMs;
    }

    long nextDueNs() {
      return nextDueNs;
    }

    TagMeta meta() {
      return meta;
    }

    String groupKey() {
      return ModbusPollPlanner.groupKey(deviceId, periodMs);
    }

    long periodNs() {
      return ModbusPollPlanner.periodNs(periodMs);
    }
  }

  /** 提交失败时也能释放已经占用的组互斥。 */
  private static final class LockedTask implements Runnable {
    private final AtomicBoolean lock;
    private final Runnable task;
    private final AtomicBoolean released = new AtomicBoolean(false);

    LockedTask(AtomicBoolean lock, Runnable task) {
      this.lock = lock;
      this.task = task;
    }

    @Override
    public void run() {
      task.run();
    }

    void release() {
      if (released.compareAndSet(false, true)) {
        lock.set(false);
      }
    }
  }

  /** 每设备单线程；上一轮未完成则跳过本轮派发（避免堆积）。仅 legacy 使用。 */
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
