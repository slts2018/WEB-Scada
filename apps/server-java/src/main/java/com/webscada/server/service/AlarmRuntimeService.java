package com.webscada.server.service;

import com.webscada.server.model.ActiveAlarm;
import com.webscada.server.model.AlarmEvent;
import com.webscada.server.model.TagAlarmConfig;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.store.AlarmEventStore;
import com.webscada.server.store.AlarmFileStore;
import com.webscada.server.ws.TagSessionRegistry;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class AlarmRuntimeService {
  private static final Logger log = LoggerFactory.getLogger(AlarmRuntimeService.class);
  /** 已恢复但未确认的行太多时，丢掉最早的，避免实时表无限涨。正在报警的不丢。 */
  private static final int MAX_CLEARED_ROWS = 500;

  private final AlarmFileStore store;
  private final AlarmEventStore events;
  private final TagSessionRegistry sessions;
  private final Object lock = new Object();
  private List<TagAlarmConfig> configs = List.of();
  private final Map<String, Track> tracks = new ConcurrentHashMap<>();
  private final Map<String, TagValue> lastValues = new ConcurrentHashMap<>();
  private final Map<String, TagMeta> lastMetas = new ConcurrentHashMap<>();
  private final Map<String, Deque<Sample>> rateSamples = new ConcurrentHashMap<>();

  public AlarmRuntimeService(AlarmFileStore store, AlarmEventStore events, TagSessionRegistry sessions) {
    this.store = store;
    this.events = events;
    this.sessions = sessions;
  }

  public List<ActiveAlarm> active() {
    synchronized (lock) {
      List<ActiveAlarm> list = new ArrayList<>();
      for (Track t : tracks.values()) {
        if (t.view != null) list.add(t.view);
      }
      list.sort((a, b) -> Long.compare(b.raisedAt(), a.raisedAt()));
      return list;
    }
  }

  /**
   * 确认一条。条件还成立时行留在表上，只是不再闪。已经恢复再确认，才从实时表去掉。已经确认过的不重复记。
   */
  public AckResult ack(String alarmId) {
    if (alarmId == null || alarmId.isBlank()) return AckResult.missing();
    synchronized (lock) {
      Track t = tracks.get(alarmId);
      if (t == null || t.view == null) return AckResult.missing();
      if (t.acked) return new AckResult(true, t.view);
      long now = System.currentTimeMillis();
      t.acked = true;
      t.ackedAt = now;
      TagValue value = lastValues.get(t.view.tagId());
      record(configOf(alarmId), t, value, "ack", now);
      if (t.active) {
        t.view = copyAck(t.view, now);
        broadcast(List.of(), List.of(t.view), List.of());
        return new AckResult(true, t.view);
      }
      String id = t.view.alarmId();
      t.view = null;
      broadcast(List.of(), List.of(), List.of(id));
      return new AckResult(true, null);
    }
  }

  public Map<String, Object> snapshotMessage() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", "alarm.snapshot");
    m.put("active", active());
    return m;
  }

  /** 变量表重载后，用当前值重新判定。失败不得影响实时值。 */
  public void prime(List<TagMeta> metas, List<TagValue> values) {
    try {
      synchronized (lock) {
        lastMetas.clear();
        for (TagMeta meta : metas) lastMetas.put(meta.tagId(), meta);
        lastValues.clear();
        for (TagValue v : values) {
          lastValues.put(v.tagId(), v);
          noteSample(v);
        }
        reloadUnlocked();
      }
    } catch (Exception e) {
      log.warn("alarm prime failed: {}", e.toString());
    }
  }

  public void onValue(TagMeta meta, TagValue value) {
    if (value == null || value.tagId() == null) return;
    try {
      synchronized (lock) {
        if (meta != null) lastMetas.put(value.tagId(), meta);
        lastValues.put(value.tagId(), value);
        noteSample(value);
        List<ActiveAlarm> raised = new ArrayList<>();
        List<ActiveAlarm> updated = new ArrayList<>();
        List<String> cleared = new ArrayList<>();
        for (TagAlarmConfig cfg : configs) {
          if (!value.tagId().equals(cfg.tagId())) continue;
          apply(cfg, value, raised, updated, cleared);
        }
        trimCleared(cleared);
        broadcast(raised, updated, cleared);
      }
    } catch (Exception e) {
      log.warn("alarm eval {}: {}", value.tagId(), e.toString());
    }
  }

  public void reloadConfigs() {
    try {
      synchronized (lock) {
        reloadUnlocked();
      }
    } catch (Exception e) {
      log.warn("alarm reload failed: {}", e.toString());
    }
  }

  @Scheduled(fixedDelay = 500)
  public void delayTick() {
    try {
      synchronized (lock) {
        long now = System.currentTimeMillis();
        List<ActiveAlarm> raised = new ArrayList<>();
        List<ActiveAlarm> updated = new ArrayList<>();
        List<String> cleared = new ArrayList<>();
        for (TagAlarmConfig cfg : configs) {
          Track t = tracks.get(cfg.alarmId());
          if (t == null || t.active || t.pendingSince == null) continue;
          long delayMs = delayMs(cfg);
          if (now - t.pendingSince < delayMs) continue;
          TagValue value = lastValues.get(cfg.tagId());
          if (value == null) continue;
          apply(cfg, value, raised, updated, cleared);
        }
        trimCleared(cleared);
        broadcast(raised, updated, cleared);
      }
    } catch (Exception e) {
      log.warn("alarm delay tick failed: {}", e.toString());
    }
  }

  private void reloadUnlocked() throws IOException {
    List<TagAlarmConfig> next = store.list();
    java.util.Set<String> ids = new java.util.HashSet<>();
    for (TagAlarmConfig c : next) ids.add(c.alarmId());
    List<String> cleared = new ArrayList<>();
    tracks
        .entrySet()
        .removeIf(
            e -> {
              if (ids.contains(e.getKey())) return false;
              if (e.getValue().view != null) cleared.add(e.getKey());
              return true;
            });
    configs = next;
    List<ActiveAlarm> raised = new ArrayList<>();
    List<ActiveAlarm> updated = new ArrayList<>();
    for (TagValue value : lastValues.values()) {
      for (TagAlarmConfig cfg : configs) {
        if (!value.tagId().equals(cfg.tagId())) continue;
        apply(cfg, value, raised, updated, cleared);
      }
    }
    trimCleared(cleared);
    broadcast(raised, updated, cleared);
  }

  private void apply(
      TagAlarmConfig cfg,
      TagValue value,
      List<ActiveAlarm> raised,
      List<ActiveAlarm> updated,
      List<String> cleared) {
    Track t = tracks.computeIfAbsent(cfg.alarmId(), id -> new Track());
    boolean cond =
        AlarmEvaluator.condition(
            cfg, t.active, value.value(), value.quality(), rateChange(cfg, value));
    long now = value.timestamp() > 0 ? value.timestamp() : System.currentTimeMillis();
    if (!cond) {
      t.pendingSince = null;
      if (!t.active) return;
      t.active = false;
      t.clearedAt = now;
      ActiveAlarm row = snapshot(cfg, t, value, now);
      t.view = row;
      record(cfg, t, value, "clear", now);
      if (t.acked) {
        cleared.add(cfg.alarmId());
        t.view = null;
      } else {
        updated.add(row);
      }
      return;
    }
    if (t.active) return;
    long delayMs = delayMs(cfg);
    if (delayMs > 0) {
      if (t.pendingSince == null) {
        t.pendingSince = now;
        return;
      }
      if (now - t.pendingSince < delayMs) return;
    }
    t.pendingSince = null;
    t.active = true;
    t.acked = false;
    t.ackedAt = null;
    t.clearedAt = null;
    t.raisedAt = now;
    t.view = snapshot(cfg, t, value, now);
    record(cfg, t, value, "raise", now);
    raised.add(t.view);
  }

  private ActiveAlarm snapshot(TagAlarmConfig cfg, Track t, TagValue value, long updatedAt) {
    TagMeta meta = lastMetas.get(cfg.tagId());
    String tagName = meta != null && meta.name() != null ? meta.name() : cfg.tagId();
    return new ActiveAlarm(
        cfg.alarmId(),
        cfg.tagId(),
        cfg.name(),
        cfg.level(),
        message(cfg, tagName, value, meta),
        value == null ? null : value.value(),
        value == null ? null : value.quality(),
        t.raisedAt,
        updatedAt,
        t.active,
        t.acked,
        t.clearedAt,
        t.ackedAt);
  }

  private static ActiveAlarm copyAck(ActiveAlarm view, long now) {
    return new ActiveAlarm(
        view.alarmId(),
        view.tagId(),
        view.name(),
        view.level(),
        view.message(),
        view.value(),
        view.quality(),
        view.raisedAt(),
        now,
        view.active(),
        true,
        view.clearedAt(),
        now);
  }

  private TagAlarmConfig configOf(String alarmId) {
    for (TagAlarmConfig cfg : configs) {
      if (alarmId.equals(cfg.alarmId())) return cfg;
    }
    return null;
  }

  private void record(TagAlarmConfig cfg, Track t, TagValue value, String eventKind, long at) {
    if (t.view == null) return;
    String shown = t.view.value() == null ? null : String.valueOf(t.view.value());
    events.append(
        new AlarmEvent(
            t.view.alarmId(),
            t.view.tagId(),
            t.view.name(),
            t.view.level(),
            cfg == null ? null : cfg.kind(),
            eventKind,
            t.view.message(),
            shown,
            value == null ? t.view.quality() : value.quality(),
            at));
  }

  private void trimCleared(List<String> cleared) {
    List<Track> idle = new ArrayList<>();
    for (Track t : tracks.values()) {
      if (t.view != null && !t.active) idle.add(t);
    }
    if (idle.size() <= MAX_CLEARED_ROWS) return;
    idle.sort((a, b) -> Long.compare(a.raisedAt, b.raisedAt));
    int extra = idle.size() - MAX_CLEARED_ROWS;
    for (int i = 0; i < extra; i++) {
      Track t = idle.get(i);
      if (t.view != null) cleared.add(t.view.alarmId());
      t.view = null;
    }
  }

  private static String message(TagAlarmConfig cfg, String tagName, TagValue value, TagMeta meta) {
    if ("quality".equals(cfg.kind())) {
      return tagName + " 质量 " + value.quality();
    }
    return tagName + " = " + displayValue(meta, value.value());
  }

  /** 布尔只改条文里的文字，条件仍用原来的 true/false。 */
  private static String displayValue(TagMeta meta, Object value) {
    if (value == null) return "-";
    if (value instanceof Boolean on) {
      String text = on ? (meta == null ? null : meta.onText()) : (meta == null ? null : meta.offText());
      if (text != null && !text.isBlank()) return text.trim();
      return on ? "true" : "false";
    }
    return String.valueOf(value);
  }

  private void noteSample(TagValue value) {
    if (!(value.value() instanceof Number n)) return;
    double current = n.doubleValue();
    if (!Double.isFinite(current)) return;
    long ts = value.timestamp() > 0 ? value.timestamp() : System.currentTimeMillis();
    Deque<Sample> samples = rateSamples.computeIfAbsent(value.tagId(), id -> new ArrayDeque<>());
    Sample last = samples.peekLast();
    if (last != null && last.ts == ts && last.value == current) return;
    samples.addLast(new Sample(ts, current));
    long cutoff = ts - 86_400_000L;
    while (!samples.isEmpty() && samples.peekFirst().ts < cutoff) samples.removeFirst();
    while (samples.size() > 500) samples.removeFirst();
  }

  /** 时间窗还没覆盖到时返回 null，变化率先不报警。 */
  private Double rateChange(TagAlarmConfig cfg, TagValue value) {
    if (!"rate".equals(cfg.kind()) || cfg.windowSec() == null || !(value.value() instanceof Number n)) {
      return null;
    }
    double current = n.doubleValue();
    if (!Double.isFinite(current)) return null;
    Deque<Sample> samples = rateSamples.get(value.tagId());
    if (samples == null || samples.isEmpty()) return null;
    long now = value.timestamp() > 0 ? value.timestamp() : System.currentTimeMillis();
    long need = now - Math.round(cfg.windowSec() * 1000.0);
    Sample base = null;
    for (Sample sample : samples) {
      if (sample.ts <= need) base = sample;
      else break;
    }
    if (base == null) base = samples.peekFirst();
    if (base == null || (samples.size() == 1 && base.ts == now)) return 0.0;
    return Math.abs(current - base.value);
  }

  private static long delayMs(TagAlarmConfig cfg) {
    if (cfg.delaySec() <= 0) return 0;
    return Math.round(cfg.delaySec() * 1000.0);
  }

  private void broadcast(List<ActiveAlarm> raised, List<ActiveAlarm> updated, List<String> cleared) {
    if (raised.isEmpty() && updated.isEmpty() && cleared.isEmpty()) return;
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", "alarm.delta");
    m.put("raised", raised);
    m.put("updated", updated);
    m.put("cleared", cleared);
    sessions.broadcastRaw(m);
  }

  private static final class Sample {
    final long ts;
    final double value;

    Sample(long ts, double value) {
      this.ts = ts;
      this.value = value;
    }
  }

  private static final class Track {
    boolean active;
    boolean acked;
    Long pendingSince;
    long raisedAt;
    Long clearedAt;
    Long ackedAt;
    ActiveAlarm view;
  }

  public record AckResult(boolean found, ActiveAlarm alarm) {
    static AckResult missing() {
      return new AckResult(false, null);
    }
  }
}
