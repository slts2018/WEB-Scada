package com.webscada.server.comm.config;

import com.webscada.server.comm.driver.modbus.ModbusConfig;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class LinkConfigValidator {
  private static final Set<String> PROTOCOLS = Set.of("modbus-tcp", "opcua", "mqtt", "http");

  public Result validate(List<CommProperties.Link> links) {
    List<String> errors = new ArrayList<>();
    List<LinkDefinition> out = new ArrayList<>();
    if (links == null) {
      return new Result(List.of(), List.of());
    }
    Set<String> ids = new HashSet<>();
    Map<String, String> clientIds = new LinkedHashMap<>();
    for (int i = 0; i < links.size(); i++) {
      CommProperties.Link link = links.get(i);
      String where = "links[" + i + "]";
      if (link == null) {
        errors.add(where + ": null");
        continue;
      }
      List<String> local = new ArrayList<>();
      String id = link.getId() == null ? "" : link.getId().trim();
      if (id.isEmpty() || !id.matches("[A-Za-z0-9._\\-]+")) {
        local.add(where + ".id: required, pattern [A-Za-z0-9._-]+");
      } else if (!ids.add(id)) {
        local.add(where + ".id: duplicate " + id);
      }
      String protocol = link.getProtocol() == null ? "" : link.getProtocol().trim().toLowerCase(Locale.ROOT);
      if (!PROTOCOLS.contains(protocol)) {
        local.add(where + ".protocol: must be one of " + PROTOCOLS);
      }
      List<LinkDefinition.Endpoint> endpoints = new ArrayList<>();
      for (int e = 0; e < link.getEndpoints().size(); e++) {
        CommProperties.Endpoint ep = link.getEndpoints().get(e);
        String host = ep == null || ep.getHost() == null ? "" : ep.getHost().trim();
        int port = ep == null ? 0 : ep.getPort();
        if (host.isEmpty()) local.add(where + ".endpoints[" + e + "].host: required");
        if (port < 1 || port > 65535) {
          local.add(where + ".endpoints[" + e + "].port: must be 1..65535");
        }
        endpoints.add(new LinkDefinition.Endpoint(host, port));
      }
      String url = link.getEndpointUrl() == null ? "" : link.getEndpointUrl().trim();
      if (("opcua".equals(protocol)) && endpoints.isEmpty()) {
        if (url.isEmpty()) {
          local.add(where + ": endpointUrl or endpoints required");
        } else {
          endpoints.addAll(parseUrl(where, protocol, url, local));
        }
      }
      if ("modbus-tcp".equals(protocol) && endpoints.isEmpty()) {
        local.add(where + ".endpoints: at least one host:port required");
      }
      if (!url.isEmpty() && ("opcua".equals(protocol) || "http".equals(protocol))) {
        parseUrl(where, protocol, url, local);
      }
      requirePositive(local, where, "connectTimeoutMs", link.getConnectTimeoutMs());
      int handshakeTimeout =
          link.getHandshakeTimeoutMs() > 0
              ? link.getHandshakeTimeoutMs()
              : link.getConnectTimeoutMs();
      if (handshakeTimeout <= 0) {
        local.add(where + ".handshakeTimeoutMs: must be > 0");
      }
      requirePositive(local, where, "responseTimeoutMs", link.getResponseTimeoutMs());
      requirePositive(local, where, "heartbeatIntervalMs", link.getHeartbeatIntervalMs());
      requirePositive(local, where, "stablePeriodMs", link.getStablePeriodMs());
      requirePositive(local, where, "staleTimeoutMs", link.getStaleTimeoutMs());
      requirePositive(local, where, "failedProbeMs", link.getFailedProbeMs());
      int pollInterval = link.getPollIntervalMs() > 0 ? link.getPollIntervalMs() : 1000;
      int failoverThreshold = link.getFailoverThreshold() > 0 ? link.getFailoverThreshold() : 3;
      long staleNeed = (long) pollInterval * 2L;
      if (link.getStaleTimeoutMs() < staleNeed) {
        List<CommProperties.Point> rawPoints = link.getPoints();
        String staleMsg =
            "staleTimeoutMs "
                + link.getStaleTimeoutMs()
                + " must be >= pollIntervalMs * 2 ("
                + pollInterval
                + ")";
        if (rawPoints == null || rawPoints.isEmpty()) {
          local.add(where + "(" + id + "): " + staleMsg);
        } else {
          for (int p = 0; p < rawPoints.size(); p++) {
            CommProperties.Point rawPoint = rawPoints.get(p);
            String pid = rawPoint == null || rawPoint.getId() == null ? "" : rawPoint.getId();
            local.add(where + ".points[" + p + "](" + pid + "): " + staleMsg);
          }
        }
      }
      int base = link.getReconnect().getBaseMs();
      int max = link.getReconnect().getMaxMs();
      double jitter = link.getReconnect().getJitter();
      int attempts = link.getReconnect().getMaxAttempts();
      if (base <= 0) local.add(where + ".reconnect.baseMs: must be > 0");
      if (max < base) local.add(where + ".reconnect.maxMs: must be >= baseMs");
      if (jitter < 0 || jitter > 1) local.add(where + ".reconnect.jitter: must be 0..1");
      if (attempts < 1) local.add(where + ".reconnect.maxAttempts: must be >= 1");
      if (link.getRetry().getRead() < 0) local.add(where + ".retry.read: must be >= 0");
      if (link.getRetry().getWrite() < 0) local.add(where + ".retry.write: must be >= 0");
      int unitId = 1;
      String addressBase = "0";
      int healthFc = 3;
      int healthAddress = 0;
      int healthCount = 1;
      List<DataPoint> dataPoints = List.of();
      List<String> pointIdList = new ArrayList<>(link.getPointIds());
      if ("modbus-tcp".equals(protocol)) {
        CommProperties.HealthProbe probe = link.getHealthProbe();
        ModbusConfig.Checked checked =
            ModbusConfig.check(
                where,
                link.getUnitId(),
                link.getAddressBase(),
                probe == null ? 3 : probe.getFc(),
                probe == null ? 0 : probe.getAddress(),
                probe == null ? 1 : probe.getCount(),
                toPoints(link.getPoints()),
                local);
        unitId = checked.unitId();
        addressBase = checked.addressBase();
        healthFc = checked.healthFc();
        healthAddress = checked.healthAddress();
        healthCount = checked.healthCount();
        dataPoints = checked.points();
        if (!dataPoints.isEmpty()) {
          pointIdList = new ArrayList<>();
          for (DataPoint point : dataPoints) pointIdList.add(point.id());
          for (String extra : link.getPointIds()) {
            if (extra != null && !extra.isBlank() && !pointIdList.contains(extra)) pointIdList.add(extra);
          }
        }
      }
      OpcUaOptions opcua = OpcUaOptions.defaults();
      MqttOptions mqtt = MqttOptions.defaults();
      HttpOptions http = HttpOptions.defaults();
      if ("opcua".equals(protocol)) {
        opcua = opcuaOptions(where, link.getOpcua(), local);
        List<DataPoint> opcPoints = opcPoints(where, link.getPoints(), local);
        if (!opcPoints.isEmpty()) {
          dataPoints = opcPoints;
          pointIdList = new ArrayList<>();
          for (DataPoint point : opcPoints) pointIdList.add(point.id());
        }
      }
      if ("mqtt".equals(protocol)) {
        mqtt = mqttOptions(where, id, link, endpoints, clientIds, local);
        List<DataPoint> mqttPoints = mqttPoints(where, link.getPoints(), mqtt.payloadFormat(), local);
        if (!mqttPoints.isEmpty()) {
          dataPoints = mqttPoints;
          pointIdList = new ArrayList<>();
          for (DataPoint point : mqttPoints) pointIdList.add(point.id());
        }
      }
      if ("http".equals(protocol)) {
        http = httpOptions(where, link, endpoints, local);
        List<DataPoint> httpPoints = httpPoints(where, link.getPoints(), local);
        if (!httpPoints.isEmpty()) {
          dataPoints = httpPoints;
          pointIdList = new ArrayList<>();
          for (DataPoint point : httpPoints) pointIdList.add(point.id());
        }
      }
      int connectMax =
          link.getConnectMaxAttempts() > 0 ? link.getConnectMaxAttempts() : attempts;
      int handshakeMax =
          link.getHandshakeMaxAttempts() > 0 ? link.getHandshakeMaxAttempts() : attempts;
      if (!local.isEmpty()) {
        errors.addAll(local);
        continue;
      }
      out.add(
          new LinkDefinition(
              id,
              link.getDeviceId(),
              protocol,
              link.isEnabled(),
              endpoints,
              url,
              link.getConnectTimeoutMs(),
              handshakeTimeout,
              link.getResponseTimeoutMs(),
              link.getHeartbeatIntervalMs(),
              link.getRetry().getRead(),
              link.getRetry().getWrite(),
              base,
              max,
              jitter,
              connectMax,
              handshakeMax,
              link.getStablePeriodMs(),
              link.getStaleTimeoutMs(),
              link.getFailedProbeMs(),
              pointIdList,
              unitId,
              addressBase,
              healthFc,
              healthAddress,
              healthCount,
              dataPoints,
              pollInterval,
              failoverThreshold,
              opcua,
              mqtt,
              http));
    }
    if (!errors.isEmpty()) return new Result(List.of(), List.copyOf(errors));
    return new Result(List.copyOf(out), List.of());
  }

  public List<String> validateDefinitions(List<LinkDefinition> links) {
    if (links == null) return List.of("links: null");
    List<CommProperties.Link> raw = new ArrayList<>();
    for (LinkDefinition d : links) {
      CommProperties.Link link = new CommProperties.Link();
      link.setId(d.id());
      link.setDeviceId(d.deviceId());
      link.setProtocol(d.protocol());
      link.setEnabled(d.enabled());
      link.setEndpointUrl(d.endpointUrl());
      link.setConnectTimeoutMs(d.connectTimeoutMs());
      link.setHandshakeTimeoutMs(d.handshakeTimeoutMs());
      link.setResponseTimeoutMs(d.responseTimeoutMs());
      link.setHeartbeatIntervalMs(d.heartbeatIntervalMs());
      link.setStablePeriodMs(d.stablePeriodMs());
      link.setStaleTimeoutMs(d.staleTimeoutMs());
      link.setFailedProbeMs(d.failedProbeMs());
      link.setPollIntervalMs(d.pollIntervalMs());
      link.setFailoverThreshold(d.failoverThreshold());
      link.setConnectMaxAttempts(d.connectMaxAttempts());
      link.setHandshakeMaxAttempts(d.handshakeMaxAttempts());
      link.getRetry().setRead(d.readRetries());
      link.getRetry().setWrite(d.writeRetries());
      link.getReconnect().setBaseMs(d.reconnectBaseMs());
      link.getReconnect().setMaxMs(d.reconnectMaxMs());
      link.getReconnect().setJitter(d.jitter());
      link.getReconnect().setMaxAttempts(
          Math.max(d.connectMaxAttempts(), d.handshakeMaxAttempts()));
      for (LinkDefinition.Endpoint ep : d.endpoints()) {
        CommProperties.Endpoint rawEp = new CommProperties.Endpoint();
        rawEp.setHost(ep.host());
        rawEp.setPort(ep.port());
        link.getEndpoints().add(rawEp);
      }
      link.getPointIds().addAll(d.pointIds());
      link.setUnitId(d.unitId());
      link.setAddressBase(d.addressBase());
      link.getHealthProbe().setFc(d.healthFc());
      link.getHealthProbe().setAddress(d.healthAddress());
      link.getHealthProbe().setCount(d.healthCount());
      for (DataPoint point : d.points()) {
        CommProperties.Point rawPoint = new CommProperties.Point();
        rawPoint.setId(point.id());
        rawPoint.setFc(point.fc());
        rawPoint.setAddress(point.address());
        rawPoint.setType(point.type());
        rawPoint.setWordOrder(point.wordOrder());
        rawPoint.setByteOrder(point.byteOrder());
        rawPoint.setScale(point.scale());
        rawPoint.setOffset(point.offset());
        rawPoint.setUnit(point.unit());
        rawPoint.setNodeId(point.nodeId());
        rawPoint.setTopic(point.topic());
        rawPoint.setField(point.field());
        rawPoint.setPath(point.path());
        rawPoint.setTagId(point.tagId());
        link.getPoints().add(rawPoint);
      }
      link.setOpcua(toProperties(d.opcua()));
      link.setMqtt(toProperties(d.mqtt()));
      link.setHttp(toProperties(d.http()));
      raw.add(link);
    }
    return validate(raw).errors();
  }

  private static List<DataPoint> toPoints(List<CommProperties.Point> points) {
    List<DataPoint> out = new ArrayList<>();
    if (points == null) return out;
    for (CommProperties.Point point : points) {
      if (point == null) {
        out.add(new DataPoint("", 0, 0, "", "high-first", "big", 1, 0, null, null, null, null, null, null));
        continue;
      }
      out.add(
          new DataPoint(
              point.getId(),
              point.getFc(),
              point.getAddress(),
              point.getType(),
              point.getWordOrder(),
              point.getByteOrder(),
              point.getScale(),
              point.getOffset(),
              point.getUnit(),
              point.getNodeId(),
              point.getTopic(),
              point.mappedField(),
              point.getPath(),
              resolvedTagId(point, point.getId())));
    }
    return out;
  }

  private static OpcUaOptions opcuaOptions(
      String where, CommProperties.OpcUa raw, List<String> errors) {
    CommProperties.OpcUa src = raw == null ? new CommProperties.OpcUa() : raw;
    String policy = src.getSecurityPolicy() == null ? "" : src.getSecurityPolicy().trim();
    String mode = src.getSecurityMode() == null ? "" : src.getSecurityMode().trim();
    if (!policy.equalsIgnoreCase("None") && !policy.equalsIgnoreCase("Basic256Sha256")) {
      errors.add(where + ".opcua.securityPolicy: must be None or Basic256Sha256");
    }
    if (!mode.equalsIgnoreCase("None")
        && !mode.equalsIgnoreCase("Sign")
        && !mode.equalsIgnoreCase("SignAndEncrypt")) {
      errors.add(where + ".opcua.securityMode: must be None, Sign, or SignAndEncrypt");
    }
    boolean secure = !policy.equalsIgnoreCase("None");
    if (secure && mode.equalsIgnoreCase("None")) {
      errors.add(where + ".opcua.securityMode: must not be None when securityPolicy is " + policy);
    }
    if (!secure && !mode.isEmpty() && !mode.equalsIgnoreCase("None")) {
      errors.add(where + ".opcua.securityMode: must be None when securityPolicy is None");
    }
    if (secure && (src.getClientCert() == null || src.getClientCert().isBlank()
        || src.getClientKey() == null || src.getClientKey().isBlank())) {
      errors.add(where + ".opcua.clientCert: certificate and private key are required");
    }
    int keepAlive = src.getKeepAliveCount() > 0 ? src.getKeepAliveCount() : 20;
    int lifetime = src.getLifetimeCount() > 0 ? src.getLifetimeCount() : 60;
    if (lifetime < 3L * keepAlive) {
      errors.add(
          where
              + ".opcua.lifetimeCount: must be >= 3 * keepAliveCount ("
              + keepAlive
              + ")");
    }
    return new OpcUaOptions(
        src.getEndpointUrlOverride(),
        policy,
        mode,
        src.getClientCert(),
        src.getClientKey(),
        src.getTrustListDir(),
        src.getSessionTimeoutMs(),
        src.getPublishingIntervalMs(),
        keepAlive,
        lifetime,
        src.getMaxNotificationsPerPublish(),
        src.getQueueSize(),
        src.getSamplingIntervalMs(),
        src.getDeadband(),
        src.isSubscriptionEnabled(),
        src.getResyncIntervalMs(),
        src.getHealthNodeId(),
        src.getNotificationQueueSize());
  }

  private static List<DataPoint> opcPoints(
      String where, List<CommProperties.Point> points, List<String> errors) {
    List<DataPoint> out = new ArrayList<>();
    if (points == null) return out;
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < points.size(); i++) {
      CommProperties.Point point = points.get(i);
      String id = point == null || point.getId() == null ? "" : point.getId().trim();
      String at = where + ".points[" + i + "](" + id + ")";
      if (id.isEmpty()) errors.add(at + ".id: required");
      else if (!seen.add(id)) errors.add(at + ".id: duplicate " + id);
      if (resolvedTagId(point, id).isBlank()) errors.add(at + ".tagId: required");
      String nodeId = point == null || point.getNodeId() == null ? "" : point.getNodeId().trim();
      if (!nodeId.matches("(?i)ns=\\d+;[sibg]=.+")) {
        errors.add(at + ".nodeId: expected ns=<index>;s=|i=|g=|b=");
      }
      if (point != null && (Double.isNaN(point.getScale()) || Double.isInfinite(point.getScale()))) {
        errors.add(at + ".scale: must be finite");
      }
      if (point != null && (Double.isNaN(point.getOffset()) || Double.isInfinite(point.getOffset()))) {
        errors.add(at + ".offset: must be finite");
      }
      out.add(
          new DataPoint(
              id,
              point == null ? 0 : point.getFc(),
              point == null ? 0 : point.getAddress(),
              point == null ? "" : point.getType(),
              point == null ? "high-first" : point.getWordOrder(),
              point == null ? "big" : point.getByteOrder(),
              point == null ? 1 : point.getScale(),
              point == null ? 0 : point.getOffset(),
              point == null ? null : point.getUnit(),
              nodeId,
              point == null ? "" : point.getTopic(),
              point == null ? "" : point.mappedField(),
              point == null ? "" : point.getPath(),
              resolvedTagId(point, id)));
    }
    return out;
  }

  private static CommProperties.OpcUa toProperties(OpcUaOptions options) {
    OpcUaOptions src = options == null ? OpcUaOptions.defaults() : options;
    CommProperties.OpcUa raw = new CommProperties.OpcUa();
    raw.setEndpointUrlOverride(src.endpointUrlOverride());
    raw.setSecurityPolicy(src.securityPolicy());
    raw.setSecurityMode(src.securityMode());
    raw.setClientCert(src.clientCert());
    raw.setClientKey(src.clientKey());
    raw.setTrustListDir(src.trustListDir());
    raw.setSessionTimeoutMs(src.sessionTimeoutMs());
    raw.setPublishingIntervalMs(src.publishingIntervalMs());
    raw.setKeepAliveCount(src.keepAliveCount());
    raw.setLifetimeCount(src.lifetimeCount());
    raw.setMaxNotificationsPerPublish(src.maxNotificationsPerPublish());
    raw.setQueueSize(src.queueSize());
    raw.setSamplingIntervalMs(src.samplingIntervalMs());
    raw.setDeadband(src.deadband());
    raw.setSubscriptionEnabled(src.subscriptionEnabled());
    raw.setResyncIntervalMs(src.resyncIntervalMs());
    raw.setHealthNodeId(src.healthNodeId());
    raw.setNotificationQueueSize(src.notificationQueueSize());
    return raw;
  }

  private static MqttOptions mqttOptions(
      String where,
      String id,
      CommProperties.Link link,
      List<LinkDefinition.Endpoint> endpoints,
      Map<String, String> clientIds,
      List<String> errors) {
    CommProperties.Mqtt src = link.getMqtt() == null ? new CommProperties.Mqtt() : link.getMqtt();
    String broker = src.getBrokerUrl() == null ? "" : src.getBrokerUrl().trim();
    if (broker.isEmpty()) {
      errors.add(where + ".mqtt.brokerUrl: required");
    } else {
      URI uri;
      try {
        uri = URI.create(broker);
      } catch (IllegalArgumentException ex) {
        errors.add(where + ".mqtt.brokerUrl: " + ex.getMessage());
        uri = null;
      }
      if (uri != null) {
        if (uri.getUserInfo() != null) {
          errors.add(where + ".mqtt.brokerUrl: put username and password in the mqtt block");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"tcp".equals(scheme) && !"ssl".equals(scheme)) {
          errors.add(where + ".mqtt.brokerUrl: scheme must be tcp or ssl");
        } else if (uri.getHost() == null || uri.getHost().isBlank()) {
          errors.add(where + ".mqtt.brokerUrl: host missing");
        } else {
          int port = uri.getPort();
          if (port == -1) port = "ssl".equals(scheme) ? 8883 : 1883;
          if (port < 1 || port > 65535) {
            errors.add(where + ".mqtt.brokerUrl: port out of range");
          } else if (endpoints.isEmpty()) {
            endpoints.add(new LinkDefinition.Endpoint(uri.getHost(), port));
          }
        }
      }
    }
    String prefix = src.getClientIdPrefix() == null ? "" : src.getClientIdPrefix().trim();
    String site = src.getSite() == null ? "" : src.getSite().trim();
    String device = link.getDeviceId() == null ? "" : link.getDeviceId().trim();
    if (prefix.isEmpty()) errors.add(where + "(" + id + ").mqtt.clientIdPrefix: required");
    if (site.isEmpty()) errors.add(where + "(" + id + ").mqtt.site: required");
    if (device.isEmpty()) errors.add(where + "(" + id + ").deviceId: required");
    String clientId = MqttOptions.clientId(prefix, site, device);
    if (prefix.isEmpty() || site.isEmpty() || device.isEmpty() || clientId.isBlank()) {
      errors.add(where + "(" + id + ").mqtt.clientId: required");
    } else {
      String previous = clientIds.putIfAbsent(clientId, id);
      if (previous != null) {
        errors.add(where + "(" + id + ").mqtt.clientId: duplicate " + clientId);
      }
    }
    if (src.isCleanSession()) {
      errors.add(where + ".mqtt.cleanSession: only false is supported");
    }
    int keepAlive = src.getKeepAliveSec() > 0 ? src.getKeepAliveSec() : 30;
    if (keepAlive < 30 || keepAlive > 60) {
      errors.add(where + ".mqtt.keepAliveSec: must be 30..60");
    }
    String format = src.getPayloadFormat() == null ? "" : src.getPayloadFormat().trim().toLowerCase(Locale.ROOT);
    if (format.isEmpty()) format = "json";
    if (!"json".equals(format) && !"raw".equals(format)) {
      errors.add(where + ".mqtt.payloadFormat: must be json or raw");
    }
    List<MqttOptions.Topic> topics = new ArrayList<>();
    List<CommProperties.MqttTopic> rawTopics = src.getTopics();
    if (rawTopics == null || rawTopics.isEmpty()) {
      errors.add(where + ".mqtt.topics: required");
    } else {
      for (int i = 0; i < rawTopics.size(); i++) {
        CommProperties.MqttTopic topic = rawTopics.get(i);
        String filter = topic == null || topic.getFilter() == null ? "" : topic.getFilter().trim();
        int qos = topic == null ? -1 : topic.getQos();
        if (filter.isEmpty()) errors.add(where + ".mqtt.topics[" + i + "].filter: required");
        if (!validQos(qos)) errors.add(where + ".mqtt.topics[" + i + "].qos: must be 0, 1, or 2");
        topics.add(new MqttOptions.Topic(filter, validQos(qos) ? qos : 0));
      }
    }
    CommProperties.Lwt lwt = src.getLwt() == null ? new CommProperties.Lwt() : src.getLwt();
    String lwtTopic = lwt.getTopic() == null ? "" : lwt.getTopic().trim();
    if (!lwtTopic.isEmpty() && !validQos(lwt.getQos())) {
      errors.add(where + ".mqtt.lwt.qos: must be 0, 1, or 2");
    }
    CommProperties.Tls tls = src.getTls() == null ? new CommProperties.Tls() : src.getTls();
    return new MqttOptions(
        broker,
        prefix,
        site,
        clientId,
        src.getUsername(),
        src.getPassword(),
        false,
        keepAlive,
        lwtTopic,
        lwt.getPayload(),
        lwt.getQos(),
        lwt.isRetain(),
        tls.getCaFile(),
        tls.getClientCert(),
        tls.getClientKey(),
        topics,
        format,
        src.getValueField(),
        src.getTsField(),
        src.getQualityField(),
        src.getSeqField(),
        src.getCommandTopic());
  }

  private static List<DataPoint> mqttPoints(
      String where, List<CommProperties.Point> points, String format, List<String> errors) {
    List<DataPoint> out = new ArrayList<>();
    if (points == null) return out;
    Set<String> seen = new HashSet<>();
    Set<String> mappings = new HashSet<>();
    for (int i = 0; i < points.size(); i++) {
      CommProperties.Point point = points.get(i);
      String id = point == null || point.getId() == null ? "" : point.getId().trim();
      String at = where + ".points[" + i + "](" + id + ")";
      if (id.isEmpty()) errors.add(at + ".id: required");
      else if (!seen.add(id)) errors.add(at + ".id: duplicate " + id);
      if (resolvedTagId(point, id).isBlank()) errors.add(at + ".tagId: required");
      String type = point == null || point.getType() == null ? "" : point.getType().trim();
      if (type.isEmpty()) errors.add(at + ".type: required");
      if (point != null && (Double.isNaN(point.getScale()) || Double.isInfinite(point.getScale()))) {
        errors.add(at + ".scale: must be finite");
      }
      if (point != null && (Double.isNaN(point.getOffset()) || Double.isInfinite(point.getOffset()))) {
        errors.add(at + ".offset: must be finite");
      }
      String topic = point == null || point.getTopic() == null ? "" : point.getTopic().trim();
      String field = point == null ? "" : point.mappedField().trim();
      String mapping = "raw".equals(format) ? topic : topic + "\0" + field;
      if (!mappings.add(mapping)) {
        errors.add(at + ".topic: duplicate mapping");
      }
      out.add(
          new DataPoint(
              id,
              point == null ? 0 : point.getFc(),
              point == null ? 0 : point.getAddress(),
              type,
              point == null ? "high-first" : point.getWordOrder(),
              point == null ? "big" : point.getByteOrder(),
              point == null ? 1 : point.getScale(),
              point == null ? 0 : point.getOffset(),
              point == null ? null : point.getUnit(),
              point == null ? "" : point.getNodeId(),
              topic,
              field,
              point == null ? "" : point.getPath(),
              resolvedTagId(point, id)));
    }
    return out;
  }

  private static CommProperties.Mqtt toProperties(MqttOptions options) {
    MqttOptions src = options == null ? MqttOptions.defaults() : options;
    CommProperties.Mqtt raw = new CommProperties.Mqtt();
    raw.setBrokerUrl(src.brokerUrl());
    raw.setClientIdPrefix(src.clientIdPrefix());
    raw.setSite(src.site());
    raw.setUsername(src.username());
    raw.setPassword(src.password());
    raw.setCleanSession(false);
    raw.setKeepAliveSec(src.keepAliveSec());
    raw.setPayloadFormat(src.payloadFormat());
    raw.setValueField(src.valueField());
    raw.setTsField(src.tsField());
    raw.setQualityField(src.qualityField());
    raw.setSeqField(src.seqField());
    raw.setCommandTopic(src.commandTopic());
    raw.getLwt().setTopic(src.lwtTopic());
    raw.getLwt().setPayload(src.lwtPayload());
    raw.getLwt().setQos(src.lwtQos());
    raw.getLwt().setRetain(src.lwtRetain());
    raw.getTls().setCaFile(src.caFile());
    raw.getTls().setClientCert(src.clientCert());
    raw.getTls().setClientKey(src.clientKey());
    for (MqttOptions.Topic topic : src.topics()) {
      CommProperties.MqttTopic rawTopic = new CommProperties.MqttTopic();
      rawTopic.setFilter(topic.filter());
      rawTopic.setQos(topic.qos());
      raw.getTopics().add(rawTopic);
    }
    return raw;
  }

  private static HttpOptions httpOptions(
      String where,
      CommProperties.Link link,
      List<LinkDefinition.Endpoint> endpoints,
      List<String> errors) {
    CommProperties.Http src = link.getHttp() == null ? new CommProperties.Http() : link.getHttp();
    String base = src.getBaseUrl() == null ? "" : src.getBaseUrl().trim();
    if (base.isEmpty()) {
      errors.add(where + ".http.baseUrl: required");
    } else {
      List<LinkDefinition.Endpoint> parsed = parseHttpBase(where + ".http.baseUrl", base, errors);
      if (endpoints.isEmpty()) endpoints.addAll(parsed);
    }
    CommProperties.HttpAuth auth = src.getAuth() == null ? new CommProperties.HttpAuth() : src.getAuth();
    String type = auth.getType() == null ? "" : auth.getType().trim().toLowerCase(Locale.ROOT);
    if (type.isEmpty()) type = "none";
    if (!type.equals("none") && !type.equals("basic") && !type.equals("bearer") && !type.equals("oauth2")) {
      errors.add(where + ".http.auth.type: must be none, basic, bearer, or oauth2");
    }
    if ("basic".equals(type) && (auth.getUsername() == null || auth.getUsername().isBlank())) {
      errors.add(where + ".http.auth.username: required");
    }
    if ("bearer".equals(type) && (auth.getToken() == null || auth.getToken().isBlank())) {
      errors.add(where + ".http.auth.token: required");
    }
    if ("oauth2".equals(type)) {
      String tokenUrl = auth.getTokenUrl() == null ? "" : auth.getTokenUrl().trim();
      if (tokenUrl.isEmpty()) errors.add(where + ".http.auth.tokenUrl: required");
      else parseHttpBase(where + ".http.auth.tokenUrl", tokenUrl, errors);
      if (auth.getClientId() == null || auth.getClientId().isBlank()) {
        errors.add(where + ".http.auth.clientId: required");
      }
      if (auth.getClientSecret() == null || auth.getClientSecret().isBlank()) {
        errors.add(where + ".http.auth.clientSecret: required");
      }
    }
    Integer rawMax = src.getMaxResponseBytes();
    int max = HttpOptions.DEFAULT_MAX_BYTES;
    if (rawMax != null) {
      if (rawMax <= 0) errors.add(where + ".http.maxResponseBytes: must be > 0");
      else max = rawMax;
    }
    String method = src.getWriteMethod() == null ? "" : src.getWriteMethod().trim().toUpperCase(Locale.ROOT);
    if (method.isEmpty()) method = "POST";
    else if (!method.equals("POST") && !method.equals("PUT")) {
      errors.add(where + ".http.writeMethod: must be POST or PUT");
    }
    CommProperties.HttpProxy proxy = src.getProxy() == null ? new CommProperties.HttpProxy() : src.getProxy();
    String proxyHost = proxy.getHost() == null ? "" : proxy.getHost().trim();
    int proxyPort = proxy.getPort();
    if (!proxyHost.isEmpty() && (proxyPort < 1 || proxyPort > 65535)) {
      errors.add(where + ".http.proxy.port: must be 1..65535");
    }
    CommProperties.Tls tls = src.getTls() == null ? new CommProperties.Tls() : src.getTls();
    Map<String, String> headers = src.getHeaders() == null ? Map.of() : src.getHeaders();
    return new HttpOptions(
        base,
        type,
        auth.getUsername(),
        auth.getPassword(),
        auth.getToken(),
        auth.getTokenUrl(),
        auth.getClientId(),
        auth.getClientSecret(),
        auth.getScope(),
        headers,
        proxyHost,
        proxyPort,
        tls.getCaFile(),
        tls.getClientCert(),
        tls.getClientKey(),
        max,
        src.getHealthPath(),
        src.getWritePath(),
        method,
        src.getTsField());
  }

  private static List<DataPoint> httpPoints(
      String where, List<CommProperties.Point> points, List<String> errors) {
    List<DataPoint> out = new ArrayList<>();
    if (points == null) return out;
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < points.size(); i++) {
      CommProperties.Point point = points.get(i);
      String id = point == null || point.getId() == null ? "" : point.getId().trim();
      String at = where + ".points[" + i + "](" + id + ")";
      if (id.isEmpty()) errors.add(at + ".id: required");
      else if (!seen.add(id)) errors.add(at + ".id: duplicate " + id);
      if (resolvedTagId(point, id).isBlank()) errors.add(at + ".tagId: required");
      String type = point == null || point.getType() == null ? "" : point.getType().trim();
      if (type.isEmpty()) errors.add(at + ".type: required");
      if (point != null && (Double.isNaN(point.getScale()) || Double.isInfinite(point.getScale()))) {
        errors.add(at + ".scale: must be finite");
      }
      if (point != null && (Double.isNaN(point.getOffset()) || Double.isInfinite(point.getOffset()))) {
        errors.add(at + ".offset: must be finite");
      }
      String path = point == null || point.getPath() == null ? "" : point.getPath().trim();
      String jsonPath = point == null ? "" : point.mappedField().trim();
      out.add(
          new DataPoint(
              id,
              point == null ? 0 : point.getFc(),
              point == null ? 0 : point.getAddress(),
              type,
              point == null ? "high-first" : point.getWordOrder(),
              point == null ? "big" : point.getByteOrder(),
              point == null ? 1 : point.getScale(),
              point == null ? 0 : point.getOffset(),
              point == null ? null : point.getUnit(),
              point == null ? "" : point.getNodeId(),
              point == null ? "" : point.getTopic(),
              jsonPath,
              path,
              resolvedTagId(point, id)));
    }
    return out;
  }

  private static CommProperties.Http toProperties(HttpOptions options) {
    HttpOptions src = options == null ? HttpOptions.defaults() : options;
    CommProperties.Http raw = new CommProperties.Http();
    raw.setBaseUrl(src.baseUrl());
    raw.getAuth().setType(src.authType());
    raw.getAuth().setUsername(src.username());
    raw.getAuth().setPassword(src.password());
    raw.getAuth().setToken(src.token());
    raw.getAuth().setTokenUrl(src.tokenUrl());
    raw.getAuth().setClientId(src.clientId());
    raw.getAuth().setClientSecret(src.clientSecret());
    raw.getAuth().setScope(src.scope());
    raw.getHeaders().putAll(src.headers());
    raw.getProxy().setHost(src.proxyHost());
    raw.getProxy().setPort(src.proxyPort());
    raw.getTls().setCaFile(src.caFile());
    raw.getTls().setClientCert(src.clientCert());
    raw.getTls().setClientKey(src.clientKey());
    raw.setMaxResponseBytes(src.maxResponseBytes());
    raw.setHealthPath(src.healthPath());
    raw.setWritePath(src.writePath());
    raw.setWriteMethod(src.writeMethod());
    raw.setTsField(src.tsField());
    return raw;
  }

  private static boolean validQos(int qos) {
    return qos == 0 || qos == 1 || qos == 2;
  }

  private static void requirePositive(List<String> errors, String where, String field, int value) {
    if (value <= 0) errors.add(where + "." + field + ": must be > 0");
  }

  private static List<LinkDefinition.Endpoint> parseHttpBase(
      String label, String url, List<String> errors) {
    List<LinkDefinition.Endpoint> found = new ArrayList<>();
    URI uri;
    try {
      uri = URI.create(url);
    } catch (IllegalArgumentException ex) {
      errors.add(label + ": " + ex.getMessage());
      return found;
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!"http".equals(scheme) && !"https".equals(scheme)) {
      errors.add(label + ": http requires http:// or https://");
      return found;
    }
    if (uri.getHost() == null || uri.getHost().isBlank()) {
      errors.add(label + ": host missing");
      return found;
    }
    int port = uri.getPort();
    if (port == -1) port = "https".equals(scheme) ? 443 : 80;
    if (port < 1 || port > 65535) {
      errors.add(label + ": port out of range");
      return found;
    }
    found.add(new LinkDefinition.Endpoint(uri.getHost(), port));
    return found;
  }

  private static List<LinkDefinition.Endpoint> parseUrl(
      String where, String protocol, String url, List<String> errors) {
    List<LinkDefinition.Endpoint> found = new ArrayList<>();
    URI uri;
    try {
      uri = URI.create(url);
    } catch (IllegalArgumentException ex) {
      errors.add(where + ".endpointUrl: " + ex.getMessage());
      return found;
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if ("opcua".equals(protocol) && !"opc.tcp".equals(scheme)) {
      errors.add(where + ".endpointUrl: opcua requires opc.tcp://");
      return found;
    }
    if ("http".equals(protocol) && !"http".equals(scheme) && !"https".equals(scheme)) {
      errors.add(where + ".endpointUrl: http requires http:// or https://");
      return found;
    }
    if (uri.getHost() == null || uri.getHost().isBlank()) {
      errors.add(where + ".endpointUrl: host missing");
      return found;
    }
    int port = uri.getPort();
    if (port == -1) port = "https".equals(scheme) ? 443 : "opc.tcp".equals(scheme) ? 4840 : 80;
    if (port < 1 || port > 65535) {
      errors.add(where + ".endpointUrl: port out of range");
      return found;
    }
    found.add(new LinkDefinition.Endpoint(uri.getHost(), port));
    return found;
  }

  /** 没写 tagId 时等于点 id。两者都空则留给调用方报 tagId required。 */
  private static String resolvedTagId(CommProperties.Point point, String id) {
    String fallback = id == null ? "" : id;
    if (point == null || point.getTagId() == null || point.getTagId().isBlank()) return fallback;
    return point.getTagId().trim();
  }

  public record Result(List<LinkDefinition> links, List<String> errors) {
    public boolean ok() {
      return errors.isEmpty();
    }
  }
}
