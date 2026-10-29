package com.webscada.server.comm.driver.modbus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.log.LogEvent;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.supervisor.LinkIoPool;
import com.webscada.server.comm.supervisor.LinkScheduler;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import com.webscada.server.comm.support.MutableClock;
import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

class ModbusIntegrationTest {
  @Test
  void linkRunsThenReconnectsAndReadsAgain() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 0x1234);
      Rig rig = Rig.open(server.port(), point("temp", 3, 0, "uint16"));
      try {
        rig.start();
        rig.until(() -> rig.quality("temp") == Quality.GOOD);
        assertEquals(0x1234, rig.value("temp"));
        assertEquals(ConnectionState.RUNNING, rig.supervisor.state());
        int accepts = server.accepts();
        server.dropClients();
        rig.clock.advance(500);
        rig.until(() -> rig.supervisor.state() == ConnectionState.DEGRADED);
        rig.clock.advance(500);
        rig.pump();
        rig.clock.advance(500);
        rig.until(() -> rig.supervisor.state() == ConnectionState.RECONNECTING);
        rig.clock.advance(2_000);
        rig.until(() -> rig.quality("temp") == Quality.GOOD && server.accepts() > accepts);
        assertEquals(0x1234, rig.value("temp"));
        assertEquals(server.port(), rig.supervisor.activeEndpoint().port());
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void deviceExceptionDoesNotReconnect() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setMode(FakeModbusServer.Mode.EXCEPTION);
      server.setExceptionCode(0x02);
      server.passProbe(0, 1);
      server.setHolding(0, 1);
      Rig rig = Rig.open(server.port(), point("temp", 3, 10, "uint16"));
      try {
        rig.start();
        rig.until(() -> rig.supervisor.state() == ConnectionState.RUNNING && server.calls().size() >= 1);
        assertEquals(1, server.accepts());
        assertEquals(Quality.BAD_COMM_FAILURE, rig.quality("temp"));
        rig.clock.advance(5_000);
        rig.until(() -> server.calls().size() >= 2);
        assertEquals(ConnectionState.RUNNING, rig.supervisor.state());
        assertEquals(1, server.accepts());
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void periodicReadsContinueWithoutReconnect() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 9);
      Rig rig = Rig.open(server.port(), 60_000, 1_000, point("temp", 3, 0, "uint16"));
      try {
        rig.start();
        rig.until(() -> rig.quality("temp") == Quality.GOOD);
        assertTrue(fc3(server) >= 1);
        rig.clock.advance(1_000);
        rig.until(() -> fc3(server) >= 2);
        rig.pump();
        rig.clock.advance(1_000);
        rig.until(() -> fc3(server) >= 3);
        assertEquals(1, server.accepts());
        assertEquals(ConnectionState.RUNNING, rig.supervisor.state());
        assertEquals(9, rig.value("temp"));
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void decodeFailureIsStoredAsBadConfig() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 0x7FC0);
      server.setHolding(1, 0);
      server.setHolding(2, 42);
      DataPoint raw = new DataPoint("raw", 3, 0, "float32", "high-first", "big", 1, 0, null, null, null, null, null, null);
      Rig rig = Rig.open(server.port(), 60_000, 60_000, raw, point("temp", 3, 2, "uint16"));
      try {
        rig.start();
        rig.until(() -> rig.quality("raw") == Quality.BAD_CONFIG && rig.quality("temp") == Quality.GOOD);
        assertNull(rig.value("raw"));
        assertEquals(42, rig.value("temp"));
        assertEquals(ConnectionState.RUNNING, rig.supervisor.state());
        assertTrue(((Number) rig.facade.snapshot("plc").get("last_success_ts")).longValue() > 0);
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void supervisorMovesToTheBackupPort() throws Exception {
    int refused;
    try (ServerSocket closed = new ServerSocket(0)) {
      refused = closed.getLocalPort();
    }
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 5);
      Rig rig = Rig.open(refused, server.port(), point("temp", 3, 0, "uint16"));
      try {
        rig.start();
        rig.until(() -> rig.reconnects() >= 1);
        assertEquals(refused, rig.supervisor.activeEndpoint().port());
        rig.clock.advance(300);
        rig.until(() -> rig.reconnects() >= 2);
        assertEquals(refused, rig.supervisor.activeEndpoint().port());
        rig.clock.advance(600);
        rig.until(() -> rig.reconnects() >= 3);
        assertEquals(server.port(), rig.supervisor.activeEndpoint().port());
        rig.clock.advance(1_200);
        rig.until(() -> rig.quality("temp") == Quality.GOOD);
        assertEquals(5, rig.value("temp"));
        assertEquals(server.port(), rig.facade.snapshot("plc").get("activePort"));
      } finally {
        rig.close();
      }
    }
  }

  private static int fc3(FakeModbusServer server) {
    int n = 0;
    for (FakeModbusServer.Call call : server.calls()) {
      if (call.function() == 3) n++;
    }
    return n;
  }

  private static DataPoint point(String id, int fc, int address, String type) {
    return new DataPoint(id, fc, address, type, "high-first", "big", 1, 0, null, null, null, null, null, null);
  }

  private static final class Rig implements AutoCloseable {
    final MutableClock clock = new MutableClock();
    final LinkScheduler.ManualScheduler scheduler = new LinkScheduler.ManualScheduler();
    final LinkIoPool io = new LinkIoPool();
    final CommFacade facade;
    final LinkSupervisor supervisor;

    private Rig(LinkDefinition link) {
      facade =
          new CommFacade(
              scheduler,
              io,
              clock,
              2_000,
              32,
              List.of(link),
              new ModbusTcpDriver(link),
              () -> 0.5,
              false,
              (LogEvent event, String json) -> {});
      supervisor = facade.supervisor(link.id());
    }

    static Rig open(int port, DataPoint point) {
      return open(port, 500, 60_000, point);
    }

    static Rig open(int port, int heartbeatMs, int pollMs, DataPoint... points) {
      return new Rig(link(List.of(endpoint(port)), heartbeatMs, pollMs, points));
    }

    static Rig open(int refused, int live, DataPoint point) {
      return new Rig(link(List.of(endpoint(refused), endpoint(live)), 500, 60_000, point));
    }

    long reconnects() {
      return ((Number) facade.snapshot("plc").get("reconnect_total")).longValue();
    }

    void start() {
      supervisor.start();
    }

    void pump() {
      for (int i = 0; i < 4; i++) {
        scheduler.requestTick();
        assertTrue(scheduler.awaitTickDone(2_000), "tick hung");
        assertTrue(io.awaitQuiet(2_000), "io hung");
      }
    }

    void until(BooleanSupplier cond) {
      long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
      while (!cond.getAsBoolean()) {
        if (System.nanoTime() > end) {
          throw new AssertionError("timeout state=" + supervisor.state());
        }
        scheduler.requestTick();
        assertTrue(scheduler.awaitTickDone(2_000), "tick hung");
        assertTrue(io.awaitQuiet(2_000), "io hung");
      }
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

    private static LinkDefinition.Endpoint endpoint(int port) {
      return new LinkDefinition.Endpoint("127.0.0.1", port);
    }

    private static LinkDefinition link(
        List<LinkDefinition.Endpoint> endpoints, int heartbeatMs, int pollMs, DataPoint... points) {
      List<String> ids = new ArrayList<>();
      for (DataPoint point : points) ids.add(point.id());
      return new LinkDefinition(
          "plc",
          "dev",
          "modbus-tcp",
          true,
          endpoints,
          "",
          800,
          800,
          300,
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
          null,
          null,
          null);
    }
  }
}
