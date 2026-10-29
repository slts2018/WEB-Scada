package com.webscada.server.comm.supervisor;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class BackoffTest {
  @Test
  void jitterFactorStaysInsideConfiguredBand() {
    assertBand(0, 1000, 60_000, () -> 0.0);
    assertBand(0, 1000, 60_000, () -> 0.5);
    assertBand(0, 1000, 60_000, () -> 1.0);
    long capped = Backoff.delayMs(8, 1000, 60_000, 0.2, () -> 0.5);
    assertTrue(capped >= 48_000 && capped <= 72_000, "capped=" + capped);
  }

  private static void assertBand(int attempt, long base, long max, java.util.function.DoubleSupplier random) {
    long delay = Backoff.delayMs(attempt, base, max, 0.2, random);
    double uncapped = Math.min(base * Math.pow(2, attempt), max);
    double factor = delay / uncapped;
    assertTrue(factor >= 0.8d && factor <= 1.2d, "factor=" + factor + " delay=" + delay);
  }
}
