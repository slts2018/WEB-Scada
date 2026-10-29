package com.webscada.server.comm.data;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class QualityTest {
  @Test
  void mapsToAndFromLegacyQuality() {
    assertEquals("Good", Quality.GOOD.toLegacy());
    assertEquals("Uncertain", Quality.UNCERTAIN.toLegacy());
    assertEquals("Uncertain", Quality.STALE.toLegacy());
    assertEquals("Offline", Quality.BAD_COMM_FAILURE.toLegacy());
    assertEquals("Bad", Quality.BAD_CONFIG.toLegacy());
    assertEquals("Bad", Quality.BAD_DEVICE.toLegacy());

    assertEquals(Quality.GOOD, Quality.fromLegacy("Good"));
    assertEquals(Quality.UNCERTAIN, Quality.fromLegacy("Uncertain"));
    assertEquals(Quality.BAD_COMM_FAILURE, Quality.fromLegacy("Offline"));
    assertEquals(Quality.BAD_DEVICE, Quality.fromLegacy("Bad"));
    assertThrows(IllegalArgumentException.class, () -> Quality.fromLegacy("nope"));
  }
}
