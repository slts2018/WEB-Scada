package com.webscada.server.comm.driver.mqtt;

import io.moquette.broker.Server;
import io.moquette.broker.config.IConfig;
import io.moquette.broker.config.MemoryConfig;
import io.moquette.broker.security.IAuthenticator;
import io.moquette.broker.security.PermitAllAuthorizatorPolicy;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/** 本机 Moquette。随机端口，测完关掉。 */
final class MqttBroker implements AutoCloseable {
  final int port;
  final String url;
  private final Server server = new Server();
  private final Path data;

  private MqttBroker(int port, boolean anonymous, IAuthenticator authenticator) throws Exception {
    this.port = port;
    this.url = "tcp://127.0.0.1:" + port;
    this.data = Files.createTempDirectory("mqtt-broker-");
    Properties props = new Properties();
    props.setProperty(IConfig.PORT_PROPERTY_NAME, Integer.toString(port));
    props.setProperty(IConfig.HOST_PROPERTY_NAME, "127.0.0.1");
    props.setProperty(IConfig.ALLOW_ANONYMOUS_PROPERTY_NAME, Boolean.toString(anonymous));
    props.setProperty(IConfig.PERSISTENCE_ENABLED_PROPERTY_NAME, "false");
    props.setProperty(IConfig.DATA_PATH_PROPERTY_NAME, data.toString());
    MemoryConfig config = new MemoryConfig(props);
    if (authenticator == null) {
      server.startServer(config);
    } else {
      server.startServer(config, null, null, authenticator, new PermitAllAuthorizatorPolicy());
    }
  }

  static MqttBroker open() throws Exception {
    return new MqttBroker(freePort(), true, null);
  }

  static MqttBroker password(String username, String password) throws Exception {
    IAuthenticator auth =
        (clientId, user, secret) ->
            username.equals(user) && secret != null && password.equals(new String(secret));
    return new MqttBroker(freePort(), false, auth);
  }

  private static int freePort() throws Exception {
    try (ServerSocket socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }

  @Override
  public void close() {
    try {
      server.stopServer();
    } catch (RuntimeException ignored) {
      // 已经停了。
    }
  }
}
