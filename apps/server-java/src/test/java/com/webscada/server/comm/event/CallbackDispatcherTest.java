package com.webscada.server.comm.event;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.metrics.LinkStats;
import com.webscada.server.comm.state.ConnectionState;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class CallbackDispatcherTest {
  @Test
  void dropsOldestWhenFull() throws Exception {
    LinkStats stats = new LinkStats();
    CallbackDispatcher dispatcher = new CallbackDispatcher(2, stats);
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    dispatcher.setListener(
        new LinkListener() {
          @Override
          public void onState(LinkEvents.StateChanged event) {
            entered.countDown();
            try {
              release.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          }
        });
    dispatcher.emit(state("first"));
    assertTrue(entered.await(1, TimeUnit.SECONDS));
    dispatcher.emit(state("a"));
    dispatcher.emit(state("b"));
    dispatcher.emit(state("c"));
    assertTrue(stats.dropped().sum() >= 1);
    release.countDown();
    dispatcher.close();
  }

  private static LinkEvents.StateChanged state(String reason) {
    return new LinkEvents.StateChanged(
        "l", ConnectionState.DISCONNECTED, ConnectionState.CONNECTING, reason, 1);
  }
}
