package com.webscada.server.comm.event;

import com.webscada.server.comm.metrics.LinkStats;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 有界队列。满了丢最旧并计数。回调在独立线程执行，emit 本身不阻塞等待业务。
 */
public final class CallbackDispatcher implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(CallbackDispatcher.class);

  private final ArrayBlockingQueue<Object> queue;
  private final LinkStats stats;
  private final Thread thread;
  private volatile LinkListener listener = new LinkListener() {};
  private final AtomicBoolean closed = new AtomicBoolean(false);
  private final Object offerLock = new Object();

  public CallbackDispatcher(int capacity, LinkStats stats) {
    if (capacity < 1) throw new IllegalArgumentException("capacity < 1");
    this.queue = new ArrayBlockingQueue<>(capacity);
    this.stats = stats;
    this.thread =
        new Thread(
            this::loop,
            "comm-callback");
    this.thread.setDaemon(true);
    this.thread.start();
  }

  public void setListener(LinkListener listener) {
    this.listener = listener == null ? new LinkListener() {} : listener;
  }

  public Thread thread() {
    return thread;
  }

  public void emit(Object event) {
    if (event == null || closed.get()) return;
    synchronized (offerLock) {
      if (!queue.offer(event)) {
        queue.poll();
        stats.dropped().increment();
        queue.offer(event);
      }
      stats.queueDepth(queue.size());
    }
  }

  private void loop() {
    while (!closed.get() || !queue.isEmpty()) {
      Object event;
      try {
        event = queue.poll(200, java.util.concurrent.TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        if (closed.get()) return;
        continue;
      }
      if (event == null) continue;
      stats.queueDepth(queue.size());
      dispatch(event);
    }
  }

  private void dispatch(Object event) {
    LinkListener current = listener;
    try {
      if (event instanceof LinkEvents.StateChanged e) current.onState(e);
      else if (event instanceof LinkEvents.DataReceived e) current.onData(e);
      else if (event instanceof LinkEvents.ErrorOccurred e) current.onError(e);
      else if (event instanceof LinkEvents.StatsUpdated e) current.onStats(e);
    } catch (RuntimeException ex) {
      log.warn("comm callback failed: {}", ex.toString());
    }
  }

  @Override
  public void close() {
    closed.set(true);
    thread.interrupt();
  }
}
