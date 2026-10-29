package com.webscada.server.comm.supervisor;

import java.util.function.DoubleSupplier;

/** delay = min(base * 2^attempt, max) * (1 + random(-jitter, +jitter))。unitRandom 取 [0, 1]。 */
public final class Backoff {
  private Backoff() {}

  public static long delayMs(
      int attempt, long baseMs, long maxMs, double jitter, DoubleSupplier unitRandom) {
    int exp = Math.min(Math.max(attempt, 0), 16);
    double capped = Math.min(baseMs * Math.pow(2, exp), Math.max(baseMs, maxMs));
    double unit = unitRandom == null ? 0.5 : unitRandom.getAsDouble();
    if (unit < 0) unit = 0;
    if (unit > 1) unit = 1;
    double jitterSpan = jitter < 0 ? 0 : Math.min(jitter, 1);
    double factor = 1 + (unit * 2 - 1) * jitterSpan;
    return Math.max(0L, Math.round(capped * factor));
  }
}
