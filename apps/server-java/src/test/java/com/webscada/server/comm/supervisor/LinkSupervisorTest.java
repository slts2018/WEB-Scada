package com.webscada.server.comm.supervisor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.support.Harness;
import com.webscada.server.comm.support.LinkFixtures;
import com.webscada.server.comm.support.ScriptedDriver;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class LinkSupervisorTest {
  @Test
  void reconnectsThenSticksToTheBackupEndpoint() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 15_000, 5_000, 502, 1502), 2_000);
    try {
      CommException refused =
          new CommException(ErrorCategory.CONNECT, true, true, "connection refused");
      harness.driver.connectPlan.add(refused);
      harness.driver.connectPlan.add(refused);
      harness.driver.connectPlan.add(refused);
      harness.driver.connectPlan.add("ok");
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 1, Quality.GOOD)));
      AtomicReference<String> callbackThread = new AtomicReference<>();
      harness.supervisor.setListener(
          new com.webscada.server.comm.event.LinkListener() {
            @Override
            public void onState(com.webscada.server.comm.event.LinkEvents.StateChanged event) {
              callbackThread.compareAndSet(null, Thread.currentThread().getName());
            }
          });
      harness.start();
      assertFalse(harness.supervisor.start());
      harness.until(
          () -> harness.driver.connects.get() >= 1 && harness.driver.disconnects.get() >= 1);
      assertTrue(harness.driver.disconnects.get() <= harness.driver.connects.get());
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(5_000);
      harness.until(
          () -> harness.driver.connects.get() >= 2 && harness.driver.disconnects.get() >= 2);
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(5_000);
      harness.until(
          () -> harness.driver.connects.get() >= 3 && harness.driver.disconnects.get() >= 3);
      assertEquals(1502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(5_000);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RUNNING);
      assertEquals("comm-io", harness.driver.connectThread);
      assertEquals("comm-callback", callbackThread.get());
      assertNotEquals("comm-tick", callbackThread.get());
      assertEquals(1502, harness.supervisor.activeEndpoint().port());
      assertEquals(1502, harness.facade.snapshot("plc").get("activePort"));
      assertEquals(4, harness.driver.seen.size());
      assertEquals(502, harness.driver.seen.get(0).port());
      assertEquals(502, harness.driver.seen.get(1).port());
      assertEquals(502, harness.driver.seen.get(2).port());
      assertEquals(1502, harness.driver.seen.get(3).port());

      List<String> errors = new ArrayList<>();
      LinkDefinition bad = LinkFixtures.modbus("plc", 15_000, 5_000, 0, 1502);
      assertFalse(harness.facade.reload(List.of(bad), errors));
      assertFalse(errors.isEmpty());
      assertEquals(502, harness.facade.store().current().get(0).endpoint(0).port());
      assertEquals(1502, harness.supervisor.activeEndpoint().port());
      assertEquals(1502, harness.facade.snapshot("plc").get("activePort"));

      harness.clock.advance(30_000);
      harness.until(() -> harness.logged("reconnect_count_cleared"));
    } finally {
      harness.close();
    }
  }

  @Test
  void staysOnTheLastEndpointInsteadOfWrappingToPrimary() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 15_000, 60_000, 502, 1502, 2502), 2_000);
    try {
      CommException refused = new CommException(ErrorCategory.CONNECT, true, true, "connection refused");
      for (int i = 0; i < 9; i++) harness.driver.connectPlan.add(refused);
      harness.start();
      for (int i = 1; i <= 9; i++) {
        int n = i;
        harness.until(
            () -> harness.driver.connects.get() >= n && harness.driver.disconnects.get() >= n);
        if (i < 9) harness.clock.advance(70_000);
      }
      assertEquals(2502, harness.supervisor.activeEndpoint().port());
      assertEquals(9, harness.driver.seen.size());
      assertEquals(502, harness.driver.seen.get(0).port());
      assertEquals(502, harness.driver.seen.get(2).port());
      assertEquals(1502, harness.driver.seen.get(3).port());
      assertEquals(1502, harness.driver.seen.get(5).port());
      assertEquals(2502, harness.driver.seen.get(6).port());
      assertEquals(2502, harness.driver.seen.get(8).port());
    } finally {
      harness.close();
    }
  }

  @Test
  void handshakeTimeoutReconnectsWithoutLeavingHandshakeEarly() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 15_000, 60_000, 502), 2_000);
    try {
      harness.supervisor.holdHandshake();
      harness.start();
      harness.until(() -> harness.supervisor.state() == ConnectionState.HANDSHAKE);
      assertEquals(1, harness.driver.connects.get());
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(3_000);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RECONNECTING);
      assertEquals(1, harness.driver.connects.get());
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      assertTrue(harness.logged("reconnect"));
    } finally {
      harness.close();
    }
  }

  @Test
  void threeHealthFailuresDropTheLinkAndMarkPointsBad() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 60_000, 60_000, 502), 2_000);
    try {
      harness.driver.readResult.set(
          List.of(
              new IoResult.PointUpdate("a", 1, Quality.GOOD),
              new IoResult.PointUpdate("b", 2, Quality.GOOD)));
      harness.driver.healthPlan.add(Health.FAILED);
      harness.driver.healthPlan.add(Health.FAILED);
      harness.driver.healthPlan.add(Health.FAILED);
      harness.start();
      harness.until(() -> harness.supervisor.state() == ConnectionState.RUNNING);
      harness.until(
          () -> harness.supervisor.points().get("a").quality() == Quality.GOOD);
      int before = harness.driver.healths.get();
      harness.clock.advance(1_000);
      harness.until(
          () ->
              harness.driver.healths.get() >= before + 1
                  && harness.supervisor.state() == ConnectionState.DEGRADED);
      harness.clock.advance(500);
      harness.until(() -> harness.driver.healths.get() >= before + 2);
      assertEquals(ConnectionState.DEGRADED, harness.supervisor.state());
      harness.clock.advance(500);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RECONNECTING);
      assertEquals(Quality.BAD_COMM_FAILURE, harness.supervisor.points().get("a").quality());
      assertEquals(Quality.BAD_COMM_FAILURE, harness.supervisor.points().get("b").quality());
    } finally {
      harness.close();
    }
  }

  @Test
  void goodPointBecomesStaleAfterTimeoutWhenPollingStops() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 1_000, 60_000, 502), 2_000);
    try {
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 7, Quality.GOOD)));
      harness.start();
      harness.until(
          () ->
              harness.supervisor.points().get("a") != null
                  && harness.supervisor.points().get("a").quality() == Quality.GOOD);
      assertEquals(Quality.BAD_COMM_FAILURE, harness.supervisor.points().get("b").quality());
      harness.clock.advance(1_000);
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.STALE);
      assertEquals(Quality.STALE, harness.supervisor.points().get("a").quality());
      assertEquals(7, harness.supervisor.points().get("a").value());
      assertEquals(Quality.STALE, harness.supervisor.points().get("b").quality());
    } finally {
      harness.close();
    }
  }

  @Test
  void badConfigReplacesGoodAndDoesNotRefreshLastSuccess() {
    Harness harness = Harness.open(LinkFixtures.polling("plc", 1_000, 502), 2_000);
    try {
      harness.driver.readResult.set(
          List.of(
              new IoResult.PointUpdate("a", 7, Quality.GOOD),
              new IoResult.PointUpdate("b", 8, Quality.GOOD)));
      harness.start();
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.GOOD);
      long success = ((Number) harness.facade.snapshot("plc").get("last_success_ts")).longValue();
      harness.driver.readResult.set(
          List.of(new IoResult.PointUpdate("a", 1.0, Quality.BAD_CONFIG)));
      harness.clock.advance(1_000);
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.BAD_CONFIG);
      assertNull(harness.supervisor.points().get("a").value());
      assertEquals(Quality.GOOD, harness.supervisor.points().get("b").quality());
      assertEquals(success, ((Number) harness.facade.snapshot("plc").get("last_success_ts")).longValue());
    } finally {
      harness.close();
    }
  }

  @Test
  void readTimeoutsShareTheFailoverStreak() {
    Harness harness = Harness.open(LinkFixtures.polling("plc", 1_000, 502, 1502), 2_000);
    try {
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 1, Quality.GOOD)));
      harness.start();
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.GOOD);
      CommException timeout = new CommException(ErrorCategory.TIMEOUT, true, false, "read timeout");
      harness.driver.readPlan.add(timeout);
      harness.clock.advance(1_000);
      harness.until(() -> timeoutTotal(harness) >= 1);
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      assertEquals(ConnectionState.RUNNING, harness.supervisor.state());
      harness.driver.readPlan.add(timeout);
      harness.driver.readPlan.add(timeout);
      harness.clock.advance(1_000);
      harness.until(() -> timeoutTotal(harness) >= 2);
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(1_000);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RECONNECTING);
      assertEquals(1502, harness.supervisor.activeEndpoint().port());
    } finally {
      harness.close();
    }
  }

  @Test
  void healthFailuresShareTheFailoverStreak() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 60_000, 60_000, 502, 1502), 2_000);
    try {
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 1, Quality.GOOD)));
      harness.driver.healthPlan.add(Health.FAILED);
      harness.driver.healthPlan.add(Health.FAILED);
      harness.driver.healthPlan.add(Health.FAILED);
      harness.start();
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.GOOD);
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(1_000);
      harness.until(() -> harness.supervisor.state() == ConnectionState.DEGRADED);
      assertEquals(502, harness.supervisor.activeEndpoint().port());
      harness.clock.advance(500);
      harness.until(() -> harness.driver.healths.get() >= 2);
      harness.clock.advance(500);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RECONNECTING);
      assertEquals(1502, harness.supervisor.activeEndpoint().port());
    } finally {
      harness.close();
    }
  }

  @Test
  void sourceTimestampSurvivesTheCacheWrite() {
    Harness harness = Harness.open(LinkFixtures.polling("plc", 60_000, 502), 2_000);
    try {
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 7, Quality.GOOD, 42L)));
      harness.start();
      harness.until(() -> harness.supervisor.points().get("a").quality() == Quality.GOOD);
      assertEquals(42L, harness.supervisor.points().get("a").sourceTs());
      assertEquals(7, harness.supervisor.points().get("a").value());
    } finally {
      harness.close();
    }
  }

  @Test
  void rebuildKeepsTheLiveSubscriptionUntilIoCanCancelIt() {
    Harness harness =
        Harness.open(LinkFixtures.subscribed("plc", 60_000, 1_000, 2, 1_000), 2_000);
    try {
      harness.driver.subscribeEnabled = true;
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 1, Quality.GOOD)));
      harness.start();
      harness.until(
          () ->
              harness.driver.subscribes.get() == 1
                  && harness.supervisor.points().get("a").quality() == Quality.GOOD);
      ScriptedDriver.ScriptedSubscription first = harness.driver.subscriptions.get(0);
      harness.driver.releaseRead = false;
      harness.driver.readEntered = false;
      harness.driver.blockNextRead = true;
      harness.clock.advance(1_000);
      tickOnly(harness);
      long end = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(2);
      while (!harness.driver.readEntered) {
        if (System.nanoTime() > end) throw new AssertionError("read did not start");
        Thread.onSpinWait();
      }
      harness.clock.advance(3_000);
      tickOnly(harness);
      assertFalse(first.cancelled);
      assertEquals(1, harness.driver.activeSubscriptions());
      assertEquals(1, harness.driver.subscribes.get());
      harness.driver.releaseRead = true;
      harness.until(
          () -> first.cancelled && harness.driver.subscribes.get() == 2 && harness.driver.activeSubscriptions() == 1);
      assertEquals(1, harness.driver.activeSubscriptions());
    } finally {
      harness.driver.releaseRead = true;
      harness.close();
    }
  }

  @Test
  void subscribeFailuresBackOffThenReconnectWhilePolling() {
    Harness harness =
        Harness.open(LinkFixtures.subscribed("plc", 1_000, 60_000, 20, 500), 2_000);
    try {
      harness.driver.subscribeEnabled = true;
      harness.driver.failSubscribe = true;
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("a", 4, Quality.GOOD)));
      harness.start();
      harness.until(
          () ->
              harness.driver.subscribes.get() >= 1
                  && harness.supervisor.points().get("a").quality() == Quality.GOOD);
      assertEquals(ConnectionState.RUNNING, harness.supervisor.state());
      int reads = harness.driver.reads.get();
      harness.clock.advance(1_000);
      harness.until(() -> harness.driver.subscribes.get() >= 2);
      harness.until(() -> harness.driver.reads.get() > reads);
      assertEquals(ConnectionState.RUNNING, harness.supervisor.state());
      assertTrue(harness.driver.subscribeAt.get(1) - harness.driver.subscribeAt.get(0) >= 1_000);
      harness.clock.advance(2_000);
      harness.until(() -> harness.driver.subscribes.get() >= 3);
      assertTrue(harness.driver.subscribeAt.get(2) - harness.driver.subscribeAt.get(1) >= 2_000);
      assertEquals(ConnectionState.RUNNING, harness.supervisor.state());
      harness.clock.advance(4_000);
      harness.until(() -> harness.supervisor.state() == ConnectionState.RECONNECTING);
      assertEquals(4, harness.driver.subscribes.get());
      assertTrue(harness.driver.subscribeAt.get(3) - harness.driver.subscribeAt.get(2) >= 4_000);
      assertTrue(subscribeError(harness));
    } finally {
      harness.close();
    }
  }

  private static void tickOnly(Harness harness) {
    harness.scheduler.requestTick();
    assertTrue(harness.scheduler.awaitTickDone(1_000), "tick hung");
  }

  private static boolean subscribeError(Harness harness) {
    synchronized (harness.logs) {
      for (com.webscada.server.comm.log.LogEvent event : harness.logs) {
        if ("subscribe_failed".equals(event.event()) && "ERROR".equals(event.level())) return true;
      }
    }
    return false;
  }

  private static long timeoutTotal(Harness harness) {
    return ((Number) harness.facade.snapshot("plc").get("timeout_total")).longValue();
  }

  @Test
  void stopFromTickThreadIsRejected() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 15_000, 60_000, 502), 2_000);
    try {
      harness.scheduler.enqueueOnTick(
          () ->
              assertThrows(
                  IllegalStateException.class, harness.supervisor::stop));
      assertTrue(harness.scheduler.awaitTickDone(1_000));
      assertEquals(ConnectionState.DISCONNECTED, harness.supervisor.state());
    } finally {
      harness.close();
    }
  }

  @Test
  void stopForceReleasesWhenIoDoesNotFinish() {
    Harness harness = Harness.open(LinkFixtures.modbus("plc", 15_000, 60_000, 502), 200);
    try {
      harness.start();
      harness.until(() -> harness.supervisor.state() == ConnectionState.RUNNING);
      harness.driver.disconnectBlockMs = 5_000;
      harness.driver.ignoreInterrupt = true;
      long started = System.nanoTime();
      harness.supervisor.stop();
      long elapsedMs = (System.nanoTime() - started) / 1_000_000;
      assertTrue(elapsedMs < 1_500, "elapsed=" + elapsedMs);
      assertEquals(ConnectionState.STOPPED, harness.supervisor.state());
      assertTrue(harness.logged("force_release"));
      assertEquals(502, harness.facade.snapshot("plc").get("activePort"));
    } finally {
      harness.driver.disconnectBlockMs = 0;
      harness.driver.ignoreInterrupt = false;
      harness.close();
    }
  }
}
