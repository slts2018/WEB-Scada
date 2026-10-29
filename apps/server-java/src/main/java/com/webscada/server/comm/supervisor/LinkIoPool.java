package com.webscada.server.comm.supervisor;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

/** 共享 IO 池。每条链路同一时刻只提交一个任务，tick 线程调用 submit 后立即返回。 */
public final class LinkIoPool implements AutoCloseable {
  private final ExecutorService pool;
  private final ConcurrentHashMap<String, AtomicBoolean> busy = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, AtomicReference<Future<?>>> current =
      new ConcurrentHashMap<>();
  private final AtomicInteger inflight = new AtomicInteger();

  public LinkIoPool() {
    this(4);
  }

  public LinkIoPool(int threads) {
    int size = Math.max(1, threads);
    pool =
        Executors.newFixedThreadPool(
            size,
            r -> {
              Thread t = new Thread(r, "comm-io");
              t.setDaemon(true);
              return t;
            });
  }

  public boolean busy(String linkId) {
    AtomicBoolean gate = busy.get(linkId);
    return gate != null && gate.get();
  }

  /** after 在 busy 清掉之后调用，用来唤醒 tick。tick 不会撞上还没释放的闸门。 */
  public boolean submit(String linkId, Runnable task, Runnable after) {
    AtomicBoolean gate = busy.computeIfAbsent(linkId, id -> new AtomicBoolean());
    if (!gate.compareAndSet(false, true)) return false;
    inflight.incrementAndGet();
    AtomicReference<Future<?>> box = new AtomicReference<>();
    current.put(linkId, box);
    Future<?> future =
        pool.submit(
            () -> {
              Thread.currentThread().setName("comm-io");
              try {
                task.run();
              } finally {
                gate.set(false);
                current.remove(linkId, box);
                inflight.decrementAndGet();
                if (after != null) after.run();
              }
            });
    box.set(future);
    return true;
  }

  public void cancel(String linkId) {
    AtomicReference<Future<?>> box = current.get(linkId);
    if (box == null) return;
    Future<?> future = box.get();
    if (future != null) future.cancel(true);
  }

  public boolean awaitQuiet(long timeoutMs) {
    long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
    while (inflight.get() > 0) {
      if (System.nanoTime() > end) return false;
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(2));
    }
    return true;
  }

  @Override
  public void close() {
    pool.shutdownNow();
  }
}
