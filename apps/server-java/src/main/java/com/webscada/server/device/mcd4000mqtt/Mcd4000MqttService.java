package com.webscada.server.device.mcd4000mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.CommsEventLogService;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 独立的 MCD4000 MQTT 订阅采集，不启用 webscada.comm，也不走通用 mqtt / HTTP mcd4000。
 */
@Service
public class Mcd4000MqttService {
  private static final Logger log = LoggerFactory.getLogger(Mcd4000MqttService.class);

  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final DeviceStatusService linkStatus;
  private final CommsEventLogService commsLog;
  private final Mcd4000MqttPayloadParser parser;
  private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Boolean> lastOnline = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, String> lastOnlineDetail = new ConcurrentHashMap<>();
  private final AtomicBoolean busy = new AtomicBoolean(false);

  public Mcd4000MqttService(
      DeviceFileStore devices,
      TagRuntimeService runtime,
      DeviceStatusService linkStatus,
      CommsEventLogService commsLog,
      ObjectMapper mapper) {
    this.devices = devices;
    this.runtime = runtime;
    this.linkStatus = linkStatus;
    this.commsLog = commsLog;
    this.parser = new Mcd4000MqttPayloadParser(mapper);
  }

  @Scheduled(fixedDelay = 1000)
  public void reconcile() {
    if (!busy.compareAndSet(false, true)) return;
    try {
      doReconcile();
    } catch (Exception e) {
      log.warn("mcd4000_mqtt reconcile failed: {}", e.toString());
    } finally {
      busy.set(false);
    }
  }

  @PreDestroy
  public void shutdown() {
    for (String id : new ArrayList<>(sessions.keySet())) stopSession(id, false);
  }

  private void doReconcile() throws Exception {
    Map<String, DeviceMeta> wanted = new LinkedHashMap<>();
    for (DeviceMeta d : devices.list()) {
      if (d != null
          && d.enabled()
          && Mcd4000MqttChannel.PROTOCOL.equalsIgnoreCase(d.protocol())) {
        wanted.put(d.deviceId(), d);
      }
    }
    for (String id : new ArrayList<>(sessions.keySet())) {
      if (!wanted.containsKey(id)) stopSession(id, true);
    }
    for (DeviceMeta dev : wanted.values()) {
      Mcd4000MqttChannel ch = Mcd4000MqttChannel.parse(dev.channel());
      if (ch == null) {
        stopSession(dev.deviceId(), false);
        commsLog.rememberReason(dev.deviceId(), "通道无效");
        noteOnline(dev, false, "通道无效");
        linkStatus.report(dev.deviceId(), false, "offline", "通道无效");
        continue;
      }
      Session existing = sessions.get(dev.deviceId());
      if (existing != null && ch.fingerprint().equals(existing.fingerprint)) {
        continue;
      }
      if (existing != null) stopSession(dev.deviceId(), false);
      startSession(dev, ch);
    }
  }

  private void startSession(DeviceMeta dev, Mcd4000MqttChannel ch) {
    String clientId = ch.clientId(dev.deviceId());
    if (!clientId.startsWith(Mcd4000MqttChannel.CLIENT_ID_PREFIX)) {
      commsLog.rememberReason(dev.deviceId(), "Client ID 无效");
      noteOnline(dev, false, "Client ID 必须以 telegraf_ 开头");
      linkStatus.report(dev.deviceId(), false, "offline", "Client ID 无效");
      return;
    }
    MemoryPersistence persistence = new MemoryPersistence();
    MqttClient client;
    try {
      client = new MqttClient(ch.brokerUri(), clientId, persistence);
    } catch (MqttException e) {
      commsLog.rememberReason(dev.deviceId(), "连接失败");
      noteOnline(dev, false, "连接失败");
      linkStatus.report(dev.deviceId(), false, "offline", shortMsg(e));
      return;
    }
    Session session = new Session(dev.deviceId(), ch.fingerprint(), ch, client, clientId);
    client.setCallback(
        new MqttCallbackExtended() {
          @Override
          public void connectComplete(boolean reconnect, String serverURI) {
            try {
              client.subscribe(ch.topics(), ch.qos0());
              commsLog.rememberReason(dev.deviceId(), "已连接 Broker");
              noteOnline(dev, true, "已连接 Broker");
              linkStatus.report(dev.deviceId(), true, "online", "已连接 Broker " + ch.brokerUri());
            } catch (Exception e) {
              commsLog.rememberReason(dev.deviceId(), "订阅失败");
              noteOnline(dev, false, "订阅失败");
              linkStatus.report(dev.deviceId(), false, "offline", shortMsg(e));
            }
          }

          @Override
          public void connectionLost(Throwable cause) {
            commsLog.rememberReason(dev.deviceId(), "连接断开");
            noteOnline(dev, false, "连接断开");
            linkStatus.report(dev.deviceId(), false, "offline", "连接断开");
            markDeviceBad(dev.deviceId());
          }

          @Override
          public void messageArrived(String topic, MqttMessage message) {
            onMessage(dev, topic, message == null ? null : message.getPayload());
          }

          @Override
          public void deliveryComplete(IMqttDeliveryToken token) {}
        });
    MqttConnectOptions opts = connectOptions(ch);
    sessions.put(dev.deviceId(), session);
    try {
      client.connect(opts);
    } catch (MqttException e) {
      sessions.remove(dev.deviceId(), session);
      closeQuietly(client);
      commsLog.rememberReason(dev.deviceId(), "连接失败");
      noteOnline(dev, false, "连接失败");
      linkStatus.report(dev.deviceId(), false, "offline", shortMsg(e));
    }
  }

  public static MqttConnectOptions connectOptions(Mcd4000MqttChannel ch) {
    MqttConnectOptions opts = new MqttConnectOptions();
    opts.setAutomaticReconnect(true);
    opts.setCleanSession(true);
    opts.setConnectionTimeout(5);
    opts.setKeepAliveInterval(30);
    opts.setMaxInflight(100);
    if (ch.username() != null && !ch.username().isBlank()) {
      opts.setUserName(ch.username());
    }
    if (ch.password() != null && !ch.password().isEmpty()) {
      opts.setPassword(ch.password().toCharArray());
    }
    return opts;
  }

  private void onMessage(DeviceMeta dev, String topic, byte[] payload) {
    List<Mcd4000MqttPayloadParser.Point> points;
    try {
      points = parser.parse(topic, payload);
    } catch (Exception e) {
      log.warn("mcd4000_mqtt parse failed device={} topic={}: {}", dev.deviceId(), topic, e.toString());
      return;
    }
    if (points.isEmpty()) return;
    List<BoundTag> tags = boundTags(dev.deviceId());
    if (tags.isEmpty()) return;
    for (Mcd4000MqttPayloadParser.Point p : points) {
      for (BoundTag bt : tags) {
        if (!matches(bt.address, p)) continue;
        Object normalized = coerce(bt.meta.dataType(), p.value());
        String quality = "Good";
        if (normalized == COERCE_FAIL) {
          if (p.lastInGroup()) {
            runtime.setTagValue(bt.meta.tagId(), String.valueOf(p.value()), "Bad", p.timestampMs());
          }
          continue;
        }
        if (p.lastInGroup()) {
          runtime.setTagValue(bt.meta.tagId(), normalized, quality, p.timestampMs());
        } else {
          runtime.writeHistorySample(bt.meta.tagId(), normalized, quality, p.timestampMs());
        }
      }
    }
  }

  static boolean matches(String address, Mcd4000MqttPayloadParser.Point p) {
    if (address == null || address.isBlank() || p == null) return false;
    String addr = address.trim();
    if (addr.equals(p.address())) return true;
    if (p.devSn() != null && !p.devSn().isBlank()) {
      return addr.equals(p.devSn() + "|" + p.address());
    }
    return false;
  }

  private List<BoundTag> boundTags(String deviceId) {
    List<BoundTag> out = new ArrayList<>();
    for (TagMeta meta : runtime.getMetas()) {
      if (meta == null || !deviceId.equals(meta.deviceId())) continue;
      String addr = meta.address() == null ? "" : meta.address().trim();
      if (addr.isEmpty()) continue;
      out.add(new BoundTag(meta, addr));
    }
    return out;
  }

  private void markDeviceBad(String deviceId) {
    for (BoundTag bt : boundTags(deviceId)) {
      TagValue cur = runtime.getTagValue(bt.meta.tagId());
      Object v = cur != null ? cur.value() : fallback(bt.meta.dataType());
      runtime.setTagValue(bt.meta.tagId(), v, "Bad");
    }
  }

  private void stopSession(String deviceId, boolean markDisabled) {
    Session session = sessions.remove(deviceId);
    if (session != null) {
      try {
        if (session.client.isConnected()) session.client.disconnect();
      } catch (Exception ignored) {
      }
      closeQuietly(session.client);
    }
    lastOnline.remove(deviceId);
    lastOnlineDetail.remove(deviceId);
    if (markDisabled) {
      linkStatus.clear(deviceId);
    }
  }

  private void noteOnline(DeviceMeta dev, boolean online, String detail) {
    if (dev == null || dev.deviceId() == null) return;
    String id = dev.deviceId();
    String det = detail == null ? "" : detail;
    Boolean prev = lastOnline.put(id, online);
    String prevDet = lastOnlineDetail.put(id, det);
    if (prev != null && prev == online) {
      if (online) return;
      if (det.equals(prevDet == null ? "" : prevDet)) return;
    }
    commsLog.deviceOnlineChanged(id, online, detail, 0, false);
  }

  private static void closeQuietly(MqttClient client) {
    try {
      client.close();
    } catch (Exception ignored) {
    }
  }

  private static final Object COERCE_FAIL = new Object();

  static Object coerce(String dataType, Object raw) {
    if (raw == null) return COERCE_FAIL;
    return switch (dataType == null ? "float" : dataType) {
      case "bool" -> {
        if (raw instanceof Boolean b) yield b;
        if (raw instanceof Number n) yield n.doubleValue() != 0;
        String s = String.valueOf(raw).trim().toLowerCase();
        yield "true".equals(s) || "1".equals(s) || "on".equals(s);
      }
      case "int" -> {
        if (raw instanceof Number n) yield (int) Math.rint(n.doubleValue());
        try {
          yield (int) Math.rint(Double.parseDouble(String.valueOf(raw)));
        } catch (NumberFormatException e) {
          yield COERCE_FAIL;
        }
      }
      case "string" -> String.valueOf(raw);
      default -> {
        if (raw instanceof Number n) yield n.doubleValue();
        try {
          yield Double.parseDouble(String.valueOf(raw));
        } catch (NumberFormatException e) {
          yield COERCE_FAIL;
        }
      }
    };
  }

  private static Object fallback(String dataType) {
    return switch (dataType == null ? "float" : dataType) {
      case "bool" -> false;
      case "string" -> "";
      default -> 0;
    };
  }

  private static String shortMsg(Exception e) {
    String m = e.getMessage();
    if (m == null || m.isBlank()) return e.getClass().getSimpleName();
    if (m.length() > 180) return m.substring(0, 180) + "…";
    return m;
  }

  private record BoundTag(TagMeta meta, String address) {}

  private record Session(
      String deviceId,
      String fingerprint,
      Mcd4000MqttChannel channel,
      MqttClient client,
      String clientId) {}
}
