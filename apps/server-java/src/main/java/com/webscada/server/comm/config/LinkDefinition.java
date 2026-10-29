package com.webscada.server.comm.config;

import java.util.List;

public record LinkDefinition(
    String id,
    String deviceId,
    String protocol,
    boolean enabled,
    List<Endpoint> endpoints,
    String endpointUrl,
    int connectTimeoutMs,
    int handshakeTimeoutMs,
    int responseTimeoutMs,
    int heartbeatIntervalMs,
    int readRetries,
    int writeRetries,
    int reconnectBaseMs,
    int reconnectMaxMs,
    double jitter,
    int connectMaxAttempts,
    int handshakeMaxAttempts,
    int stablePeriodMs,
    int staleTimeoutMs,
    int failedProbeMs,
    List<String> pointIds,
    int unitId,
    String addressBase,
    int healthFc,
    int healthAddress,
    int healthCount,
    List<DataPoint> points,
    int pollIntervalMs,
    int failoverThreshold,
    OpcUaOptions opcua,
    MqttOptions mqtt,
    HttpOptions http) {

  public LinkDefinition {
    endpoints = endpoints == null ? List.of() : List.copyOf(endpoints);
    pointIds = pointIds == null ? List.of() : List.copyOf(pointIds);
    points = points == null ? List.of() : List.copyOf(points);
    if (endpointUrl == null) endpointUrl = "";
    if (deviceId == null || deviceId.isBlank()) deviceId = id;
    if (handshakeTimeoutMs <= 0) handshakeTimeoutMs = connectTimeoutMs;
    if (addressBase == null || addressBase.isBlank()) addressBase = "0";
    if (healthFc <= 0) healthFc = 3;
    if (healthCount <= 0) healthCount = 1;
    if (pollIntervalMs <= 0) pollIntervalMs = 1000;
    if (failoverThreshold <= 0) failoverThreshold = 3;
    if (opcua == null) opcua = OpcUaOptions.defaults();
    if (mqtt == null) mqtt = MqttOptions.defaults();
    if (http == null) http = HttpOptions.defaults();
  }

  /** 下标超出备用列表时停在最后一个，不绕回主地址。 */
  public Endpoint endpoint(int index) {
    if (endpoints.isEmpty()) {
      return new Endpoint("", 0);
    }
    int i = index;
    if (i < 0) i = 0;
    if (i >= endpoints.size()) i = endpoints.size() - 1;
    return endpoints.get(i);
  }

  public record Endpoint(String host, int port) {}
}
