package com.webscada.server.comm.log;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class LinkLogTest {
  @Test
  void redactsSecretsAndKeepsSessionFields() {
    List<LogEvent> events = new ArrayList<>();
    LinkLog log =
        new LinkLog(
            "plc",
            "dev",
            "modbus-tcp",
            Clock.systemUTC(),
            (event, json) -> events.add(event));
    log.info(
        "connect",
        "CONNECT",
        "password=root token: abc -----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----",
        3L,
        1,
        "session-1",
        "corr-9");
    LogEvent event = events.get(0);
    assertEquals("session-1", event.sessionId());
    assertEquals("corr-9", event.correlationId());
    assertFalse(event.detail().contains("root"));
    assertFalse(event.detail().contains("SECRET"));
    assertTrue(event.detail().contains("***"));

    LinkLog broken =
        new LinkLog(
            "plc",
            "dev",
            "modbus-tcp",
            Clock.systemUTC(),
            (e, json) -> {
              throw new IllegalStateException("disk full");
            });
    broken.warn("x", "y", "password=nope", null, null, "s", "c");
    assertEquals(1, broken.recent().size());
    assertFalse(broken.recent().get(0).detail().contains("nope"));
  }
}
