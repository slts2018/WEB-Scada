package com.webscada.server.comm.data;

/**
 * 通信模块品质。{@link #toLegacy()} / {@link #fromLegacy(String)} 对应变量运行时现有的
 * Good / Bad / Uncertain / Offline。Bad 与 Uncertain 有多对一，反向映射是有损的：
 * Bad → BAD_DEVICE，Uncertain → UNCERTAIN。
 */
public enum Quality {
  GOOD,
  UNCERTAIN,
  BAD_COMM_FAILURE,
  BAD_CONFIG,
  BAD_DEVICE,
  STALE;

  public String toLegacy() {
    return switch (this) {
      case GOOD -> "Good";
      case UNCERTAIN, STALE -> "Uncertain";
      case BAD_COMM_FAILURE -> "Offline";
      case BAD_CONFIG, BAD_DEVICE -> "Bad";
    };
  }

  public static Quality fromLegacy(String quality) {
    if (quality == null || quality.isBlank()) {
      throw new IllegalArgumentException("legacy quality required");
    }
    return switch (quality.trim()) {
      case "Good", "GOOD" -> GOOD;
      case "Uncertain", "UNCERTAIN" -> UNCERTAIN;
      case "Offline", "OFFLINE" -> BAD_COMM_FAILURE;
      case "Bad", "BAD" -> BAD_DEVICE;
      default -> throw new IllegalArgumentException("unknown legacy quality: " + quality);
    };
  }
}
