package com.webscada.server.comm.state;

import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.metrics.LinkStats;
import java.util.EnumMap;

/**
 * 唯一的状态迁移表。拒绝时返回 false，并记 rejected_transition_total 与 ERROR 日志。
 * strict 只在测试里打开，用来断言非法迁移。
 */
public final class ConnectionStateMachine {
  public enum Signal {
    START,
    CONNECT_OK,
    CONNECT_FAIL,
    HANDSHAKE_OK,
    HANDSHAKE_FAIL,
    IO_FAIL,
    DEGRADE,
    RECOVER,
    GIVE_UP,
    BACKOFF_ELAPSED,
    MAX_ATTEMPTS,
    PROBE_OK,
    STOP,
    RELEASED
  }

  private final EnumMap<ConnectionState, EnumMap<Signal, ConnectionState>> table =
      new EnumMap<>(ConnectionState.class);
  private final LinkStats stats;
  private final LinkLog log;
  private volatile ConnectionState state = ConnectionState.DISCONNECTED;
  private long enteredAtMs;
  private boolean strict;

  public ConnectionStateMachine(LinkStats stats, LinkLog log, long nowMs) {
    this.stats = stats;
    this.log = log;
    this.enteredAtMs = nowMs;
    for (ConnectionState s : ConnectionState.values()) {
      table.put(s, new EnumMap<>(Signal.class));
    }
    allow(ConnectionState.DISCONNECTED, Signal.START, ConnectionState.CONNECTING);
    allow(ConnectionState.DISCONNECTED, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.CONNECTING, Signal.CONNECT_OK, ConnectionState.HANDSHAKE);
    allow(ConnectionState.CONNECTING, Signal.CONNECT_FAIL, ConnectionState.RECONNECTING);
    allow(ConnectionState.CONNECTING, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.HANDSHAKE, Signal.HANDSHAKE_OK, ConnectionState.RUNNING);
    allow(ConnectionState.HANDSHAKE, Signal.HANDSHAKE_FAIL, ConnectionState.RECONNECTING);
    allow(ConnectionState.HANDSHAKE, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.RUNNING, Signal.IO_FAIL, ConnectionState.RECONNECTING);
    allow(ConnectionState.RUNNING, Signal.DEGRADE, ConnectionState.DEGRADED);
    allow(ConnectionState.RUNNING, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.DEGRADED, Signal.RECOVER, ConnectionState.RUNNING);
    allow(ConnectionState.DEGRADED, Signal.GIVE_UP, ConnectionState.RECONNECTING);
    allow(ConnectionState.DEGRADED, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.RECONNECTING, Signal.BACKOFF_ELAPSED, ConnectionState.CONNECTING);
    allow(ConnectionState.RECONNECTING, Signal.MAX_ATTEMPTS, ConnectionState.FAILED);
    allow(ConnectionState.RECONNECTING, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.FAILED, Signal.PROBE_OK, ConnectionState.HANDSHAKE);
    allow(ConnectionState.FAILED, Signal.STOP, ConnectionState.STOPPING);
    allow(ConnectionState.STOPPING, Signal.RELEASED, ConnectionState.STOPPED);
    // 停机后的再次启动。表内其余信号仍然拒绝。
    allow(ConnectionState.STOPPED, Signal.START, ConnectionState.CONNECTING);
    stats.state(state);
  }

  public void setStrict(boolean strict) {
    this.strict = strict;
  }

  public ConnectionState state() {
    return state;
  }

  public boolean transition(
      Signal signal, String reason, long nowMs, String sessionId, String correlationId) {
    ConnectionState from = state;
    ConnectionState to = table.get(from).get(signal);
    if (to == null) {
      stats.rejectedTransitions().increment();
      log.error(
          "rejected_transition",
          "REJECTED",
          "from=" + from + " signal=" + signal + " reason=" + safe(reason),
          null,
          null,
          sessionId,
          correlationId);
      if (strict) {
        throw new IllegalStateException("rejected transition " + from + " / " + signal);
      }
      return false;
    }
    long duration = Math.max(0, nowMs - enteredAtMs);
    state = to;
    enteredAtMs = nowMs;
    stats.state(to);
    log.info(
        "state_changed",
        to.name(),
        "from=" + from + " to=" + to + " reason=" + safe(reason),
        duration,
        null,
        sessionId,
        correlationId);
    return true;
  }

  private static String safe(String reason) {
    return reason == null ? "" : reason;
  }

  private void allow(ConnectionState from, Signal signal, ConnectionState to) {
    table.get(from).put(signal, to);
  }
}
