package com.webscada.server.device.mcd4000;

/** channel = baseUrl|DeviceId|UnitId|source(vib|plc|arm) */
public record Mcd4000Channel(String baseUrl, String deviceId, String unitId, Source source) {
  public enum Source {
    VIB,
    PLC,
    ARM
  }

  public static Mcd4000Channel parse(String channel) {
    if (channel == null || channel.isBlank()) return null;
    String[] parts = channel.split("\\|", -1);
    String base = parts.length > 0 ? parts[0].trim() : "";
    String did = parts.length > 1 ? parts[1].trim() : "";
    String uid = parts.length > 2 ? parts[2].trim() : "";
    Source src = Source.VIB;
    if (parts.length > 3) {
      String s = parts[3].trim().toLowerCase();
      if ("plc".equals(s)) src = Source.PLC;
      else if ("arm".equals(s)) src = Source.ARM;
    }
    if (base.isEmpty() || did.isEmpty()) return null;
    // UnitId 可选（振动文档有该字段；PLC/ARM 示例不含）
    String normalizedBase = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    return new Mcd4000Channel(normalizedBase, did, uid, src);
  }

  public record TagAddr(String sensor, String field) {
    public static TagAddr parse(String address) {
      if (address == null || address.isBlank()) return null;
      int i = address.indexOf('|');
      String sensor;
      String field;
      if (i >= 0) {
        sensor = address.substring(0, i).trim();
        field = address.substring(i + 1).trim();
      } else {
        sensor = address.trim();
        field = "";
      }
      if (sensor.isEmpty() || field.isEmpty()) return null;
      return new TagAddr(sensor, field);
    }
  }
}
