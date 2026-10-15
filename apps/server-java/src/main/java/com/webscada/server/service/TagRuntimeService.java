package com.webscada.server.service;



import com.webscada.server.db.InfluxHolder;

import com.webscada.server.mock.MockTagData;

import com.webscada.server.model.DeviceMeta;

import com.webscada.server.model.TagHistory;
import com.webscada.server.model.TagMeta;

import com.webscada.server.model.TagSimulation;

import com.webscada.server.model.TagValue;

import com.webscada.server.store.DeviceFileStore;

import com.webscada.server.store.TagFileStore;

import com.webscada.server.ws.TagSessionRegistry;

import java.io.IOException;

import java.util.ArrayList;

import java.util.HashSet;

import java.util.List;

import java.util.Map;

import java.util.Objects;

import java.util.Set;

import java.util.concurrent.ConcurrentHashMap;

import java.util.concurrent.ThreadLocalRandom;

import org.slf4j.Logger;

import org.slf4j.LoggerFactory;

import org.springframework.scheduling.annotation.Scheduled;

import org.springframework.stereotype.Service;



@Service

public class TagRuntimeService {

  private static final Logger log = LoggerFactory.getLogger(TagRuntimeService.class);



  private final TagFileStore tagStore;

  private final DeviceFileStore deviceStore;

  private final TagSessionRegistry sessions;

  private final InfluxHolder influx;

  private final AlarmRuntimeService alarms;

  private final Map<String, TagValue> values = new ConcurrentHashMap<>();

  private volatile List<TagMeta> metas = List.of();

  /** 启用中的 mcd4000 设备 ID；其 Tag 由轮询驱动，不走 Mock 抖动 */

  private volatile Set<String> mcdDeviceIds = Set.of();

  /** 启用中的模拟设备；出值方式看变量上的 simulation，没有则用类型默认 */

  private volatile Set<String> mockDeviceIds = Set.of();

  private final Map<String, Long> simSlots = new ConcurrentHashMap<>();

  private final Map<String, Long> scanSlots = new ConcurrentHashMap<>();

  private final Map<String, TagValue> pendingPush = new ConcurrentHashMap<>();

  private final Map<String, Long> lastPushAt = new ConcurrentHashMap<>();

  private final Map<String, Long> lastHistAt = new ConcurrentHashMap<>();

  private long lastDeviceRefresh;



  public TagRuntimeService(

      TagFileStore tagStore,

      DeviceFileStore deviceStore,

      TagSessionRegistry sessions,

      InfluxHolder influx,

      AlarmRuntimeService alarms) {

    this.tagStore = tagStore;

    this.deviceStore = deviceStore;

    this.sessions = sessions;

    this.influx = influx;

    this.alarms = alarms;

  }



  public List<TagMeta> getMetas() {

    return metas;

  }



  public List<TagValue> getCurrentValues() {

    return new ArrayList<>(values.values());

  }



  public TagValue getTagValue(String tagId) {

    return values.get(tagId);

  }



  public boolean isMcdDriven(TagMeta meta) {

    return meta != null && mcdDeviceIds.contains(meta.deviceId());

  }



  private boolean isMockDriven(TagMeta meta) {

    return meta != null && meta.deviceId() != null && mockDeviceIds.contains(meta.deviceId());

  }



  public synchronized void reload() {

    try {

      metas = tagStore.list();

    } catch (IOException e) {

      log.warn("reload tags failed: {}", e.toString());

      metas = List.of();

    }

    refreshMcdDevices();

    Map<String, TagValue> seed = new ConcurrentHashMap<>();

    for (TagValue v : MockTagData.createInitialMockValues()) {

      seed.put(v.tagId(), v);

    }

    for (TagMeta meta : metas) {

      if (!values.containsKey(meta.tagId())) {

        TagValue initial = seed.get(meta.tagId());

        if (initial != null) values.put(meta.tagId(), initial);

        else {

          Object fallback =

              switch (meta.dataType()) {

                case "bool" -> false;

                case "string" -> "";

                default -> 0;

              };

          values.put(meta.tagId(), now(meta.tagId(), fallback, "Good"));

        }

      }

    }

    values.keySet().removeIf(id -> metas.stream().noneMatch(m -> m.tagId().equals(id)));

    alarms.prime(metas, new ArrayList<>(values.values()));

  }



  private void refreshMcdDevices() {

    try {

      Set<String> ids = new HashSet<>();

      Set<String> mocks = new HashSet<>();

      for (DeviceMeta d : deviceStore.list()) {

        if (!d.enabled() || d.deviceId() == null) continue;

        if ("mcd4000".equalsIgnoreCase(d.protocol())) ids.add(d.deviceId());

        else if ("mock".equalsIgnoreCase(d.protocol())) mocks.add(d.deviceId());

      }

      mcdDeviceIds = Set.copyOf(ids);

      mockDeviceIds = Set.copyOf(mocks);

    } catch (IOException e) {

      log.warn("reload mcd devices failed: {}", e.toString());

    }

  }



  public TagValue setTagValue(String tagId, Object value, String quality) {
    TagValue prev = values.get(tagId);
    TagValue next = now(tagId, value, quality);
    values.put(tagId, next);
    TagMeta meta = metaOf(tagId);
    noteAlarm(meta, next);
    offerPush(meta, next, null);
    recordHistory(meta, prev, next, true);
    return next;
  }



  public WriteResult writeTag(String tagId, Object value) {

    TagMeta meta =

        metas.stream().filter(m -> m.tagId().equals(tagId)).findFirst().orElse(null);

    if (meta == null) {

      try {

        meta = tagStore.get(tagId);

      } catch (IOException ignored) {

      }

    }

    if (meta == null) return WriteResult.fail("Tag not found");

    if (isMcdDriven(meta)) {

      return WriteResult.fail("MCD4000 数据中台为查询 API，写值不会下发现场");

    }

    if (!meta.writable()) return WriteResult.fail("Tag is read-only");



    Object normalized = value;

    switch (meta.dataType()) {

      case "bool" -> normalized = toBool(value);

      case "int" -> normalized = (int) Math.rint(toNumber(value));

      case "float" -> normalized = toNumber(value);

      default -> normalized = value == null ? null : String.valueOf(value);

    }

    if (("int".equals(meta.dataType()) || "float".equals(meta.dataType()))

        && normalized instanceof Number n

        && !Double.isFinite(n.doubleValue())) {

      return WriteResult.fail("Invalid numeric value");

    }

    TagValue next = setTagValue(tagId, normalized, "Good");

    return WriteResult.ok(next);

  }



  @Scheduled(fixedRate = 200)
  public void tick() {
    long nowMs = System.currentTimeMillis();
    if (nowMs - lastDeviceRefresh > 10_000) {
      lastDeviceRefresh = nowMs;
      refreshMcdDevices();
    }

    List<TagValue> changed = new ArrayList<>();
    ThreadLocalRandom rnd = ThreadLocalRandom.current();
    for (TagMeta meta : metas) {
      if (!isMockDriven(meta)) continue;
      int scan = meta.scanPeriodMs() == null ? 1000 : Math.max(200, meta.scanPeriodMs());
      long scanSlot = nowMs / scan;
      Long prevScan = scanSlots.get(meta.tagId());
      if (prevScan != null && prevScan == scanSlot) continue;
      scanSlots.put(meta.tagId(), scanSlot);

      TagSimulation sim = effectiveSimulation(meta);
      if (!sim.enabled()) continue;
      TagValue cur = values.get(meta.tagId());
      if (cur == null) continue;
      long periodMs = Math.max(1L, Math.round(sim.periodSec() * 1000));
      long slot = "sine".equals(sim.mode()) ? nowMs / 1000 : nowMs / periodMs;
      Long prevSlot = simSlots.get(meta.tagId());
      if (prevSlot != null && prevSlot == slot) continue;
      simSlots.put(meta.tagId(), slot);
      Object next = stepSimulation(meta, sim, cur.value(), rnd, nowMs);
      if (next == null || Objects.equals(next, cur.value())) continue;
      TagValue v = now(meta.tagId(), next, "Good");
      values.put(meta.tagId(), v);
      noteAlarm(meta, v);
      offerPush(meta, v, changed);
      recordHistory(meta, cur, v, false);
    }
    if (!changed.isEmpty()) sessions.broadcastDelta(changed);
    flushPushAndHistory(nowMs);
  }



  @Scheduled(fixedRate = 8000)

  public void qualityTick() {

    TagValue cur = values.get("demo.temp");

    if (cur == null || !(cur.value() instanceof Number)) return;

    TagMeta demoMeta =

        metas.stream().filter(m -> "demo.temp".equals(m.tagId())).findFirst().orElse(null);

    if (!isMockDriven(demoMeta)) return;

    if (ThreadLocalRandom.current().nextDouble() > 0.85) {

      String q = ThreadLocalRandom.current().nextBoolean() ? "Bad" : "Uncertain";

      setTagValue("demo.temp", cur.value(), q);

      new Thread(

              () -> {

                try {

                  Thread.sleep(2000);

                } catch (InterruptedException ignored) {

                  Thread.currentThread().interrupt();

                }

                TagValue latest = values.get("demo.temp");

                if (latest != null) setTagValue("demo.temp", latest.value(), "Good");

              },

              "quality-recover")

          .start();

    }

  }



  private void noteAlarm(TagMeta meta, TagValue value) {

    alarms.onValue(meta, value);

  }

  /** 推送合并。未启用时立刻进 immediate，或直接广播。报警已在调用前处理。 */
  private void offerPush(TagMeta meta, TagValue value, List<TagValue> immediate) {
    if (meta != null && Boolean.TRUE.equals(meta.pushEnabled())) {
      pendingPush.put(value.tagId(), value);
      return;
    }
    pendingPush.remove(value.tagId());
    if (immediate != null) immediate.add(value);
    else sessions.broadcastDelta(List.of(value));
  }

  private void flushPushAndHistory(long nowMs) {
    List<TagValue> due = new ArrayList<>();
    for (Map.Entry<String, TagValue> entry : pendingPush.entrySet()) {
      TagMeta meta = metaOf(entry.getKey());
      if (meta == null || !Boolean.TRUE.equals(meta.pushEnabled())) {
        due.add(entry.getValue());
        pendingPush.remove(entry.getKey());
        continue;
      }
      int period = meta.pushPeriodMs() == null ? 1000 : Math.max(200, meta.pushPeriodMs());
      long last = lastPushAt.getOrDefault(entry.getKey(), 0L);
      if (last != 0 && nowMs - last < period) continue;
      due.add(entry.getValue());
      pendingPush.remove(entry.getKey());
      lastPushAt.put(entry.getKey(), nowMs);
    }
    if (!due.isEmpty()) sessions.broadcastDelta(due);

    for (TagMeta meta : metas) {
      TagHistory history = meta.history();
      if (history == null || !Boolean.TRUE.equals(history.enabled())) continue;
      if (!"interval".equals(history.mode())) continue;
      int period = history.intervalMs() == null ? 1000 : Math.max(200, history.intervalMs());
      long last = lastHistAt.getOrDefault(meta.tagId(), 0L);
      if (last != 0 && nowMs - last < period) continue;
      TagValue cur = values.get(meta.tagId());
      if (cur == null) continue;
      influx.writeSampleQuiet(cur.tagId(), cur.value(), cur.quality(), nowMs);
      lastHistAt.put(meta.tagId(), nowMs);
    }
  }

  /**
   * history 缺省：只有 setTagValue 记历史。显式关闭仍记质量好坏切换。
   * 变化存按死区；周期存交给 flush，质量切换立刻记。
   */
  private void recordHistory(TagMeta meta, TagValue prev, TagValue next, boolean legacyWrite) {
    TagHistory history = meta == null ? null : meta.history();
    if (history == null || history.enabled() == null) {
      if (legacyWrite) {
        influx.writeSampleQuiet(next.tagId(), next.value(), next.quality(), next.timestamp());
      }
      return;
    }
    if (qualityFlip(prev, next)) {
      influx.writeSampleQuiet(next.tagId(), next.value(), next.quality(), next.timestamp());
      lastHistAt.put(next.tagId(), next.timestamp());
      return;
    }
    if (!Boolean.TRUE.equals(history.enabled())) return;
    if ("interval".equals(history.mode())) return;
    if (!changedEnough(history, prev == null ? null : prev.value(), next.value())) return;
    influx.writeSampleQuiet(next.tagId(), next.value(), next.quality(), next.timestamp());
    lastHistAt.put(next.tagId(), next.timestamp());
  }

  private static boolean qualityFlip(TagValue prev, TagValue next) {
    if (prev == null || next == null) return false;
    return badQuality(prev.quality()) != badQuality(next.quality());
  }

  private static boolean badQuality(String quality) {
    return "Bad".equals(quality) || "Offline".equals(quality);
  }

  private static boolean changedEnough(TagHistory history, Object prev, Object next) {
    if (Objects.equals(prev, next)) return false;
    if (prev instanceof Number before && next instanceof Number after) {
      double band = history.deadband() == null ? 0 : Math.max(0, history.deadband());
      return Math.abs(after.doubleValue() - before.doubleValue()) >= band;
    }
    return true;
  }



  private TagMeta metaOf(String tagId) {

    for (TagMeta meta : metas) {

      if (meta.tagId().equals(tagId)) return meta;

    }

    return null;

  }



  private static TagValue now(String tagId, Object value, String quality) {

    return new TagValue(tagId, value, quality, System.currentTimeMillis());

  }



  private static boolean toBool(Object v) {

    if (v instanceof Boolean b) return b;

    if (v instanceof Number n) return n.doubleValue() != 0;

    if (v == null) return false;

    String s = String.valueOf(v).trim().toLowerCase();

    return s.equals("true") || s.equals("1") || s.equals("on");

  }



  /** 没存过 simulation 时：只读点按类型给默认，可写点默认关闭。 */

  private static TagSimulation effectiveSimulation(TagMeta meta) {

    TagSimulation saved = meta.simulation();

    double fallbackStep = defaultStep(meta);

    if (saved == null) {

      boolean percent = isPercent(meta) || (meta.tagId() != null && meta.tagId().contains("level"));

      boolean numeric = "int".equals(meta.dataType()) || "float".equals(meta.dataType());

      double period = "bool".equals(meta.dataType()) ? 5 : "string".equals(meta.dataType()) ? 3 : 1;

      return new TagSimulation(

          !meta.writable(),

          period,

          numeric && percent ? 0d : null,

          numeric && percent ? 100d : null,

          numeric ? fallbackStep : null,

          "string".equals(meta.dataType()) ? "待机\n运行\n停止" : null,

          defaultMode(meta.dataType()));

    }

    double period = saved.periodSec();

    if (!Double.isFinite(period)) period = 1;

    period = Math.min(3600, Math.max(1, period));

    Double step = saved.step() != null ? saved.step() : ("int".equals(meta.dataType()) || "float".equals(meta.dataType()) ? fallbackStep : null);

    String options = saved.options() != null && !saved.options().isBlank() ? saved.options() : "待机\n运行\n停止";

    return new TagSimulation(saved.enabled(), period, saved.min(), saved.max(), step, options, resolveMode(meta.dataType(), saved.mode()));

  }



  private static String defaultMode(String dataType) {

    if ("bool".equals(dataType)) return "toggle";

    if ("string".equals(dataType)) return "cycle";

    return "walk";

  }



  private static String resolveMode(String dataType, String mode) {

    if (mode == null || mode.isBlank()) return defaultMode(dataType);

    boolean ok =

        switch (dataType == null ? "" : dataType) {

          case "bool" -> mode.equals("toggle") || mode.equals("random");

          case "string" -> mode.equals("cycle") || mode.equals("random");

          case "int", "float" -> mode.equals("walk") || mode.equals("random") || mode.equals("ramp") || mode.equals("sine");

          default -> false;

        };

    return ok ? mode : defaultMode(dataType);

  }



  private static double defaultStep(TagMeta meta) {

    if ("int".equals(meta.dataType())) return 1;

    String id = meta.tagId() == null ? "" : meta.tagId();

    if (id.contains("level") || isPercent(meta)) return 2;

    if (id.contains("pressure")) return 0.4;

    return 0.8;

  }



  private static Object stepSimulation(

      TagMeta meta, TagSimulation sim, Object current, ThreadLocalRandom rnd, long nowMs) {

    String type = meta.dataType() == null ? "" : meta.dataType();

    String mode = sim.mode() == null ? defaultMode(type) : sim.mode();

    return switch (type) {

      case "bool" -> "random".equals(mode) ? rnd.nextBoolean() : !toBool(current);

      case "int" -> stepNumber(current, sim, rnd, nowMs, true);

      case "float" -> stepNumber(current, sim, rnd, nowMs, false);

      case "string" -> stepString(meta, sim, mode, rnd, nowMs);

      default -> current;

    };

  }



  private static Number stepNumber(

      Object current, TagSimulation sim, ThreadLocalRandom rnd, long nowMs, boolean asInt) {

    String mode = sim.mode() == null ? "walk" : sim.mode();

    if ("random".equals(mode) || "sine".equals(mode) || "ramp".equals(mode)) {

      double min = sim.min() == null ? 0 : sim.min();

      double max = sim.max() == null ? 100 : sim.max();

      if (min > max) {

        double swap = min;

        min = max;

        max = swap;

      }

      double next;

      if ("random".equals(mode)) {

        next = min + rnd.nextDouble() * (max - min);

      } else if ("sine".equals(mode)) {

        double mid = (min + max) / 2;

        double amp = (max - min) / 2;

        double periodMs = Math.max(1d, sim.periodSec()) * 1000d;

        double phase = (nowMs % (long) periodMs) / periodMs;

        next = mid + amp * Math.sin(2 * Math.PI * phase);

      } else {

        double base = toNumber(current);

        if (!Double.isFinite(base)) base = min;

        double delta = Math.abs(sim.step() == null ? 1 : sim.step());

        if (delta == 0) delta = 1;

        next = base + delta;

        if (next > max) next = min;

      }

      if (asInt) return Math.round(next);

      return Double.parseDouble(String.format("%.1f", next));

    }

    return asInt ? stepInt(current, sim, rnd) : stepFloat(current, sim, rnd);

  }



  private static long stepInt(Object current, TagSimulation sim, ThreadLocalRandom rnd) {

    double base = toNumber(current);

    if (!Double.isFinite(base)) base = 0;

    int mag = Math.max(1, (int) Math.round(Math.abs(sim.step() == null ? 1 : sim.step())));

    int delta = rnd.nextInt(mag) + 1;

    if (rnd.nextBoolean()) delta = -delta;

    return clamp(Math.round(base) + delta, sim);

  }



  private static double stepFloat(Object current, TagSimulation sim, ThreadLocalRandom rnd) {

    double base = toNumber(current);

    if (!Double.isFinite(base)) base = 0;

    double amp = Math.abs(sim.step() == null ? 0.8 : sim.step());

    double next = clamp(base + (rnd.nextDouble() - 0.5) * 2 * amp, sim);

    return Double.parseDouble(String.format("%.1f", next));

  }



  private static String stepString(

      TagMeta meta, TagSimulation sim, String mode, ThreadLocalRandom rnd, long nowMs) {

    String raw = sim.options() == null || sim.options().isBlank() ? "待机\n运行\n停止" : sim.options();

    String[] parts = raw.split("\\r?\\n|\\|");

    java.util.List<String> options = new java.util.ArrayList<>();

    for (String part : parts) {

      String item = part.trim();

      if (!item.isEmpty()) options.add(item);

    }

    if (options.isEmpty()) return "";

    if ("random".equals(mode)) return options.get(rnd.nextInt(options.size()));

    int salt = meta.tagId() == null ? 0 : Math.floorMod(meta.tagId().hashCode(), options.size());

    long slot = nowMs / Math.max(1L, Math.round(sim.periodSec() * 1000));

    int index = (int) Math.floorMod(slot + salt, options.size());

    return options.get(index);

  }



  private static long clamp(long n, TagSimulation sim) {

    return (long) clamp((double) n, sim);

  }



  private static double clamp(double n, TagSimulation sim) {

    Double min = sim.min();

    Double max = sim.max();

    if (min != null && max != null && min > max) {

      Double swap = min;

      min = max;

      max = swap;

    }

    if (min != null && n < min) n = min;

    if (max != null && n > max) n = max;

    return n;

  }



  private static boolean isPercent(TagMeta meta) {

    return "%".equals(meta.unit());

  }



  private static double toNumber(Object v) {

    if (v instanceof Number n) return n.doubleValue();

    if (v == null) return Double.NaN;

    try {

      return Double.parseDouble(String.valueOf(v));

    } catch (NumberFormatException e) {

      return Double.NaN;

    }

  }



  public record WriteResult(boolean ok, String message, TagValue value) {

    static WriteResult ok(TagValue v) {

      return new WriteResult(true, "ok", v);

    }



    static WriteResult fail(String message) {

      return new WriteResult(false, message, null);

    }

  }

}


