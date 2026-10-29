package com.webscada.server.comm.metrics;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.webscada.server.comm.state.ConnectionState;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LinkStatsTest {
  @Test
  void snapshotReadsAddersWithoutMutation() {
    LinkStats stats = new LinkStats();
    stats.reconnectTotal().increment();
    stats.timeouts().add(2);
    stats.recordLatency(10);
    stats.recordLatency(20);
    stats.recordLatency(30);
    stats.state(ConnectionState.RUNNING);
    stats.activeEndpoint("10.0.0.8", 502);
    Map<String, Object> snap = stats.snapshot();
    assertEquals(1L, snap.get("reconnect_total"));
    assertEquals(2L, snap.get("timeout_total"));
    assertEquals("RUNNING", snap.get("connection_state"));
    assertEquals("10.0.0.8", snap.get("activeHost"));
    assertEquals(502, snap.get("activePort"));
    @SuppressWarnings("unchecked")
    Map<String, Object> latency = (Map<String, Object>) snap.get("request_latency_ms");
    assertEquals(20L, latency.get("p50"));
  }
}
