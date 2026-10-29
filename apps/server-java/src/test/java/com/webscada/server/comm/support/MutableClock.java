package com.webscada.server.comm.support;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;

public final class MutableClock extends Clock {
  private final AtomicLong now = new AtomicLong(1_700_000_000_000L);

  @Override
  public ZoneId getZone() {
    return ZoneOffset.UTC;
  }

  @Override
  public Clock withZone(ZoneId zone) {
    return this;
  }

  @Override
  public Instant instant() {
    return Instant.ofEpochMilli(millis());
  }

  @Override
  public long millis() {
    return now.get();
  }

  public void advance(long ms) {
    now.addAndGet(ms);
  }
}
