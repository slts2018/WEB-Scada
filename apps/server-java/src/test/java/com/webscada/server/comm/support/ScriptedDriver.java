package com.webscada.server.comm.support;

import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;
import java.util.function.Consumer;

/** 测试用驱动，不是协议实现。 */
public final class ScriptedDriver implements ProtocolDriver {
  public final ConcurrentLinkedQueue<Object> connectPlan = new ConcurrentLinkedQueue<>();
  public final ConcurrentLinkedQueue<Object> healthPlan = new ConcurrentLinkedQueue<>();
  public final ConcurrentLinkedQueue<Object> readPlan = new ConcurrentLinkedQueue<>();
  public final AtomicReference<List<IoResult.PointUpdate>> readResult =
      new AtomicReference<>(List.of());
  public final List<LinkDefinition.Endpoint> seen =
      Collections.synchronizedList(new ArrayList<>());
  public final ConcurrentLinkedQueue<Object> subscribePlan = new ConcurrentLinkedQueue<>();
  public final List<ScriptedSubscription> subscriptions =
      Collections.synchronizedList(new ArrayList<>());
  public final List<Long> subscribeAt = Collections.synchronizedList(new ArrayList<>());
  public final AtomicInteger connects = new AtomicInteger();
  public final AtomicInteger disconnects = new AtomicInteger();
  public final AtomicInteger healths = new AtomicInteger();
  public final AtomicInteger reads = new AtomicInteger();
  public final AtomicInteger subscribes = new AtomicInteger();
  public volatile boolean subscribeEnabled;
  public volatile boolean failSubscribe;
  public volatile boolean blockNextRead;
  public volatile boolean readEntered;
  public volatile boolean releaseRead = true;
  public volatile long disconnectBlockMs;
  public volatile boolean ignoreInterrupt;
  public volatile String connectThread = "";
  public final ConcurrentLinkedQueue<Object> writePlan = new ConcurrentLinkedQueue<>();
  public final List<IoRequest> writes = Collections.synchronizedList(new ArrayList<>());
  public volatile long writeBlockMs;

  @Override
  public String name() {
    return "scripted";
  }

  @Override
  public boolean supportsSubscription() {
    return subscribeEnabled;
  }

  /** 有活动订阅时用链路里的 OPC UA 对账间隔，否则仍按 poll，和改之前的 liveSub 判断一致。 */
  @Override
  public long resyncIntervalMs(LinkDefinition link) {
    if (subscribeEnabled && activeSubscriptions() > 0) return link.opcua().resyncIntervalMs();
    return link.pollIntervalMs();
  }

  @Override
  public long silenceTimeoutMs(LinkDefinition link) {
    if (!subscribeEnabled || activeSubscriptions() == 0) return 0L;
    return (long) link.opcua().keepAliveCount() * link.opcua().publishingIntervalMs() * 2L;
  }

  public int activeSubscriptions() {
    int n = 0;
    synchronized (subscriptions) {
      for (ScriptedSubscription sub : subscriptions) {
        if (!sub.cancelled) n++;
      }
    }
    return n;
  }

  @Override
  public void connect(DriverContext ctx) throws CommException {
    connectThread = Thread.currentThread().getName();
    connects.incrementAndGet();
    seen.add(ctx.endpoint());
    Object next = connectPlan.poll();
    if (next instanceof CommException ex) throw ex;
  }

  @Override
  public void disconnect() {
    disconnects.incrementAndGet();
    long wait = disconnectBlockMs;
    if (wait <= 0) return;
    long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(wait);
    while (System.nanoTime() < end) {
      if (!ignoreInterrupt && Thread.currentThread().isInterrupted()) return;
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(5));
    }
  }

  @Override
  public Health healthCheck(DriverContext ctx) throws CommException {
    healths.incrementAndGet();
    Object next = healthPlan.poll();
    if (next instanceof CommException ex) throw ex;
    if (next instanceof Health health) return health;
    return Health.OK;
  }

  @Override
  public IoResult read(DriverContext ctx, IoRequest request) throws CommException {
    reads.incrementAndGet();
    if (blockNextRead) {
      blockNextRead = false;
      readEntered = true;
      while (!releaseRead) {
        if (Thread.currentThread().isInterrupted()) break;
        LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(5));
      }
    }
    Object next = readPlan.poll();
    if (next instanceof CommException ex) throw ex;
    return new IoResult(true, ctx.correlationId(), readResult.get(), null);
  }

  @Override
  public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
    writes.add(request);
    long wait = writeBlockMs;
    if (wait > 0) {
      long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(wait);
      while (System.nanoTime() < end) {
        if (Thread.currentThread().isInterrupted()) {
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "write interrupted");
        }
        LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(5));
      }
    }
    Object next = writePlan.poll();
    if (next instanceof CommException ex) throw ex;
    return new IoResult(true, ctx.correlationId(), List.of(), null);
  }

  @Override
  public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException {
    subscribes.incrementAndGet();
    subscribeAt.add(ctx.clock().millis());
    if (failSubscribe) {
      throw new CommException(ErrorCategory.CONNECT, true, false, "subscribe failed");
    }
    Object next = subscribePlan.poll();
    if (next instanceof CommException ex) throw ex;
    ScriptedSubscription sub = new ScriptedSubscription();
    subscriptions.add(sub);
    return sub;
  }

  public static final class ScriptedSubscription implements Subscription {
    public volatile boolean cancelled;

    @Override
    public void cancel() {
      cancelled = true;
    }
  }
}
