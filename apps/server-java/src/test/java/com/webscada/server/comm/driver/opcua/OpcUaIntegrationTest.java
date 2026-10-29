package com.webscada.server.comm.driver.opcua;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.OpcUaOptions;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.log.LogEvent;
import com.webscada.server.comm.metrics.LinkStats;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.supervisor.LinkIoPool;
import com.webscada.server.comm.supervisor.LinkScheduler;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import com.webscada.server.comm.support.MutableClock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class OpcUaIntegrationTest {
  @Test
  void readsWritesAndReconnectsAgainstTheTestServer() throws Exception {
    try (OpcUaTestServer server = new OpcUaTestServer()) {
      int ns = server.namespaceIndex();
      DataPoint temp = point("temp", "ns=" + ns + ";s=temp", 1, 0);
      DataPoint flow = point("flow", "ns=" + ns + ";s=flow", 1, 0);
      DataPoint missing = point("gone", "ns=" + ns + ";s=missing", 1, 0);
      Rig rig = Rig.open(server, false, 500, 600_000, 60_000, 20, 1_000, temp, flow, missing);
      try {
        rig.start();
        rig.until(() -> rig.quality("temp") == Quality.GOOD && rig.quality("flow") == Quality.GOOD);
        assertEquals(1.25d, (Double) rig.value("temp"), 0.0001);
        assertEquals(2.5d, (Double) rig.value("flow"), 0.0001);
        assertEquals(Quality.BAD_CONFIG, rig.quality("gone"));
        IoResult written = rig.driver.write(rig.writeContext(server), new IoRequest("w", "temp", 7.5d));
        assertTrue(written.ok());
        int before = rig.reads.get();
        server.stop();
        rig.clock.advance(500);
        rig.until(() -> rig.supervisor.state() == ConnectionState.DEGRADED);
        rig.clock.advance(250);
        rig.tick();
        rig.clock.advance(250);
        rig.until(() -> rig.supervisor.state() == ConnectionState.RECONNECTING);
        server.start();
        rig.clock.advance(5_000);
        rig.until(() -> rig.quality("temp") == Quality.GOOD && rig.reads.get() > before);
        assertEquals(7.5d, (Double) rig.value("temp"), 0.0001);
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void subscriptionPushesChangesAndResyncsOnItsOwnInterval() throws Exception {
    try (OpcUaTestServer server = new OpcUaTestServer()) {
      int ns = server.namespaceIndex();
      DataPoint temp = point("temp", "ns=" + ns + ";s=temp", 1, 0);
      Rig rig = Rig.open(server, true, 60_000, 1_000, 5_000, 50, 200, temp);
      try {
        rig.start();
        rig.until(() -> rig.quality("temp") == Quality.GOOD);
        int afterAlign = rig.reads.get();
        server.setTemp(9.5d);
        rig.until(() -> rig.value("temp") instanceof Double value && Math.abs(value - 9.5d) < 0.0001);
        rig.clock.advance(1_000);
        rig.tick();
        assertEquals(afterAlign, rig.reads.get());
        rig.clock.advance(5_000);
        rig.until(() -> rig.reads.get() > afterAlign);
        rig.clock.advance(50L * 200L * 2L);
        rig.until(() -> rig.logged("subscription_silent"));
      } finally {
        rig.close();
      }
    }
  }

  private static DataPoint point(String id, String nodeId, double scale, double offset) {
    return new DataPoint(id, 0, 0, "double", "high-first", "big", scale, offset, null, nodeId, null, null, null, null);
  }

  private static final class Rig implements AutoCloseable {
    final MutableClock clock = new MutableClock();
    final LinkScheduler.ManualScheduler scheduler = new LinkScheduler.ManualScheduler();
    final LinkIoPool io = new LinkIoPool();
    final List<LogEvent> logs = Collections.synchronizedList(new ArrayList<>());
    final CountingDriver driver;
    final CommFacade facade;
    final LinkSupervisor supervisor;
    final AtomicInteger reads;

    private Rig(LinkDefinition link) {
      driver = new CountingDriver(new OpcUaDriver(link));
      reads = driver.reads;
      facade =
          new CommFacade(
              scheduler,
              io,
              clock,
              2_000,
              32,
              List.of(link),
              driver,
              () -> 0.5,
              false,
              (event, json) -> logs.add(event));
      supervisor = facade.supervisor(link.id());
    }

    static Rig open(
        OpcUaTestServer server,
        boolean subscribe,
        int heartbeatMs,
        int pollMs,
        int resyncMs,
        int keepAlive,
        int publishingMs,
        DataPoint... points) {
      return new Rig(link(server, subscribe, heartbeatMs, pollMs, resyncMs, keepAlive, publishingMs, points));
    }

    void tick() {
      scheduler.requestTick();
      assertTrue(scheduler.awaitTickDone(3_000), "tick hung");
      assertTrue(io.awaitQuiet(3_000), "io hung");
    }

    DriverContext writeContext(OpcUaTestServer server) {
      return new DriverContext(
          "ua",
          "s",
          "w",
          new LinkDefinition.Endpoint("127.0.0.1", server.port()),
          2_000,
          1_000,
          new LinkLog("ua", "dev", "opcua", clock, (event, json) -> {}),
          new LinkStats(),
          clock);
    }

    void start() {
      supervisor.start();
    }

    void until(BooleanSupplier cond) {
      long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(12);
      while (!cond.getAsBoolean()) {
        if (System.nanoTime() > end) {
          throw new AssertionError("timeout state=" + supervisor.state() + " reads pending");
        }
        scheduler.requestTick();
        assertTrue(scheduler.awaitTickDone(3_000), "tick hung");
        assertTrue(io.awaitQuiet(3_000), "io hung");
      }
    }

    boolean logged(String event) {
      synchronized (logs) {
        for (LogEvent e : logs) {
          if (event.equals(e.event())) return true;
        }
      }
      return false;
    }

    Quality quality(String id) {
      if (supervisor.points().get(id) == null) return null;
      return supervisor.points().get(id).quality();
    }

    Object value(String id) {
      return supervisor.points().get(id).value();
    }

    @Override
    public void close() {
      facade.close();
    }

    private static LinkDefinition link(
        OpcUaTestServer server,
        boolean subscribe,
        int heartbeatMs,
        int pollMs,
        int resyncMs,
        int keepAlive,
        int publishingMs,
        DataPoint... points) {
      List<String> ids = new ArrayList<>();
      for (DataPoint point : points) ids.add(point.id());
      OpcUaOptions options =
          new OpcUaOptions(
              "",
              "None",
              "None",
              "",
              "",
              "",
              60_000,
              publishingMs,
              keepAlive,
              keepAlive * 3,
              0,
              10,
              100,
              0,
              subscribe,
              resyncMs,
              "",
              256);
      return new LinkDefinition(
          "ua",
          "dev",
          "opcua",
          true,
          List.of(new LinkDefinition.Endpoint("127.0.0.1", server.port())),
          server.endpointUrl(),
          2_000,
          2_000,
          1_000,
          heartbeatMs,
          0,
          0,
          300,
          5_000,
          0,
          5,
          5,
          60_000,
          60_000,
          60_000,
          ids,
          1,
          "0",
          3,
          0,
          1,
          List.of(points),
          pollMs,
          3,
          options,
          null,
          null);
    }
  }

  private static final class CountingDriver implements ProtocolDriver {
    final OpcUaDriver delegate;
    final AtomicInteger reads = new AtomicInteger();

    CountingDriver(OpcUaDriver delegate) {
      this.delegate = delegate;
    }

    @Override
    public String name() {
      return delegate.name();
    }

    @Override
    public boolean supportsSubscription() {
      return delegate.supportsSubscription();
    }

    @Override
    public long resyncIntervalMs(com.webscada.server.comm.config.LinkDefinition link) {
      return delegate.resyncIntervalMs(link);
    }

    @Override
    public long silenceTimeoutMs(com.webscada.server.comm.config.LinkDefinition link) {
      return delegate.silenceTimeoutMs(link);
    }

    @Override
    public int notificationQueueSize(com.webscada.server.comm.config.LinkDefinition link) {
      return delegate.notificationQueueSize(link);
    }

    @Override
    public void connect(DriverContext ctx) throws CommException {
      delegate.connect(ctx);
    }

    @Override
    public void disconnect() {
      delegate.disconnect();
    }

    @Override
    public Health healthCheck(DriverContext ctx) throws CommException {
      return delegate.healthCheck(ctx);
    }

    @Override
    public IoResult read(DriverContext ctx, IoRequest request) throws CommException {
      reads.incrementAndGet();
      return delegate.read(ctx, request);
    }

    @Override
    public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
      return delegate.write(ctx, request);
    }

    @Override
    public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
        throws CommException {
      return delegate.subscribe(ctx, request, callback);
    }
  }
}
