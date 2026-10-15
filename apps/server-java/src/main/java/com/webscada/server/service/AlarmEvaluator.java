package com.webscada.server.service;

import com.webscada.server.model.TagAlarmConfig;

/** 纯判定：是否满足报警条件。active=true 时模拟量按死区保持。 */
public final class AlarmEvaluator {
  private AlarmEvaluator() {}

  public static boolean condition(TagAlarmConfig cfg, boolean active, Object value, String quality) {
    return condition(cfg, active, value, quality, null);
  }

  /**
   * change 是变化率报警在时间窗内的变化量。窗还没攒够时传 null，条件为假。
   */
  public static boolean condition(
      TagAlarmConfig cfg, boolean active, Object value, String quality, Double change) {
    if (cfg == null || !cfg.enabled()) return false;
    return switch (cfg.kind() == null ? "" : cfg.kind()) {
      case "limit" -> limit(cfg, active, value);
      case "bool" -> bool(cfg, value);
      case "target" -> target(cfg, active, value);
      case "rate" -> rate(cfg, active, change);
      case "match" -> textEquals(cfg, value);
      case "mismatch" -> !textEquals(cfg, value);
      case "quality" -> quality != null && quality.equals(cfg.quality());
      default -> false;
    };
  }

  private static boolean limit(TagAlarmConfig cfg, boolean active, Object value) {
    if (!(value instanceof Number n) || cfg.threshold() == null || cfg.limit() == null) return false;
    double v = n.doubleValue();
    if (!Double.isFinite(v)) return false;
    double th = cfg.threshold();
    double db = cfg.deadband() == null ? 0 : Math.max(0, cfg.deadband());
    boolean high = "HH".equals(cfg.limit()) || "H".equals(cfg.limit());
    boolean low = "L".equals(cfg.limit()) || "LL".equals(cfg.limit());
    if (!high && !low) return false;
    if (!active) return high ? v > th : v < th;
    return high ? v >= th - db : v <= th + db;
  }

  private static boolean bool(TagAlarmConfig cfg, Object value) {
    if (cfg.boolValue() == null) return false;
    if (value instanceof Boolean b) return b.booleanValue() == cfg.boolValue();
    if (value instanceof Number n) return (n.doubleValue() != 0) == cfg.boolValue();
    return false;
  }

  private static boolean target(TagAlarmConfig cfg, boolean active, Object value) {
    if (!(value instanceof Number n) || cfg.target() == null || cfg.threshold() == null) return false;
    double dev = Math.abs(n.doubleValue() - cfg.target());
    if (!Double.isFinite(dev)) return false;
    double band = Math.max(0, cfg.threshold());
    double db = cfg.deadband() == null ? 0 : Math.max(0, cfg.deadband());
    if (!active) return dev > band;
    return dev >= Math.max(0, band - db);
  }

  private static boolean rate(TagAlarmConfig cfg, boolean active, Double change) {
    if (change == null || cfg.threshold() == null || !Double.isFinite(change)) return false;
    double band = Math.max(0, cfg.threshold());
    double db = cfg.deadband() == null ? 0 : Math.max(0, cfg.deadband());
    if (!active) return change > band;
    return change >= Math.max(0, band - db);
  }

  private static boolean textEquals(TagAlarmConfig cfg, Object value) {
    String current = value == null ? "" : String.valueOf(value);
    String expect = cfg.expectText() == null ? "" : cfg.expectText();
    return current.equals(expect);
  }
}
