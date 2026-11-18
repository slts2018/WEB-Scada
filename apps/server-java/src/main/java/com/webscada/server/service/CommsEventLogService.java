package com.webscada.server.service;

import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.store.DeviceFileStore;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

/**
 * 通讯状态变化写入 {@link AppLogService}（日志管理页 + web-scada.log）。
 * 只记状态翻转，并对相同文案做合并/限流，避免每轮轮询刷屏。
 */
@Service
public class CommsEventLogService {
  public static final String SOURCE = "通讯";

  private static final long IDENTICAL_SUPPRESS_MS = 30_000;
  private static final long QUALITY_MERGE_MS = 700;

  private final AppLogService logs;
  private final DeviceFileStore devices;

  private final ConcurrentHashMap<String, Last> lastByKey = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, String> lastReason = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, QualityBucket> qualityBuckets = new ConcurrentHashMap<>();
  private final ScheduledExecutorService flusher =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "comms-event-log");
            t.setDaemon(true);
            return t;
          });

  public CommsEventLogService(AppLogService logs, DeviceFileStore devices) {
    this.logs = logs;
    this.devices = devices;
    this.flusher.scheduleAtFixedRate(this::flushQualityBuckets, 400, 400, TimeUnit.MILLISECONDS);
  }

  @PreDestroy
  public void shutdown() {
    flusher.shutdownNow();
    flushQualityBuckets();
  }

  public void rememberReason(String deviceId, String reason) {
    if (deviceId == null || deviceId.isBlank()) return;
    if (reason == null || reason.isBlank()) return;
    lastReason.put(deviceId, humanReason(reason));
  }

  public void deviceEnabledChanged(DeviceMeta dev, boolean enabled) {
    if (dev == null || dev.deviceId() == null) return;
    String id = dev.deviceId();
    String who = describeDevice(dev);
    if (enabled) {
      rememberReason(id, "设备已启用");
      emit("info", "enabled:" + id + ":1", who + " 已启用，开始采集");
    } else {
      rememberReason(id, "设备已停用");
      emit("warn", "enabled:" + id + ":0", who + " 已停用，停止采集");
    }
  }

  public void deviceOnlineChanged(
      String deviceId, boolean online, String detail, int failCount, boolean enteredCooldown) {
    if (deviceId == null || deviceId.isBlank()) return;
    String who = describeDevice(deviceId);
    String reason = humanReason(detail);
    if (!reason.isBlank()) rememberReason(deviceId, reason);
    if (online) {
      String msg = who + " 上线：通讯已恢复";
      if (!reason.isBlank() && !reason.equals("通讯已恢复")) msg += "（" + reason + "）";
      emit("info", "online:" + deviceId, msg);
      return;
    }
    StringBuilder sb = new StringBuilder();
    sb.append(who).append(" 离线：").append(reason.isBlank() ? "连接失败" : reason);
    if (failCount > 0) sb.append("，连续失败 ").append(failCount).append(" 次");
    if (enteredCooldown) sb.append("，进入冷却");
    emit("warn", "online:" + deviceId, sb.toString());
  }

  public void onTagQualityChange(TagMeta meta, TagValue prev, TagValue next) {
    if (next == null) return;
    String from = prev == null ? null : prev.quality();
    String to = next.quality();
    if (!qualityTransition(from, to)) return;
    // 初始加载写成 Good 不记，避免启动刷屏
    if (prev == null && isGood(to)) return;
    String deviceId = meta != null ? meta.deviceId() : null;
    String tagId = next.tagId();
    if (tagId == null || tagId.isBlank()) return;
    String fromN = normalizeQuality(from);
    String toN = normalizeQuality(to);
    String bucketKey = String.valueOf(deviceId) + "|" + fromN + "|" + toN;
    String label = tagLabel(meta, tagId);
    qualityBuckets
        .computeIfAbsent(bucketKey, k -> new QualityBucket(deviceId, fromN, toN))
        .add(label);
  }

  private void flushQualityBuckets() {
    long now = System.currentTimeMillis();
    for (Map.Entry<String, QualityBucket> e : new ArrayList<>(qualityBuckets.entrySet())) {
      QualityBucket b = e.getValue();
      if (now - b.firstAt < QUALITY_MERGE_MS) continue;
      if (qualityBuckets.remove(e.getKey(), b)) {
        emitQuality(b);
      }
    }
  }

  private void emitQuality(QualityBucket b) {
    String who = b.deviceId == null ? "未绑定设备的变量" : describeDevice(b.deviceId);
    String tags = joinTags(b.tags);
    StringBuilder sb = new StringBuilder();
    sb.append(who).append(" 变量 ").append(tags);
    sb.append(" 质量 ").append(b.fromQ).append(" → ").append(b.toQ);
    String reason = b.deviceId == null ? null : lastReason.get(b.deviceId);
    if (reason != null && !reason.isBlank()) sb.append("，原因：").append(reason);
    String level = isBad(b.toQ) ? "warn" : "info";
    emit(level, "quality:" + b.deviceId + ":" + b.toQ, sb.toString());
  }

  private void emit(String level, String key, String message) {
    if (message == null || message.isBlank()) return;
    long now = System.currentTimeMillis();
    Last prev = lastByKey.get(key);
    if (prev != null
        && message.equals(prev.message)
        && now - prev.at < IDENTICAL_SUPPRESS_MS) {
      return;
    }
    lastByKey.put(key, new Last(message, now));
    logs.append(null, now, level, SOURCE, message);
  }

  private String describeDevice(String deviceId) {
    try {
      DeviceMeta dev = devices.get(deviceId);
      if (dev != null) return describeDevice(dev);
    } catch (IOException ignored) {
    }
    return "设备「" + deviceId + "」";
  }

  public static String describeDevice(DeviceMeta dev) {
    String name = dev.name() == null || dev.name().isBlank() ? dev.deviceId() : dev.name();
    String addr = dev.channel() == null ? "" : dev.channel().trim();
    if (addr.isEmpty()) return "设备「" + name + "」";
    return "设备「" + name + "」(" + addr + ")";
  }

  static boolean qualityTransition(String from, String to) {
    String a = normalizeQuality(from);
    String b = normalizeQuality(to);
    if (a.equals(b)) return false;
    // 只记录 Bad/Offline 与 Good 之间的翻转（含 Bad↔Offline）
    boolean involveBad = isBad(a) || isBad(b);
    boolean involveGood = isGood(a) || isGood(b);
    boolean badKindChange = isBad(a) && isBad(b);
    return (involveBad && involveGood) || badKindChange;
  }

  static boolean isBad(String q) {
    return "Bad".equals(q) || "Offline".equals(q);
  }

  static boolean isGood(String q) {
    return "Good".equals(q);
  }

  static String normalizeQuality(String q) {
    if (q == null || q.isBlank()) return "Unknown";
    return q.trim();
  }

  private static String tagLabel(TagMeta meta, String tagId) {
    if (meta != null && meta.name() != null && !meta.name().isBlank() && !meta.name().equals(tagId)) {
      return tagId + "(" + meta.name() + ")";
    }
    return tagId;
  }

  private static String joinTags(Set<String> tags) {
    ArrayList<String> list = new ArrayList<>(tags);
    int n = list.size();
    int show = Math.min(8, n);
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < show; i++) {
      if (i > 0) sb.append("、");
      sb.append(list.get(i));
    }
    if (n > show) sb.append(" 等 ").append(n).append(" 个");
    return sb.toString();
  }

  static String humanReason(String raw) {
    if (raw == null) return "";
    String s = raw.trim();
    if (s.isEmpty()) return "";
    String low = s.toLowerCase(Locale.ROOT);
    if (low.contains("cooldown") || s.contains("冷却")) {
      return "设备冷却中";
    }
    if (low.contains("connection refused") || low.contains("connect refused")) {
      return "连接被拒绝";
    }
    if (low.contains("connection reset")) return "连接被重置";
    if (low.contains("timed out") || low.contains("timeout") || low.contains("time out")) {
      return "连接或等待超时";
    }
    if (low.contains("unreachable") || low.contains("no route")) return "网络不可达";
    if (low.contains("no reply") || low.contains("all points failed") || "采集失败".equals(s)) {
      return "采集无应答";
    }
    if (low.startsWith("poll ok") || s.contains("已采集")) return "采集正常";
    if (low.startsWith("partial") || s.contains("部分成功")) return "部分点采集成功";
    if (low.contains("connected (no tags)")) return "已连接（无采集点）";
    if (s.length() > 120) return s.substring(0, 117) + "...";
    return s;
  }

  private static final class Last {
    final String message;
    final long at;

    Last(String message, long at) {
      this.message = message;
      this.at = at;
    }
  }

  private static final class QualityBucket {
    final String deviceId;
    final String fromQ;
    final String toQ;
    final Set<String> tags = new LinkedHashSet<>();
    final long firstAt = System.currentTimeMillis();

    QualityBucket(String deviceId, String fromQ, String toQ) {
      this.deviceId = deviceId;
      this.fromQ = fromQ;
      this.toQ = toQ;
    }

    synchronized void add(String tag) {
      tags.add(tag);
    }
  }
}
