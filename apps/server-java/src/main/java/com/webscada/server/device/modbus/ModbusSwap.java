package com.webscada.server.device.modbus;

import java.util.Locale;

/** 对齐 Flight 设备「字排序 / 双字排序」：SwapNone / SwapBytes / SwapWords / SwapAll。 */
public enum ModbusSwap {
  SwapNone,
  SwapBytes,
  SwapWords,
  SwapAll;

  public static ModbusSwap parse(String text, ModbusSwap fallback) {
    if (text == null || text.isBlank()) return fallback;
    String s = text.trim();
    for (ModbusSwap v : values()) {
      if (v.name().equalsIgnoreCase(s)) return v;
    }
    String n = s.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
    return switch (n) {
      case "none", "swapnone" -> SwapNone;
      case "bytes", "swapbytes", "byte" -> SwapBytes;
      case "words", "swapwords", "word" -> SwapWords;
      case "all", "swapall" -> SwapAll;
      default -> fallback;
    };
  }

  /**
   * 对从 Modbus 读出的寄存器字节流重排（每寄存器已是高字节在前）。
   *
   * @param words 寄存器个数
   * @param wire 长度 = words*2
   */
  public byte[] apply(byte[] wire, int words) {
    if (wire == null || words <= 0 || wire.length < words * 2) return wire;
    byte[] out = wire.clone();
    if (this == SwapNone) return out;
    if (words == 1) {
      if (this == SwapBytes || this == SwapAll) {
        swap2(out, 0);
      }
      return out;
    }
    // 32 位（2 字）经典四选一；64 位按每 2 字一组套用双字规则
    int groups = words / 2;
    int rem = words % 2;
    for (int g = 0; g < groups; g++) {
      int base = g * 4;
      applyDword(out, base);
    }
    if (rem == 1) {
      int base = groups * 4;
      if (this == SwapBytes || this == SwapAll) {
        swap2(out, base);
      }
    }
    return out;
  }

  private void applyDword(byte[] b, int base) {
    // ABCD
    byte a = b[base];
    byte bb = b[base + 1];
    byte c = b[base + 2];
    byte d = b[base + 3];
    switch (this) {
      case SwapNone -> {
        /* ABCD */
      }
      case SwapBytes -> {
        // BADC
        b[base] = bb;
        b[base + 1] = a;
        b[base + 2] = d;
        b[base + 3] = c;
      }
      case SwapWords -> {
        // CDAB
        b[base] = c;
        b[base + 1] = d;
        b[base + 2] = a;
        b[base + 3] = bb;
      }
      case SwapAll -> {
        // DCBA
        b[base] = d;
        b[base + 1] = c;
        b[base + 2] = bb;
        b[base + 3] = a;
      }
    }
  }

  private static void swap2(byte[] b, int i) {
    byte t = b[i];
    b[i] = b[i + 1];
    b[i + 1] = t;
  }

  /** 寄存器数组 → 字节（每寄存器 BE） */
  public static byte[] regsToBytes(int[] regs) {
    byte[] out = new byte[regs.length * 2];
    for (int i = 0; i < regs.length; i++) {
      out[i * 2] = (byte) ((regs[i] >> 8) & 0xff);
      out[i * 2 + 1] = (byte) (regs[i] & 0xff);
    }
    return out;
  }

  public static int[] bytesToRegs(byte[] bytes) {
    int n = bytes.length / 2;
    int[] regs = new int[n];
    for (int i = 0; i < n; i++) {
      regs[i] = ((bytes[i * 2] & 0xff) << 8) | (bytes[i * 2 + 1] & 0xff);
    }
    return regs;
  }
}
