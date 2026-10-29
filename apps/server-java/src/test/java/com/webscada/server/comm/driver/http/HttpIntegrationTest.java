package com.webscada.server.comm.driver.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.CommFacade;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.HttpOptions;
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
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.supervisor.LinkIoPool;
import com.webscada.server.comm.supervisor.LinkScheduler;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import com.webscada.server.comm.support.MutableClock;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

class HttpIntegrationTest {
  private static final long SOURCE_TS = 1_700_000_000_000L;
  private static final String VALUES =
      "{\"ts\":1700000000000,\"sensors\":{\"temp\":12.5},\"flow\":3}";

  @Test
  void oneGetReadsEveryPointOnTheSamePath() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver = driver(stub, options(stub, "none", 1_048_576, "", "/write", "POST"), 1_000);
      driver.connect(context(stub, 1_000, stub.logs, stub.stats));
      IoResult result =
          driver.read(
              context(stub, 1_000, stub.logs, stub.stats),
              new IoRequest("read-1", "*", null));
      assertEquals(1, stub.hits("/values"));
      assertEquals(12.5d, number(result, "temp"));
      assertEquals(7d, number(result, "flow"));
      assertEquals(SOURCE_TS, update(result, "temp").sourceTs());
      assertEquals(Quality.BAD_CONFIG, update(result, "gap").quality());
      assertEquals(null, update(result, "gap").value());
    }
  }

  @Test
  void unauthorizedOnceRefreshesASingleToken() throws Exception {
    assertTimeoutPreemptively(Duration.ofSeconds(8), () -> {
      try (Stub stub = Stub.open()) {
        stub.oauth = true;
        HttpDriver driver = oauth(stub, 1_000);
        driver.connect(context(stub, 1_000, stub.logs, stub.stats));
        IoResult result = driver.read(context(stub, 1_000, stub.logs, stub.stats), new IoRequest("r", "*", null));
        assertEquals(12.5d, number(result, "temp"));
        assertEquals(2, stub.tokens.get(), "initial fetch plus one refresh");
        assertEquals(2, stub.hits("/values"));
      }
    });
  }

  @Test
  void concurrentReadsShareOneRefresh() throws Exception {
    assertTimeoutPreemptively(Duration.ofSeconds(15), () -> {
      try (Stub stub = Stub.open()) {
        stub.oauth = true;
        stub.holdFirst = new CountDownLatch(1);
        stub.holdSecond = new CountDownLatch(1);
        HttpDriver driver = oauth(stub, 1_000);
        DriverContext ctx = context(stub, 1_000, stub.logs, stub.stats);
        driver.connect(ctx);
        ExecutorService pool = Executors.newFixedThreadPool(3);
        CountDownLatch done = new CountDownLatch(3);
        AtomicReference<Throwable> error = new AtomicReference<>();
        try {
          for (int i = 0; i < 3; i++) {
            pool.submit(() -> {
              try {
                IoResult result = driver.read(ctx, new IoRequest("r", "*", null));
                if (!(number(result, "temp") == 12.5d)) {
                  throw new AssertionError("temp " + number(result, "temp"));
                }
              } catch (Throwable ex) {
                error.compareAndSet(null, ex);
              } finally {
                done.countDown();
              }
            });
          }
          assertTrue(stub.firstEntered.await(3, TimeUnit.SECONDS));
          Thread.sleep(100);
          assertEquals(1, stub.tokens.get());
          stub.holdFirst.countDown();
          assertTrue(stub.secondEntered.await(3, TimeUnit.SECONDS));
          Thread.sleep(150);
          assertEquals(2, stub.tokens.get());
          stub.holdSecond.countDown();
          assertTrue(done.await(5, TimeUnit.SECONDS));
        } finally {
          stub.release();
          pool.shutdownNow();
        }
        if (error.get() != null) throw new AssertionError(error.get());
        assertEquals(2, stub.tokens.get());
        assertEquals(6, stub.hits("/values"));
      }
    });
  }

  @Test
  void secondUnauthorizedIsAuthAndDoesNotFailOver() throws Exception {
    try (Stub stub = Stub.open()) {
      stub.oauth = true;
      stub.rejectAll = true;
      HttpDriver driver = oauth(stub, 1_000);
      driver.connect(context(stub, 1_000, stub.logs, stub.stats));
      CommException ex =
          assertThrows(
              CommException.class,
              () -> driver.read(context(stub, 1_000, stub.logs, stub.stats), new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.AUTH, ex.category());
      assertFalse(ex.retryable());
      assertFalse(ex.failoverAllowed());
      assertEquals(2, stub.tokens.get());
      assertEquals(2, stub.hits("/values"));
    }
  }

  @Test
  void notFoundIsConfig() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver =
          driver(stub, options(stub, "none", 1_048_576, "", "/write", "POST"), 1_000, point("temp", "/missing", "temp", "double", 1, 0));
      driver.connect(context(stub, 1_000, stub.logs, stub.stats));
      CommException ex =
          assertThrows(
              CommException.class,
              () -> driver.read(context(stub, 1_000, stub.logs, stub.stats), new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.CONFIG, ex.category());
      assertFalse(ex.failoverAllowed());
      assertEquals(1, stub.hits("/missing"));
    }
  }

  @Test
  void serverErrorAndRateLimitDoNotRetry() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver =
          driver(stub, options(stub, "none", 1_048_576, "", "/write", "POST"), 1_000, point("temp", "/boom", "temp", "double", 1, 0));
      DriverContext ctx = context(stub, 1_000, stub.logs, stub.stats);
      driver.connect(ctx);
      CommException server =
          assertThrows(CommException.class, () -> driver.read(ctx, new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.DEVICE, server.category());
      assertTrue(server.retryable());
      assertFalse(server.failoverAllowed());
      assertEquals(1, stub.hits("/boom"));
      assertEquals(1, stub.stats.protocolErrors().sum());
      assertEquals(0, stub.stats.rateLimited().sum());

      HttpDriver limited =
          driver(stub, options(stub, "none", 1_048_576, "", "/write", "POST"), 1_000, point("temp", "/limited", "temp", "double", 1, 0));
      LinkStats stats = new LinkStats();
      List<LogEvent> logs = new ArrayList<>();
      DriverContext limitCtx = context(stub, 1_000, logs, stats);
      limited.connect(limitCtx);
      CommException rate =
          assertThrows(CommException.class, () -> limited.read(limitCtx, new IoRequest("r", "*", null)));
      assertEquals(ErrorCategory.DEVICE, rate.category());
      assertTrue(rate.retryable());
      assertFalse(rate.failoverAllowed());
      assertEquals(1, stub.hits("/limited"));
      assertEquals(1, stats.rateLimited().sum());
      assertEquals(0, stats.protocolErrors().sum());
      assertTrue(logs.stream().anyMatch(event -> event.detail() != null && event.detail().contains("Retry-After=12")));
    }
  }

  @Test
  void oversizedBodyFailsWithoutBufferingIt() throws Exception {
    assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
      try (Stub stub = Stub.open()) {
        HttpDriver driver =
            driver(stub, options(stub, "none", 128, "", "/write", "POST"), 2_000, point("temp", "/huge", "temp", "double", 1, 0));
        driver.connect(context(stub, 2_000, stub.logs, stub.stats));
        CommException ex =
            assertThrows(
                CommException.class,
                () -> driver.read(context(stub, 2_000, stub.logs, stub.stats), new IoRequest("r", "*", null)));
        assertEquals(ErrorCategory.CONFIG, ex.category());
        assertTrue(ex.getMessage().contains("maxResponseBytes"));
      }
    });
  }

  @Test
  void illegalJsonIsBadConfigWithHexPrefix() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver =
          driver(
              stub,
              options(stub, "none", 1_048_576, "", "/write", "POST"),
              1_000,
              point("temp", "/bad", "temp", "double", 1, 0),
              point("flow", "/bad", "flow", "double", 1, 0));
      List<LogEvent> logs = new ArrayList<>();
      DriverContext ctx = context(stub, 1_000, logs, stub.stats);
      driver.connect(ctx);
      IoResult result = driver.read(ctx, new IoRequest("r", "*", null));
      assertEquals(Quality.BAD_CONFIG, update(result, "temp").quality());
      assertEquals(Quality.BAD_CONFIG, update(result, "flow").quality());
      assertEquals(null, update(result, "temp").value());
      assertTrue(logs.stream().anyMatch(event -> event.detail() != null && event.detail().contains("6E6F742D6A736F6E")));
      assertTrue(logs.stream().anyMatch(event -> "CONFIG".equals(event.code())));
    }
  }

  @Test
  void slowResponseIsTimeout() throws Exception {
    assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
      try (Stub stub = Stub.open()) {
        HttpDriver driver =
            driver(stub, options(stub, "none", 1_048_576, "", "/write", "POST"), 300, point("temp", "/slow", "temp", "double", 1, 0));
        driver.connect(context(stub, 300, stub.logs, stub.stats));
        CommException ex =
            assertThrows(
                CommException.class,
                () -> driver.read(context(stub, 300, stub.logs, stub.stats), new IoRequest("r", "*", null)));
        assertEquals(ErrorCategory.TIMEOUT, ex.category());
        assertFalse(ex.failoverAllowed());
      }
    });
  }

  @Test
  void writeSendsIdempotencyKeyAndRejectsABlankOne() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver = driver(stub, options(stub, "none", 1_048_576, "", "/write", "PUT"), 1_000);
      driver.connect(context(stub, 1_000, stub.logs, stub.stats));
      driver.write(context(stub, 1_000, stub.logs, stub.stats), new IoRequest("abc-1", "temp", 4));
      assertEquals("PUT", stub.method.get());
      assertEquals("abc-1", stub.idempotency.get());
      assertTrue(stub.body.get().contains("\"pointId\":\"temp\""));
      assertEquals(1, stub.hits("/write"));
      CommException ex =
          assertThrows(
              CommException.class,
              () -> driver.write(context(stub, 1_000, stub.logs, stub.stats), new IoRequest("  ", "temp", 4)));
      assertEquals(ErrorCategory.CONFIG, ex.category());
      assertEquals(1, stub.hits("/write"));
    }
  }

  @Test
  void healthUsesItsOwnGetAndAuthIsNotADrop() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver = driver(stub, options(stub, "bearer", 1_048_576, "/health", "/write", "POST"), 1_000);
      DriverContext ctx = context(stub, 1_000, stub.logs, stub.stats);
      driver.connect(ctx);
      driver.read(ctx, new IoRequest("r", "*", null));
      assertEquals(Health.OK, driver.healthCheck(ctx));
      assertEquals(1, stub.hits("/health"));
      assertEquals(1, stub.hits("/values"));
      stub.healthStatus = 401;
      assertEquals(Health.FAILED, driver.healthCheck(ctx));
      assertTrue(stub.logs.stream().anyMatch(event -> "AUTH".equals(event.code())));
      assertEquals(2, stub.hits("/health"));
    }
  }

  @Test
  void repeatedHealthChecksReuseOneTcpConnection() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver =
          driver(
              stub,
              options(stub, "none", 1_048_576, "/health", "/write", "POST"),
              1_000,
              point("temp", "/values", "sensors.temp", "double", 1, 0));
      DriverContext ctx = context(stub, 1_000, stub.logs, stub.stats);
      driver.connect(ctx);
      assertEquals(Health.OK, driver.healthCheck(ctx));
      assertEquals(Health.OK, driver.healthCheck(ctx));
      assertEquals(2, stub.hits("/health"));
      assertEquals(1, stub.peers.size(), "accept count");
    }
  }

  @Test
  void oldPayloadTimestampIsStale() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpDriver driver =
          driver(
              stub,
              options(stub, "none", 1_048_576, "", "/write", "POST"),
              1_000,
              point("temp", "/values", "sensors.temp", "double", 1, 0));
      DriverContext ctx =
          new DriverContext(
              "api",
              "session",
              "corr",
              new LinkDefinition.Endpoint("127.0.0.1", stub.port),
              1_000,
              1_000,
              new LinkLog("api", "dev", "http", Clock.systemUTC(), (event, json) -> stub.logs.add(event)),
              stub.stats,
              Clock.fixed(Instant.ofEpochMilli(SOURCE_TS + 60_000), ZoneOffset.UTC));
      driver.connect(ctx);
      IoResult result = driver.read(ctx, new IoRequest("r", "*", null));
      assertEquals(Quality.STALE, update(result, "temp").quality());
      assertEquals(12.5d, number(result, "temp"));
      assertEquals(SOURCE_TS, update(result, "temp").sourceTs());
    }
  }

  @Test
  void healthNotFoundLogsOnceAndDoesNotReconnect() throws Exception {
    try (Stub stub = Stub.open()) {
      HttpOptions http = options(stub, "none", 1_048_576, "/missing", "/write", "POST");
      LinkDefinition link =
          definition(
              stub,
              http,
              1_000,
              1_000,
              60_000,
              point("temp", "/values", "sensors.temp", "double", 1, 0));
      HttpDriver driver = new HttpDriver(link);
      MutableClock clock = new MutableClock();
      LinkScheduler.ManualScheduler scheduler = new LinkScheduler.ManualScheduler();
      LinkIoPool io = new LinkIoPool();
      List<LogEvent> logs = java.util.Collections.synchronizedList(new ArrayList<>());
      CommFacade facade =
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
      try {
        LinkSupervisor supervisor = facade.supervisor("api");
        supervisor.start();
        until(
            scheduler,
            io,
            () -> {
              var sample = supervisor.points().get("temp");
              return sample != null && sample.quality() == Quality.GOOD;
            });
        for (int i = 0; i < 4; i++) {
          clock.advance(1_000);
          tick(scheduler, io);
        }
        tick(scheduler, io);
        assertEquals(ConnectionState.RUNNING, supervisor.state());
        assertEquals(0L, supervisor.stats().reconnectTotal().sum());
        assertTrue(stub.hits("/missing") >= 3, "health checks=" + stub.hits("/missing"));
        assertEquals(1, logs.stream().filter(event -> "ERROR".equals(event.level())).count());
        assertEquals(1, logs.stream().filter(event -> "health_config".equals(event.event())).count());
        assertEquals(1L, supervisor.stats().decodeErrors().sum());
      } finally {
        facade.close();
        io.close();
        scheduler.close();
      }
    }
  }

  private static void tick(LinkScheduler.ManualScheduler scheduler, LinkIoPool io) {
    scheduler.requestTick();
    assertTrue(scheduler.awaitTickDone(3_000), "tick hung");
    assertTrue(io.awaitQuiet(3_000), "io hung");
  }

  private static void until(
      LinkScheduler.ManualScheduler scheduler, LinkIoPool io, BooleanSupplier cond) {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
    while (!cond.getAsBoolean()) {
      if (System.nanoTime() > end) throw new AssertionError("supervisor did not become ready");
      tick(scheduler, io);
    }
  }

  private static HttpDriver oauth(Stub stub, int responseMs) {
    HttpOptions options =
        new HttpOptions(
            stub.base(),
            "oauth2",
            "",
            "",
            "",
            stub.base() + "/oauth/token",
            "scada",
            "secret",
            "read",
            Map.of(),
            "",
            0,
            "",
            "",
            "",
            1_048_576,
            "",
            "/write",
            "POST",
            "ts");
    return driver(stub, options, responseMs);
  }

  private static HttpOptions options(
      Stub stub, String auth, int maxBytes, String health, String writePath, String writeMethod) {
    return new HttpOptions(
        stub.base(),
        auth,
        "",
        "",
        "bearer".equals(auth) ? "static-token" : "",
        "",
        "",
        "",
        "",
        Map.of(),
        "",
        0,
        "",
        "",
        "",
        maxBytes,
        health,
        writePath,
        writeMethod,
        "ts");
  }

  private static HttpDriver driver(Stub stub, HttpOptions options, int responseMs, DataPoint... points) {
    DataPoint[] used =
        points.length == 0
            ? new DataPoint[] {
              point("temp", "/values", "sensors.temp", "double", 1, 0),
              point("flow", "/values", "flow", "double", 2, 1),
              point("gap", "/values", "missing", "double", 1, 0)
            }
            : points;
    return new HttpDriver(definition(stub, options, responseMs, used));
  }

  private static LinkDefinition definition(Stub stub, HttpOptions options, int responseMs, DataPoint... points) {
    return definition(stub, options, responseMs, 60_000, 1_000, points);
  }

  private static LinkDefinition definition(
      Stub stub, HttpOptions options, int responseMs, int heartbeat, int poll, DataPoint... points) {
    List<String> ids = new ArrayList<>();
    for (DataPoint point : points) ids.add(point.id());
    return new LinkDefinition(
        "api",
        "dev",
        "http",
        true,
        List.of(new LinkDefinition.Endpoint("127.0.0.1", stub.port)),
        "",
        1_000,
        1_000,
        responseMs,
        heartbeat,
        0,
        0,
        1_000,
        60_000,
        0,
        5,
        5,
        30_000,
        60_000,
        60_000,
        ids,
        1,
        "0",
        3,
        0,
        1,
        List.of(points),
        poll,
        3,
        null,
        null,
        options);
  }

  private static DataPoint point(
      String id, String path, String jsonPath, String type, double scale, double offset) {
    return new DataPoint(id, 0, 0, type, "high-first", "big", scale, offset, null, "", "", jsonPath, path, null);
  }

  private static DriverContext context(Stub stub, int responseMs, List<LogEvent> logs, LinkStats stats) {
    return new DriverContext(
        "api",
        "session",
        "corr",
        new LinkDefinition.Endpoint("127.0.0.1", stub.port),
        1_000,
        responseMs,
        new LinkLog("api", "dev", "http", Clock.systemUTC(), (event, json) -> logs.add(event)),
        stats,
        Clock.fixed(Instant.ofEpochMilli(5_000), ZoneOffset.UTC));
  }

  private static IoResult.PointUpdate update(IoResult result, String id) {
    for (IoResult.PointUpdate update : result.points()) {
      if (id.equals(update.pointId())) return update;
    }
    throw new AssertionError("missing " + id);
  }

  private static double number(IoResult result, String id) {
    Object value = update(result, id).value();
    assertTrue(value instanceof Number, String.valueOf(value));
    return ((Number) value).doubleValue();
  }

  private static final class Stub implements AutoCloseable {
    final int port;
    final HttpServer server;
    final ExecutorService pool;
    final LinkStats stats = new LinkStats();
    final List<LogEvent> logs = new ArrayList<>();
    final AtomicInteger tokens = new AtomicInteger();
    final Map<String, AtomicInteger> hits = new ConcurrentHashMap<>();
    final AtomicReference<String> idempotency = new AtomicReference<>();
    final AtomicReference<String> method = new AtomicReference<>();
    final AtomicReference<String> body = new AtomicReference<>("");
    final Set<Integer> peers = ConcurrentHashMap.newKeySet();
    volatile boolean oauth;
    volatile boolean rejectAll;
    volatile int healthStatus = 200;
    volatile CountDownLatch holdFirst;
    volatile CountDownLatch holdSecond;
    final CountDownLatch firstEntered = new CountDownLatch(1);
    final CountDownLatch secondEntered = new CountDownLatch(1);

    private Stub(HttpServer server, ExecutorService pool) {
      this.server = server;
      this.pool = pool;
      this.port = server.getAddress().getPort();
    }

    static Stub open() throws IOException {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      ExecutorService pool =
          Executors.newCachedThreadPool(
              task -> {
                Thread thread = new Thread(task, "http-test");
                thread.setDaemon(true);
                return thread;
              });
      Stub stub = new Stub(server, pool);
      server.createContext("/", stub::handle);
      server.setExecutor(pool);
      server.start();
      return stub;
    }

    String base() {
      return "http://127.0.0.1:" + port;
    }

    int hits(String path) {
      AtomicInteger count = hits.get(path);
      return count == null ? 0 : count.get();
    }

    void release() {
      if (holdFirst != null) holdFirst.countDown();
      if (holdSecond != null) holdSecond.countDown();
    }

    private void handle(HttpExchange exchange) throws IOException {
      byte[] request;
      try (InputStream in = exchange.getRequestBody()) {
        request = in.readAllBytes();
      }
      String path = exchange.getRequestURI().getPath();
      InetSocketAddress remote = exchange.getRemoteAddress();
      if (remote != null) peers.add(remote.getPort());
      hits.computeIfAbsent(path, key -> new AtomicInteger()).incrementAndGet();
      try {
        if ("/oauth/token".equals(path)) {
          int n = tokens.incrementAndGet();
          if (n == 1 && holdFirst != null) {
            firstEntered.countDown();
            holdFirst.await(5, TimeUnit.SECONDS);
          }
          if (n == 2 && holdSecond != null) {
            secondEntered.countDown();
            holdSecond.await(5, TimeUnit.SECONDS);
          }
          text(exchange, 200, "{\"access_token\":\"tok-" + n + "\",\"expires_in\":3600}");
          return;
        }
        if (oauth && !allowed(exchange)) {
          text(exchange, 401, "");
          return;
        }
        if ("/values".equals(path)) {
          text(exchange, 200, VALUES);
          return;
        }
        if ("/missing".equals(path)) {
          text(exchange, 404, "");
          return;
        }
        if ("/boom".equals(path)) {
          text(exchange, 500, "down");
          return;
        }
        if ("/limited".equals(path)) {
          exchange.getResponseHeaders().add("Retry-After", "12");
          text(exchange, 429, "");
          return;
        }
        if ("/bad".equals(path)) {
          text(exchange, 200, "not-json");
          return;
        }
        if ("/huge".equals(path)) {
          int size = 1_048_576;
          exchange.sendResponseHeaders(200, size);
          try (OutputStream out = exchange.getResponseBody()) {
            byte[] chunk = new byte[4096];
            int left = size;
            while (left > 0) {
              int n = Math.min(chunk.length, left);
              out.write(chunk, 0, n);
              left -= n;
            }
          }
          return;
        }
        if ("/slow".equals(path)) {
          Thread.sleep(2_000);
          text(exchange, 200, VALUES);
          return;
        }
        if ("/health".equals(path)) {
          text(exchange, healthStatus, "ok");
          return;
        }
        if ("/write".equals(path)) {
          method.set(exchange.getRequestMethod());
          idempotency.set(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
          body.set(new String(request, StandardCharsets.UTF_8));
          text(exchange, 200, "{}");
          return;
        }
        text(exchange, 404, "");
      } catch (InterruptedException ex) {
        Thread.currentThread().interrupt();
      }
    }

    private boolean allowed(HttpExchange exchange) {
      if (rejectAll) return false;
      return "Bearer tok-2".equals(exchange.getRequestHeaders().getFirst("Authorization"));
    }

    private static void text(HttpExchange exchange, int status, String body) throws IOException {
      byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(status, bytes.length);
      try (OutputStream out = exchange.getResponseBody()) {
        out.write(bytes);
      }
    }

    @Override
    public void close() {
      release();
      server.stop(0);
      pool.shutdownNow();
    }
  }
}
