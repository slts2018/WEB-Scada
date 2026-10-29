package com.webscada.server.comm.config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "webscada.comm")
public class CommProperties {
  private boolean enabled = false;
  private int graceMs = 5000;
  private int callbackQueueSize = 256;
  private int tickMs = 50;
  private int ioThreads = 4;
  /** 为 true 时，变量时间戳用设备时标。默认关，避免时标回跳打乱历史。 */
  private boolean useSourceTimestamp = false;
  /** 为 true 时，可写变量才允许下发到通信链路。默认关。 */
  private boolean allowWrite = false;
  /** 接入队列长度。满了丢最旧。 */
  private int bridgeQueueSize = 4096;
  private final List<Link> links = new ArrayList<>();

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public int getGraceMs() {
    return graceMs;
  }

  public void setGraceMs(int graceMs) {
    this.graceMs = graceMs;
  }

  public int getCallbackQueueSize() {
    return callbackQueueSize;
  }

  public void setCallbackQueueSize(int callbackQueueSize) {
    this.callbackQueueSize = callbackQueueSize;
  }

  public int getTickMs() {
    return tickMs;
  }

  public void setTickMs(int tickMs) {
    this.tickMs = tickMs;
  }

  public int getIoThreads() {
    return ioThreads;
  }

  public void setIoThreads(int ioThreads) {
    this.ioThreads = ioThreads;
  }

  public boolean isUseSourceTimestamp() {
    return useSourceTimestamp;
  }

  public void setUseSourceTimestamp(boolean useSourceTimestamp) {
    this.useSourceTimestamp = useSourceTimestamp;
  }

  public boolean isAllowWrite() {
    return allowWrite;
  }

  public void setAllowWrite(boolean allowWrite) {
    this.allowWrite = allowWrite;
  }

  public int getBridgeQueueSize() {
    return bridgeQueueSize;
  }

  public void setBridgeQueueSize(int bridgeQueueSize) {
    this.bridgeQueueSize = bridgeQueueSize;
  }

  public List<Link> getLinks() {
    return links;
  }

  public static class Link {
    private String id = "";
    private String deviceId = "";
    private String protocol = "";
    private boolean enabled = true;
    private final List<Endpoint> endpoints = new ArrayList<>();
    private String endpointUrl = "";
    private int connectTimeoutMs = 3000;
    private int handshakeTimeoutMs = 3000;
    private int responseTimeoutMs = 3000;
    private int heartbeatIntervalMs = 20000;
    private final Retry retry = new Retry();
    private final Reconnect reconnect = new Reconnect();
    private int stablePeriodMs = 30000;
    private int staleTimeoutMs = 15000;
    private int failedProbeMs = 300000;
    private int pollIntervalMs = 1000;
    private int failoverThreshold = 3;
    private int connectMaxAttempts = -1;
    private int handshakeMaxAttempts = -1;
    private int unitId = 1;
    private String addressBase = "0";
    private HealthProbe healthProbe = new HealthProbe();
    private final List<String> pointIds = new ArrayList<>();
    private final List<Point> points = new ArrayList<>();
    private OpcUa opcua = new OpcUa();
    private Mqtt mqtt = new Mqtt();
    private Http http = new Http();

    public String getId() {
      return id;
    }

    public void setId(String id) {
      this.id = id;
    }

    public String getDeviceId() {
      return deviceId;
    }

    public void setDeviceId(String deviceId) {
      this.deviceId = deviceId;
    }

    public String getProtocol() {
      return protocol;
    }

    public void setProtocol(String protocol) {
      this.protocol = protocol;
    }

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public List<Endpoint> getEndpoints() {
      return endpoints;
    }

    public String getEndpointUrl() {
      return endpointUrl;
    }

    public void setEndpointUrl(String endpointUrl) {
      this.endpointUrl = endpointUrl;
    }

    public int getConnectTimeoutMs() {
      return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(int connectTimeoutMs) {
      this.connectTimeoutMs = connectTimeoutMs;
    }

    public int getHandshakeTimeoutMs() {
      return handshakeTimeoutMs;
    }

    public void setHandshakeTimeoutMs(int handshakeTimeoutMs) {
      this.handshakeTimeoutMs = handshakeTimeoutMs;
    }

    public int getResponseTimeoutMs() {
      return responseTimeoutMs;
    }

    public void setResponseTimeoutMs(int responseTimeoutMs) {
      this.responseTimeoutMs = responseTimeoutMs;
    }

    public int getHeartbeatIntervalMs() {
      return heartbeatIntervalMs;
    }

    public void setHeartbeatIntervalMs(int heartbeatIntervalMs) {
      this.heartbeatIntervalMs = heartbeatIntervalMs;
    }

    public Retry getRetry() {
      return retry;
    }

    public Reconnect getReconnect() {
      return reconnect;
    }

    public int getStablePeriodMs() {
      return stablePeriodMs;
    }

    public void setStablePeriodMs(int stablePeriodMs) {
      this.stablePeriodMs = stablePeriodMs;
    }

    public int getStaleTimeoutMs() {
      return staleTimeoutMs;
    }

    public void setStaleTimeoutMs(int staleTimeoutMs) {
      this.staleTimeoutMs = staleTimeoutMs;
    }

    public int getFailedProbeMs() {
      return failedProbeMs;
    }

    public void setFailedProbeMs(int failedProbeMs) {
      this.failedProbeMs = failedProbeMs;
    }

    public int getPollIntervalMs() {
      return pollIntervalMs;
    }

    public void setPollIntervalMs(int pollIntervalMs) {
      this.pollIntervalMs = pollIntervalMs;
    }

    public int getFailoverThreshold() {
      return failoverThreshold;
    }

    public void setFailoverThreshold(int failoverThreshold) {
      this.failoverThreshold = failoverThreshold;
    }

    public int getConnectMaxAttempts() {
      return connectMaxAttempts;
    }

    public void setConnectMaxAttempts(int connectMaxAttempts) {
      this.connectMaxAttempts = connectMaxAttempts;
    }

    public int getHandshakeMaxAttempts() {
      return handshakeMaxAttempts;
    }

    public void setHandshakeMaxAttempts(int handshakeMaxAttempts) {
      this.handshakeMaxAttempts = handshakeMaxAttempts;
    }

    public int getUnitId() {
      return unitId;
    }

    public void setUnitId(int unitId) {
      this.unitId = unitId;
    }

    public String getAddressBase() {
      return addressBase;
    }

    public void setAddressBase(String addressBase) {
      this.addressBase = addressBase;
    }

    public HealthProbe getHealthProbe() {
      return healthProbe;
    }

    public void setHealthProbe(HealthProbe healthProbe) {
      this.healthProbe = healthProbe == null ? new HealthProbe() : healthProbe;
    }

    public List<Point> getPoints() {
      return points;
    }

    public List<String> getPointIds() {
      return pointIds;
    }

    public OpcUa getOpcua() {
      return opcua;
    }

    public void setOpcua(OpcUa opcua) {
      this.opcua = opcua == null ? new OpcUa() : opcua;
    }

    public Mqtt getMqtt() {
      return mqtt;
    }

    public void setMqtt(Mqtt mqtt) {
      this.mqtt = mqtt == null ? new Mqtt() : mqtt;
    }

    public Http getHttp() {
      return http;
    }

    public void setHttp(Http http) {
      this.http = http == null ? new Http() : http;
    }
  }

  public static class Endpoint {
    private String host = "";
    private int port;

    public String getHost() {
      return host;
    }

    public void setHost(String host) {
      this.host = host;
    }

    public int getPort() {
      return port;
    }

    public void setPort(int port) {
      this.port = port;
    }
  }

  public static class Point {
    private String id = "";
    private int fc;
    private int address;
    private String type = "";
    private String wordOrder = "high-first";
    private String byteOrder = "big";
    private double scale = 1;
    private double offset;
    private Integer unit;
    private String nodeId = "";
    private String topic = "";
    private String field = "";
    private String jsonPath = "";
    private String path = "";
    private String tagId = "";

    public String getId() {
      return id;
    }

    public void setId(String id) {
      this.id = id;
    }

    public int getFc() {
      return fc;
    }

    public void setFc(int fc) {
      this.fc = fc;
    }

    public int getAddress() {
      return address;
    }

    public void setAddress(int address) {
      this.address = address;
    }

    public String getType() {
      return type;
    }

    public void setType(String type) {
      this.type = type;
    }

    public String getWordOrder() {
      return wordOrder;
    }

    public void setWordOrder(String wordOrder) {
      this.wordOrder = wordOrder;
    }

    public String getByteOrder() {
      return byteOrder;
    }

    public void setByteOrder(String byteOrder) {
      this.byteOrder = byteOrder;
    }

    public double getScale() {
      return scale;
    }

    public void setScale(double scale) {
      this.scale = scale;
    }

    public double getOffset() {
      return offset;
    }

    public void setOffset(double offset) {
      this.offset = offset;
    }

    public Integer getUnit() {
      return unit;
    }

    public void setUnit(Integer unit) {
      this.unit = unit;
    }

    public String getNodeId() {
      return nodeId;
    }

    public void setNodeId(String nodeId) {
      this.nodeId = nodeId == null ? "" : nodeId;
    }

    public String getTopic() {
      return topic;
    }

    public void setTopic(String topic) {
      this.topic = topic == null ? "" : topic;
    }

    public String getField() {
      return field;
    }

    public void setField(String field) {
      this.field = field == null ? "" : field;
    }

    public String getJsonPath() {
      return jsonPath;
    }

    public void setJsonPath(String jsonPath) {
      this.jsonPath = jsonPath == null ? "" : jsonPath;
    }

    public String mappedField() {
      if (field != null && !field.isBlank()) return field;
      return jsonPath == null ? "" : jsonPath;
    }

    public String getPath() {
      return path;
    }

    public String getTagId() {
      return tagId;
    }

    public void setTagId(String tagId) {
      this.tagId = tagId == null ? "" : tagId;
    }

    public void setPath(String path) {
      this.path = path == null ? "" : path;
    }
  }

  public static class HealthProbe {
    private int fc = 3;
    private int address;
    private int count = 1;

    public int getFc() {
      return fc;
    }

    public void setFc(int fc) {
      this.fc = fc;
    }

    public int getAddress() {
      return address;
    }

    public void setAddress(int address) {
      this.address = address;
    }

    public int getCount() {
      return count;
    }

    public void setCount(int count) {
      this.count = count;
    }
  }

  public static class Retry {
    private int read = 2;
    private int write = 0;

    public int getRead() {
      return read;
    }

    public void setRead(int read) {
      this.read = read;
    }

    public int getWrite() {
      return write;
    }

    public void setWrite(int write) {
      this.write = write;
    }
  }

  public static class Reconnect {
    private int baseMs = 1000;
    private int maxMs = 60000;
    private double jitter = 0.2;
    private int maxAttempts = 20;

    public int getBaseMs() {
      return baseMs;
    }

    public void setBaseMs(int baseMs) {
      this.baseMs = baseMs;
    }

    public int getMaxMs() {
      return maxMs;
    }

    public void setMaxMs(int maxMs) {
      this.maxMs = maxMs;
    }

    public double getJitter() {
      return jitter;
    }

    public void setJitter(double jitter) {
      this.jitter = jitter;
    }

    public int getMaxAttempts() {
      return maxAttempts;
    }

    public void setMaxAttempts(int maxAttempts) {
      this.maxAttempts = maxAttempts;
    }
  }

  public static class OpcUa {
    private String endpointUrlOverride = "";
    private String securityPolicy = "None";
    private String securityMode = "None";
    private String clientCert = "";
    private String clientKey = "";
    private String trustListDir = "";
    private int sessionTimeoutMs = 60000;
    private int publishingIntervalMs = 500;
    private int keepAliveCount = 20;
    private int lifetimeCount = 60;
    private int maxNotificationsPerPublish;
    private int queueSize = 10;
    private int samplingIntervalMs;
    private double deadband;
    private boolean subscriptionEnabled = true;
    private int resyncIntervalMs = 60000;
    private String healthNodeId = "";
    private int notificationQueueSize = 256;

    public String getEndpointUrlOverride() {
      return endpointUrlOverride;
    }

    public void setEndpointUrlOverride(String endpointUrlOverride) {
      this.endpointUrlOverride = endpointUrlOverride;
    }

    public String getSecurityPolicy() {
      return securityPolicy;
    }

    public void setSecurityPolicy(String securityPolicy) {
      this.securityPolicy = securityPolicy;
    }

    public String getSecurityMode() {
      return securityMode;
    }

    public void setSecurityMode(String securityMode) {
      this.securityMode = securityMode;
    }

    public String getClientCert() {
      return clientCert;
    }

    public void setClientCert(String clientCert) {
      this.clientCert = clientCert;
    }

    public String getClientKey() {
      return clientKey;
    }

    public void setClientKey(String clientKey) {
      this.clientKey = clientKey;
    }

    public String getTrustListDir() {
      return trustListDir;
    }

    public void setTrustListDir(String trustListDir) {
      this.trustListDir = trustListDir;
    }

    public int getSessionTimeoutMs() {
      return sessionTimeoutMs;
    }

    public void setSessionTimeoutMs(int sessionTimeoutMs) {
      this.sessionTimeoutMs = sessionTimeoutMs;
    }

    public int getPublishingIntervalMs() {
      return publishingIntervalMs;
    }

    public void setPublishingIntervalMs(int publishingIntervalMs) {
      this.publishingIntervalMs = publishingIntervalMs;
    }

    public int getKeepAliveCount() {
      return keepAliveCount;
    }

    public void setKeepAliveCount(int keepAliveCount) {
      this.keepAliveCount = keepAliveCount;
    }

    public int getLifetimeCount() {
      return lifetimeCount;
    }

    public void setLifetimeCount(int lifetimeCount) {
      this.lifetimeCount = lifetimeCount;
    }

    public int getMaxNotificationsPerPublish() {
      return maxNotificationsPerPublish;
    }

    public void setMaxNotificationsPerPublish(int maxNotificationsPerPublish) {
      this.maxNotificationsPerPublish = maxNotificationsPerPublish;
    }

    public int getQueueSize() {
      return queueSize;
    }

    public void setQueueSize(int queueSize) {
      this.queueSize = queueSize;
    }

    public int getSamplingIntervalMs() {
      return samplingIntervalMs;
    }

    public void setSamplingIntervalMs(int samplingIntervalMs) {
      this.samplingIntervalMs = samplingIntervalMs;
    }

    public double getDeadband() {
      return deadband;
    }

    public void setDeadband(double deadband) {
      this.deadband = deadband;
    }

    public boolean isSubscriptionEnabled() {
      return subscriptionEnabled;
    }

    public void setSubscriptionEnabled(boolean subscriptionEnabled) {
      this.subscriptionEnabled = subscriptionEnabled;
    }

    public int getResyncIntervalMs() {
      return resyncIntervalMs;
    }

    public void setResyncIntervalMs(int resyncIntervalMs) {
      this.resyncIntervalMs = resyncIntervalMs;
    }

    public String getHealthNodeId() {
      return healthNodeId;
    }

    public void setHealthNodeId(String healthNodeId) {
      this.healthNodeId = healthNodeId;
    }

    public int getNotificationQueueSize() {
      return notificationQueueSize;
    }

    public void setNotificationQueueSize(int notificationQueueSize) {
      this.notificationQueueSize = notificationQueueSize;
    }
  }

  public static class Mqtt {
    private String brokerUrl = "";
    private String clientIdPrefix = "";
    private String site = "";
    private String username = "";
    private String password = "";
    private boolean cleanSession;
    private int keepAliveSec;
    private Lwt lwt = new Lwt();
    private Tls tls = new Tls();
    private final List<MqttTopic> topics = new ArrayList<>();
    private String payloadFormat = "json";
    private String valueField = "value";
    private String tsField = "ts";
    private String qualityField = "quality";
    private String seqField = "seq";
    private String commandTopic = "";

    public String getBrokerUrl() {
      return brokerUrl;
    }

    public void setBrokerUrl(String brokerUrl) {
      this.brokerUrl = brokerUrl;
    }

    public String getClientIdPrefix() {
      return clientIdPrefix;
    }

    public void setClientIdPrefix(String clientIdPrefix) {
      this.clientIdPrefix = clientIdPrefix;
    }

    public String getSite() {
      return site;
    }

    public void setSite(String site) {
      this.site = site;
    }

    public String getUsername() {
      return username;
    }

    public void setUsername(String username) {
      this.username = username == null ? "" : username;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password == null ? "" : password;
    }

    public boolean isCleanSession() {
      return cleanSession;
    }

    public void setCleanSession(boolean cleanSession) {
      this.cleanSession = cleanSession;
    }

    public int getKeepAliveSec() {
      return keepAliveSec;
    }

    public void setKeepAliveSec(int keepAliveSec) {
      this.keepAliveSec = keepAliveSec;
    }

    public Lwt getLwt() {
      return lwt;
    }

    public void setLwt(Lwt lwt) {
      this.lwt = lwt == null ? new Lwt() : lwt;
    }

    public Tls getTls() {
      return tls;
    }

    public void setTls(Tls tls) {
      this.tls = tls == null ? new Tls() : tls;
    }

    public List<MqttTopic> getTopics() {
      return topics;
    }

    public String getPayloadFormat() {
      return payloadFormat;
    }

    public void setPayloadFormat(String payloadFormat) {
      this.payloadFormat = payloadFormat;
    }

    public String getValueField() {
      return valueField;
    }

    public void setValueField(String valueField) {
      this.valueField = valueField;
    }

    public String getTsField() {
      return tsField;
    }

    public void setTsField(String tsField) {
      this.tsField = tsField;
    }

    public String getQualityField() {
      return qualityField;
    }

    public void setQualityField(String qualityField) {
      this.qualityField = qualityField;
    }

    public String getSeqField() {
      return seqField;
    }

    public void setSeqField(String seqField) {
      this.seqField = seqField;
    }

    public String getCommandTopic() {
      return commandTopic;
    }

    public void setCommandTopic(String commandTopic) {
      this.commandTopic = commandTopic == null ? "" : commandTopic;
    }
  }

  public static class MqttTopic {
    private String filter = "";
    private int qos;

    public String getFilter() {
      return filter;
    }

    public void setFilter(String filter) {
      this.filter = filter == null ? "" : filter;
    }

    public int getQos() {
      return qos;
    }

    public void setQos(int qos) {
      this.qos = qos;
    }
  }

  public static class Lwt {
    private String topic = "";
    private String payload = "";
    private int qos;
    private boolean retain;

    public String getTopic() {
      return topic;
    }

    public void setTopic(String topic) {
      this.topic = topic == null ? "" : topic;
    }

    public String getPayload() {
      return payload;
    }

    public void setPayload(String payload) {
      this.payload = payload == null ? "" : payload;
    }

    public int getQos() {
      return qos;
    }

    public void setQos(int qos) {
      this.qos = qos;
    }

    public boolean isRetain() {
      return retain;
    }

    public void setRetain(boolean retain) {
      this.retain = retain;
    }
  }

  public static class Tls {
    private String caFile = "";
    private String clientCert = "";
    private String clientKey = "";

    public String getCaFile() {
      return caFile;
    }

    public void setCaFile(String caFile) {
      this.caFile = caFile == null ? "" : caFile;
    }

    public String getClientCert() {
      return clientCert;
    }

    public void setClientCert(String clientCert) {
      this.clientCert = clientCert == null ? "" : clientCert;
    }

    public String getClientKey() {
      return clientKey;
    }

    public void setClientKey(String clientKey) {
      this.clientKey = clientKey == null ? "" : clientKey;
    }
  }

  public static class Http {
    private String baseUrl = "";
    private HttpAuth auth = new HttpAuth();
    private final Map<String, String> headers = new LinkedHashMap<>();
    private HttpProxy proxy = new HttpProxy();
    private Tls tls = new Tls();
    private Integer maxResponseBytes;
    private String healthPath = "";
    private String writePath = "";
    private String writeMethod = "POST";
    private String tsField = "ts";

    public String getBaseUrl() {
      return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
      this.baseUrl = baseUrl == null ? "" : baseUrl;
    }

    public HttpAuth getAuth() {
      return auth;
    }

    public void setAuth(HttpAuth auth) {
      this.auth = auth == null ? new HttpAuth() : auth;
    }

    public Map<String, String> getHeaders() {
      return headers;
    }

    public HttpProxy getProxy() {
      return proxy;
    }

    public void setProxy(HttpProxy proxy) {
      this.proxy = proxy == null ? new HttpProxy() : proxy;
    }

    public Tls getTls() {
      return tls;
    }

    public void setTls(Tls tls) {
      this.tls = tls == null ? new Tls() : tls;
    }

    public Integer getMaxResponseBytes() {
      return maxResponseBytes;
    }

    public void setMaxResponseBytes(Integer maxResponseBytes) {
      this.maxResponseBytes = maxResponseBytes;
    }

    public String getHealthPath() {
      return healthPath;
    }

    public void setHealthPath(String healthPath) {
      this.healthPath = healthPath == null ? "" : healthPath;
    }

    public String getWritePath() {
      return writePath;
    }

    public void setWritePath(String writePath) {
      this.writePath = writePath == null ? "" : writePath;
    }

    public String getWriteMethod() {
      return writeMethod;
    }

    public void setWriteMethod(String writeMethod) {
      this.writeMethod = writeMethod == null ? "" : writeMethod;
    }

    public String getTsField() {
      return tsField;
    }

    public void setTsField(String tsField) {
      this.tsField = tsField == null ? "" : tsField;
    }
  }

  public static class HttpAuth {
    private String type = "none";
    private String username = "";
    private String password = "";
    private String token = "";
    private String tokenUrl = "";
    private String clientId = "";
    private String clientSecret = "";
    private String scope = "";

    public String getType() {
      return type;
    }

    public void setType(String type) {
      this.type = type == null ? "" : type;
    }

    public String getUsername() {
      return username;
    }

    public void setUsername(String username) {
      this.username = username == null ? "" : username;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password == null ? "" : password;
    }

    public String getToken() {
      return token;
    }

    public void setToken(String token) {
      this.token = token == null ? "" : token;
    }

    public String getTokenUrl() {
      return tokenUrl;
    }

    public void setTokenUrl(String tokenUrl) {
      this.tokenUrl = tokenUrl == null ? "" : tokenUrl;
    }

    public String getClientId() {
      return clientId;
    }

    public void setClientId(String clientId) {
      this.clientId = clientId == null ? "" : clientId;
    }

    public String getClientSecret() {
      return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
      this.clientSecret = clientSecret == null ? "" : clientSecret;
    }

    public String getScope() {
      return scope;
    }

    public void setScope(String scope) {
      this.scope = scope == null ? "" : scope;
    }
  }

  public static class HttpProxy {
    private String host = "";
    private int port;

    public String getHost() {
      return host;
    }

    public void setHost(String host) {
      this.host = host == null ? "" : host;
    }

    public int getPort() {
      return port;
    }

    public void setPort(int port) {
      this.port = port;
    }
  }
}
