package com.webscada.server.device.modbus;

import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 同一设备的 Modbus 请求在通信层串行排队。
 *
 * <p>底层 {@link ModbusTcpClient}/{@link ModbusUdpClient} 的读写都是 {@code synchronized}，
 * 同一会话不允许并发请求。本队列把等待从调度线程挪到设备通信线程，并单独记录排队时延。
 */
final class ModbusCommQueue {
  private final ConcurrentHashMap<String, ExecutorService> executors = new ConcurrentHashMap<>();
  private final AtomicInteger seq = new AtomicInteger();

  <T> T submit(String deviceId, Callable<T> task) throws Exception {
    return submitTimed(deviceId, task).result();
  }

  <T> Timed<T> submitTimed(String deviceId, Callable<T> task) throws Exception {
    if (deviceId == null) throw new IllegalArgumentException("deviceId");
    long enqueuedNs = System.nanoTime();
    ExecutorService exec = executors.computeIfAbsent(deviceId, this::newExecutor);
    Future<Timed<T>> future =
        exec.submit(
            () -> {
              long startNs = System.nanoTime();
              T value = task.call();
              long endNs = System.nanoTime();
              return new Timed<>(value, startNs - enqueuedNs, endNs - startNs);
            });
    try {
      return future.get();
    } catch (Exception e) {
      Throwable cause = e.getCause() != null ? e.getCause() : e;
      if (cause instanceof Exception ex) throw ex;
      if (cause instanceof Error err) throw err;
      throw e;
    }
  }

  void drop(String deviceId) {
    if (deviceId == null) return;
    ExecutorService exec = executors.remove(deviceId);
    if (exec != null) exec.shutdownNow();
  }

  void shutdown() {
    for (ExecutorService exec : executors.values()) {
      exec.shutdownNow();
    }
    executors.clear();
  }

  void awaitQuietly(long timeoutMs) {
    long deadline = System.currentTimeMillis() + Math.max(0L, timeoutMs);
    for (ExecutorService exec : executors.values()) {
      long left = deadline - System.currentTimeMillis();
      if (left <= 0) break;
      try {
        exec.awaitTermination(left, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        break;
      }
    }
  }

  private ExecutorService newExecutor(String deviceId) {
    ThreadFactory tf =
        r -> {
          Thread t = new Thread(r, "modbus-comm-" + deviceId + "-" + seq.incrementAndGet());
          t.setDaemon(true);
          return t;
        };
    return Executors.newSingleThreadExecutor(tf);
  }

  record Timed<T>(T result, long queueNs, long execNs) {}
}
