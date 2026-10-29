package com.webscada.server.comm.driver.opcua;

import java.net.ServerSocket;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.eclipse.milo.opcua.sdk.core.AccessLevel;
import org.eclipse.milo.opcua.sdk.server.LifecycleManager;
import org.eclipse.milo.opcua.sdk.server.ManagedNamespaceWithLifecycle;
import org.eclipse.milo.opcua.sdk.server.OpcUaServer;
import org.eclipse.milo.opcua.sdk.server.items.DataItem;
import org.eclipse.milo.opcua.sdk.server.items.MonitoredItem;
import org.eclipse.milo.opcua.sdk.server.util.SubscriptionModel;
import org.eclipse.milo.opcua.sdk.server.OpcUaServerConfig;
import org.eclipse.milo.opcua.sdk.server.OpcUaServerConfigBuilder;
import org.eclipse.milo.opcua.sdk.server.EndpointConfig;
import org.eclipse.milo.opcua.sdk.server.nodes.UaVariableNode;
import org.eclipse.milo.opcua.sdk.server.nodes.filters.AttributeFilter;
import org.eclipse.milo.opcua.stack.core.NodeIds;
import org.eclipse.milo.opcua.stack.core.AttributeId;
import org.eclipse.milo.opcua.stack.core.security.DefaultCertificateManager;
import org.eclipse.milo.opcua.stack.core.security.MemoryCertificateQuarantine;
import org.eclipse.milo.opcua.stack.core.security.SecurityPolicy;
import org.eclipse.milo.opcua.stack.core.types.builtin.DataValue;
import org.eclipse.milo.opcua.stack.core.types.builtin.LocalizedText;
import org.eclipse.milo.opcua.stack.core.types.builtin.NodeId;
import org.eclipse.milo.opcua.stack.core.types.builtin.QualifiedName;
import org.eclipse.milo.opcua.stack.core.types.builtin.Variant;
import org.eclipse.milo.opcua.stack.core.types.enumerated.MessageSecurityMode;
import org.eclipse.milo.opcua.stack.core.types.enumerated.UserTokenType;
import org.eclipse.milo.opcua.stack.core.types.structured.UserTokenPolicy;
import org.eclipse.milo.opcua.stack.transport.server.tcp.OpcTcpServerTransport;
import org.eclipse.milo.opcua.stack.transport.server.tcp.OpcTcpServerTransportConfig;

/** 本机 SecurityPolicy=None 的最小地址空间，只给测试用。 */
public final class OpcUaTestServer implements AutoCloseable {
  public final AtomicInteger reads = new AtomicInteger();
  private OpcUaServer server;
  private TestSpace space;
  private final int port;
  private double tempValue = 1.25;
  private double flowValue = 2.5;

  public OpcUaTestServer() throws Exception {
    int chosen;
    try (ServerSocket socket = new ServerSocket(0)) {
      chosen = socket.getLocalPort();
    }
    this.port = chosen;
    open();
  }

  private void open() throws Exception {
    EndpointConfig endpoint =
        EndpointConfig.newBuilder()
            .setBindAddress("127.0.0.1")
            .setHostname("127.0.0.1")
            .setBindPort(port)
            .setSecurityPolicy(SecurityPolicy.None)
            .setSecurityMode(MessageSecurityMode.None)
            .addTokenPolicy(new UserTokenPolicy("anonymous", UserTokenType.Anonymous, null, null, null))
            .build();
    OpcUaServerConfig config =
        new OpcUaServerConfigBuilder()
            .setApplicationName(LocalizedText.english("webscada-test"))
            .setApplicationUri("urn:webscada:test")
            .setProductUri("urn:webscada:test")
            .setCertificateManager(new DefaultCertificateManager(new MemoryCertificateQuarantine()))
            .setEndpoints(Set.of(endpoint))
            .build();
    server =
        new OpcUaServer(
            config, profile -> new OpcTcpServerTransport(OpcTcpServerTransportConfig.newBuilder().build()));
    space = new TestSpace(server, reads, tempValue, flowValue);
    server.startup().get(5, TimeUnit.SECONDS);
    space.startup();
  }

  public int port() {
    return port;
  }

  public String endpointUrl() {
    return "opc.tcp://127.0.0.1:" + port;
  }

  public int namespaceIndex() {
    return space.namespaceIndex();
  }

  public void setTemp(double value) {
    tempValue = value;
    space.temp.setValue(new DataValue(new Variant(value)));
  }

  public void stop() throws Exception {
    tempValue = current(space.temp, tempValue);
    flowValue = current(space.flow, flowValue);
    try {
      space.shutdown();
    } catch (RuntimeException ignored) {
      // 旧地址空间已停。
    }
    server.shutdown().get(5, TimeUnit.SECONDS);
  }

  public void start() throws Exception {
    open();
  }

  private static double current(UaVariableNode node, double fallback) {
    if (node == null || node.getValue() == null || node.getValue().getValue() == null) return fallback;
    Object raw = node.getValue().getValue().getValue();
    return raw instanceof Number number ? number.doubleValue() : fallback;
  }

  @Override
  public void close() throws Exception {
    try {
      space.shutdown();
    } catch (RuntimeException ignored) {
      // 测试服务器关闭。
    }
    server.shutdown().get(5, TimeUnit.SECONDS);
  }

  private static final class TestSpace extends ManagedNamespaceWithLifecycle {
    private final SubscriptionModel subscriptionModel;
    UaVariableNode temp;
    UaVariableNode flow;

    TestSpace(OpcUaServer server, AtomicInteger reads, double tempValue, double flowValue) {
      super(server, "urn:webscada:test:nodes");
      subscriptionModel = new SubscriptionModel(server, this);
      getLifecycleManager().addLifecycle(subscriptionModel);
      getLifecycleManager().addStartupTask(() -> addNodes(reads, tempValue, flowValue));
    }

    int namespaceIndex() {
      return getNamespaceIndex().intValue();
    }

    @Override
    public void onDataItemsCreated(List<DataItem> items) {
      subscriptionModel.onDataItemsCreated(items);
    }

    @Override
    public void onDataItemsModified(List<DataItem> items) {
      subscriptionModel.onDataItemsModified(items);
    }

    @Override
    public void onDataItemsDeleted(List<DataItem> items) {
      subscriptionModel.onDataItemsDeleted(items);
    }

    @Override
    public void onMonitoringModeChanged(List<MonitoredItem> items) {
      subscriptionModel.onMonitoringModeChanged(items);
    }

    private void addNodes(AtomicInteger reads, double tempValue, double flowValue) {
      int index = getNamespaceIndex().intValue();
      temp = variable(index, "temp", tempValue, reads);
      flow = variable(index, "flow", flowValue, reads);
    }

    private UaVariableNode variable(int index, String name, double value, AtomicInteger reads) {
      UaVariableNode node =
          new UaVariableNode.UaVariableNodeBuilder(getNodeContext())
              .setNodeId(new NodeId(index, name))
              .setBrowseName(new QualifiedName(index, name))
              .setDisplayName(LocalizedText.english(name))
              .setDataType(NodeIds.Double)
              .setAccessLevel(AccessLevel.CurrentRead, AccessLevel.CurrentWrite)
              .setUserAccessLevel(AccessLevel.CurrentRead, AccessLevel.CurrentWrite)
              .setValue(new DataValue(new Variant(value)))
              .build();
      node.getFilterChain()
          .addLast(
              new AttributeFilter() {
                @Override
                public Object readAttribute(
                    org.eclipse.milo.opcua.sdk.server.nodes.filters.AttributeFilterContext context,
                    AttributeId attributeId)
                    throws org.eclipse.milo.opcua.stack.core.UaException {
                  if (attributeId == AttributeId.Value) reads.incrementAndGet();
                  return context.readAttribute(attributeId);
                }
              });
      getNodeManager().addNode(node);
      return node;
    }

    @SuppressWarnings("unused")
    LifecycleManager manager() {
      return getLifecycleManager();
    }
  }
}
