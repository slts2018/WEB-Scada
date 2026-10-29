package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.util.Arrays;

/**
 * 按 MBAP 长度字段切帧。一次 append 可以含多个 PDU，也可以只含半个帧头或半个 PDU。
 * 长度非法时立刻失败，不等待声明中的海量字节。
 */
public final class MbapBuffer {
  static final int HEADER = 6;
  static final int MIN_LENGTH = 2;
  static final int MAX_LENGTH = 254;
  private static final int MAX_BUFFER = 4096;

  private byte[] buf = new byte[256];
  private int size;

  public record Frame(int transactionId, int protocolId, int unitId, byte[] pdu) {}

  public static byte[] encode(int transactionId, int protocolId, int unitId, byte[] pdu) {
    byte[] body = pdu == null ? new byte[0] : pdu;
    byte[] out = new byte[7 + body.length];
    Bytes.putU16(out, 0, transactionId);
    Bytes.putU16(out, 2, protocolId);
    Bytes.putU16(out, 4, 1 + body.length);
    out[6] = (byte) unitId;
    System.arraycopy(body, 0, out, 7, body.length);
    return out;
  }

  public void append(byte[] data, int offset, int length) throws CommException {
    if (length <= 0) return;
    if (size > MAX_BUFFER || length > MAX_BUFFER || size + length > MAX_BUFFER) {
      clear();
      throw protocol("mbap buffer overflow");
    }
    ensure(size + length);
    System.arraycopy(data, offset, buf, size, length);
    size += length;
  }

  public void append(byte[] data) throws CommException {
    if (data != null) append(data, 0, data.length);
  }

  /** 还缺字节时返回 null。 */
  public Frame poll() throws CommException {
    if (size < HEADER) return null;
    int length = Bytes.u16(buf, 4);
    if (length < MIN_LENGTH || length > MAX_LENGTH) {
      int bad = length;
      clear();
      throw protocol("mbap length " + bad);
    }
    int total = HEADER + length;
    if (size < total) return null;
    byte[] frame = Arrays.copyOf(buf, total);
    int rest = size - total;
    System.arraycopy(buf, total, buf, 0, rest);
    size = rest;
    byte[] pdu = Arrays.copyOfRange(frame, 7, total);
    return new Frame(Bytes.u16(frame, 0), Bytes.u16(frame, 2), frame[6] & 0xff, pdu);
  }

  public void clear() {
    size = 0;
  }

  public static void requireProtocol(Frame frame) throws CommException {
    if (frame.protocolId() != 0) {
      throw protocol("protocol id " + frame.protocolId());
    }
  }

  private void ensure(int needed) {
    if (buf.length >= needed) return;
    buf = Arrays.copyOf(buf, Math.max(needed, buf.length * 2));
  }

  private static CommException protocol(String message) {
    return new CommException(ErrorCategory.PROTOCOL, true, false, message);
  }
}
