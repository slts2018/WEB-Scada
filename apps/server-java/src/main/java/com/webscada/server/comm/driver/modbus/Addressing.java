package com.webscada.server.comm.driver.modbus;

/** 0 基址直接用 PDU 地址。40001 风格按功能码落到 0xxxx / 1xxxx / 3xxxx / 4xxxx。 */
public final class Addressing {
  private Addressing() {}

  public static int toPdu(String addressBase, int function, int address) {
    String base = addressBase == null || addressBase.isBlank() ? "0" : addressBase.trim();
    if ("0".equals(base)) {
      if (address < 0 || address > 65535) {
        throw new IllegalArgumentException("address " + address + " out of range 0..65535");
      }
      return address;
    }
    if (!"40001".equals(base)) {
      throw new IllegalArgumentException("addressBase must be 0 or 40001");
    }
    int origin =
        switch (function) {
          case 1, 5, 15 -> 1;
          case 2 -> 10001;
          case 4 -> 30001;
          case 3, 6, 16, 23 -> 40001;
          default -> throw new IllegalArgumentException("function " + function);
        };
    if (address < origin || address >= origin + 9999) {
      throw new IllegalArgumentException(
          "address " + address + " not in " + origin + ".." + (origin + 9998));
    }
    return address - origin;
  }

  public static void requireSpan(int pduAddress, int width) {
    if (width < 1) throw new IllegalArgumentException("count must be > 0");
    if (pduAddress < 0 || width > 65536 || pduAddress > 65535 - width + 1) {
      throw new IllegalArgumentException(
          "address " + pduAddress + " count " + width + " exceeds 65535");
    }
  }
}
