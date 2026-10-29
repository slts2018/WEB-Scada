package com.webscada.server.comm.driver.modbus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.log.LogEvent;
import com.webscada.server.comm.metrics.LinkStats;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ModbusTcpDriverTest {
  @Test
  void readsCoilsAndRegistersAndSplitsAt125() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setCoil(0, true);
      server.setDiscrete(1, true);
      server.setHolding(2, 0x1234);
      server.setInput(3, 0x00FF);
      for (int i = 0; i < 126; i++) server.setHolding(100 + i, i);
      List<DataPoint> points = new ArrayList<>();
      points.add(point("coil", 1, 0, "bool"));
      points.add(point("disc", 2, 1, "bool"));
      points.add(point("hold", 3, 2, "uint16"));
      points.add(point("in", 4, 3, "int16"));
      for (int i = 0; i < 126; i++) points.add(point("r" + i, 3, 100 + i, "uint16"));
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "0", points));
      DriverContext ctx = ctx(server.port(), 400);
      driver.connect(ctx);
      IoResult result = driver.read(ctx, new IoRequest("r", "*", null));
      assertEquals(true, value(result, "coil"));
      assertEquals(true, value(result, "disc"));
      assertEquals(0x1234, value(result, "hold"));
      assertEquals(255, value(result, "in"));
      assertEquals(125, value(result, "r125"));
      List<FakeModbusServer.Call> calls = server.calls();
      assertTrue(calls.stream().anyMatch(c -> c.function() == 3 && c.address() == 100 && c.count() == 125));
      assertTrue(calls.stream().anyMatch(c -> c.function() == 3 && c.address() == 225 && c.count() == 1));
      driver.disconnect();
      driver.disconnect();
    }
  }

  @Test
  void discardsMismatchedTransactionAndKeepsTheMatch() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setMode(FakeModbusServer.Mode.STICKY);
      server.setHolding(0, 7);
      LinkStats stats = new LinkStats();
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      DriverContext ctx = ctx(server.port(), stats, 400);
      driver.connect(ctx);
      assertEquals(7, value(driver.read(ctx, new IoRequest("r", "*", null)), "a"));
      assertEquals(1, stats.protocolErrors().sum());
      server.setMode(FakeModbusServer.Mode.BAD_TXN);
      server.setHolding(0, 8);
      assertEquals(8, value(driver.read(ctx, new IoRequest("r", "*", null)), "a"));
      assertEquals(2, stats.protocolErrors().sum());
      driver.disconnect();
    }
  }

  @Test
  void reassemblesHalfPacketsAndRejectsBadFrames() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setMode(FakeModbusServer.Mode.HALF);
      server.setHolding(0, 9);
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      DriverContext ctx = ctx(server.port(), 800);
      driver.connect(ctx);
      assertEquals(9, value(driver.read(ctx, new IoRequest("r", "*", null)), "a"));
      server.setMode(FakeModbusServer.Mode.BAD_PROTOCOL);
      CommException protocol = assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.PROTOCOL, protocol.category());
      server.setMode(FakeModbusServer.Mode.BAD_LENGTH);
      CommException length = assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.PROTOCOL, length.category());
      assertTrue(length.getMessage().contains("length"));
      driver.disconnect();
    }
  }

  @Test
  void mapsExceptionCodesAndRetriesGatewayOnce() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      List<LogEvent> logs = new ArrayList<>();
      DriverContext ctx = ctx(server.port(), logs, 400);
      driver.connect(ctx);
      for (int code : new int[] {0x02, 0x03}) {
        server.setMode(FakeModbusServer.Mode.EXCEPTION);
        server.setExceptionCode(code);
        int before = server.calls().size();
        CommException error = assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
        assertEquals(ErrorCategory.DEVICE, error.category());
        assertFalse(error.retryable());
        assertFalse(error.failoverAllowed());
        assertEquals(before + 1, server.calls().size());
      }
      server.setExceptionCode(0x0A);
      int before = server.calls().size();
      CommException gateway = assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
      assertTrue(gateway.retryable());
      assertFalse(gateway.failoverAllowed());
      assertTrue(gateway.getMessage().contains("网关/下游"));
      assertEquals(before + 2, server.calls().size());
      assertTrue(logs.stream().anyMatch(e -> e.detail() != null && e.detail().contains("网关/下游")));
      server.setExceptionCode(0x02);
      assertEquals(Health.OK, driver.healthCheck(ctx));
      driver.disconnect();
    }
  }

  @Test
  void timesOutAndNoticesADroppedSocket() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 1, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      DriverContext ctx = ctx(server.port(), 150);
      driver.connect(ctx);
      server.setMode(FakeModbusServer.Mode.SILENT);
      long started = System.nanoTime();
      CommException timeout = assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
      long elapsed = (System.nanoTime() - started) / 1_000_000L;
      assertEquals(ErrorCategory.TIMEOUT, timeout.category());
      assertTrue(timeout.retryable());
      assertFalse(timeout.failoverAllowed());
      assertEquals(2, server.calls().size());
      assertTrue(elapsed < 1200, "elapsed=" + elapsed);
      driver.disconnect();
      ModbusTcpDriver droppedDriver =
          new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      droppedDriver.connect(ctx);
      server.setMode(FakeModbusServer.Mode.DROP);
      CommException dropped =
          assertThrows(CommException.class, () -> droppedDriver.read(ctx, new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.CONNECT, dropped.category());
      droppedDriver.disconnect();
    }
  }

  @Test
  void writesSingleAndMultipleAndReadBackRetry() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 1);
      List<LogEvent> logs = new ArrayList<>();
      ModbusTcpDriver driver =
          new ModbusTcpDriver(
              definition(
                  server.port(),
                  0,
                  1,
                  "0",
                  List.of(
                      point("coil", 1, 0, "bool"),
                      point("reg", 3, 0, "uint16"),
                      point("wide", 3, 2, "int32"))));
      DriverContext ctx = ctx(server.port(), logs, 400);
      driver.connect(ctx);
      driver.write(ctx, new IoRequest("w", "coil", true));
      assertEquals(true, value(driver.read(ctx, new IoRequest("r", "coil", null)), "coil"));
      server.setSkipApplies(1);
      driver.write(ctx, new IoRequest("w", "reg", 7));
      assertEquals(7, value(driver.read(ctx, new IoRequest("r", "reg", null)), "reg"));
      assertTrue(logs.stream().anyMatch(e -> "write_retry".equals(e.event()) && e.detail().contains("可能重复")));
      driver.write(ctx, new IoRequest("w", "wide", 0x12345678));
      assertEquals(0x12345678, value(driver.read(ctx, new IoRequest("r", "wide", null)), "wide"));
      driver.disconnect();
      byte[] coils = Pdu.writeCoils(4, 2, new byte[] {0x03});
      try (MbapClient direct = open(server.port())) {
        direct.exchange(1, coils, ctx);
        byte[] bits = Pdu.parseRead(1, 2, direct.exchange(1, Pdu.readRequest(1, 4, 2), ctx));
        assertEquals(0x03, bits[0] & 0x03);
        byte[] rw = Pdu.readWrite(0, 1, 1, 1, new byte[] {0x00, 0x2A});
        byte[] read = Pdu.parseRead(23, 1, direct.exchange(1, rw, ctx));
        assertEquals(7, Bytes.u16(read, 0));
        assertEquals(0x2A, server.holding(1));
      }
    }
  }

  @Test
  void uses40001AddressAndRejectsNanOnTheWire() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setHolding(0, 4);
      server.setHolding(10, 0x7FC0);
      server.setHolding(11, 0x0000);
      DataPoint scaled = new DataPoint("s", 3, 40001, "uint16", "low-first", "big", 0.1, 1, null, null, null, null, null, null);
      // 40001 是 PDU 0。低字在前对单字没有影响。
      DataPoint nan = new DataPoint("n", 3, 10, "float32", "high-first", "big", 1, 0, null, null, null, null, null, null);
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "40001", List.of(scaled)));
      List<LogEvent> logs = new ArrayList<>();
      DriverContext ctx = ctx(server.port(), logs, 400);
      driver.connect(ctx);
      assertEquals(1.4d, ((Number) value(driver.read(ctx, new IoRequest("r", "*", null)), "s")).doubleValue(), 1e-9);
      assertEquals(0, server.calls().get(0).address());
      driver.disconnect();
      ModbusTcpDriver nanDriver =
          new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(nan)));
      nanDriver.connect(ctx);
      IoResult result = nanDriver.read(ctx, new IoRequest("r", "*", null));
      IoResult.PointUpdate update = result.points().get(0);
      assertNull(update.value());
      assertEquals(Quality.BAD_CONFIG, update.quality());
      assertTrue(logs.stream().anyMatch(e -> e.detail() != null && e.detail().contains("7FC0")));
      nanDriver.disconnect();
    }
  }

  @Test
  void assertsASingleInFlightRequest() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      server.setMode(FakeModbusServer.Mode.SILENT);
      server.resetSeen();
      ModbusTcpDriver driver = new ModbusTcpDriver(definition(server.port(), 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
      DriverContext ctx = ctx(server.port(), 800);
      driver.connect(ctx);
      AtomicReference<Throwable> first = new AtomicReference<>();
      Thread worker =
          new Thread(
              () -> {
                try {
                  driver.read(ctx, new IoRequest("r", "*", null));
                } catch (Throwable ex) {
                  first.set(ex);
                }
              });
      worker.start();
      assertTrue(server.seen().await(2, java.util.concurrent.TimeUnit.SECONDS));
      assertThrows(IllegalStateException.class, () -> driver.read(ctx, new IoRequest("r2", "*", null)));
      server.dropClients();
      worker.join(2000);
      assertTrue(first.get() instanceof CommException);
      driver.disconnect();
    }
  }

  @Test
  void float32ScaleReadBackComparesRawRegisters() throws Exception {
    try (FakeModbusServer server = new FakeModbusServer()) {
      List<LogEvent> logs = new ArrayList<>();
      DataPoint flow = new DataPoint("flow", 3, 0, "float32", "high-first", "big", 0.1, 0, null, null, null, null, null, null);
      ModbusTcpDriver driver =
          new ModbusTcpDriver(definition(server.port(), 0, 1, "0", List.of(flow)));
      DriverContext ctx = ctx(server.port(), logs, 400);
      driver.connect(ctx);
      driver.write(ctx, new IoRequest("w", "flow", 12345.678));
      long writes = server.calls().stream().filter(call -> call.function() == 16).count();
      assertEquals(1, writes);
      assertTrue(logs.stream().noneMatch(event -> "write_retry".equals(event.event())));
      driver.disconnect();
    }
  }

  @Test
  void connectFailureAllowsFailover() throws Exception {
    int port;
    try (java.net.ServerSocket closed = new java.net.ServerSocket(0)) {
      port = closed.getLocalPort();
    }
    ModbusTcpDriver driver = new ModbusTcpDriver(definition(port, 0, 0, "0", List.of(point("a", 3, 0, "uint16"))));
    DriverContext ctx =
        new DriverContext(
            "plc",
            "s",
            "c",
            new LinkDefinition.Endpoint("127.0.0.1", port),
            800,
            200,
            new LinkLog("plc", "dev", "modbus-tcp", Clock.systemUTC(), (e, json) -> {}),
            new LinkStats(),
            Clock.systemUTC());
    CommException error = assertThrows(CommException.class, () -> driver.connect(ctx));
    assertEquals(ErrorCategory.CONNECT, error.category());
    assertTrue(error.failoverAllowed());
  }

  private static MbapClient open(int port) throws CommException {
    MbapClient client = new MbapClient();
    client.connect("127.0.0.1", port, 800);
    return client;
  }

  private static Object value(IoResult result, String id) {
    for (IoResult.PointUpdate update : result.points()) {
      if (id.equals(update.pointId())) return update.value();
    }
    throw new AssertionError("missing " + id);
  }

  private static DataPoint point(String id, int fc, int address, String type) {
    return new DataPoint(id, fc, address, type, "high-first", "big", 1, 0, null, null, null, null, null, null);
  }

  private static DriverContext ctx(int port, int responseMs) {
    return ctx(port, new LinkStats(), new ArrayList<>(), responseMs);
  }

  private static DriverContext ctx(int port, LinkStats stats, int responseMs) {
    return ctx(port, stats, new ArrayList<>(), responseMs);
  }

  private static DriverContext ctx(int port, List<LogEvent> logs, int responseMs) {
    return ctx(port, new LinkStats(), logs, responseMs);
  }

  private static DriverContext ctx(int port, LinkStats stats, List<LogEvent> logs, int responseMs) {
    return new DriverContext(
        "plc",
        "session",
        "corr",
        new LinkDefinition.Endpoint("127.0.0.1", port),
        800,
        responseMs,
        new LinkLog("plc", "dev", "modbus-tcp", Clock.systemUTC(), (event, json) -> logs.add(event)),
        stats,
        Clock.systemUTC());
  }

  private static LinkDefinition definition(
      int port, int readRetries, int writeRetries, String addressBase, List<DataPoint> points) {
    List<String> ids = new ArrayList<>();
    for (DataPoint point : points) ids.add(point.id());
    return new LinkDefinition(
        "plc",
        "dev",
        "modbus-tcp",
        true,
        List.of(new LinkDefinition.Endpoint("127.0.0.1", port)),
        "",
        800,
        800,
        400,
        60000,
        readRetries,
        writeRetries,
        200,
        2000,
        0,
        5,
        5,
        60000,
        60000,
        60000,
        ids,
        1,
        addressBase,
        3,
        "40001".equals(addressBase) ? 40001 : 0,
        1,
        points,
        1000,
        3,
        null,
        null,
        null);
  }
}
