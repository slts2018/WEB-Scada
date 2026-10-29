package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** 一条 TCP 连接上的 MBAP 收发。同一时刻只允许一个在途请求。 */
final class MbapClient implements AutoCloseable {
  private final Object lock = new Object();
  private final MbapBuffer buffer = new MbapBuffer();
  private final AtomicBoolean inflight = new AtomicBoolean();
  private final AtomicInteger nextTxn = new AtomicInteger();
  private Socket socket;
  private InputStream in;
  private OutputStream out;

  @Override
  public void close() {
    disconnect();
  }

  void connect(String host, int port, int connectTimeoutMs) throws CommException {
    disconnect();
    if (host == null || host.isBlank() || port < 1 || port > 65535) {
      throw new CommException(
          ErrorCategory.CONNECT, true, true, "connect rejected " + host + ":" + port);
    }
    Socket opened = new Socket();
    try {
      opened.connect(new InetSocketAddress(host, port), Math.max(1, connectTimeoutMs));
      opened.setTcpNoDelay(true);
      synchronized (lock) {
        socket = opened;
        in = opened.getInputStream();
        out = opened.getOutputStream();
        buffer.clear();
      }
    } catch (IOException ex) {
      try {
        opened.close();
      } catch (IOException ignored) {
        // 建链失败后的关闭不再覆盖原始错误。
      }
      throw new CommException(
          ErrorCategory.CONNECT,
          true,
          true,
          "connect " + host + ":" + port + " failed: " + ex.getMessage(),
          ex);
    }
  }

  void disconnect() {
    Socket current;
    synchronized (lock) {
      current = socket;
      socket = null;
      in = null;
      out = null;
      buffer.clear();
    }
    inflight.set(false);
    if (current != null) {
      try {
        current.close();
      } catch (IOException ignored) {
        // 幂等关闭。
      }
    }
  }

  boolean connected() {
    synchronized (lock) {
      return socket != null && socket.isConnected() && !socket.isClosed();
    }
  }

  byte[] exchange(int unit, byte[] pdu, DriverContext ctx) throws CommException {
    if (!inflight.compareAndSet(false, true)) {
      throw new IllegalStateException("modbus tcp: one request in flight");
    }
    try {
      int txn = nextTxn.updateAndGet(v -> v >= 65535 ? 1 : v + 1);
      byte[] frame = MbapBuffer.encode(txn, 0, unit, pdu);
      InputStream input;
      Socket current;
      synchronized (lock) {
        current = socket;
        input = in;
        if (current == null || out == null) {
          throw new CommException(ErrorCategory.CONNECT, true, false, "not connected");
        }
        out.write(frame);
        out.flush();
      }
      long deadline = System.nanoTime() + Math.max(1, ctx.responseTimeoutMs()) * 1_000_000L;
      byte[] scratch = new byte[512];
      while (true) {
        MbapBuffer.Frame polled;
        synchronized (buffer) {
          polled = buffer.poll();
        }
        if (polled != null) {
          MbapBuffer.requireProtocol(polled);
          if (polled.transactionId() != txn || polled.unitId() != (unit & 0xff)) {
            ctx.stats().protocolErrors().increment();
            ctx.log()
                .warn(
                    "mbap_discard",
                    "PROTOCOL",
                    "transaction mismatch expect=" + txn + " got=" + polled.transactionId(),
                    null,
                    null,
                    ctx.sessionId(),
                    ctx.correlationId());
            continue;
          }
          return polled.pdu();
        }
        long leftNs = deadline - System.nanoTime();
        if (leftNs <= 0) {
          synchronized (buffer) {
            buffer.clear();
          }
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "response timeout");
        }
        int waitMs = (int) Math.min(Integer.MAX_VALUE, Math.max(1L, leftNs / 1_000_000L));
        current.setSoTimeout(waitMs);
        int n;
        try {
          n = input.read(scratch);
        } catch (SocketTimeoutException ex) {
          synchronized (buffer) {
            buffer.clear();
          }
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "response timeout", ex);
        } catch (java.io.InterruptedIOException ex) {
          Thread.currentThread().interrupt();
          disconnect();
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "interrupted", ex);
        }
        if (n < 0) {
          disconnect();
          throw new CommException(ErrorCategory.CONNECT, true, true, "connection closed");
        }
        synchronized (buffer) {
          buffer.append(scratch, 0, n);
        }
      }
    } catch (CommException ex) {
      if (ex.category() == ErrorCategory.PROTOCOL) {
        synchronized (buffer) {
          buffer.clear();
        }
      }
      throw ex;
    } catch (IOException ex) {
      disconnect();
      throw new CommException(ErrorCategory.CONNECT, true, true, "connection closed", ex);
    } finally {
      inflight.set(false);
    }
  }
}
