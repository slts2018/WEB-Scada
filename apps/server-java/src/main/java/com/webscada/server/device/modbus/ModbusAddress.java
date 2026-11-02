package com.webscada.server.device.modbus;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 变量 address：{@code holding:144} / {@code holding:144.1} / {@code holding:18448#2}。
 * 与前端 tagAddress 及 Flight「区+地址+长度+位」对齐。
 */
public record ModbusAddress(String area, int offset, Integer bit, Integer length) {
  private static final Pattern FULL =
      Pattern.compile(
          "^(coil|discrete|input|holding)\\s*:\\s*(\\d+)\\s*(?:#\\s*(\\d+))?(?:[./．。]\\s*(\\d+))?$",
          Pattern.CASE_INSENSITIVE);
  private static final Pattern BARE =
      Pattern.compile("^(\\d+)\\s*(?:#\\s*(\\d+))?(?:[./．。]\\s*(\\d+))?$");

  public static ModbusAddress parse(String address) {
    if (address == null || address.isBlank()) return null;
    String s = address.trim();
    Matcher m = FULL.matcher(s);
    if (m.matches()) {
      return of(m.group(1), m.group(2), m.group(4), m.group(3));
    }
    m = BARE.matcher(s);
    if (m.matches()) {
      return of("holding", m.group(1), m.group(3), m.group(2));
    }
    return null;
  }

  private static ModbusAddress of(String areaRaw, String offsetRaw, String bitRaw, String lengthRaw) {
    String area = areaRaw.trim().toLowerCase(Locale.ROOT);
    int offset;
    try {
      offset = Integer.parseInt(offsetRaw.trim());
    } catch (NumberFormatException e) {
      return null;
    }
    if (offset < 0 || offset > 65535) return null;
    Integer bit = null;
    if (bitRaw != null && !bitRaw.isBlank()) {
      try {
        int b = Integer.parseInt(bitRaw.trim());
        if (b < 0 || b > 15) return null;
        bit = b;
      } catch (NumberFormatException e) {
        return null;
      }
    }
    Integer length = null;
    if (lengthRaw != null && !lengthRaw.isBlank()) {
      try {
        int len = Integer.parseInt(lengthRaw.trim());
        if (len < 1 || len > 125) return null;
        length = len;
      } catch (NumberFormatException e) {
        return null;
      }
    }
    return new ModbusAddress(area, offset, bit, length);
  }

  /** 读功能码 1/2/3/4 */
  public int readFc() {
    return switch (area) {
      case "coil" -> 1;
      case "discrete" -> 2;
      case "input" -> 4;
      default -> 3; // holding
    };
  }

  public boolean isCoilSpace() {
    return "coil".equals(area) || "discrete".equals(area);
  }

  public boolean writableArea() {
    return "coil".equals(area) || "holding".equals(area);
  }
}
