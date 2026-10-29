package com.webscada.server.comm.driver.mqtt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.MqttOptions;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
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
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.Test;

class MqttIntegrationTest {
  @Test
  void connectMapsPasswordRejectAndTimeout() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      MqttDriver driver = driver(broker.port, "conn");
      driver.connect(context(broker.port, 2_000));
      assertEquals(Health.OK, driver.healthCheck(context(broker.port, 2_000)));
      driver.disconnect();
    }
    try (MqttBroker broker = MqttBroker.password("scada", "secret")) {
      MqttDriver driver = driver(broker.port, "auth", "scada", "wrong");
      CommException ex = assertThrows(CommException.class, () -> driver.connect(context(broker.port, 2_000)));
      assertEquals(ErrorCategory.AUTH, ex.category(), ex.getMessage());
    }
    try (ServerSocket reject = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
      Thread thread = new Thread(() -> refuse(reject), "mqtt-reject");
      thread.setDaemon(true);
      thread.start();
      MqttDriver driver = driver(reject.getLocalPort(), "reject");
      CommException ex =
          assertThrows(CommException.class, () -> driver.connect(context(reject.getLocalPort(), 2_000)));
      assertEquals(ErrorCategory.CONNECT, ex.category(), ex.getMessage());
    }
    try (ServerSocket blackhole = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
      AtomicReference<Socket> held = new AtomicReference<>();
      Thread thread =
          new Thread(
              () -> {
                try {
                  held.set(blackhole.accept());
                  Thread.sleep(10_000);
                } catch (Exception ignored) {
                  // 超时用例主动关掉。
                }
              },
              "mqtt-blackhole");
      thread.setDaemon(true);
      thread.start();
      try {
        MqttDriver driver = driver(blackhole.getLocalPort(), "slow");
        CommException ex =
            assertThrows(CommException.class, () -> driver.connect(context(blackhole.getLocalPort(), 1_000)));
        assertEquals(ErrorCategory.TIMEOUT, ex.category(), ex.getMessage());
      } finally {
        Socket socket = held.get();
        if (socket != null) socket.close();
      }
    }
  }

  @Test
  void resubscribesAfterCleanSessionReconnect() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      Rig rig = Rig.open(broker.port, "session", 1_000, 60_000, 60_000);
      try {
        rig.start();
        rig.until(() -> rig.supervisor.state() == ConnectionState.RUNNING && rig.driver.subscribeCount() == 1);
        kick(broker.url, rig.driverClientId());
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!rig.driver.connectionLost() && System.nanoTime() < end) Thread.sleep(20);
        assertTrue(rig.driver.connectionLost(), "connectionLost did not fire");
        for (int i = 0; i < 8 && rig.supervisor.state() != ConnectionState.RECONNECTING; i++) {
          rig.clock.advance(1_000);
          rig.tick();
        }
        assertEquals(ConnectionState.RECONNECTING, rig.supervisor.state());
        rig.clock.advance(1_000);
        rig.until(() -> rig.supervisor.state() == ConnectionState.RUNNING && rig.driver.subscribeCount() >= 2);
        publish(broker.url, "pub-session", "plant/session/data", "{\"value\":9,\"seq\":2}", 1, false);
        rig.until(() -> rig.value("temp") instanceof Number n && n.doubleValue() == 9d);
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void duplicateQos1UpdatesOnce() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      Rig rig = Rig.open(broker.port, "dedup", 60_000, 60_000, 60_000);
      try {
        rig.start();
        rig.until(() -> rig.supervisor.state() == ConnectionState.RUNNING);
        publish(broker.url, "pub-dedup", "plant/dedup/data", "{\"value\":11,\"seq\":7,\"ts\":1700000000000}", 1, false);
        rig.until(() -> rig.value("temp") instanceof Number n && n.doubleValue() == 11d);
        publish(broker.url, "pub-dedup-2", "plant/dedup/data", "{\"value\":22,\"seq\":7,\"ts\":1700000000000}", 1, false);
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (rig.driver.duplicateCount() < 1 && System.nanoTime() < end) {
          rig.tick();
          Thread.sleep(20);
        }
        assertEquals(1, rig.driver.duplicateCount());
        assertEquals(11d, ((Number) rig.value("temp")).doubleValue());
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void retainedOldTimestampLandsStale() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      Rig rig = Rig.open(broker.port, "retain", 60_000, 1_000, 15_000);
      long ts = rig.clock.millis() - 600_000L;
      publish(
          broker.url,
          "pub-retain",
          "plant/retain/data",
          "{\"value\":3.5,\"ts\":" + ts + ",\"quality\":\"Good\",\"seq\":1}",
          1,
          true);
      try {
        rig.start();
        rig.until(() -> rig.quality("temp") == Quality.STALE);
        assertEquals(Quality.STALE, rig.quality("temp"));
        assertEquals(ts, rig.supervisor.points().get("temp").sourceTs());
      } finally {
        rig.close();
      }
    }
  }

  @Test
  void sameIdempotencyKeyIsPublishedOnce() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      MqttDriver driver = driver(broker.port, "cmd");
      AtomicInteger got = new AtomicInteger();
      AtomicReference<String> body = new AtomicReference<>("");
      try (MqttClient watch = new MqttClient(broker.url, "watch-cmd", new MemoryPersistence())) {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setAutomaticReconnect(false);
        watch.setCallback(
            new MqttCallback() {
              @Override
              public void connectionLost(Throwable cause) {}

              @Override
              public void messageArrived(String topic, MqttMessage message) {
                body.set(new String(message.getPayload(), StandardCharsets.UTF_8));
                got.incrementAndGet();
              }

              @Override
              public void deliveryComplete(IMqttDeliveryToken token) {}
            });
        watch.connect(options);
        watch.subscribe("plant/cmd/cmd", 1);
        driver.connect(context(broker.port, 2_000));
        driver.write(context(broker.port, 2_000), new IoRequest("cmd-1", "temp", 4));
        driver.write(context(broker.port, 2_000), new IoRequest("cmd-1", "temp", 4));
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (got.get() < 1 && System.nanoTime() < end) Thread.sleep(20);
        Thread.sleep(300);
        assertEquals(1, got.get());
        assertTrue(body.get().contains("\"idempotencyKey\":\"cmd-1\""));
        assertTrue(body.get().contains("\"pointId\":\"temp\""));
        driver.disconnect();
        watch.disconnect();
      }
    }
  }

  @Test
  void quietTopicDoesNotRebuildSubscription() throws Exception {
    try (MqttBroker broker = MqttBroker.open()) {
      Rig rig = Rig.open(broker.port, "quiet", 120_000, 1_000, 60_000);
      try {
        rig.start();
        rig.until(() -> rig.supervisor.state() == ConnectionState.RUNNING && rig.driver.subscribeCount() == 1);
        assertEquals(0L, rig.driver.resyncIntervalMs(rig.link));
        assertEquals(0L, rig.driver.silenceTimeoutMs(rig.link));
        rig.clock.advance(60_000);
        rig.tick();
        assertEquals(1, rig.driver.subscribeCount());
        assertFalse(rig.logged("subscription_silent"));
      } finally {
        rig.close();
      }
    }
  }

  private static void refuse(ServerSocket server) {
    try (Socket socket = server.accept()) {
      socket.setSoTimeout(500);
      try {
        socket.getInputStream().readNBytes(256);
      } catch (Exception ignored) {
        // CONNECT 比 256 字节短，读超时后直接回 CONNACK。
      }
      OutputStream out = socket.getOutputStream();
      out.write(new byte[] {0x20, 0x02, 0x00, 0x03});
      out.flush();
      Thread.sleep(200);
    } catch (Exception ignored) {
      // 客户端已经按拒绝处理。
    }
  }

  private static void kick(String url, String clientId) throws Exception {
    try (MqttClient kicker = new MqttClient(url, clientId, new MemoryPersistence())) {
      MqttConnectOptions options = new MqttConnectOptions();
      options.setCleanSession(true);
      options.setAutomaticReconnect(false);
      options.setConnectionTimeout(3);
      kicker.connect(options);
      kicker.disconnect();
    }
  }

  private static void publish(String url, String clientId, String topic, String json, int qos, boolean retained)
      throws Exception {
    try (MqttClient pub = new MqttClient(url, clientId, new MemoryPersistence())) {
      MqttConnectOptions options = new MqttConnectOptions();
      options.setCleanSession(true);
      options.setAutomaticReconnect(false);
      options.setConnectionTimeout(3);
      pub.connect(options);
      MqttMessage message = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
      message.setQos(qos);
      message.setRetained(retained);
      pub.publish(topic, message);
      pub.disconnect();
    }
  }

  private static MqttDriver driver(int port, String device) {
    return driver(port, device, "", "");
  }

  private static MqttDriver driver(int port, String device, String username, String password) {
    return new MqttDriver(definition(port, device, 60_000, 60_000, 60_000, username, password));
  }

  private static DriverContext context(int port, int connectTimeoutMs) {
    MutableClock clock = new MutableClock();
    return new DriverContext(
        "plc",
        "session",
        "corr",
        new LinkDefinition.Endpoint("127.0.0.1", port),
        connectTimeoutMs,
        2_000,
        new LinkLog("plc", "dev", "mqtt", clock, (event, json) -> {}),
        new LinkStats(),
        clock);
  }

  @Test
  void sameTimestampDifferentPayloadIsNotOneKey() {
    LinkDefinition link = definition(1, "hash", 60_000, 1_000, 60_000, "", "");
    byte[] first = "{\"value\":1,\"ts\":10}".getBytes(StandardCharsets.UTF_8);
    byte[] second = "{\"value\":2,\"ts\":10}".getBytes(StandardCharsets.UTF_8);
    MqttPayload.Batch a = MqttPayload.decode(link, "plant/hash/data", first, false, 10_000);
    MqttPayload.Batch b = MqttPayload.decode(link, "plant/hash/data", second, false, 10_000);
    assertNotEquals(a.dedupKey(), b.dedupKey());
    assertTrue(a.dedupKey().startsWith("plant/hash/data|10|"));
    byte[] sequenced = "{\"value\":1,\"ts\":10,\"seq\":7}".getBytes(StandardCharsets.UTF_8);
    assertEquals(
        "plant/hash/data|seq:7",
        MqttPayload.decode(link, "plant/hash/data", sequenced, false, 10_000).dedupKey());
  }

  private static LinkDefinition definition(
      int port, String device, int heartbeat, int poll, int stale, String username, String password) {
    MqttOptions mqtt =
        new MqttOptions(
            "tcp://127.0.0.1:" + port,
            "scada",
            "plant",
            "scada-plant-" + device,
            username,
            password,
            false,
            30,
            "",
            "",
            0,
            false,
            "",
            "",
            "",
            List.of(new MqttOptions.Topic("plant/" + device + "/data", 1)),
            "json",
            "value",
            "ts",
            "quality",
            "seq",
            "plant/" + device + "/cmd");
    DataPoint point =
        new DataPoint("temp", 0, 0, "double", "high-first", "big", 1, 0, null, "", "plant/" + device + "/data", "", "", null);
    return new LinkDefinition(
        device,
        device,
        "mqtt",
        true,
        List.of(new LinkDefinition.Endpoint("127.0.0.1", port)),
        "",
        2_000,
        2_000,
        2_000,
        heartbeat,
        0,
        0,
        1_000,
        60_000,
        0,
        5,
        5,
        30_000,
        stale,
        60_000,
        List.of("temp"),
        1,
        "0",
        3,
        0,
        1,
        List.of(point),
        poll,
        3,
        null,
        mqtt,
        null);
  }

  private static final class Rig implements AutoCloseable {
    final MutableClock clock = new MutableClock();
    final LinkScheduler.ManualScheduler scheduler = new LinkScheduler.ManualScheduler();
    final LinkIoPool io = new LinkIoPool();
    final List<LogEvent> logs = Collections.synchronizedList(new ArrayList<>());
    final LinkDefinition link;
    final MqttDriver driver;
    final CommFacade facade;
    final LinkSupervisor supervisor;

    private Rig(int port, String device, int heartbeat, int poll, int stale) {
      link = definition(port, device, heartbeat, poll, stale, "", "");
      driver = new MqttDriver(link);
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
      supervisor = facade.supervisor(device);
    }

    static Rig open(int port, String device, int heartbeat, int poll, int stale) {
      return new Rig(port, device, heartbeat, poll, stale);
    }

    String driverClientId() {
      return link.mqtt().clientId();
    }

    void start() {
      supervisor.start();
    }

    void tick() {
      scheduler.requestTick();
      assertTrue(scheduler.awaitTickDone(3_000), "tick hung");
      assertTrue(io.awaitQuiet(3_000), "io hung");
    }

    void until(BooleanSupplier cond) {
      long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(12);
      while (!cond.getAsBoolean()) {
        if (System.nanoTime() > end) {
          throw new AssertionError(
              "timeout state="
                  + supervisor.state()
                  + " subs="
                  + driver.subscribeCount()
                  + " sample="
                  + supervisor.points().get("temp")
                  + " logs="
                  + logs);
        }
        tick();
      }
    }

    boolean logged(String event) {
      synchronized (logs) {
        for (LogEvent item : logs) {
          if (event.equals(item.event())) return true;
        }
      }
      return false;
    }

    Quality quality(String id) {
      if (supervisor.points().get(id) == null) return null;
      return supervisor.points().get(id).quality();
    }

    Object value(String id) {
      if (supervisor.points().get(id) == null) return null;
      return supervisor.points().get(id).value();
    }

    @Override
    public void close() {
      facade.close();
      io.close();
    }
  }
}
