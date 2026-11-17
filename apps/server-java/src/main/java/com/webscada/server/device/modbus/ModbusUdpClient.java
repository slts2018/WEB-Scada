package com.webscada.server.device.modbus;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.util.Arrays;

/**
 * Modbus UDP（MBAP）。事务号固定为 0：该设备把 UDP 首字节自增当成下载命令。
 * 超时不关套接字，调用方停掉这一轮剩余请求。
 */
public final class ModbusUdpClient implements ModbusClient {
  private final String host;
  private final int port;
  private final int unitId;
  private final int responseTimeoutMs;
  private DatagramSocket socket;
  private InetAddress address;

  public ModbusUdpClient(String host, int port, int unitId, int responseTimeoutMs) {
    this.host = host;
    this.port = port;
    this.unitId = unitId & 0xff;
    this.responseTimeoutMs = Math.max(200, responseTimeoutMs);
  }

  @Override
  public String host() {
    return host;
  }

  @Override
  public int port() {
    return port;
  }

  @Override
  public synchronized void ensureConnected() throws IOException {
    if (socket != null && !socket.isClosed()) return;
    closeQuietly();
    socket = new DatagramSocket();
    socket.setSoTimeout(responseTimeoutMs);
    address = InetAddress.getByName(host);
  }

  public synchronized byte[] exchange(byte[] pdu) throws IOException {
    ensureConnected();
    byte[] frame = new byte[7 + pdu.length];
    frame[0] = 0;
    frame[1] = 0;
    frame[2] = 0;
    frame[3] = 0;
    int len = 1 + pdu.length;
    frame[4] = (byte) ((len >> 8) & 0xff);
    frame[5] = (byte) (len & 0xff);
    frame[6] = (byte) unitId;
    System.arraycopy(pdu, 0, frame, 7, pdu.length);

    try {
      socket.send(new DatagramPacket(frame, frame.length, address, port));
    } catch (IOException e) {
      closeQuietly();
      throw new IOException(text(e, "udp send failed"), e);
    }

    byte[] buf = new byte[260];
    long deadline = System.nanoTime() + responseTimeoutMs * 1_000_000L;
    while (true) {
      int remain = (int) ((deadline - System.nanoTime()) / 1_000_000L);
      if (remain <= 0) throw new IOException("udp timeout");
      socket.setSoTimeout(Math.max(1, remain));
      DatagramPacket packet = new DatagramPacket(buf, buf.length);
      try {
        socket.receive(packet);
      } catch (SocketTimeoutException e) {
        throw new IOException("udp timeout");
      } catch (IOException e) {
        closeQuietly();
        throw new IOException(text(e, "udp recv failed"), e);
      }
      if (packet.getAddress() != null && !packet.getAddress().equals(address)) continue;
      return decode(packet.getData(), packet.getOffset(), packet.getLength());
    }
  }

  private byte[] decode(byte[] raw, int off, int n) throws IOException {
    if (n < 8) throw new IOException("mbap mismatch");
    int txn = ((raw[off] & 0xff) << 8) | (raw[off + 1] & 0xff);
    int proto = ((raw[off + 2] & 0xff) << 8) | (raw[off + 3] & 0xff);
    int length = ((raw[off + 4] & 0xff) << 8) | (raw[off + 5] & 0xff);
    if (txn != 0 || proto != 0 || length < 2 || length > 260 || off + 6 + length > n) {
      throw new IOException("mbap mismatch");
    }
    if ((raw[off + 6] & 0xff) != unitId) throw new IOException("mbap mismatch");
    return Arrays.copyOfRange(raw, off + 7, off + 6 + length);
  }

  @Override
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

  @Override
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

  @Override
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

  @Override
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

  @Override
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

  private static void putU16(byte[] b, int i, int v) {
    b[i] = (byte) ((v >> 8) & 0xff);
    b[i + 1] = (byte) (v & 0xff);
  }

  private static String text(Exception e, String fallback) {
    String m = e.getMessage();
    return m == null || m.isBlank() ? fallback : m;
  }

  private void closeQuietly() {
    try {
      close();
    } catch (Exception ignored) {
    }
  }

  @Override
  public synchronized void close() {
    if (socket != null) socket.close();
    socket = null;
    address = null;
  }
}
