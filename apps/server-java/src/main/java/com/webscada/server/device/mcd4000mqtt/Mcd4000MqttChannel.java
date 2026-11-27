package com.webscada.server.device.mcd4000mqtt;

/**
 * channel = host:port|gatewaySn 或 host:port|gatewaySn|username|password
 * 主题按 telegraf：sys/&lt;gatewaySn&gt;/up|upfast|passthrough（无前导斜杠），QoS 0。
 */
public record Mcd4000MqttChannel(
    String host, int port, String gatewaySn, String username, String password) {

  public static final String PROTOCOL = "mcd4000_mqtt";
  public static final String CLIENT_ID_PREFIX = "telegraf_";

  public static Mcd4000MqttChannel parse(String channel) {
    if (channel == null || channel.isBlank()) return null;
    String[] parts = channel.split("\\|", -1);
    String broker = parts[0].trim();
    if (broker.isEmpty()) return null;
    String host;
    int port = 1883;
    int colon = broker.lastIndexOf(':');
    if (colon > 0 && colon < broker.length() - 1) {
      host = broker.substring(0, colon).trim();
      try {
        port = Integer.parseInt(broker.substring(colon + 1).trim());
      } catch (NumberFormatException e) {
        return null;
      }
    } else {
      host = broker;
    }
    if (host.isEmpty() || port < 1 || port > 65535) return null;
    String gatewaySn = parts.length > 1 ? parts[1].trim() : "";
    if (gatewaySn.isEmpty()) return null;
    String username = parts.length > 2 ? parts[2].trim() : "";
    String password;
    if (parts.length <= 3) {
      password = "";
    } else {
      StringBuilder sb = new StringBuilder();
      for (int i = 3; i < parts.length; i++) {
        if (i > 3) sb.append('|');
        sb.append(parts[i]);
      }
      password = sb.toString();
    }
    return new Mcd4000MqttChannel(host, port, gatewaySn, username, password);
  }

  public String brokerUri() {
    return "tcp://" + host + ":" + port;
  }

  public String topic(String kind) {
    return "sys/" + gatewaySn + "/" + kind;
  }

  public String[] topics() {
    return new String[] {topic("up"), topic("upfast"), topic("passthrough")};
  }

  public int[] qos0() {
    return new int[] {0, 0, 0};
  }

  /** 必须以 telegraf_ 开头，且与 telegraf 的 _PLC/_ARM/_passthrough 以及其它设备不冲突。 */
  public String clientId(String deviceId) {
    String id = sanitize(deviceId);
    if (id.isEmpty()) id = sanitize(gatewaySn);
    if (id.isEmpty()) id = "dev";
    String built = CLIENT_ID_PREFIX + "webscada_" + id;
    if (built.length() > 80) built = built.substring(0, 80);
    return built;
  }

  public static String probeClientId() {
    String suffix = Long.toHexString(System.nanoTime());
    if (suffix.length() > 12) suffix = suffix.substring(suffix.length() - 12);
    return CLIENT_ID_PREFIX + "probe_" + suffix;
  }

  public String fingerprint() {
    return host + ":" + port + "|" + gatewaySn + "|" + username + "|" + password;
  }

  public static String topicKind(String topic) {
    if (topic == null) return "";
    String t = topic.trim();
    if (t.startsWith("/")) t = t.substring(1);
    int slash = t.lastIndexOf('/');
    String last = slash >= 0 ? t.substring(slash + 1) : t;
    if ("up".equals(last) || "upfast".equals(last) || "passthrough".equals(last)) return last;
    return "";
  }

  static String sanitize(String raw) {
    if (raw == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < raw.length(); i++) {
      char c = raw.charAt(i);
      if ((c >= 'a' && c <= 'z')
          || (c >= 'A' && c <= 'Z')
          || (c >= '0' && c <= '9')
          || c == '_'
          || c == '-') {
        sb.append(c);
      } else if (c == '.' || c == ' ') {
        sb.append('_');
      }
    }
    return sb.toString();
  }
}
