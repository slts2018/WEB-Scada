package com.webscada.server.comm.metrics;

import com.webscada.server.comm.state.ConnectionState;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.LongAdder;

/** 计数用 LongAdder / AtomicLong。{@link #snapshot()} 只做 get/sum，不加锁。 */
public final class LinkStats {
  private static final int LATENCY_SLOTS = 64;

  private final LongAdder reconnectTotal = new LongAdder();
  private final LongAdder rejectedTransitions = new LongAdder();
  private final LongAdder rxFrames = new LongAdder();
  private final LongAdder txFrames = new LongAdder();
  private final LongAdder timeouts = new LongAdder();
  private final LongAdder protocolErrors = new LongAdder();
  private final LongAdder decodeErrors = new LongAdder();
  private final LongAdder dropped = new LongAdder();
  private final LongAdder rateLimited = new LongAdder();
  private final AtomicLong connectDurationMs = new AtomicLong();
  private final AtomicLong lastSuccessTs = new AtomicLong();
  private final AtomicLong queueDepth = new AtomicLong();
  private final AtomicReference<String> state = new AtomicReference<>(ConnectionState.DISCONNECTED.name());
  private final AtomicReference<String> activeHost = new AtomicReference<>("");
  private final AtomicInteger activePort = new AtomicInteger();
  private final AtomicReference<String> sessionId = new AtomicReference<>("");
  private final AtomicLongArray latency = new AtomicLongArray(LATENCY_SLOTS);
  private final AtomicInteger latencyIndex = new AtomicInteger();
  private final AtomicInteger latencyCount = new AtomicInteger();

  public LongAdder reconnectTotal() {
    return reconnectTotal;
  }

  public LongAdder rejectedTransitions() {
    return rejectedTransitions;
  }

  public LongAdder rxFrames() {
    return rxFrames;
  }

  public LongAdder txFrames() {
    return txFrames;
  }

  public LongAdder timeouts() {
    return timeouts;
  }

  public LongAdder protocolErrors() {
    return protocolErrors;
  }

  public LongAdder decodeErrors() {
    return decodeErrors;
  }

  public LongAdder dropped() {
    return dropped;
  }

  /** HTTP 429。和 5xx 的 protocol_error 分开计。 */
  public LongAdder rateLimited() {
    return rateLimited;
  }

  public void state(ConnectionState next) {
    state.set(next.name());
  }

  public void activeEndpoint(String host, int port) {
    activeHost.set(host == null ? "" : host);
    activePort.set(port);
  }

  public void session(String id) {
    sessionId.set(id == null ? "" : id);
  }

  public void connectDuration(long ms) {
    connectDurationMs.set(ms);
  }

  public void lastSuccess(long ts) {
    lastSuccessTs.set(ts);
  }

  public void queueDepth(int depth) {
    queueDepth.set(depth);
  }

  public void recordLatency(long ms) {
    int idx = latencyIndex.getAndIncrement() & (LATENCY_SLOTS - 1);
    latency.set(idx, ms);
    latencyCount.updateAndGet(n -> n >= LATENCY_SLOTS ? LATENCY_SLOTS : n + 1);
  }

  public String activeHost() {
    return activeHost.get();
  }

  public int activePort() {
    return activePort.get();
  }

  public Map<String, Object> snapshot() {
    int n = latencyCount.get();
    long p50 = 0;
    long p95 = 0;
    long p99 = 0;
    if (n > 0) {
      long[] sample = new long[n];
      for (int i = 0; i < n; i++) sample[i] = latency.get(i);
      Arrays.sort(sample);
      p50 = sample[pctIndex(n, 0.50)];
      p95 = sample[pctIndex(n, 0.95)];
      p99 = sample[pctIndex(n, 0.99)];
    }
    Map<String, Object> latencyMap = new LinkedHashMap<>();
    latencyMap.put("p50", p50);
    latencyMap.put("p95", p95);
    latencyMap.put("p99", p99);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("connection_state", state.get());
    out.put("reconnect_total", reconnectTotal.sum());
    out.put("rejected_transition_total", rejectedTransitions.sum());
    out.put("connect_duration_ms", connectDurationMs.get());
    out.put("rx_frames_total", rxFrames.sum());
    out.put("tx_frames_total", txFrames.sum());
    out.put("timeout_total", timeouts.sum());
    out.put("protocol_error_total", protocolErrors.sum());
    out.put("decode_error_total", decodeErrors.sum());
    out.put("request_latency_ms", latencyMap);
    out.put("queue_depth", queueDepth.get());
    out.put("dropped_total", dropped.sum());
    out.put("rate_limit_total", rateLimited.sum());
    out.put("last_success_ts", lastSuccessTs.get());
    out.put("activeHost", activeHost.get());
    out.put("activePort", activePort.get());
    out.put("sessionId", sessionId.get());
    return out;
  }

  private static int pctIndex(int n, double p) {
    int idx = (int) Math.ceil(p * n) - 1;
    if (idx < 0) return 0;
    if (idx >= n) return n - 1;
    return idx;
  }
}
