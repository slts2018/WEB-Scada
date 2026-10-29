package com.webscada.server.comm.driver.opcua;

import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.math.BigInteger;
import java.time.Instant;
import java.util.Locale;
import org.eclipse.milo.opcua.stack.core.types.builtin.DataValue;
import org.eclipse.milo.opcua.stack.core.types.builtin.DateTime;
import org.eclipse.milo.opcua.stack.core.types.builtin.Variant;
import org.eclipse.milo.opcua.stack.core.types.builtin.unsigned.UByte;
import org.eclipse.milo.opcua.stack.core.types.builtin.unsigned.UInteger;
import org.eclipse.milo.opcua.stack.core.types.builtin.unsigned.ULong;
import org.eclipse.milo.opcua.stack.core.types.builtin.unsigned.UShort;

/**
 * 标量 Variant 与工程值互转。数组和结构体不进入 Modbus 类型体系。
 * UInt64 点必须显式配 type: uint64，否则按有符号 long 展示。
 */
public final class OpcUaValues {
  private OpcUaValues() {}

  public record Decoded(Object value, Quality quality, String detail) {}

  public static Decoded decode(DataPoint point, DataValue data) {
    if (data == null) return new Decoded(null, Quality.BAD_DEVICE, "empty DataValue");
    OpcUaStatus.Mapped mapped = OpcUaStatus.map(data.getStatusCode());
    if (mapped.quality() != Quality.GOOD && mapped.quality() != Quality.UNCERTAIN) {
      String name = data.getStatusCode() == null ? "null" : data.getStatusCode().toString();
      return new Decoded(null, mapped.quality(), name);
    }
    Variant variant = data.getValue();
    Object raw = variant == null ? null : variant.getValue();
    if (raw == null) return new Decoded(null, Quality.BAD_CONFIG, "null variant");
    if (raw.getClass().isArray() || raw instanceof org.eclipse.milo.opcua.stack.core.types.builtin.ExtensionObject) {
      return new Decoded(null, Quality.BAD_CONFIG, raw.getClass().getName());
    }
    if (!scalar(raw)) return new Decoded(null, Quality.BAD_CONFIG, raw.getClass().getName());
    Object value = apply(point, toJava(point, raw));
    return new Decoded(value, mapped.quality(), "");
  }

  public static Variant encode(DataPoint point, Object engineering) throws CommException {
    Object raw = unscale(point, engineering);
    String type = point.type() == null ? "" : point.type().trim().toLowerCase(Locale.ROOT);
    try {
      return new Variant(coerce(type, raw));
    } catch (RuntimeException ex) {
      throw new CommException(ErrorCategory.CONFIG, false, false, point.id() + ": " + ex.getMessage());
    }
  }

  public static boolean sameVariant(Variant sent, Variant back) {
    Object left = sent == null ? null : sent.getValue();
    Object right = back == null ? null : back.getValue();
    if (left instanceof Number a && right instanceof Number b && !(left instanceof Float) && !(left instanceof Double)
        && !(right instanceof Float) && !(right instanceof Double)) {
      return a.longValue() == b.longValue();
    }
    return java.util.Objects.equals(left, right);
  }

  public static Long sourceMillis(DataValue data) {
    if (data == null) return null;
    DateTime source = data.getSourceTime();
    if (source == null || source.isNull()) return null;
    Instant instant = source.getJavaInstant();
    return instant == null ? null : instant.toEpochMilli();
  }

  private static boolean scalar(Object raw) {
    return raw instanceof Boolean
        || raw instanceof Number
        || raw instanceof String
        || raw instanceof DateTime;
  }

  private static Object toJava(DataPoint point, Object raw) {
    if (raw instanceof DateTime time) {
      Instant instant = time.getJavaInstant();
      return instant == null ? null : instant.toEpochMilli();
    }
    if (raw instanceof UByte || raw instanceof UShort || raw instanceof UInteger) {
      return ((Number) raw).longValue();
    }
    if (raw instanceof ULong value) {
      if (isUint64(point)) return new BigInteger(Long.toUnsignedString(value.longValue()));
      return value.longValue();
    }
    if (raw instanceof Byte || raw instanceof Short || raw instanceof Integer || raw instanceof Long) {
      return ((Number) raw).longValue();
    }
    if (raw instanceof Float || raw instanceof Double) return ((Number) raw).doubleValue();
    return raw;
  }

  private static Object apply(DataPoint point, Object raw) {
    if (!(raw instanceof Number number)) return raw;
    if (point.scale() == 1d && point.offset() == 0d) return raw;
    return number.doubleValue() * point.scale() + point.offset();
  }

  private static Object unscale(DataPoint point, Object engineering) throws CommException {
    if (!(engineering instanceof Number number)) return engineering;
    if (point.scale() == 1d && point.offset() == 0d) return engineering;
    if (point.scale() == 0d) {
      throw new CommException(ErrorCategory.CONFIG, false, false, point.id() + ": scale is 0");
    }
    return (number.doubleValue() - point.offset()) / point.scale();
  }

  private static Object coerce(String type, Object raw) {
    if (type.isEmpty()) return raw instanceof Number number ? narrow(number) : raw;
    return switch (type) {
      case "boolean", "bool" -> raw instanceof Boolean bit ? bit : ((Number) raw).doubleValue() != 0d;
      case "sbyte" -> ((Number) raw).byteValue();
      case "byte" -> UByte.valueOf(((Number) raw).shortValue());
      case "int16" -> ((Number) raw).shortValue();
      case "uint16" -> UShort.valueOf(((Number) raw).intValue());
      case "int32" -> ((Number) raw).intValue();
      case "uint32" -> UInteger.valueOf(((Number) raw).longValue());
      case "int64" -> ((Number) raw).longValue();
      case "uint64" -> ULong.valueOf(((Number) raw).longValue());
      case "float", "float32" -> ((Number) raw).floatValue();
      case "double", "float64" -> ((Number) raw).doubleValue();
      case "string" -> String.valueOf(raw);
      case "datetime" -> new DateTime(Instant.ofEpochMilli(((Number) raw).longValue()));
      default -> raw;
    };
  }

  private static boolean isUint64(DataPoint point) {
    String type = point.type() == null ? "" : point.type().trim().toLowerCase(Locale.ROOT);
    return "uint64".equals(type);
  }

  private static Object narrow(Number number) {
    if (number instanceof Float || number instanceof Double) return number.doubleValue();
    return number.longValue();
  }
}
