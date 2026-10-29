package com.webscada.server.comm.driver.opcua;

import static org.eclipse.milo.opcua.stack.core.types.builtin.unsigned.Unsigned.uint;

import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.config.OpcUaOptions;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.security.KeyPair;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.eclipse.milo.opcua.sdk.client.DiscoveryClient;
import org.eclipse.milo.opcua.sdk.client.OpcUaClient;
import org.eclipse.milo.opcua.sdk.client.OpcUaClientConfig;
import org.eclipse.milo.opcua.sdk.client.OpcUaClientConfigBuilder;
import org.eclipse.milo.opcua.sdk.client.SessionActivityListener;
import org.eclipse.milo.opcua.sdk.client.UaSession;
import org.eclipse.milo.opcua.sdk.client.identity.AnonymousProvider;
import org.eclipse.milo.opcua.sdk.client.subscriptions.OpcUaMonitoredItem;
import org.eclipse.milo.opcua.sdk.client.subscriptions.OpcUaSubscription;
import org.eclipse.milo.opcua.stack.core.UaException;
import org.eclipse.milo.opcua.stack.core.security.CertificateValidator;
import org.eclipse.milo.opcua.stack.core.security.DefaultClientCertificateValidator;
import org.eclipse.milo.opcua.stack.core.security.FileBasedTrustListManager;
import org.eclipse.milo.opcua.stack.core.security.MemoryCertificateQuarantine;
import org.eclipse.milo.opcua.stack.core.security.SecurityPolicy;
import org.eclipse.milo.opcua.stack.core.types.builtin.DataValue;
import org.eclipse.milo.opcua.stack.core.types.builtin.LocalizedText;
import org.eclipse.milo.opcua.stack.core.types.builtin.NodeId;
import org.eclipse.milo.opcua.stack.core.types.builtin.StatusCode;
import org.eclipse.milo.opcua.stack.core.types.builtin.Variant;
import org.eclipse.milo.opcua.stack.core.types.enumerated.DataChangeTrigger;
import org.eclipse.milo.opcua.stack.core.types.enumerated.DeadbandType;
import org.eclipse.milo.opcua.stack.core.types.enumerated.MessageSecurityMode;
import org.eclipse.milo.opcua.stack.core.types.enumerated.TimestampsToReturn;
import org.eclipse.milo.opcua.stack.core.types.structured.DataChangeFilter;
import org.eclipse.milo.opcua.stack.core.types.structured.EndpointDescription;
import org.eclipse.milo.opcua.stack.core.util.EndpointUtil;

/**
 * OPC UA 客户端。不在内部重连，也不调用 TransferSubscriptions。
 * 会话掉线后由 Supervisor 断开并新建会话、重建订阅。
 */
public final class OpcUaDriver implements ProtocolDriver {
  private static final NodeId SERVER_STATE = NodeId.parse("ns=0;i=2259");

  private final AtomicBoolean busy = new AtomicBoolean();
  private final Object lock = new Object();
  private volatile LinkDefinition link;
  private volatile OpcUaClient client;
  private volatile boolean closing;
  private volatile boolean broken;

  public OpcUaDriver(LinkDefinition link) {
    this.link = link;
  }

  public void rebind(LinkDefinition next) {
    this.link = next;
  }

  @Override
  public String name() {
    return "opcua";
  }

  @Override
  public boolean supportsSubscription() {
    return link.opcua().subscriptionEnabled();
  }

  @Override
  public long resyncIntervalMs(LinkDefinition link) {
    if (link.opcua().subscriptionEnabled()) return link.opcua().resyncIntervalMs();
    return link.pollIntervalMs();
  }

  @Override
  public long silenceTimeoutMs(LinkDefinition link) {
    if (!link.opcua().subscriptionEnabled()) return 0L;
    return (long) link.opcua().keepAliveCount() * link.opcua().publishingIntervalMs() * 2L;
  }

  @Override
  public int notificationQueueSize(LinkDefinition link) {
    return Math.max(1, link.opcua().notificationQueueSize());
  }

  @Override
  public void connect(DriverContext ctx) throws CommException {
    enter();
    try {
      disconnectQuiet();
      closing = false;
      broken = false;
      long deadline = System.nanoTime() + Math.max(1, ctx.connectTimeoutMs()) * 1_000_000L;
      String url = endpointUrl(ctx);
      List<EndpointDescription> found = await(DiscoveryClient.getEndpoints(url), deadline, "discovery");
      EndpointDescription selected = select(found, link.opcua());
      String override = link.opcua().endpointUrlOverride();
      String forced = override == null || override.isBlank() ? url : override;
      String host = EndpointUtil.getHost(forced);
      int port = EndpointUtil.getPort(forced);
      if (host == null || host.isBlank() || port <= 0) {
        throw config("endpoint url has no host/port: " + forced);
      }
      selected = EndpointUtil.updateUrl(selected, host, port);
      if (SecurityPolicy.None.getUri().equals(selected.getSecurityPolicyUri())) {
        ctx.log().warn("security_none", "SECURITY", "SecurityPolicy=None", null, null, ctx.sessionId(), ctx.correlationId());
      }
      OpcUaClient created = OpcUaClient.create(config(ctx, selected));
      created.addSessionActivityListener(
          new SessionActivityListener() {
            @Override
            public void onSessionInactive(UaSession session) {
              if (!closing) broken = true;
            }
          });
      await(created.connectAsync(), deadline, "connect");
      synchronized (lock) {
        client = created;
      }
      Double timeout = created.getSession().getSessionTimeout();
      ctx.log()
          .info(
              "opcua_session",
              "SESSION",
              "sessionTimeoutMs=" + timeout + " channel token renewal is handled by Milo",
              null,
              null,
              ctx.sessionId(),
              ctx.correlationId());
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw translate(ex, true);
    } finally {
      leave();
    }
  }

  @Override
  public void disconnect() {
    closing = true;
    disconnectQuiet();
    broken = false;
    closing = false;
  }

  @Override
  public Health healthCheck(DriverContext ctx) throws CommException {
    enter();
    try {
      ensureUp();
      String configured = link.opcua().healthNodeId();
      NodeId node = configured == null || configured.isBlank() ? SERVER_STATE : NodeId.parse(configured);
      DataValue value = readOne(ctx, node);
      OpcUaStatus.Mapped mapped = OpcUaStatus.map(value.getStatusCode());
      if (mapped.logStatus()) {
        ctx.log()
            .warn(
                "health_status",
                "HEALTH",
                String.valueOf(value.getStatusCode()),
                null,
                null,
                ctx.sessionId(),
                ctx.correlationId());
      }
      if (mapped.quality() == Quality.UNCERTAIN) {
        ctx.log()
            .warn(
                "health_uncertain",
                "HEALTH",
                String.valueOf(value.getStatusCode()),
                null,
                null,
                ctx.sessionId(),
                ctx.correlationId());
        return Health.OK;
      }
      if (mapped.quality() == Quality.GOOD) return Health.OK;
      return Health.FAILED;
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw translate(ex, false);
    } finally {
      leave();
    }
  }

  @Override
  public IoResult read(DriverContext ctx, IoRequest request) throws CommException {
    enter();
    try {
      ensureUp();
      List<DataPoint> points = points();
      List<NodeId> nodes = new ArrayList<>();
      List<DataPoint> readable = new ArrayList<>();
      List<IoResult.PointUpdate> updates = new ArrayList<>();
      for (DataPoint point : points) {
        try {
          nodes.add(NodeId.parse(point.nodeId()));
          readable.add(point);
        } catch (RuntimeException ex) {
          updates.add(new IoResult.PointUpdate(point.id(), null, Quality.BAD_CONFIG));
        }
      }
      if (!nodes.isEmpty()) {
        List<DataValue> values =
            await(
                client().readValuesAsync(0, TimestampsToReturn.Both, nodes),
                System.nanoTime() + Math.max(1, ctx.responseTimeoutMs()) * 1_000_000L,
                "read");
        for (int i = 0; i < readable.size(); i++) {
          DataValue value = i < values.size() ? values.get(i) : null;
          OpcUaValues.Decoded decoded = OpcUaValues.decode(readable.get(i), value);
          if (decoded.quality() == Quality.BAD_CONFIG || decoded.quality() == Quality.BAD_DEVICE) {
            ctx.log()
                .warn(
                    "decode_rejected",
                    "OPCUA",
                    readable.get(i).id() + " " + decoded.detail(),
                    null,
                    null,
                    ctx.sessionId(),
                    ctx.correlationId());
          }
          updates.add(
              new IoResult.PointUpdate(
                  readable.get(i).id(), decoded.value(), decoded.quality(), OpcUaValues.sourceMillis(value)));
        }
      }
      return new IoResult(true, ctx.correlationId(), updates, null);
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw translate(ex, false);
    } finally {
      leave();
    }
  }

  @Override
  public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
    enter();
    try {
      ensureUp();
      if (request == null || request.pointId() == null || request.pointId().isBlank()) {
        throw config("write pointId required");
      }
      DataPoint point = find(request.pointId());
      Variant sent = OpcUaValues.encode(point, request.value());
      int attempts = Math.max(0, link.writeRetries());
      for (int i = 0; ; i++) {
        StatusCode code = writeOne(ctx, NodeId.parse(point.nodeId()), sent);
        OpcUaStatus.Mapped mapped = OpcUaStatus.map(code);
        if (mapped.quality() != Quality.GOOD) {
          if (mapped.logStatus()) {
            ctx.log()
                .warn("write_status", "WRITE", String.valueOf(code), null, null, ctx.sessionId(), ctx.correlationId());
          }
          return new IoResult(
              false,
              ctx.correlationId(),
              List.of(new IoResult.PointUpdate(point.id(), null, mapped.quality())),
              null);
        }
        if (i >= attempts) break;
        DataValue back = readOne(ctx, NodeId.parse(point.nodeId()));
        if (OpcUaValues.sameVariant(sent, back.getValue())) break;
        ctx.log()
            .warn(
                "write_retry",
                "WRITE",
                "可能重复 point=" + point.id(),
                null,
                i + 1,
                ctx.sessionId(),
                ctx.correlationId());
      }
      return new IoResult(true, ctx.correlationId(), List.of(), null);
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw translate(ex, false);
    } finally {
      leave();
    }
  }

  @Override
  public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException {
    enter();
    try {
      ensureUp();
      OpcUaOptions options = link.opcua();
      OpcUaSubscription subscription = new OpcUaSubscription(client(), options.publishingIntervalMs());
      subscription.setLifetimeAndKeepAliveCalculated(false);
      subscription.setMaxKeepAliveCount(uint(options.keepAliveCount()));
      subscription.setLifetimeCount(uint(options.lifetimeCount()));
      subscription.setMaxNotificationsPerPublish(uint(Math.max(0, options.maxNotificationsPerPublish())));
      subscription.setWatchdogMultiplier(2.0);
      List<DataPoint> points = points();
      Map<NodeId, DataPoint> byNode = new HashMap<>();
      int items = 0;
      for (DataPoint point : points) {
        NodeId nodeId = NodeId.parse(point.nodeId());
        OpcUaMonitoredItem item = OpcUaMonitoredItem.newDataItem(nodeId);
        double sampling = options.samplingIntervalMs() > 0 ? options.samplingIntervalMs() : options.publishingIntervalMs();
        item.setSamplingInterval(sampling);
        item.setQueueSize(uint(options.queueSize()));
        item.setDiscardOldest(true);
        if (options.deadband() > 0) {
          item.setFilter(
              new DataChangeFilter(
                  DataChangeTrigger.StatusValue, uint(DeadbandType.Absolute.getValue()), options.deadband()));
        }
        subscription.addMonitoredItem(item);
        byNode.put(nodeId, point);
        items++;
      }
      subscription.setSubscriptionListener(
          new OpcUaSubscription.SubscriptionListener() {
            @Override
            public void onDataReceived(
                OpcUaSubscription sub, List<OpcUaMonitoredItem> changed, List<DataValue> values) {
              List<IoResult.PointUpdate> updates = new ArrayList<>();
              for (int i = 0; i < changed.size(); i++) {
                NodeId nodeId = changed.get(i).getReadValueId().getNodeId();
                DataPoint point = byNode.get(nodeId);
                if (point == null) continue;
                DataValue value = i < values.size() ? values.get(i) : null;
                OpcUaValues.Decoded decoded = OpcUaValues.decode(point, value);
                updates.add(
                    new IoResult.PointUpdate(
                        point.id(), decoded.value(), decoded.quality(), OpcUaValues.sourceMillis(value)));
              }
              callback.accept(new IoResult(true, ctx.correlationId(), updates, null));
            }

            @Override
            public void onKeepAliveReceived(OpcUaSubscription sub) {
              callback.accept(new IoResult(true, "keepalive", List.of(), null));
            }

            @Override
            public void onWatchdogTimerElapsed(OpcUaSubscription sub) {
              callback.accept(
                  new IoResult(
                      false,
                      ctx.correlationId(),
                      List.of(),
                      new CommException(ErrorCategory.TIMEOUT, true, false, "subscription silent")));
            }
          });
      subscription.create();
      subscription.synchronizeMonitoredItems();
      ctx.log()
          .info(
              "opcua_subscription",
              "SUBSCRIBE",
              "publishingIntervalMs="
                  + options.publishingIntervalMs()
                  + " keepAlive="
                  + options.keepAliveCount()
                  + " lifetime="
                  + options.lifetimeCount()
                  + " items="
                  + items,
              null,
              null,
              ctx.sessionId(),
              ctx.correlationId());
      return () -> {
        try {
          subscription.delete();
        } catch (Exception ignored) {
          // 关闭是尽力而为。
        }
      };
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw translate(ex, false);
    } finally {
      leave();
    }
  }

  private DataValue readOne(DriverContext ctx, NodeId node) throws Exception {
    List<DataValue> values =
        await(
            client().readValuesAsync(0, TimestampsToReturn.Both, List.of(node)),
            System.nanoTime() + Math.max(1, ctx.responseTimeoutMs()) * 1_000_000L,
            "read");
    if (values.isEmpty()) throw config("empty read");
    return values.get(0);
  }

  private StatusCode writeOne(DriverContext ctx, NodeId node, Variant variant) throws Exception {
    List<StatusCode> codes =
        await(
            client().writeValuesAsync(List.of(node), List.of(new DataValue(variant))),
            System.nanoTime() + Math.max(1, ctx.responseTimeoutMs()) * 1_000_000L,
            "write");
    if (codes.isEmpty()) throw config("empty write");
    return codes.get(0);
  }

  private OpcUaClientConfig config(DriverContext ctx, EndpointDescription endpoint) throws Exception {
    OpcUaOptions options = link.opcua();
    OpcUaClientConfigBuilder builder = new OpcUaClientConfigBuilder();
    builder.setApplicationName(LocalizedText.english("webscada-" + link.id()));
    builder.setApplicationUri("urn:webscada:client:" + link.id());
    builder.setProductUri("urn:webscada:client");
    builder.setEndpoint(endpoint);
    builder.setIdentityProvider(new AnonymousProvider());
    builder.setSessionTimeout(uint(options.sessionTimeoutMs()));
    builder.setRequestTimeout(uint(Math.max(1, ctx.responseTimeoutMs())));
    builder.setKeepAliveFailuresAllowed(uint(1));
    builder.setSessionEndpointValidationEnabled(false);
    SecurityPolicy policy = policy(options.securityPolicy());
    if (policy == SecurityPolicy.None) {
      builder.setCertificateValidator(new CertificateValidator.InsecureCertificateValidator());
    } else {
      KeyPair keys = OpcUaCertificates.loadKeyPair(options.clientCert(), options.clientKey());
      X509Certificate certificate = OpcUaCertificates.loadCertificate(options.clientCert());
      builder.setKeyPair(keys);
      builder.setCertificate(certificate);
      builder.setCertificateChain(new X509Certificate[] {certificate});
      FileBasedTrustListManager trust =
          FileBasedTrustListManager.createAndInitialize(java.nio.file.Path.of(options.trustListDir()));
      builder.setCertificateValidator(
          new DefaultClientCertificateValidator(trust, new MemoryCertificateQuarantine()));
    }
    builder.setSecurityKeysListener(
        keys ->
            ctx.log()
                .info(
                    "opcua_channel",
                    "CHANNEL",
                    "channelId=" + keys.channelId() + " tokenId=" + keys.tokenId(),
                    null,
                    null,
                    ctx.sessionId(),
                    ctx.correlationId()));
    return builder.build();
  }

  private static EndpointDescription select(List<EndpointDescription> found, OpcUaOptions options)
      throws CommException {
    SecurityPolicy policy = policy(options.securityPolicy());
    MessageSecurityMode mode = mode(options.securityMode());
    for (EndpointDescription endpoint : found) {
      if (policy.getUri().equals(endpoint.getSecurityPolicyUri()) && endpoint.getSecurityMode() == mode) {
        return endpoint;
      }
    }
    throw config("no endpoint for " + options.securityPolicy() + "/" + options.securityMode());
  }

  private String endpointUrl(DriverContext ctx) {
    if (link.endpointUrl() != null && !link.endpointUrl().isBlank()) return link.endpointUrl();
    return "opc.tcp://" + ctx.endpoint().host() + ":" + ctx.endpoint().port();
  }

  private List<DataPoint> points() {
    List<DataPoint> out = new ArrayList<>();
    for (DataPoint point : link.points()) {
      if (point.nodeId() != null && !point.nodeId().isBlank()) out.add(point);
    }
    return out;
  }

  private DataPoint find(String id) throws CommException {
    for (DataPoint point : points()) {
      if (id.equals(point.id())) return point;
    }
    throw config("unknown point " + id);
  }

  private void ensureUp() throws CommException {
    if (broken || client() == null) {
      throw new CommException(ErrorCategory.CONNECT, true, true, "session inactive");
    }
  }

  private OpcUaClient client() throws CommException {
    OpcUaClient current;
    synchronized (lock) {
      current = client;
    }
    if (current == null) throw new CommException(ErrorCategory.CONNECT, true, true, "not connected");
    return current;
  }

  private void disconnectQuiet() {
    OpcUaClient current;
    synchronized (lock) {
      current = client;
      client = null;
    }
    if (current == null) return;
    try {
      current.disconnectAsync().get(2, TimeUnit.SECONDS);
    } catch (Exception ignored) {
      // 关闭是尽力而为。
    }
  }

  private static <T> T await(java.util.concurrent.CompletionStage<T> stage, long deadlineNs, String op)
      throws Exception {
    long left = deadlineNs - System.nanoTime();
    if (left <= 0) throw new CommException(ErrorCategory.TIMEOUT, true, false, op + " timeout");
    try {
      return stage.toCompletableFuture().get(Math.max(1, TimeUnit.NANOSECONDS.toMillis(left)), TimeUnit.MILLISECONDS);
    } catch (TimeoutException ex) {
      stage.toCompletableFuture().cancel(true);
      throw new CommException(ErrorCategory.TIMEOUT, true, false, op + " timeout", ex);
    }
  }

  private static CommException translate(Throwable ex, boolean connect) {
    Throwable current = ex;
    while (current.getCause() != null && current.getCause() != current && !(current instanceof UaException)) {
      current = current.getCause();
    }
    if (current instanceof CommException comm) return comm;
    if (current instanceof TimeoutException) {
      return new CommException(ErrorCategory.TIMEOUT, true, false, "response timeout", current);
    }
    if (current instanceof UaException ua) {
      StatusCode status = ua.getStatusCode();
      String hint = OpcUaStatus.clockSkew(status) ? " 可能时钟偏差" : "";
      if (status != null && (OpcUaStatus.clockSkew(status) || status.getValue() == org.eclipse.milo.opcua.stack.core.StatusCodes.Bad_SecurityChecksFailed
          || status.getValue() == org.eclipse.milo.opcua.stack.core.StatusCodes.Bad_CertificateInvalid)) {
        return new CommException(
            ErrorCategory.CONFIG, false, false, "certificate rejected: " + status + hint, ua);
      }
      if (status != null && status.getValue() == org.eclipse.milo.opcua.stack.core.StatusCodes.Bad_Timeout) {
        return new CommException(ErrorCategory.TIMEOUT, true, false, ua.getMessage(), ua);
      }
    }
    String message = current.getMessage() == null ? current.toString() : current.getMessage();
    if (connect) return new CommException(ErrorCategory.CONNECT, true, true, message, current);
    return new CommException(ErrorCategory.CONNECT, true, false, message, current);
  }

  private static SecurityPolicy policy(String name) throws CommException {
    if (name == null || name.equalsIgnoreCase("None")) return SecurityPolicy.None;
    if (name.equalsIgnoreCase("Basic256Sha256")) return SecurityPolicy.Basic256Sha256;
    throw config("securityPolicy " + name);
  }

  private static MessageSecurityMode mode(String name) throws CommException {
    if (name == null || name.isBlank() || name.equalsIgnoreCase("None")) return MessageSecurityMode.None;
    if (name.equalsIgnoreCase("Sign")) return MessageSecurityMode.Sign;
    if (name.equalsIgnoreCase("SignAndEncrypt")) return MessageSecurityMode.SignAndEncrypt;
    throw config("securityMode " + name);
  }

  private void enter() {
    if (!busy.compareAndSet(false, true)) {
      throw new IllegalStateException("opcua: one request in flight");
    }
  }

  private void leave() {
    busy.set(false);
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }

}
