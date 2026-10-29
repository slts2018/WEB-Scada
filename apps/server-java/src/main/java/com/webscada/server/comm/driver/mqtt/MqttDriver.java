package com.webscada.server.comm.driver.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.MqttOptions;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

/**
 * MQTT 3.1.1。重连只走 Supervisor：这里显式关掉 Paho 自动重连。
 * 断线不清点缓存。{@code read} 固定返回空，避免用缓存快照刷新接收时间。
 */
public final class MqttDriver implements ProtocolDriver {
  private static final int DEDUP_LIMIT = 1024;
  private static final ObjectMapper JSON = new ObjectMapper();

  private volatile LinkDefinition link;
  private volatile MqttAsyncClient client;
  private volatile boolean broken;
  private volatile boolean closing;
  private volatile Consumer<IoResult> push;
  private volatile DriverContext bound;
  private final MqttDedup dataKeys = new MqttDedup(DEDUP_LIMIT);
  private final MqttDedup commandKeys = new MqttDedup(DEDUP_LIMIT);
  private final AtomicInteger duplicates = new AtomicInteger();
  private final AtomicInteger unkeyed = new AtomicInteger();
  private final AtomicInteger subscribes = new AtomicInteger();
  private final Object lock = new Object();

  public MqttDriver(LinkDefinition link) {
    this.link = link;
  }

  public void rebind(LinkDefinition link) {
    this.link = link;
  }

  /** QoS1 重复投递被丢掉的次数。 */
  public int duplicateCount() {
    return duplicates.get();
  }

  /** 没有 seq 也没有 ts、因此无法去重的消息数。值仍然写入。 */
  public int unkeyedCount() {
    return unkeyed.get();
  }

  public int subscribeCount() {
    return subscribes.get();
  }

  public boolean connectionLost() {
    return broken;
  }

  @Override
  public String name() {
    return "mqtt";
  }

  @Override
  public boolean supportsSubscription() {
    return !link.mqtt().topics().isEmpty();
  }

  @Override
  public long resyncIntervalMs(LinkDefinition ignored) {
    return 0L;
  }

  @Override
  public long silenceTimeoutMs(LinkDefinition ignored) {
    return 0L;
  }

  @Override
  public void connect(DriverContext ctx) throws CommException {
    bound = ctx;
    MqttOptions options = link.mqtt();
    if (options.brokerUrl().isBlank()) throw config("brokerUrl required");
    if (options.clientId().isBlank()) throw config("clientId required");
    MqttAsyncClient created;
    try {
      created = new MqttAsyncClient(options.brokerUrl(), options.clientId(), new MemoryPersistence());
    } catch (MqttException ex) {
      throw mapConnect(ex);
    }
    created.setCallback(callback());
    synchronized (lock) {
      closeQuiet(client);
      client = created;
      closing = false;
    }
    try {
      created.connect(connectOptions(ctx, options)).waitForCompletion(Math.max(1, ctx.connectTimeoutMs()));
    } catch (MqttException ex) {
      synchronized (lock) {
        closeQuiet(created);
        if (client == created) client = null;
      }
      throw mapConnect(ex);
    }
    broken = false;
    ctx.log()
        .info(
            "mqtt_session",
            "SESSION",
            "cleanSession=false automaticReconnect=false clientId=" + options.clientId(),
            null,
            null,
            ctx.sessionId(),
            ctx.correlationId());
  }

  @Override
  public void disconnect() {
    closing = true;
    push = null;
    synchronized (lock) {
      closeQuiet(client);
      client = null;
    }
    broken = false;
    closing = false;
  }

  @Override
  public Health healthCheck(DriverContext ctx) {
    if (broken) return Health.FAILED;
    MqttAsyncClient current = client;
    if (current == null || !current.isConnected()) return Health.FAILED;
    return Health.OK;
  }

  /** MQTT 没有读。空结果不会带上缓存里的点，接收时间也就不会被刷掉。 */
  @Override
  public IoResult read(DriverContext ctx, IoRequest request) {
    String correlation = request == null || request.correlationId() == null ? ctx.correlationId() : request.correlationId();
    return new IoResult(true, correlation, java.util.List.of(), null);
  }

  /**
   * 发到命令主题，QoS1，等到 PUBACK 才返回成功。
   * PUBACK 只表示 broker 已经收到命令，不表示设备已经执行。
   * 不会自动重发。{@code IoRequest.correlationId} 就是 idempotencyKey，重复的直接丢弃。
   */
  @Override
  public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
    if (request == null || request.pointId() == null || request.pointId().isBlank()) {
      throw config("pointId required");
    }
    String key = request.correlationId() == null ? "" : request.correlationId().trim();
    if (key.isEmpty()) throw config("idempotencyKey required");
    String topic = link.mqtt().commandTopic();
    if (topic.isBlank()) throw config("commandTopic required");
    ObjectNode body = JSON.createObjectNode();
    body.put("pointId", request.pointId());
    body.set("value", JSON.valueToTree(request.value()));
    body.put("ts", ctx.clock().millis());
    body.put("idempotencyKey", key);
    byte[] payload;
    try {
      payload = JSON.writeValueAsBytes(body);
    } catch (Exception ex) {
      throw config("command payload");
    }
    MqttMessage message = new MqttMessage(payload);
    message.setQos(1);
    message.setRetained(false);
    MqttAsyncClient current;
    synchronized (lock) {
      if (commandKeys.contains(key)) {
        ctx.log()
            .warn(
                "mqtt_command_duplicate",
                "WRITE",
                "dropped duplicate idempotencyKey",
                null,
                null,
                ctx.sessionId(),
                key);
        return new IoResult(true, key, java.util.List.of(), null);
      }
      current = client;
    }
    if (current == null || !current.isConnected()) {
      throw new CommException(ErrorCategory.CONNECT, true, true, "mqtt not connected");
    }
    try {
      current.publish(topic, message).waitForCompletion(Math.max(1, ctx.responseTimeoutMs()));
    } catch (MqttException ex) {
      throw mapPublish(ex);
    }
    commandKeys.add(key);
    return new IoResult(true, key, java.util.List.of(), null);
  }

  @Override
  public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException {
    subscribes.incrementAndGet();
    bound = ctx;
    push = callback;
    MqttOptions options = link.mqtt();
    if (options.topics().isEmpty()) throw config("topics required");
    MqttAsyncClient current = client;
    if (current == null || !current.isConnected()) {
      throw new CommException(ErrorCategory.CONNECT, true, true, "mqtt not connected");
    }
    String[] filters = new String[options.topics().size()];
    int[] qos = new int[options.topics().size()];
    for (int i = 0; i < options.topics().size(); i++) {
      filters[i] = options.topics().get(i).filter();
      qos[i] = options.topics().get(i).qos();
    }
    try {
      current.subscribe(filters, qos).waitForCompletion(Math.max(1, ctx.responseTimeoutMs()));
    } catch (MqttException ex) {
      throw new CommException(ErrorCategory.CONNECT, true, true, "mqtt subscribe failed", ex);
    }
    String[] subscribed = filters;
    return () -> {
      MqttAsyncClient live = client;
      if (live == null || !live.isConnected()) return;
      try {
        live.unsubscribe(subscribed).waitForCompletion(200);
      } catch (MqttException ignored) {
        // 断线后的退订失败不影响重连，下次 subscribe 会再订一遍。
      }
    };
  }

  private MqttCallback callback() {
    return new MqttCallback() {
      @Override
      public void connectionLost(Throwable cause) {
        if (!closing) broken = true;
      }

      @Override
      public void messageArrived(String topic, MqttMessage message) {
        DriverContext ctx = bound;
        Consumer<IoResult> listener = push;
        if (ctx == null || listener == null || message == null) return;
        byte[] payload = message.getPayload() == null ? new byte[0] : message.getPayload();
        try {
          MqttPayload.Batch batch =
              MqttPayload.decode(link, topic, payload, message.isRetained(), ctx.clock().millis());
          if (batch.dedupKey() != null && dataKeys.alreadySeen(batch.dedupKey())) {
            int count = duplicates.incrementAndGet();
            ctx.log()
                .info(
                    "mqtt_duplicate",
                    "DATA",
                    "dropped duplicate",
                    null,
                    count,
                    ctx.sessionId(),
                    ctx.correlationId());
            return;
          }
          if (batch.dedupKey() == null && batch.failureHex() == null && !batch.points().isEmpty()) {
            unkeyed.incrementAndGet();
          }
          if (batch.failureHex() != null) {
            ctx.log()
                .warn(
                    "mqtt_payload",
                    "CONFIG",
                    "hex=" + batch.failureHex(),
                    null,
                    null,
                    ctx.sessionId(),
                    ctx.correlationId());
          }
          if (batch.points().isEmpty()) return;
          listener.accept(new IoResult(true, ctx.correlationId(), batch.points(), null));
        } catch (RuntimeException ex) {
          ctx.log()
              .warn("mqtt_payload", "CONFIG", ex.toString(), null, null, ctx.sessionId(), ctx.correlationId());
        }
      }

      @Override
      public void deliveryComplete(IMqttDeliveryToken token) {}
    };
  }

  private MqttConnectOptions connectOptions(DriverContext ctx, MqttOptions options) throws CommException {
    MqttConnectOptions connect = new MqttConnectOptions();
    connect.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
    connect.setCleanSession(false);
    connect.setAutomaticReconnect(false);
    connect.setKeepAliveInterval(options.keepAliveSec());
    int seconds =
        (int) Math.min(Integer.MAX_VALUE, Math.max(1L, (ctx.connectTimeoutMs() + 999L) / 1000L));
    connect.setConnectionTimeout(seconds);
    if (!options.username().isBlank()) connect.setUserName(options.username());
    if (!options.password().isBlank()) connect.setPassword(options.password().toCharArray());
    if (options.willEnabled()) {
      connect.setWill(
          options.lwtTopic(),
          options.lwtPayload().getBytes(StandardCharsets.UTF_8),
          options.lwtQos(),
          options.lwtRetain());
    }
    if (options.brokerUrl().toLowerCase(Locale.ROOT).startsWith("ssl:")) {
      connect.setSocketFactory(MqttTls.factory(options));
    }
    return connect;
  }

  private static void closeQuiet(MqttAsyncClient current) {
    if (current == null) return;
    try {
      if (current.isConnected()) current.disconnect(200).waitForCompletion(500);
    } catch (MqttException ignored) {
      try {
        current.disconnectForcibly(200, 200);
      } catch (MqttException ignoredForce) {
        // 已经断了。
      }
    }
    try {
      current.close();
    } catch (MqttException ignored) {
      // 关闭失败不再抛，避免挡住重连。
    }
  }

  private static CommException mapConnect(MqttException ex) {
    int code = ex.getReasonCode();
    if (code == MqttException.REASON_CODE_FAILED_AUTHENTICATION
        || code == MqttException.REASON_CODE_NOT_AUTHORIZED) {
      return new CommException(ErrorCategory.AUTH, false, false, "mqtt auth rejected", ex);
    }
    if (code == MqttException.REASON_CODE_CLIENT_TIMEOUT || timedOut(ex)) {
      return new CommException(ErrorCategory.TIMEOUT, true, false, "mqtt connect timeout", ex);
    }
    if (code == MqttException.REASON_CODE_INVALID_CLIENT_ID) {
      return new CommException(ErrorCategory.CONFIG, false, false, "mqtt clientId rejected", ex);
    }
    return new CommException(ErrorCategory.CONNECT, true, true, "mqtt broker rejected", ex);
  }

  private static CommException mapPublish(MqttException ex) {
    if (ex.getReasonCode() == MqttException.REASON_CODE_CLIENT_TIMEOUT || timedOut(ex)) {
      return new CommException(ErrorCategory.TIMEOUT, true, false, "mqtt publish timeout", ex);
    }
    return new CommException(ErrorCategory.CONNECT, true, false, "mqtt publish failed", ex);
  }

  private static boolean timedOut(Throwable ex) {
    Throwable current = ex;
    while (current != null) {
      String message = current.getMessage() == null ? "" : current.getMessage().toLowerCase(Locale.ROOT);
      if (current instanceof java.net.SocketTimeoutException
          || message.contains("timeout")
          || message.contains("timed out")
          || message.contains("超时")) {
        return true;
      }
      current = current.getCause();
    }
    return false;
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }
}
