package com.webscada.server.comm.driver.modbus;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/** 进程内假从站。只用于测试，不进入生产代码。 */
public final class FakeModbusServer implements AutoCloseable {
  public enum Mode {
    NORMAL,
    EXCEPTION,
    STICKY,
    HALF,
    BAD_TXN,
    BAD_PROTOCOL,
    BAD_LENGTH,
    SILENT,
    DROP
  }

  public record Call(int function, int address, int count) {}

  private final ServerSocket server;
  private final AtomicInteger accepts = new AtomicInteger();
  private final List<Call> calls = Collections.synchronizedList(new ArrayList<>());
  private final List<Socket> clients = new CopyOnWriteArrayList<>();
  private final int[] holding = new int[1024];
  private final int[] input = new int[1024];
  private final BitSet coils = new BitSet();
  private final BitSet discrete = new BitSet();
  private volatile boolean running = true;
  private volatile Mode mode = Mode.NORMAL;
  private volatile int exceptionCode = 2;
  private volatile int passAddress = -1;
  private volatile int passCount = 1;
  private volatile int skipApplies;
  private volatile CountDownLatch seen = new CountDownLatch(1);

  public FakeModbusServer() throws IOException {
    server = new ServerSocket();
    server.setReuseAddress(true);
    server.bind(new java.net.InetSocketAddress("127.0.0.1", 0));
    Thread thread = new Thread(this::acceptLoop, "fake-modbus");
    thread.setDaemon(true);
    thread.start();
  }

  public int port() {
    return server.getLocalPort();
  }

  public void setMode(Mode mode) {
    this.mode = mode;
  }

  public void setExceptionCode(int code) {
    exceptionCode = code;
  }

  public void passProbe(int address, int count) {
    passAddress = address;
    passCount = count;
  }

  public void setSkipApplies(int n) {
    skipApplies = n;
  }

  public void setHolding(int address, int value) {
    holding[address] = value & 0xffff;
  }

  public int holding(int address) {
    return holding[address];
  }

  public void setInput(int address, int value) {
    input[address] = value & 0xffff;
  }

  public void setCoil(int address, boolean on) {
    coils.set(address, on);
  }

  public void setDiscrete(int address, boolean on) {
    discrete.set(address, on);
  }

  public List<Call> calls() {
    synchronized (calls) {
      return List.copyOf(calls);
    }
  }

  public int accepts() {
    return accepts.get();
  }

  public CountDownLatch seen() {
    return seen;
  }

  public void resetSeen() {
    seen = new CountDownLatch(1);
  }

  public void dropClients() {
    for (Socket socket : clients) {
      try {
        socket.close();
      } catch (IOException ignored) {
        // 测试用断开。
      }
    }
    clients.clear();
  }

  private void acceptLoop() {
    while (running) {
      try {
        Socket socket = server.accept();
        accepts.incrementAndGet();
        clients.add(socket);
        Thread worker = new Thread(() -> handle(socket), "fake-modbus-conn");
        worker.setDaemon(true);
        worker.start();
      } catch (IOException ex) {
        if (running) continue;
        return;
      }
    }
  }

  private void handle(Socket socket) {
    try (socket) {
      socket.setTcpNoDelay(true);
      InputStream in = socket.getInputStream();
      OutputStream out = socket.getOutputStream();
      while (true) {
        byte[] frame = readFrame(in);
        if (frame == null) return;
        seen.countDown();
        if (mode == Mode.DROP) {
          socket.close();
          return;
        }
        byte[] response = respond(frame);
        if (response == null || mode == Mode.SILENT) continue;
        writeResponse(out, response);
      }
    } catch (IOException ex) {
      // 对端关闭。
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
    } finally {
      clients.remove(socket);
    }
  }

  private void writeResponse(OutputStream out, byte[] response) throws IOException, InterruptedException {
    if (mode == Mode.HALF) {
      int cut = Math.min(3, response.length);
      out.write(response, 0, cut);
      out.flush();
      Thread.sleep(40);
      out.write(response, cut, response.length - cut);
      out.flush();
      return;
    }
    if (mode == Mode.STICKY || mode == Mode.BAD_TXN) {
      int unit = response[6] & 0xff;
      byte[] junk = MbapBuffer.encode(0xABCD, 0, unit, new byte[] {(byte) 0x83, 0x02});
      if (mode == Mode.STICKY) {
        byte[] both = new byte[junk.length + response.length];
        System.arraycopy(junk, 0, both, 0, junk.length);
        System.arraycopy(response, 0, both, junk.length, response.length);
        out.write(both);
        out.flush();
      } else {
        out.write(junk);
        out.flush();
        out.write(response);
        out.flush();
      }
      return;
    }
    out.write(response);
    out.flush();
  }

  private byte[] respond(byte[] frame) {
    int txn = Bytes.u16(frame, 0);
    int unit = frame[6] & 0xff;
    byte[] pdu = java.util.Arrays.copyOfRange(frame, 7, frame.length);
    int function = pdu.length == 0 ? 0 : pdu[0] & 0xff;
    int address = pdu.length >= 3 ? Bytes.u16(pdu, 1) : 0;
    int count = pdu.length >= 5 ? Bytes.u16(pdu, 3) : 1;
    calls.add(new Call(function, address, count));
    if (mode == Mode.EXCEPTION && !(passAddress >= 0 && address == passAddress && count == passCount)) {
      return MbapBuffer.encode(txn, 0, unit, new byte[] {(byte) (function | 0x80), (byte) exceptionCode});
    }
    if (mode == Mode.BAD_PROTOCOL) {
      byte[] normal = answer(function, pdu);
      return MbapBuffer.encode(txn, 1, unit, normal);
    }
    if (mode == Mode.BAD_LENGTH) {
      return MbapBuffer.encode(txn, 0, unit, new byte[] {0x03, 0x04, 0x00, 0x01});
    }
    byte[] body = answer(function, pdu);
    return MbapBuffer.encode(txn, 0, unit, body);
  }

  private byte[] answer(int function, byte[] pdu) {
    int address = pdu.length >= 3 ? Bytes.u16(pdu, 1) : 0;
    int count = pdu.length >= 5 ? Bytes.u16(pdu, 3) : 0;
    return switch (function) {
      case 1 -> readBits(1, address, count, coils);
      case 2 -> readBits(2, address, count, discrete);
      case 3 -> readRegs(3, address, count, holding);
      case 4 -> readRegs(4, address, count, input);
      case 5 -> {
        boolean on = Bytes.u16(pdu, 3) == 0xFF00;
        if (skipApplies > 0) skipApplies--;
        else coils.set(address, on);
        yield pdu;
      }
      case 6 -> {
        if (skipApplies > 0) skipApplies--;
        else holding[address] = Bytes.u16(pdu, 3);
        yield pdu;
      }
      case 15 -> {
        int qty = count;
        int packedAt = 6;
        for (int i = 0; i < qty; i++) {
          int bit = (pdu[packedAt + i / 8] >> (i % 8)) & 1;
          coils.set(address + i, bit == 1);
        }
        byte[] echo = new byte[5];
        echo[0] = 15;
        Bytes.putU16(echo, 1, address);
        Bytes.putU16(echo, 3, qty);
        yield echo;
      }
      case 16 -> {
        int qty = count;
        if (skipApplies > 0) skipApplies--;
        else {
          for (int i = 0; i < qty; i++) holding[address + i] = Bytes.u16(pdu, 6 + i * 2);
        }
        byte[] echo = new byte[5];
        echo[0] = 16;
        Bytes.putU16(echo, 1, address);
        Bytes.putU16(echo, 3, qty);
        yield echo;
      }
      case 23 -> {
        int readAddr = Bytes.u16(pdu, 1);
        int readQty = Bytes.u16(pdu, 3);
        int writeAddr = Bytes.u16(pdu, 5);
        int writeQty = Bytes.u16(pdu, 7);
        for (int i = 0; i < writeQty; i++) holding[writeAddr + i] = Bytes.u16(pdu, 10 + i * 2);
        yield readRegs(23, readAddr, readQty, holding);
      }
      default -> new byte[] {(byte) (function | 0x80), 0x01};
    };
  }

  private static byte[] readBits(int function, int address, int count, BitSet bits) {
    int bytes = (count + 7) / 8;
    byte[] pdu = new byte[2 + bytes];
    pdu[0] = (byte) function;
    pdu[1] = (byte) bytes;
    for (int i = 0; i < count; i++) {
      if (bits.get(address + i)) pdu[2 + i / 8] |= (byte) (1 << (i % 8));
    }
    return pdu;
  }

  private static byte[] readRegs(int function, int address, int count, int[] table) {
    byte[] pdu = new byte[2 + count * 2];
    pdu[0] = (byte) function;
    pdu[1] = (byte) (count * 2);
    for (int i = 0; i < count; i++) Bytes.putU16(pdu, 2 + i * 2, table[address + i]);
    return pdu;
  }

  private static byte[] readFrame(InputStream in) throws IOException {
    byte[] head = readFully(in, 6);
    if (head == null) return null;
    int length = Bytes.u16(head, 4);
    byte[] body = readFully(in, length);
    if (body == null) return null;
    byte[] all = new byte[6 + length];
    System.arraycopy(head, 0, all, 0, 6);
    System.arraycopy(body, 0, all, 6, length);
    return all;
  }

  private static byte[] readFully(InputStream in, int n) throws IOException {
    byte[] buf = new byte[n];
    int off = 0;
    while (off < n) {
      int r = in.read(buf, off, n - off);
      if (r < 0) return null;
      off += r;
    }
    return buf;
  }

  @Override
  public void close() throws IOException {
    running = false;
    dropClients();
    server.close();
  }
}
