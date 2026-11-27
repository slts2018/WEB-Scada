package com.webscada.server.device.modbus;

import java.util.Arrays;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/** 采集调度时延与通信排队时延的短窗口统计，供限流日志使用。 */
final class ModbusSchedMetrics {
  private static final int MAX_SAMPLES = 4096;
  private final ConcurrentLinkedQueue<Sample> samples = new ConcurrentLinkedQueue<>();
  private final AtomicInteger size = new AtomicInteger();

  void record(String deviceId, int periodMs, long schedDelayNs, long queueNs, long commExecNs) {
    samples.add(new Sample(deviceId, periodMs, schedDelayNs, queueNs, commExecNs));
    if (size.incrementAndGet() > MAX_SAMPLES) {
      if (samples.poll() != null) size.decrementAndGet();
    }
  }

  Snapshot snapshotAndReset() {
    Sample[] batch = samples.toArray(Sample[]::new);
    samples.clear();
    size.set(0);
    if (batch.length == 0) return Snapshot.EMPTY;
    long[] sched = new long[batch.length];
    long[] queue = new long[batch.length];
    long[] comm = new long[batch.length];
    for (int i = 0; i < batch.length; i++) {
      sched[i] = batch[i].schedDelayNs();
      queue[i] = batch[i].queueNs();
      comm[i] = batch[i].commExecNs();
    }
    return new Snapshot(batch.length, stats(sched), stats(queue), stats(comm));
  }

  private static Stats stats(long[] values) {
    long[] copy = values.clone();
    Arrays.sort(copy);
    return new Stats(
        nsToMs(copy[copy.length / 2]),
        nsToMs(percentile(copy, 0.95)),
        nsToMs(copy[copy.length - 1]));
  }

  private static long percentile(long[] sortedAsc, double p) {
    if (sortedAsc.length == 1) return sortedAsc[0];
    int idx = (int) Math.ceil(p * sortedAsc.length) - 1;
    if (idx < 0) idx = 0;
    if (idx >= sortedAsc.length) idx = sortedAsc.length - 1;
    return sortedAsc[idx];
  }

  private static long nsToMs(long ns) {
    return Math.round(ns / 1_000_000.0);
  }

  record Sample(String deviceId, int periodMs, long schedDelayNs, long queueNs, long commExecNs) {}

  record Stats(long p50Ms, long p95Ms, long maxMs) {}

  record Snapshot(int n, Stats sched, Stats queue, Stats comm) {
    static final Snapshot EMPTY = new Snapshot(0, new Stats(0, 0, 0), new Stats(0, 0, 0), new Stats(0, 0, 0));
  }
}
