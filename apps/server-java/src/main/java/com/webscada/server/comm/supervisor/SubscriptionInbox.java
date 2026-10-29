package com.webscada.server.comm.supervisor;

import com.webscada.server.comm.driver.IoResult;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;

/** 订阅推送的有界队列。满了丢最旧并计数。Milo 线程只调用 {@link #offer}。 */
public final class SubscriptionInbox {
  private final ArrayBlockingQueue<IoResult> queue;
  private final Object offerLock = new Object();
  private long dropped;

  public SubscriptionInbox(int capacity) {
    if (capacity < 1) throw new IllegalArgumentException("capacity < 1");
    this.queue = new ArrayBlockingQueue<>(capacity);
  }

  public int offer(IoResult result) {
    if (result == null) return 0;
    int lost = 0;
    synchronized (offerLock) {
      if (!queue.offer(result)) {
        queue.poll();
        lost = 1;
        dropped++;
        queue.offer(result);
      }
    }
    return lost;
  }

  public List<IoResult> drain() {
    List<IoResult> out = new ArrayList<>();
    queue.drainTo(out);
    return out;
  }

  public long dropped() {
    synchronized (offerLock) {
      return dropped;
    }
  }
}
