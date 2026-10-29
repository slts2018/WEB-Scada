package com.webscada.server.comm.driver.modbus;

final class Bytes {
  private Bytes() {}

  static int u16(byte[] data, int index) {
    return ((data[index] & 0xff) << 8) | (data[index + 1] & 0xff);
  }

  static void putU16(byte[] data, int index, int value) {
    data[index] = (byte) (value >>> 8);
    data[index + 1] = (byte) value;
  }

  static String hex(byte[] data) {
    if (data == null || data.length == 0) return "";
    StringBuilder out = new StringBuilder(data.length * 2);
    for (byte b : data) out.append(String.format("%02X", b));
    return out.toString();
  }
}
