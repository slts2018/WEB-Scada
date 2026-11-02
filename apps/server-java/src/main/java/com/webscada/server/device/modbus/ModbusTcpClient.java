package com.webscada.server.device.modbus;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Arrays;

/** 轻量 Modbus TCP（MBAP）会话，供变量轮询/写值使用。 */
public final class ModbusTcpClient implements AutoCloseable {
  private final String host;
  private final int port;
  private final int unitId;
  private final int connectTimeoutMs;
  private final int responseTimeoutMs;
  private Socket socket;
  private InputStream in;
  private OutputStream out;
  private int txn;

  public ModbusTcpClient(
      String host, int port, int unitId, int connectTimeoutMs, int responseTimeoutMs) {
    this.host = host;
    this.port = port;
    this.unitId = unitId & 0xff;
    this.connectTimeoutMs = Math.max(200, connectTimeoutMs);
    this.responseTimeoutMs = Math.max(200, responseTimeoutMs);
  }

  public synchronized void ensureConnected() throws IOException {
    if (socket != null && socket.isConnected() && !socket.isClosed()) return;
    closeQuietly();
    Socket s = new Socket();
    s.connect(new InetSocketAddress(host, port), connectTimeoutMs);
    s.setTcpNoDelay(true);
    s.setSoTimeout(responseTimeoutMs);
    socket = s;
    in = s.getInputStream();
    out = s.getOutputStream();
  }

  public synchronized byte[] exchange(byte[] pdu) throws IOException {
    ensureConnected();
    txn = txn >= 65535 ? 1 : txn + 1;
    byte[] frame = new byte[7 + pdu.length];
    frame[0] = (byte) ((txn >> 8) & 0xff);
    frame[1] = (byte) (txn & 0xff);
    frame[2] = 0;
    frame[3] = 0;
    int len = 1 + pdu.length;
    frame[4] = (byte) ((len >> 8) & 0xff);
    frame[5] = (byte) (len & 0xff);
    frame[6] = (byte) unitId;
    System.arraycopy(pdu, 0, frame, 7, pdu.length);
    out.write(frame);
    out.flush();

    byte[] header = readFully(6);
    int proto = ((header[2] & 0xff) << 8) | (header[3] & 0xff);
    int length = ((header[4] & 0xff) << 8) | (header[5] & 0xff);
    if (proto != 0 || length < 2 || length > 260) {
      closeQuietly();
      throw new IOException("bad mbap proto=" + proto + " len=" + length);
    }
    byte[] rest = readFully(length);
    int gotTxn = ((header[0] & 0xff) << 8) | (header[1] & 0xff);
    if (gotTxn != txn || (rest[0] & 0xff) != unitId) {
      closeQuietly();
      throw new IOException("mbap mismatch");
    }
    return Arrays.copyOfRange(rest, 1, rest.length);
  }

  public synchronized int[] readRegisters(int fc, int address, int quantity) throws IOException {
    if (fc != 3 && fc != 4) throw new IllegalArgumentException("fc");
    byte[] pdu = new byte[5];
    pdu[0] = (byte) fc;
    putU16(pdu, 1, address);
    putU16(pdu, 3, quantity);
    byte[] resp = exchange(pdu);
    if (resp.length < 2) throw new IOException("short pdu");
    if ((resp[0] & 0x80) != 0) throw new IOException("modbus exception " + (resp[1] & 0xff));
    if ((resp[0] & 0xff) != fc) throw new IOException("fc mismatch");
    int byteCount = resp[1] & 0xff;
    if (byteCount != quantity * 2 || resp.length < 2 + byteCount) {
      throw new IOException("length mismatch");
    }
    int[] regs = new int[quantity];
    for (int i = 0; i < quantity; i++) {
      regs[i] = ((resp[2 + i * 2] & 0xff) << 8) | (resp[3 + i * 2] & 0xff);
    }
    return regs;
  }

  public synchronized boolean[] readBits(int fc, int address, int quantity) throws IOException {
    if (fc != 1 && fc != 2) throw new IllegalArgumentException("fc");
    byte[] pdu = new byte[5];
    pdu[0] = (byte) fc;
    putU16(pdu, 1, address);
    putU16(pdu, 3, quantity);
    byte[] resp = exchange(pdu);
    if (resp.length < 2) throw new IOException("short pdu");
    if ((resp[0] & 0x80) != 0) throw new IOException("modbus exception " + (resp[1] & 0xff));
    if ((resp[0] & 0xff) != fc) throw new IOException("fc mismatch");
    int byteCount = resp[1] & 0xff;
    boolean[] bits = new boolean[quantity];
    for (int i = 0; i < quantity; i++) {
      int bi = i / 8;
      if (2 + bi >= resp.length || bi >= byteCount) break;
      bits[i] = ((resp[2 + bi] >> (i % 8)) & 1) != 0;
    }
    return bits;
  }

  public synchronized void writeSingleRegister(int address, int value) throws IOException {
    byte[] pdu = new byte[5];
    pdu[0] = 6;
    putU16(pdu, 1, address);
    putU16(pdu, 3, value & 0xffff);
    byte[] resp = exchange(pdu);
    if (resp.length >= 1 && (resp[0] & 0x80) != 0) {
      throw new IOException("modbus exception " + (resp.length > 1 ? (resp[1] & 0xff) : -1));
    }
  }

  public synchronized void writeRegisters(int address, int[] values) throws IOException {
    int qty = values.length;
    byte[] pdu = new byte[6 + qty * 2];
    pdu[0] = 16;
    putU16(pdu, 1, address);
    putU16(pdu, 3, qty);
    pdu[5] = (byte) (qty * 2);
    for (int i = 0; i < qty; i++) {
      putU16(pdu, 6 + i * 2, values[i] & 0xffff);
    }
    byte[] resp = exchange(pdu);
    if (resp.length >= 1 && (resp[0] & 0x80) != 0) {
      throw new IOException("modbus exception " + (resp.length > 1 ? (resp[1] & 0xff) : -1));
    }
  }

  public synchronized void writeCoil(int address, boolean on) throws IOException {
    byte[] pdu = new byte[5];
    pdu[0] = 5;
    putU16(pdu, 1, address);
    putU16(pdu, 3, on ? 0xFF00 : 0x0000);
    byte[] resp = exchange(pdu);
    if (resp.length >= 1 && (resp[0] & 0x80) != 0) {
      throw new IOException("modbus exception " + (resp.length > 1 ? (resp[1] & 0xff) : -1));
    }
  }

  private byte[] readFully(int n) throws IOException {
    byte[] buf = new byte[n];
    int off = 0;
    while (off < n) {
      int r = in.read(buf, off, n - off);
      if (r < 0) {
        closeQuietly();
        throw new IOException("connection closed");
      }
      off += r;
    }
    return buf;
  }

  private static void putU16(byte[] b, int i, int v) {
    b[i] = (byte) ((v >> 8) & 0xff);
    b[i + 1] = (byte) (v & 0xff);
  }

  private void closeQuietly() {
    try {
      close();
    } catch (Exception ignored) {
    }
  }

  @Override
  public synchronized void close() {
    try {
      if (socket != null) socket.close();
    } catch (IOException ignored) {
    }
    socket = null;
    in = null;
    out = null;
  }
}
