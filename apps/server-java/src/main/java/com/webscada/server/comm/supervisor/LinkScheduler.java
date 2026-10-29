package com.webscada.server.comm.supervisor;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * tick 调度。生产用共享单线程 {@link SharedTickScheduler}；测试用 {@link ManualScheduler}。
 * tick 回调跑在名为 comm-tick 的线程上。
 */
public interface LinkScheduler extends AutoCloseable {
  void register(Runnable tick);

  void requestTick();

  boolean isTickThread();

  /** 把动作排进 tick 线程。测试用它断言 stop() 不能从 tick 线程调用。 */
  void enqueueOnTick(Runnable action);

  boolean awaitTickDone(long timeoutMs);

  @Override
  void close();

  final class ManualScheduler implements LinkScheduler {
    private static final Logger log = LoggerFactory.getLogger(ManualScheduler.class);
    private final List<Runnable> ticks = new CopyOnWriteArrayList<>();
    private final List<Runnable> side = new CopyOnWriteArrayList<>();
    private final ThreadLocal<Boolean> inTick = new ThreadLocal<>();
    private final AtomicInteger requested = new AtomicInteger();
    private final AtomicInteger finished = new AtomicInteger();
    private final AtomicBoolean pending = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final Thread thread;

    public ManualScheduler() {
      thread = new Thread(this::loop, "comm-tick");
      thread.setDaemon(true);
      thread.start();
    }

    @Override
    public void register(Runnable tick) {
      ticks.add(tick);
    }

    @Override
    public void requestTick() {
      if (pending.compareAndSet(false, true)) requested.incrementAndGet();
      LockSupport.unpark(thread);
    }

    @Override
    public boolean isTickThread() {
      return Boolean.TRUE.equals(inTick.get());
    }

    @Override
    public void enqueueOnTick(Runnable action) {
      side.add(action);
      requestTick();
    }

    @Override
    public boolean awaitTickDone(long timeoutMs) {
      long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
      int target = requested.get();
      while (finished.get() < target) {
        if (System.nanoTime() > end) return false;
        LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(2));
      }
      return true;
    }

    @Override
    public void close() {
      closed.set(true);
      LockSupport.unpark(thread);
    }

    private void loop() {
      while (!closed.get()) {
        if (!pending.get() && side.isEmpty()) {
          LockSupport.park();
          continue;
        }
        pending.set(false);
        inTick.set(Boolean.TRUE);
        try {
          while (!side.isEmpty()) {
            Runnable extra = side.remove(0);
            extra.run();
          }
          try {
            for (Runnable tick : ticks) tick.run();
          } catch (RuntimeException ex) {
            log.warn("tick failed: {}", ex.toString());
          }
          finished.incrementAndGet();
        } finally {
          inTick.remove();
        }
      }
    }
  }

  final class SharedTickScheduler implements LinkScheduler {
    private static final Logger log = LoggerFactory.getLogger(SharedTickScheduler.class);
    private final List<Runnable> ticks = new CopyOnWriteArrayList<>();
    private final List<Runnable> side = new CopyOnWriteArrayList<>();
    private final ThreadLocal<Boolean> inTick = new ThreadLocal<>();
    private final AtomicBoolean pending = new AtomicBoolean();
    private final ScheduledExecutorService executor;
    private final AtomicInteger requested = new AtomicInteger();
    private final AtomicInteger finished = new AtomicInteger();

    public SharedTickScheduler(int tickMs) {
      int period = Math.max(10, tickMs);
      executor =
          Executors.newSingleThreadScheduledExecutor(
              r -> {
                Thread t = new Thread(r, "comm-tick");
                t.setDaemon(true);
                return t;
              });
      executor.scheduleAtFixedRate(this::requestTick, period, period, TimeUnit.MILLISECONDS);
    }

    @Override
    public void register(Runnable tick) {
      ticks.add(tick);
    }

    @Override
    public void requestTick() {
      if (pending.compareAndSet(false, true)) {
        requested.incrementAndGet();
        executor.execute(this::runOnce);
      }
    }

    @Override
    public boolean isTickThread() {
      return Boolean.TRUE.equals(inTick.get());
    }

    @Override
    public void enqueueOnTick(Runnable action) {
      side.add(action);
      requestTick();
    }

    @Override
    public boolean awaitTickDone(long timeoutMs) {
      long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
      int target = requested.get();
      while (finished.get() < target) {
        if (System.nanoTime() > end) return false;
        LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(2));
      }
      return true;
    }

    private void runOnce() {
      pending.set(false);
      inTick.set(Boolean.TRUE);
      try {
        while (!side.isEmpty()) {
          side.remove(0).run();
        }
        try {
          for (Runnable tick : ticks) tick.run();
        } catch (RuntimeException ex) {
          log.warn("tick failed: {}", ex.toString());
        }
      } finally {
        finished.incrementAndGet();
        inTick.remove();
      }
    }

    @Override
    public void close() {
      executor.shutdownNow();
    }
  }
}
