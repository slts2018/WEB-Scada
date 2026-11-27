package com.webscada.server.device.mcd4000mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 对齐 telegraf 配置与 passthrough.star：PLC time 为 unix 秒；ARM time 为 unix 毫秒；
 * passthrough 的 devList 是对象，数据在 varList.content。
 */
public final class Mcd4000MqttPayloadParser {
  public enum Kind {
    PLC,
    ARM,
    FEATURE
  }

  public record Point(
      Kind kind, String devSn, String address, Object value, long timestampMs, boolean lastInGroup) {}

  private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
  private static final DateTimeFormatter PASSTHROUGH_TIME =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

  private final ObjectMapper mapper;

  public Mcd4000MqttPayloadParser(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  public List<Point> parse(String topic, byte[] payload) throws Exception {
    if (payload == null || payload.length == 0) return List.of();
    JsonNode root = mapper.readTree(payload);
    if (root == null || !root.isObject()) return List.of();
    String kind = Mcd4000MqttChannel.topicKind(topic);
    int cmdId = intVal(root.get("cmdId"), -1);
    if (kind.isEmpty()) {
      if (cmdId == 101) kind = "up";
      else if (cmdId == 100) kind = "upfast";
      else if (cmdId == 102) kind = "passthrough";
    }
    return switch (kind) {
      case "up" -> parsePlc(root);
      case "upfast" -> parseArm(root);
      case "passthrough" -> parsePassthrough(root);
      default -> List.of();
    };
  }

  private List<Point> parsePlc(JsonNode root) {
    JsonNode devList = root.get("devList");
    if (devList == null || !devList.isArray()) return List.of();
    List<Point> out = new ArrayList<>();
    for (JsonNode dev : devList) {
      if (dev == null || !dev.isObject()) continue;
      String devSn = text(dev.get("devSn"));
      long ts = unixSecondsToMs(dev.get("time"));
      JsonNode varList = dev.get("varList");
      if (varList == null || !varList.isObject()) continue;
      List<Map.Entry<String, JsonNode>> fields = new ArrayList<>();
      Iterator<Map.Entry<String, JsonNode>> it = varList.fields();
      while (it.hasNext()) fields.add(it.next());
      for (int i = 0; i < fields.size(); i++) {
        Map.Entry<String, JsonNode> e = fields.get(i);
        String name = e.getKey() == null ? "" : e.getKey().trim();
        if (name.isEmpty()) continue;
        Object value = scalar(e.getValue());
        if (value == null) continue;
        out.add(new Point(Kind.PLC, devSn, name, value, ts, true));
      }
    }
    return out;
  }

  private List<Point> parseArm(JsonNode root) {
    JsonNode varList = root.get("varList");
    String devSn = text(root.get("devSn"));
    if (varList == null || !varList.isArray()) {
      JsonNode devList = root.get("devList");
      if (devList != null && devList.isObject()) {
        varList = devList.get("varList");
        if (devSn.isEmpty()) devSn = text(devList.get("devSn"));
      } else if (devList != null && devList.isArray() && devList.size() > 0) {
        JsonNode first = devList.get(0);
        varList = first.get("varList");
        if (devSn.isEmpty()) devSn = text(first.get("devSn"));
      }
    }
    if (varList == null || !varList.isArray() || varList.isEmpty()) return List.of();
    List<Point> out = new ArrayList<>();
    int n = varList.size();
    for (int i = 0; i < n; i++) {
      JsonNode sample = varList.get(i);
      if (sample == null || !sample.isObject()) continue;
      long ts = unixMillis(sample.get("time"));
      boolean last = i == n - 1;
      Iterator<Map.Entry<String, JsonNode>> it = sample.fields();
      while (it.hasNext()) {
        Map.Entry<String, JsonNode> e = it.next();
        String name = e.getKey() == null ? "" : e.getKey().trim();
        if (name.isEmpty() || "time".equals(name)) continue;
        Object value = scalar(e.getValue());
        if (value == null) continue;
        out.add(new Point(Kind.ARM, devSn, name, value, ts, last));
      }
    }
    return out;
  }

  private List<Point> parsePassthrough(JsonNode root) {
    JsonNode content = contentsOf(root);
    if (content == null) return List.of();
    List<JsonNode> parents = new ArrayList<>();
    if (content.isArray()) {
      content.forEach(parents::add);
    } else {
      parents.add(content);
    }
    List<Point> out = new ArrayList<>();
    for (JsonNode c : parents) {
      if (c == null || !c.isObject()) continue;
      String unitId = text(c.get("unit_id"));
      if (unitId.isEmpty()) continue;
      long ts = parseShanghai(text(c.get("time")));
      JsonNode values = c.get("value");
      if (values == null || !values.isArray()) continue;
      for (JsonNode item : values) {
        if (item == null || !item.isObject()) continue;
        String sensor = sensorNameOf(item);
        if (sensor.isEmpty()) continue;
        String kind = classify(item, sensor);
        if (!"feature".equals(kind)) continue; // 波形/频谱/键相本轮不采为普通标量
        Iterator<Map.Entry<String, JsonNode>> it = item.fields();
        while (it.hasNext()) {
          Map.Entry<String, JsonNode> e = it.next();
          String field = e.getKey() == null ? "" : e.getKey().trim();
          if (field.isEmpty() || isSkipKey(field)) continue;
          Object value = scalar(e.getValue());
          if (value == null) continue;
          out.add(new Point(Kind.FEATURE, unitId, sensor + "|" + field, value, ts, true));
        }
      }
    }
    return out;
  }

  static JsonNode contentsOf(JsonNode obj) {
    if (obj == null || !obj.isObject()) return null;
    JsonNode dev = obj.get("devList");
    if (dev != null && dev.isObject()) {
      JsonNode varList = dev.get("varList");
      if (varList != null && varList.isObject()) {
        JsonNode content = varList.get("content");
        if (content != null && !content.isNull()) return content;
      }
    }
    if (obj.has("unit_id") && obj.has("value")) return obj;
    return null;
  }

  static String classify(JsonNode item, String sensorName) {
    boolean hasF = item.has("f") && !item.get("f").isNull();
    boolean hasA = item.has("a") && !item.get("a").isNull();
    if (hasF && hasA) return "spectrum";
    if (item.has("wave") && !item.get("wave").isNull()) {
      String name = sensorName == null ? "" : sensorName.toLowerCase(Locale.ROOT);
      if (name.contains("kp") || name.contains("keyphase") || name.contains("key_phase")) {
        return "keyphase";
      }
      return "waveform";
    }
    return "feature";
  }

  static String sensorNameOf(JsonNode item) {
    String name = text(item.get("sensor_name"));
    if (name.isEmpty()) name = text(item.get("sensorName"));
    return name;
  }

  static boolean isSkipKey(String key) {
    return "sensor_name".equals(key)
        || "sensorName".equals(key)
        || "sensor_id".equals(key)
        || "sensorId".equals(key);
  }

  static long unixSecondsToMs(JsonNode n) {
    if (n == null || !n.isNumber()) {
      String s = text(n);
      if (s.isEmpty()) return System.currentTimeMillis();
      try {
        double v = Double.parseDouble(s);
        return unixSecondsToMsValue(v);
      } catch (NumberFormatException e) {
        return System.currentTimeMillis();
      }
    }
    return unixSecondsToMsValue(n.asDouble());
  }

  static long unixSecondsToMsValue(double v) {
    // telegraf PLC 为 unix 秒。若误发毫秒（>= 1e12），按毫秒收下，避免时间跑到远未来。
    if (v >= 1e12) return (long) v;
    return (long) (v * 1000.0);
  }

  static long unixMillis(JsonNode n) {
    if (n == null || n.isNull()) return System.currentTimeMillis();
    if (n.isNumber()) return n.asLong();
    String s = text(n);
    if (s.isEmpty()) return System.currentTimeMillis();
    try {
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      try {
        return (long) Double.parseDouble(s);
      } catch (NumberFormatException e2) {
        return System.currentTimeMillis();
      }
    }
  }

  static long parseShanghai(String raw) {
    if (raw == null || raw.isBlank()) return System.currentTimeMillis();
    try {
      LocalDateTime ldt = LocalDateTime.parse(raw.trim(), PASSTHROUGH_TIME);
      return ldt.atZone(SHANGHAI).toInstant().toEpochMilli();
    } catch (DateTimeParseException e) {
      return System.currentTimeMillis();
    }
  }

  static Object scalar(JsonNode n) {
    if (n == null || n.isNull()) return null;
    if (n.isBoolean()) return n.booleanValue();
    if (n.isInt() || n.isLong()) return n.longValue();
    if (n.isNumber()) return n.doubleValue();
    if (n.isTextual()) {
      String s = n.asText();
      if (s == null) return null;
      String t = s.trim();
      if (t.isEmpty()) return s;
      try {
        if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) {
          return Double.parseDouble(t);
        }
        long lv = Long.parseLong(t);
        if (lv >= Integer.MIN_VALUE && lv <= Integer.MAX_VALUE) return (int) lv;
        return lv;
      } catch (NumberFormatException e) {
        return s;
      }
    }
    // 数组/对象不当普通标量
    return null;
  }

  static String text(JsonNode n) {
    if (n == null || n.isNull()) return "";
    if (n.isTextual()) return n.asText().trim();
    if (n.isNumber() || n.isBoolean()) return n.asText().trim();
    return "";
  }

  static int intVal(JsonNode n, int fallback) {
    if (n == null || n.isNull()) return fallback;
    if (n.isNumber()) return n.asInt();
    try {
      return Integer.parseInt(text(n));
    } catch (NumberFormatException e) {
      return fallback;
    }
  }
}
