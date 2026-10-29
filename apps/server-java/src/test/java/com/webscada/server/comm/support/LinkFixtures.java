package com.webscada.server.comm.support;

import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.OpcUaOptions;
import java.util.ArrayList;
import java.util.List;

public final class LinkFixtures {
  private LinkFixtures() {}

  public static LinkDefinition modbus(String id, int staleMs, int failedProbeMs, int port, int... morePorts) {
    return create(id, staleMs, failedProbeMs, 1_000, 60_000, 3, 20, port, morePorts);
  }

  /** 订阅测试：心跳拉长。resync、keepAlive、publishing 决定对账和静默窗口。 */
  public static LinkDefinition subscribed(
      String id, int pollMs, int resyncMs, int keepAlive, int publishingMs) {
    int lifetime = Math.max(keepAlive * 3, 1);
    OpcUaOptions ua =
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
            lifetime,
            0,
            10,
            100,
            0,
            true,
            resyncMs,
            "",
            256);
    return new LinkDefinition(
        id,
        "dev-" + id,
        "opcua",
        true,
        List.of(new LinkDefinition.Endpoint("192.168.1.10", 4840)),
        "opc.tcp://192.168.1.10:4840",
        3000,
        3000,
        3000,
        60_000,
        0,
        0,
        1000,
        60000,
        0.2,
        5,
        5,
        30000,
        60_000,
        60_000,
        List.of("a", "b"),
        1,
        "0",
        3,
        0,
        1,
        List.of(),
        pollMs,
        3,
        ua,
        null,
        null);
  }

  public static LinkDefinition withPoints(LinkDefinition link, List<DataPoint> points) {
    List<String> ids = new ArrayList<>();
    for (DataPoint point : points) ids.add(point.id());
    return new LinkDefinition(
        link.id(),
        link.deviceId(),
        link.protocol(),
        link.enabled(),
        link.endpoints(),
        link.endpointUrl(),
        link.connectTimeoutMs(),
        link.handshakeTimeoutMs(),
        link.responseTimeoutMs(),
        link.heartbeatIntervalMs(),
        link.readRetries(),
        link.writeRetries(),
        link.reconnectBaseMs(),
        link.reconnectMaxMs(),
        link.jitter(),
        link.connectMaxAttempts(),
        link.handshakeMaxAttempts(),
        link.stablePeriodMs(),
        link.staleTimeoutMs(),
        link.failedProbeMs(),
        ids,
        link.unitId(),
        link.addressBase(),
        link.healthFc(),
        link.healthAddress(),
        link.healthCount(),
        points,
        link.pollIntervalMs(),
        link.failoverThreshold(),
        link.opcua(),
        link.mqtt(),
        link.http());
  }

  /** 周期采集测试：心跳拉长，避免和 poll 抢同一个 tick。 */
  public static LinkDefinition polling(String id, int pollMs, int port, int... morePorts) {
    return create(id, 60_000, 60_000, 60_000, pollMs, 3, 5, port, morePorts);
  }

  private static LinkDefinition create(
      String id,
      int staleMs,
      int failedProbeMs,
      int heartbeatMs,
      int pollMs,
      int failoverThreshold,
      int connectMax,
      int port,
      int... morePorts) {
    List<LinkDefinition.Endpoint> endpoints = new ArrayList<>();
    endpoints.add(new LinkDefinition.Endpoint("192.168.1.10", port));
    for (int extra : morePorts) endpoints.add(new LinkDefinition.Endpoint("192.168.1.10", extra));
    return new LinkDefinition(
        id,
        "dev-" + id,
        "modbus-tcp",
        true,
        endpoints,
        "",
        3000,
        3000,
        3000,
        heartbeatMs,
        2,
        0,
        1000,
        60000,
        0.2,
        connectMax,
        5,
        30000,
        staleMs,
        failedProbeMs,
        List.of("a", "b"),
        1,
        "0",
        3,
        0,
        1,
        List.of(),
        pollMs,
        failoverThreshold,
        null,
        null,
        null);
  }
}
