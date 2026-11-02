package com.webscada.server.device.modbus;

import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;

/** 采集日志限流，避免每轮轮询刷屏。 */
final class ModbusAcqLog {
  private static final long DEFAULT_MS = 10_000;
  private final ConcurrentHashMap<String, Long> lastAt = new ConcurrentHashMap<>();

  boolean allow(String key) {
    return allow(key, DEFAULT_MS);
  }

  boolean allow(String key, long minIntervalMs) {
    long now = System.currentTimeMillis();
    Long prev = lastAt.get(key);
    if (prev != null && now - prev < minIntervalMs) return false;
    lastAt.put(key, now);
    return true;
  }

  void warn(Logger log, String key, String fmt, Object... args) {
    if (allow(key) && log.isWarnEnabled()) {
      log.warn(fmt, args);
    }
  }

  void info(Logger log, String key, String fmt, Object... args) {
    if (allow(key) && log.isInfoEnabled()) {
      log.info(fmt, args);
    }
  }

  void info(Logger log, String key, long minIntervalMs, String fmt, Object... args) {
    if (allow(key, minIntervalMs) && log.isInfoEnabled()) {
      log.info(fmt, args);
    }
  }
}
