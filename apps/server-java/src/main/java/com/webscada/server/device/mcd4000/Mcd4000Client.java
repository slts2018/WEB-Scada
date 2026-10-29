package com.webscada.server.device.mcd4000;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 调用沈鼓数据中台 InfluxdbReadWrite Query*，取每个 Sensor/Field 最新一点。 */
public final class Mcd4000Client {
  private static final Logger log = LoggerFactory.getLogger(Mcd4000Client.class);
  private static final ZoneId CN = ZoneId.of("Asia/Shanghai");
  private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

  private final ObjectMapper mapper;
  private final HttpClient http;
  private final Duration timeout;
  private final int lookbackSec;

  public Mcd4000Client(
      ObjectMapper mapper, Duration timeout, int lookbackSec, boolean insecureSsl) {
    this.mapper = mapper;
    this.timeout = timeout;
    this.lookbackSec = Math.max(10, lookbackSec);
    HttpClient.Builder b =
        HttpClient.newBuilder()
            .connectTimeout(timeout)
            .followRedirects(HttpClient.Redirect.NORMAL);
    if (insecureSsl) {
      try {
        TrustManager[] trustAll =
            new TrustManager[] {
              new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] c, String a) {}

                public void checkServerTrusted(X509Certificate[] c, String a) {}

                public X509Certificate[] getAcceptedIssuers() {
                  return new X509Certificate[0];
                }
              }
            };
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, trustAll, new SecureRandom());
        b.sslContext(ctx);
        log.warn("mcd4000: insecure SSL enabled (trust-all) — only for lab / known hosts");
      } catch (Exception e) {
        log.warn("mcd4000: failed to enable insecure SSL: {}", e.toString());
      }
    }
    this.http = b.build();
  }

  /** 任意 HTTP 响应都算主机可达；连接失败由调用方记为离线。 */
  public void reachable(String baseUrl) throws Exception {
    HttpRequest req =
        HttpRequest.newBuilder(URI.create(baseUrl))
            .timeout(timeout)
            .method("GET", HttpRequest.BodyPublishers.noBody())
            .build();
    http.send(req, HttpResponse.BodyHandlers.discarding());
  }

  /** 一个点的值和由返回 code 决定的质量（只有 Good / Bad）。 */
  public record Point(Object value, String quality) {}

  /**
   * @return map key = sensor + "\0" + field → 最新一点。响应级 code 失败时各点质量为 Bad。
   */
  public Map<String, Point> queryLatest(
      Mcd4000Channel ch, Collection<Mcd4000Channel.TagAddr> addrs) throws Exception {
    Set<String> sensors = new LinkedHashSet<>();
    Set<String> fields = new LinkedHashSet<>();
    for (Mcd4000Channel.TagAddr a : addrs) {
      sensors.add(a.sensor());
      fields.add(a.field());
    }
    if (sensors.isEmpty() || fields.isEmpty()) return Map.of();

    LocalDateTime end = LocalDateTime.now(CN);
    LocalDateTime start = end.minusSeconds(lookbackSec);
    String startTime = start.format(FMT);
    String endTime = end.format(FMT);

    // 请求体严格按 data_center_API_v4.html 示例字段名
    String path;
    ObjectNode body = mapper.createObjectNode();

    switch (ch.source()) {
      case PLC -> {
        // 现场 QueryAllPLCDatas：PascalCase + UnitId(可 "") + FuncName=last
        path = "/api/InfluxdbReadWrite/QueryAllPLCDatas";
        body.put("DeviceId", ch.deviceId());
        body.put("UnitId", ch.unitId() == null ? "" : ch.unitId());
        ArrayNode sensorsArr = body.putArray("Sensors");
        sensors.forEach(sensorsArr::add);
        ArrayNode fieldsArr = body.putArray("Fields");
        fields.forEach(fieldsArr::add);
        body.put("StartTime", startTime);
        body.put("FuncName", "last");
      }
      case ARM -> {
        // 3.2 QueryAllARMDatas：同上
        path = "/api/InfluxdbReadWrite/QueryAllARMDatas";
        body.put("deviceId", ch.deviceId());
        ArrayNode sensorsArr = body.putArray("sensors");
        sensors.forEach(sensorsArr::add);
        ArrayNode fieldsArr = body.putArray("fields");
        fields.forEach(fieldsArr::add);
        body.put("startTime", startTime);
        body.put("endTime", endTime);
        body.put("Interval", "1s");
        body.put("Timeshift", "1s");
      }
      default -> {
        // 2.1 QueryDataByInterval：DeviceId / UnitId(可为 "") / Sensors / Fields / StartTime / EndTime / …
        path = "/api/InfluxdbReadWrite/QueryDataByInterval";
        body.put("DeviceId", ch.deviceId());
        body.put("UnitId", ch.unitId() == null ? "" : ch.unitId());
        ArrayNode sensorsArr = body.putArray("Sensors");
        sensors.forEach(sensorsArr::add);
        ArrayNode fieldsArr = body.putArray("Fields");
        fields.forEach(fieldsArr::add);
        body.put("StartTime", startTime);
        body.put("EndTime", endTime);
        body.put("Interval", "1s");
        body.put("Timeshift", "1s");
        body.put("Limit", 1);
      }
    }

    String url = ch.baseUrl() + path;
    HttpRequest req =
        HttpRequest.newBuilder(URI.create(url))
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
            .build();

    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() < 200 || res.statusCode() >= 300) {
      throw new IllegalStateException("HTTP " + res.statusCode() + " from " + url);
    }
    String raw = res.body() == null ? "" : res.body().trim();
    if (raw.isEmpty()) return Map.of();
    JsonNode root = mapper.readTree(raw);
    return extractPoints(root);
  }

  /**
   * 质量只看返回 code，不看数值本身。
   * 响应包 {@code {code, data}}：0 / 200 为 Good，其它为 Bad。
   * 点列 {@code [time, value, code]} 用第三列；没有 code 且有值视为 Good。
   */
  static Map<String, Point> extractPoints(JsonNode root) {
    if (root == null || root.isNull()) return Map.of();
    JsonNode payload = root;
    Boolean responseOk = null;
    if (root.isObject()) {
      JsonNode code = first(root, "code", "Code");
      JsonNode data = first(root, "data", "Data", "result", "Result");
      if (code != null && !code.isNull() && data != null && (data.isObject() || data.isArray())) {
        responseOk = isSuccessCode(code);
        payload = data;
      }
    }
    if (Boolean.FALSE.equals(responseOk)) {
      Map<String, Point> bad = new HashMap<>();
      for (Map.Entry<String, Point> e : readPoints(payload).entrySet()) {
        bad.put(e.getKey(), new Point(e.getValue().value(), "Bad"));
      }
      return bad;
    }
    return readPoints(payload);
  }

  /** sensor\0field → 点。没有 code 的成功点质量为 Good。 */
  private static Map<String, Point> readPoints(JsonNode root) {
    Map<String, Point> out = new HashMap<>();
    if (root == null || root.isNull()) return out;

    // 格式 A（QueryDataByInterval / PLC / ARM）:
    // { Sensor: { Field: [[time, value] | [time, value, code], ...] } }
    if (root.isObject()) {
      root.fields()
          .forEachRemaining(
              e -> {
                String sensor = e.getKey();
                JsonNode fieldsNode = e.getValue();
                if (fieldsNode != null && fieldsNode.isObject()) {
                  fieldsNode
                      .fields()
                      .forEachRemaining(
                          fe -> {
                            Point p = lastPoint(fe.getValue());
                            if (p != null) out.put(key(sensor, fe.getKey()), p);
                          });
                }
              });
      if (!out.isEmpty()) return out;
    }

    // 格式 B（QueryDataBylimitORInterval）:
    // [ { sensor, columns:[time,f1,...], values:[[t,v1,...],...] } ]
    if (root.isArray()) {
      for (JsonNode item : root) {
        if (item == null || !item.isObject()) continue;
        JsonNode sensorNode = item.get("sensor");
        JsonNode columns = item.get("columns");
        JsonNode values = item.get("values");
        if (sensorNode == null || columns == null || values == null || !values.isArray()) continue;
        String sensor = sensorNode.asText("");
        if (sensor.isEmpty() || !columns.isArray() || values.isEmpty()) continue;
        JsonNode lastRow = values.get(values.size() - 1);
        if (lastRow == null || !lastRow.isArray()) continue;
        int codeCol = columnIndex(columns, "code", "Code", "quality", "Quality");
        JsonNode rowCode = codeCol >= 0 && codeCol < lastRow.size() ? lastRow.get(codeCol) : null;
        for (int c = 1; c < columns.size() && c < lastRow.size(); c++) {
          if (c == codeCol) continue;
          String field = columns.get(c).asText("");
          if (field.isEmpty() || isCodeName(field)) continue;
          Object v = scalar(lastRow.get(c));
          if (v == null) continue;
          String quality = rowCode != null ? (isSuccessCode(rowCode) ? "Good" : "Bad") : "Good";
          out.put(key(sensor, field), new Point(v, quality));
        }
      }
    }
    return out;
  }

  private static Point lastPoint(JsonNode series) {
    if (series == null || !series.isArray() || series.isEmpty()) return null;
    JsonNode last = series.get(series.size() - 1);
    if (last == null) return null;
    if (last.isArray()) {
      if (last.size() < 2) return null;
      Object value = scalar(last.get(1));
      if (value == null) return null;
      if (last.size() >= 3 && last.get(2) != null && !last.get(2).isNull()) {
        return new Point(value, isSuccessCode(last.get(2)) ? "Good" : "Bad");
      }
      return new Point(value, "Good");
    }
    Object value = scalar(last);
    return value == null ? null : new Point(value, "Good");
  }

  /** 0 / 200（含 OPC Good=192）视为好质量，其它数值 code 为坏。 */
  static boolean isSuccessCode(JsonNode n) {
    if (n == null || n.isNull()) return false;
    if (n.isBoolean()) return n.booleanValue();
    if (n.isNumber()) {
      int c = n.intValue();
      return c == 0 || c == 200 || c == 192;
    }
    if (n.isTextual()) {
      String s = n.asText("").trim();
      return "0".equals(s)
          || "200".equals(s)
          || "192".equals(s)
          || "ok".equalsIgnoreCase(s)
          || "success".equalsIgnoreCase(s)
          || "good".equalsIgnoreCase(s)
          || "true".equalsIgnoreCase(s);
    }
    return false;
  }

  private static JsonNode first(JsonNode obj, String... names) {
    for (String name : names) {
      JsonNode n = obj.get(name);
      if (n != null && !n.isMissingNode()) return n;
    }
    return null;
  }

  private static int columnIndex(JsonNode columns, String... names) {
    for (int i = 0; i < columns.size(); i++) {
      String name = columns.get(i).asText("");
      if (isCodeName(name)) {
        for (String expect : names) {
          if (expect.equalsIgnoreCase(name)) return i;
        }
      }
    }
    return -1;
  }

  private static boolean isCodeName(String name) {
    return "code".equalsIgnoreCase(name) || "quality".equalsIgnoreCase(name);
  }

  private static Object scalar(JsonNode n) {
    if (n == null || n.isNull()) return null;
    if (n.isBoolean()) return n.booleanValue();
    if (n.isNumber()) return n.numberValue();
    if (n.isTextual()) {
      String s = n.asText();
      if (s.isBlank()) return null;
      // 波形/频谱整段字符串：原样返回（Tag 宜用 string）
      if (s.startsWith("[")) return s;
      try {
        if (s.contains(".") || s.contains("e") || s.contains("E")) return Double.parseDouble(s);
        return Long.parseLong(s);
      } catch (NumberFormatException e) {
        return s;
      }
    }
    return n.toString();
  }

  public static String key(String sensor, String field) {
    return sensor + "\0" + field;
  }

  public void logOnce(String msg, Exception e) {
    log.warn("mcd4000: {} — {}", msg, e.toString());
  }
}
