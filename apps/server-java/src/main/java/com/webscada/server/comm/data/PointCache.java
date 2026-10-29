package com.webscada.server.comm.data;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/** 只在 tick 线程修改。snapshot 通过 ConcurrentHashMap 的 get 做无锁读。 */
public final class PointCache {
  private final ConcurrentHashMap<String, PointSample> points = new ConcurrentHashMap<>();

  public void seed(Collection<String> pointIds, long nowMs) {
    if (pointIds == null) return;
    for (String id : pointIds) {
      if (id == null || id.isBlank()) continue;
      points.put(id, bad(id, nowMs));
    }
  }

  public void markAll(Quality quality, long nowMs) {
    for (String id : points.keySet()) {
      PointSample prev = points.get(id);
      Long lastGood = prev == null ? null : prev.lastGoodTs();
      points.put(id, new PointSample(id, null, quality, null, nowMs, lastGood));
    }
  }

  /** 成功读到的点转为 GOOD。未出现在结果里的点保留原品质，并把接收时间拨到 now，供 stale 计时。 */
  public void applyRead(Collection<String> goodPointIds, long nowMs) {
    if (goodPointIds != null) {
      for (String id : goodPointIds) {
        if (id == null || id.isBlank()) continue;
        PointSample prev = points.get(id);
        Long lastGood = nowMs;
        Object value = prev == null ? null : prev.value();
        Long source = prev != null && prev.sourceTs() != null ? prev.sourceTs() : Long.valueOf(nowMs);
        points.put(id, new PointSample(id, value, Quality.GOOD, source, nowMs, lastGood));
      }
    }
    for (String id : new ArrayList<>(points.keySet())) {
      if (goodPointIds != null && goodPointIds.contains(id)) continue;
      PointSample prev = points.get(id);
      if (prev == null || prev.quality() == Quality.GOOD) continue;
      points.put(
          id,
          new PointSample(id, null, prev.quality(), prev.sourceTs(), nowMs, prev.lastGoodTs()));
    }
  }

  public void putValue(String pointId, Object value, Quality quality, long nowMs) {
    putValue(pointId, value, quality, null, nowMs);
  }

  public void putValue(String pointId, Object value, Quality quality, Long sourceTs, long nowMs) {
    PointSample prev = points.get(pointId);
    Long lastGood = quality == Quality.GOOD ? Long.valueOf(nowMs) : prev == null ? null : prev.lastGoodTs();
    Long source = sourceTs != null ? sourceTs : Long.valueOf(nowMs);
    points.put(pointId, new PointSample(pointId, value, quality, source, nowMs, lastGood));
  }

  /** GOOD 和非 GOOD 都按 recvTs 判断，超过 staleTimeout 转为 STALE。GOOD 保留上次值。 */
  public int applyStale(long nowMs, long staleTimeoutMs) {
    if (staleTimeoutMs <= 0) return 0;
    int n = 0;
    for (String id : new ArrayList<>(points.keySet())) {
      PointSample prev = points.get(id);
      if (prev == null || prev.quality() == Quality.STALE) continue;
      if (nowMs - prev.recvTs() >= staleTimeoutMs) {
        Object value = prev.quality() == Quality.GOOD ? prev.value() : null;
        points.put(
            id,
            new PointSample(id, value, Quality.STALE, prev.sourceTs(), nowMs, prev.lastGoodTs()));
        n++;
      }
    }
    return n;
  }

  public PointSample get(String pointId) {
    return points.get(pointId);
  }

  public List<PointSample> snapshot() {
    return List.copyOf(points.values());
  }

  private static PointSample bad(String id, long nowMs) {
    return new PointSample(id, null, Quality.BAD_COMM_FAILURE, null, nowMs, null);
  }
}
