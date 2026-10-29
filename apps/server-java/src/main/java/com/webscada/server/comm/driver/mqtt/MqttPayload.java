package com.webscada.server.comm.driver.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.MqttOptions;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.JsonValues;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** JSON 或 raw 负载。解析失败给出十六进制前缀，不填 0。路径和换算走 {@link JsonValues}。 */
final class MqttPayload {
  private MqttPayload() {}

  record Batch(List<IoResult.PointUpdate> points, String failureHex, String dedupKey) {}

  static Batch decode(LinkDefinition link, String topic, byte[] payload, boolean retained, long nowMs) {
    byte[] body = payload == null ? new byte[0] : payload;
    List<DataPoint> matched = new ArrayList<>();
    for (DataPoint point : link.points()) {
      if (point.topic().isBlank() || point.topic().equals(topic)) matched.add(point);
    }
    if (matched.isEmpty()) return new Batch(List.of(), null, null);
    try {
      if ("raw".equalsIgnoreCase(link.mqtt().payloadFormat())) {
        return raw(link, matched, body, retained, nowMs);
      }
      return json(link, topic, matched, body, retained, nowMs);
    } catch (RuntimeException ex) {
      return failed(matched, body);
    }
  }

  private static Batch json(
      LinkDefinition link,
      String topic,
      List<DataPoint> matched,
      byte[] body,
      boolean retained,
      long nowMs) {
    JsonNode root;
    try {
      root = JsonValues.readTree(body);
    } catch (Exception ex) {
      return failed(matched, body);
    }
    if (root == null || !root.isObject()) return failed(matched, body);
    MqttOptions mqtt = link.mqtt();
    Long ts = JsonValues.timestamp(root.get(mqtt.tsField()));
    Long source = ts != null ? ts : nowMs;
    Quality quality = mapQuality(root.get(mqtt.qualityField()));
    if (quality == null) quality = Quality.GOOD;
    quality = age(quality, ts, nowMs, link.staleTimeoutMs());
    String seq = text(root.get(mqtt.seqField()));
    String key = dedupKey(topic, seq, ts, body);
    List<IoResult.PointUpdate> points = new ArrayList<>();
    boolean bad = false;
    for (DataPoint point : matched) {
      String path = point.field().isBlank() ? mqtt.valueField() : point.field();
      JsonNode node = JsonValues.at(root, path);
      try {
        if (node == null || node.isNull()) throw new IllegalArgumentException("missing " + path);
        points.add(new IoResult.PointUpdate(point.id(), JsonValues.cast(point, node), quality, source));
      } catch (RuntimeException ex) {
        bad = true;
        points.add(new IoResult.PointUpdate(point.id(), null, Quality.BAD_CONFIG, source));
      }
    }
    return new Batch(points, bad ? JsonValues.hexPrefix(body) : null, key);
  }

  private static Batch raw(
      LinkDefinition link, List<DataPoint> matched, byte[] body, boolean retained, long nowMs) {
    if (matched.size() != 1) return failed(matched, body);
    DataPoint point = matched.get(0);
    String text = new String(body, StandardCharsets.UTF_8).trim();
    if (text.isEmpty()) return failed(matched, body);
    try {
      Object value = JsonValues.castText(point, text);
      return new Batch(
          List.of(new IoResult.PointUpdate(point.id(), value, Quality.GOOD, nowMs)), null, null);
    } catch (RuntimeException ex) {
      return failed(matched, body);
    }
  }

  /**
   * 负载里的 ts 已经超过 staleTimeout，就不能因为刚收到就当成实时值。
   * 测试用的 broker 重发 retained 时不一定带 RETAIN 标志，所以按 ts 判断，不看这个位。
   */
  private static Quality age(Quality quality, Long ts, long nowMs, int staleTimeoutMs) {
    if (ts == null || quality != Quality.GOOD) return quality;
    if (staleTimeoutMs > 0 && nowMs - ts >= staleTimeoutMs) return Quality.STALE;
    return quality;
  }

  /** 有 seq 用 seq。没有 seq 时用 topic、ts 和负载摘要，避免相同时间戳的不同负载被当成同一条。 */
  private static String dedupKey(String topic, String seq, Long ts, byte[] body) {
    if (seq != null && !seq.isBlank()) return topic + "|seq:" + seq;
    if (ts == null) return null;
    return topic + "|" + ts + "|" + JsonValues.sha256(body);
  }

  private static Batch failed(List<DataPoint> matched, byte[] body) {
    List<IoResult.PointUpdate> points = new ArrayList<>();
    for (DataPoint point : matched) {
      points.add(new IoResult.PointUpdate(point.id(), null, Quality.BAD_CONFIG, null));
    }
    return new Batch(points, JsonValues.hexPrefix(body), null);
  }

  private static String text(JsonNode node) {
    if (node == null || node.isNull()) return null;
    String value = node.asText();
    return value == null || value.isBlank() ? null : value;
  }

  private static Quality mapQuality(JsonNode node) {
    if (node == null || node.isNull()) return null;
    String text = node.asText("").trim().toLowerCase(Locale.ROOT);
    if (text.isEmpty() || "good".equals(text)) return Quality.GOOD;
    if ("uncertain".equals(text)) return Quality.UNCERTAIN;
    if ("bad".equals(text) || "bad_device".equals(text)) return Quality.BAD_DEVICE;
    throw new IllegalArgumentException("quality " + text);
  }
}
