package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;

public final class RegisterCodec {
  private RegisterCodec() {}

  public enum WordOrder {
    HIGH_FIRST,
    LOW_FIRST
  }

  public enum Endian {
    BIG,
    LITTLE
  }

  public record Decoded(Object value, Quality quality, String detail) {
    static Decoded good(Object value) {
      return new Decoded(value, Quality.GOOD, "");
    }

    static Decoded bad(String detail) {
      return new Decoded(null, Quality.BAD_CONFIG, detail);
    }
  }

  public static Decoded decode(ModbusPoint point, byte[] wire) {
    int bytes = point.bit() ? 1 : point.width() * 2;
    if (wire == null || wire.length < bytes) {
      return Decoded.bad("length raw=" + Bytes.hex(wire == null ? new byte[0] : wire));
    }
    if (point.bit()) {
      return Decoded.good((wire[0] & 0x01) != 0);
    }
    byte[] canonical = reorder(wire, point.width(), point.wordOrder(), point.endian());
    ByteBuffer buffer = ByteBuffer.wrap(canonical).order(ByteOrder.BIG_ENDIAN);
    Object raw =
        switch (point.type()) {
          case "int16" -> (int) buffer.getShort();
          case "uint16" -> buffer.getShort() & 0xffff;
          case "int32" -> buffer.getInt();
          case "uint32" -> Integer.toUnsignedLong(buffer.getInt());
          case "float32" -> buffer.getFloat();
          case "float64" -> buffer.getDouble();
          default -> null;
        };
    if (raw instanceof Float value && (Float.isNaN(value) || Float.isInfinite(value))) {
      return Decoded.bad((Float.isInfinite(value) ? "Inf" : "NaN") + " raw=" + Bytes.hex(wire));
    }
    if (raw instanceof Double value && (Double.isNaN(value) || Double.isInfinite(value))) {
      return Decoded.bad((Double.isInfinite(value) ? "Inf" : "NaN") + " raw=" + Bytes.hex(wire));
    }
    if (raw == null) {
      return Decoded.bad("type raw=" + Bytes.hex(wire));
    }
    if (point.scale() == 1d && point.offset() == 0d) return Decoded.good(raw);
    double scaled = ((Number) raw).doubleValue() * point.scale() + point.offset();
    if (Double.isNaN(scaled) || Double.isInfinite(scaled)) {
      return Decoded.bad("scaled raw=" + Bytes.hex(wire));
    }
    return Decoded.good(scaled);
  }

  public static byte[] encodeRegisters(ModbusPoint point, Object value) throws CommException {
    if (point.bit()) throw config(point.id() + ": bit point");
    if (!(value instanceof Number number)) throw config(point.id() + ": numeric value required");
    int words = point.width();
    ByteBuffer canonical = ByteBuffer.allocate(words * 2).order(ByteOrder.BIG_ENDIAN);
    switch (point.type()) {
      case "int16" -> canonical.putShort((short) unscale(point, number, Short.MIN_VALUE, Short.MAX_VALUE));
      case "uint16" -> canonical.putShort((short) unscale(point, number, 0, 65535));
      case "int32" -> canonical.putInt((int) unscale(point, number, Integer.MIN_VALUE, Integer.MAX_VALUE));
      case "uint32" ->
          canonical.putInt((int) unscale(point, number, 0, 0xffff_ffffL));
      case "float32" -> {
        float raw = unscaleFloat(point, number);
        if (Float.isNaN(raw) || Float.isInfinite(raw)) throw config(point.id() + ": NaN");
        canonical.putFloat(raw);
      }
      case "float64" -> {
        double raw = unscaleDouble(point, number);
        if (Double.isNaN(raw) || Double.isInfinite(raw)) throw config(point.id() + ": NaN");
        canonical.putDouble(raw);
      }
      default -> throw config(point.id() + ": type " + point.type());
    }
    return reorder(canonical.array(), words, point.wordOrder(), point.endian());
  }

  public static boolean encodeBit(Object value) throws CommException {
    if (value instanceof Boolean bit) return bit;
    if (value instanceof Number number) return number.doubleValue() != 0d;
    if (value instanceof String text) {
      String s = text.trim();
      if ("1".equals(s) || "true".equalsIgnoreCase(s)) return true;
      if ("0".equals(s) || "false".equalsIgnoreCase(s)) return false;
    }
    throw config("coil value required");
  }

  public static WordOrder wordOrder(String text) {
    String n = norm(text);
    if (n.isEmpty() || n.equals("highfirst") || n.equals("high")) return WordOrder.HIGH_FIRST;
    if (n.equals("lowfirst") || n.equals("low")) return WordOrder.LOW_FIRST;
    return null;
  }

  public static Endian endian(String text) {
    String n = norm(text);
    if (n.isEmpty() || n.equals("big") || n.equals("be") || n.equals("bigendian")) return Endian.BIG;
    if (n.equals("little") || n.equals("le") || n.equals("littleendian")) return Endian.LITTLE;
    return null;
  }

  public static int width(String type) {
    return switch (type == null ? "" : type.trim().toLowerCase(Locale.ROOT)) {
      case "bool", "int16", "uint16" -> 1;
      case "int32", "uint32", "float32" -> 2;
      case "float64" -> 4;
      default -> -1;
    };
  }

  public static boolean bitFunction(int function) {
    return function == 1 || function == 2 || function == 5 || function == 15;
  }

  public static boolean compatible(int function, String type) {
    boolean bit = "bool".equals(type);
    int width = width(type);
    if (width < 0) return false;
    if (bitFunction(function)) return bit;
    return !bit && (function == 3 || function == 4 || function == 6 || function == 16 || function == 23);
  }

  static byte[] reorder(byte[] wire, int words, WordOrder wordOrder, Endian endian) {
    byte[] out = ArraysCopy(wire, words * 2);
    if (endian == Endian.LITTLE) {
      for (int i = 0; i < out.length; i += 2) {
        byte tmp = out[i];
        out[i] = out[i + 1];
        out[i + 1] = tmp;
      }
    }
    if (wordOrder == WordOrder.LOW_FIRST && words > 1) {
      byte[] rev = new byte[out.length];
      for (int w = 0; w < words; w++) {
        int src = (words - 1 - w) * 2;
        rev[w * 2] = out[src];
        rev[w * 2 + 1] = out[src + 1];
      }
      return rev;
    }
    return out;
  }

  private static byte[] ArraysCopy(byte[] wire, int length) {
    byte[] out = new byte[length];
    System.arraycopy(wire, 0, out, 0, Math.min(length, wire.length));
    return out;
  }

  private static long unscale(ModbusPoint point, Number number, long min, long max)
      throws CommException {
    double raw = identity(point) ? number.doubleValue() : (number.doubleValue() - point.offset()) / point.scale();
    if (Double.isNaN(raw) || Double.isInfinite(raw)) throw config(point.id() + ": NaN");
    long rounded = Math.round(raw);
    if (rounded < min || rounded > max) throw config(point.id() + ": out of range " + rounded);
    return rounded;
  }

  private static float unscaleFloat(ModbusPoint point, Number number) {
    if (identity(point)) return number.floatValue();
    return (float) ((number.doubleValue() - point.offset()) / point.scale());
  }

  private static double unscaleDouble(ModbusPoint point, Number number) {
    if (identity(point)) return number.doubleValue();
    return (number.doubleValue() - point.offset()) / point.scale();
  }

  private static boolean identity(ModbusPoint point) {
    return point.scale() == 1d && point.offset() == 0d;
  }

  private static String norm(String text) {
    if (text == null) return "";
    return text.trim().toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }
}
