package com.webscada.server.comm.config;

/** OPC UA 链路参数。Modbus 链路使用 {@link #defaults()}，驱动不会读取。 */
public record OpcUaOptions(
    String endpointUrlOverride,
    String securityPolicy,
    String securityMode,
    String clientCert,
    String clientKey,
    String trustListDir,
    int sessionTimeoutMs,
    int publishingIntervalMs,
    int keepAliveCount,
    int lifetimeCount,
    int maxNotificationsPerPublish,
    int queueSize,
    int samplingIntervalMs,
    double deadband,
    boolean subscriptionEnabled,
    int resyncIntervalMs,
    String healthNodeId,
    int notificationQueueSize) {

  public OpcUaOptions {
    if (endpointUrlOverride == null) endpointUrlOverride = "";
    if (securityPolicy == null || securityPolicy.isBlank()) securityPolicy = "None";
    if (securityMode == null || securityMode.isBlank()) securityMode = "None";
    if (clientCert == null) clientCert = "";
    if (clientKey == null) clientKey = "";
    if (trustListDir == null) trustListDir = "";
    if (sessionTimeoutMs <= 0) sessionTimeoutMs = 60_000;
    if (publishingIntervalMs <= 0) publishingIntervalMs = 500;
    if (keepAliveCount <= 0) keepAliveCount = 20;
    if (lifetimeCount <= 0) lifetimeCount = 60;
    if (maxNotificationsPerPublish < 0) maxNotificationsPerPublish = 0;
    if (queueSize <= 0) queueSize = 10;
    if (samplingIntervalMs < 0) samplingIntervalMs = 0;
    if (resyncIntervalMs <= 0) resyncIntervalMs = 60_000;
    if (healthNodeId == null) healthNodeId = "";
    if (notificationQueueSize <= 0) notificationQueueSize = 256;
  }

  public static OpcUaOptions defaults() {
    return new OpcUaOptions(
        "", "None", "None", "", "", "", 60_000, 500, 20, 60, 0, 10, 0, 0, true, 60_000, "", 256);
  }
}
