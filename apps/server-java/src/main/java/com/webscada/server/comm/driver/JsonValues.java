package com.webscada.server.comm.driver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.comm.config.DataPoint;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Locale;

/** JSON 路径、类型换算和负载摘要。MQTT 与 HTTP 共用，不各写一份。 */
public final class JsonValues {
  public static final int HEX_BYTES = 32;
  private static final ObjectMapper JSON = new ObjectMapper();

  private JsonValues() {}

  public static JsonNode readTree(byte[] body) throws java.io.IOException {
    return JSON.readTree(body == null ? new byte[0] : body);
  }

  public static JsonNode at(JsonNode root, String path) {
    JsonNode cur = root;
    if (path == null || path.isBlank()) return cur;
    for (String part : path.split("\\.")) {
      if (part.isEmpty()) continue;
      if (cur == null || !cur.isObject()) return null;
      cur = cur.get(part);
    }
    return cur;
  }

  public static Long timestamp(JsonNode node) {
    if (node == null || node.isNull()) return null;
    if (node.isNumber()) return node.longValue();
    if (!node.isTextual()) throw new IllegalArgumentException("ts");
    String text = node.asText().trim();
    if (text.isEmpty()) return null;
    boolean digits = true;
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (i == 0 && ch == '-') continue;
      if (ch < '0' || ch > '9') {
        digits = false;
        break;
      }
    }
    if (digits) return Long.parseLong(text);
    return Instant.parse(text).toEpochMilli();
  }

  public static Object cast(DataPoint point, JsonNode node) {
    String type = point.type() == null ? "" : point.type().trim().toLowerCase(Locale.ROOT);
    if ("string".equals(type)) return node.asText();
    if ("bool".equals(type) || "boolean".equals(type)) {
      return bool(node.isBoolean() ? Boolean.toString(node.booleanValue()) : node.asText());
    }
    if ("uint64".equals(type)) {
      BigInteger raw =
          node.isNumber() ? BigInteger.valueOf(node.longValue()) : new BigInteger(node.asText().trim());
      if (point.scale() == 1d && point.offset() == 0d) return raw;
      return raw.doubleValue() * point.scale() + point.offset();
    }
    double number = node.isNumber() ? node.doubleValue() : Double.parseDouble(node.asText().trim());
    return scale(point, number);
  }

  public static Object castText(DataPoint point, String text) {
    String type = point.type() == null ? "" : point.type().trim().toLowerCase(Locale.ROOT);
    if ("string".equals(type)) return text;
    if ("bool".equals(type) || "boolean".equals(type)) return bool(text);
    if ("uint64".equals(type)) {
      BigInteger raw = new BigInteger(text);
      if (point.scale() == 1d && point.offset() == 0d) return raw;
      return raw.doubleValue() * point.scale() + point.offset();
    }
    return scale(point, Double.parseDouble(text));
  }

  /** 负载前 32 字节的大写十六进制。空负载返回空串。 */
  public static String hexPrefix(byte[] body) {
    if (body == null || body.length == 0) return "";
    int n = Math.min(HEX_BYTES, body.length);
    StringBuilder sb = new StringBuilder(n * 2);
    for (int i = 0; i < n; i++) sb.append(String.format("%02X", body[i]));
    return sb.toString();
  }

  public static String sha256(byte[] body) {
    try {
      byte[] dig = MessageDigest.getInstance("SHA-256").digest(body == null ? new byte[0] : body);
      StringBuilder sb = new StringBuilder(dig.length * 2);
      for (byte b : dig) sb.append(String.format("%02x", b));
      return sb.toString();
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(ex);
    }
  }

  private static Object scale(DataPoint point, double number) {
    if (!Double.isFinite(number)) throw new IllegalArgumentException("not finite");
    if (point.scale() == 1d && point.offset() == 0d) return number;
    double scaled = number * point.scale() + point.offset();
    if (!Double.isFinite(scaled)) throw new IllegalArgumentException("not finite");
    return scaled;
  }

  private static Boolean bool(String text) {
    if ("true".equalsIgnoreCase(text) || "1".equals(text)) return Boolean.TRUE;
    if ("false".equalsIgnoreCase(text) || "0".equals(text)) return Boolean.FALSE;
    throw new IllegalArgumentException("bool");
  }
}
