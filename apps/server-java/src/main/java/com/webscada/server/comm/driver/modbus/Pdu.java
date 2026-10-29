package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.util.Arrays;

/** 功能码 01/02/03/04/05/06/15/16，以及可选的 23。异常帧在这里变成 CommException。 */
public final class Pdu {
  private Pdu() {}

  public static byte[] readRequest(int function, int address, int count) {
    byte[] pdu = new byte[5];
    pdu[0] = (byte) function;
    Bytes.putU16(pdu, 1, address);
    Bytes.putU16(pdu, 3, count);
    return pdu;
  }

  public static byte[] writeCoil(int address, boolean on) {
    byte[] pdu = new byte[5];
    pdu[0] = 5;
    Bytes.putU16(pdu, 1, address);
    Bytes.putU16(pdu, 3, on ? 0xFF00 : 0x0000);
    return pdu;
  }

  public static byte[] writeRegister(int address, int value) {
    byte[] pdu = new byte[5];
    pdu[0] = 6;
    Bytes.putU16(pdu, 1, address);
    Bytes.putU16(pdu, 3, value);
    return pdu;
  }

  public static byte[] writeCoils(int address, int count, byte[] packed) {
    return writeMultiple(15, address, count, packed);
  }

  public static byte[] writeRegisters(int address, int count, byte[] data) {
    return writeMultiple(16, address, count, data);
  }

  /** FC23：先写后读。响应是读回的寄存器字节。 */
  public static byte[] readWrite(
      int readAddress, int readCount, int writeAddress, int writeCount, byte[] data) {
    byte[] body = data == null ? new byte[0] : data;
    byte[] pdu = new byte[10 + body.length];
    pdu[0] = 23;
    Bytes.putU16(pdu, 1, readAddress);
    Bytes.putU16(pdu, 3, readCount);
    Bytes.putU16(pdu, 5, writeAddress);
    Bytes.putU16(pdu, 7, writeCount);
    pdu[9] = (byte) body.length;
    System.arraycopy(body, 0, pdu, 10, body.length);
    return pdu;
  }

  public static byte[] parseRead(int function, int count, byte[] pdu) throws CommException {
    rejectException(pdu);
    if (pdu.length < 2 || (pdu[0] & 0xff) != function) {
      throw protocol("function mismatch");
    }
    int byteCount = pdu[1] & 0xff;
    int expect = function <= 2 ? (count + 7) / 8 : count * 2;
    if (byteCount != expect || pdu.length != 2 + byteCount) {
      throw protocol(
          "length mismatch function="
              + function
              + " byteCount="
              + byteCount
              + " pdu="
              + pdu.length
              + " expect="
              + expect);
    }
    return Arrays.copyOfRange(pdu, 2, pdu.length);
  }

  public static void parseWriteSingle(byte[] request, byte[] response) throws CommException {
    rejectException(response);
    if (request == null || response.length != request.length) {
      throw protocol("write echo length mismatch");
    }
    for (int i = 0; i < request.length; i++) {
      if (request[i] != response[i]) throw protocol("write echo mismatch");
    }
  }

  public static void parseWriteMultiple(int function, int address, int count, byte[] response)
      throws CommException {
    rejectException(response);
    if (response.length != 5 || (response[0] & 0xff) != function) {
      throw protocol("write multiple length mismatch");
    }
    if (Bytes.u16(response, 1) != (address & 0xffff) || Bytes.u16(response, 3) != count) {
      throw protocol("write multiple echo mismatch");
    }
  }

  public static boolean gateway(CommException error) {
    return error != null
        && error.category() == ErrorCategory.DEVICE
        && error.retryable()
        && !error.failoverAllowed();
  }

  private static byte[] writeMultiple(int function, int address, int count, byte[] data) {
    byte[] body = data == null ? new byte[0] : data;
    byte[] pdu = new byte[6 + body.length];
    pdu[0] = (byte) function;
    Bytes.putU16(pdu, 1, address);
    Bytes.putU16(pdu, 3, count);
    pdu[5] = (byte) body.length;
    System.arraycopy(body, 0, pdu, 6, body.length);
    return pdu;
  }

  private static void rejectException(byte[] pdu) throws CommException {
    if (pdu == null || pdu.length < 1) throw protocol("empty pdu");
    int function = pdu[0] & 0xff;
    if ((function & 0x80) == 0) return;
    if (pdu.length < 2) throw protocol("exception without code");
    throw device(pdu[1] & 0xff);
  }

  static CommException device(int code) {
    String hex = String.format("%02X", code);
    String name =
        switch (code) {
          case 0x01 -> "illegal function";
          case 0x02 -> "illegal data address";
          case 0x03 -> "illegal data value";
          case 0x04 -> "slave device failure";
          case 0x0A -> "gateway path unavailable";
          case 0x0B -> "gateway target device failed to respond";
          default -> "exception";
        };
    if (code == 0x0A || code == 0x0B) {
      return new CommException(
          ErrorCategory.DEVICE, true, false, "网关/下游 " + name + " (" + hex + ")");
    }
    return new CommException(
        ErrorCategory.DEVICE, false, false, "modbus exception " + hex + " " + name);
  }

  private static CommException protocol(String message) {
    return new CommException(ErrorCategory.PROTOCOL, true, false, message);
  }
}
