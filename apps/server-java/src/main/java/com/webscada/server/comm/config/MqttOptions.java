package com.webscada.server.comm.config;

import java.util.List;

/**
 * MQTT 3.1.1 链路参数。不实现 5.0。
 *
 * <pre>
 * mqtt:
 *   brokerUrl: tcp://10.0.0.8:1883
 *   clientIdPrefix: scada
 *   site: plant-a
 *   username: scada
 *   password: ${MQTT_PASSWORD}
 *   cleanSession: false
 *   keepAliveSec: 30
 *   commandTopic: plant/pump-1/cmd
 *   payloadFormat: json
 *   valueField: value
 *   tsField: ts
 *   qualityField: quality
 *   seqField: seq
 *   lwt:
 *     topic: plant/pump-1/status
 *     payload: offline
 *     qos: 1
 *     retain: true
 *   tls:
 *     caFile: /etc/scada/ca.pem
 *     clientCert: /etc/scada/client.pem
 *     clientKey: /etc/scada/client.key
 *   topics:
 *     - filter: plant/pump-1/data
 *       qos: 1
 * </pre>
 *
 * clientId 由 {@code clientIdPrefix-site-deviceId} 生成，整份配置里不能重复。
 * QoS1 写出的 PUBACK 只表示 broker 已经收到命令，不表示设备已经执行。见 {@code MqttDriver#write}。
 */
public record MqttOptions(
    String brokerUrl,
    String clientIdPrefix,
    String site,
    String clientId,
    String username,
    String password,
    boolean cleanSession,
    int keepAliveSec,
    String lwtTopic,
    String lwtPayload,
    int lwtQos,
    boolean lwtRetain,
    String caFile,
    String clientCert,
    String clientKey,
    List<Topic> topics,
    String payloadFormat,
    String valueField,
    String tsField,
    String qualityField,
    String seqField,
    String commandTopic) {

  public MqttOptions {
    if (brokerUrl == null) brokerUrl = "";
    if (clientIdPrefix == null) clientIdPrefix = "";
    if (site == null) site = "";
    if (clientId == null) clientId = "";
    if (username == null) username = "";
    if (password == null) password = "";
    if (keepAliveSec <= 0) keepAliveSec = 30;
    if (lwtTopic == null) lwtTopic = "";
    if (lwtPayload == null) lwtPayload = "";
    if (lwtQos < 0) lwtQos = 0;
    if (caFile == null) caFile = "";
    if (clientCert == null) clientCert = "";
    if (clientKey == null) clientKey = "";
    topics = topics == null ? List.of() : List.copyOf(topics);
    if (payloadFormat == null || payloadFormat.isBlank()) payloadFormat = "json";
    if (valueField == null || valueField.isBlank()) valueField = "value";
    if (tsField == null || tsField.isBlank()) tsField = "ts";
    if (qualityField == null || qualityField.isBlank()) qualityField = "quality";
    if (seqField == null || seqField.isBlank()) seqField = "seq";
    if (commandTopic == null) commandTopic = "";
  }

  public static MqttOptions defaults() {
    return new MqttOptions(
        "", "", "", "", "", "", false, 30, "", "", 0, false, "", "", "", List.of(), "json",
        "value", "ts", "quality", "seq", "");
  }

  public boolean willEnabled() {
    return !lwtTopic.isBlank();
  }

  public static String clientId(String prefix, String site, String device) {
    String p = prefix == null ? "" : prefix.trim();
    String s = site == null ? "" : site.trim();
    String d = device == null ? "" : device.trim();
    return p + "-" + s + "-" + d;
  }

  public record Topic(String filter, int qos) {
    public Topic {
      if (filter == null) filter = "";
    }
  }
}
