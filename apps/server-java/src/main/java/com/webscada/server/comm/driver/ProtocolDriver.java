package com.webscada.server.comm.driver;

import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.error.CommException;
import java.util.function.Consumer;

/**
 * 单协议驱动。connect 失败抛 {@link CommException}，不得在内部重试或重连。
 * Modbus TCP 在 {@code driver.modbus}，OPC UA 在 {@code driver.opcua}，MQTT 3.1.1 在 {@code driver.mqtt}，
 * HTTP 在 {@code driver.http}。
 */
public interface ProtocolDriver {
  String name();

  void connect(DriverContext ctx) throws CommException;

  /** 幂等。可从 IO 线程被中断。 */
  void disconnect();

  Health healthCheck(DriverContext ctx) throws CommException;

  IoResult read(DriverContext ctx, IoRequest request) throws CommException;

  IoResult write(DriverContext ctx, IoRequest request) throws CommException;

  Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException;

  /** OPC UA 或 MQTT 打开订阅时为 true。默认驱动只做周期读。 */
  default boolean supportsSubscription() {
    return false;
  }

  /**
   * 订阅期间的对账读间隔。默认就是周期采集间隔。
   * 返回值 &lt;= 0 表示没有周期对账，Supervisor 不再排下一次读。
   */
  default long resyncIntervalMs(LinkDefinition link) {
    return link.pollIntervalMs();
  }

  /** 订阅静默多久才重建。0 表示不做静默判定。 */
  default long silenceTimeoutMs(LinkDefinition link) {
    return 0L;
  }

  /**
   * 订阅通知队列长度。默认 256。
   * 各协议自己决定，Supervisor 不再读 OPC UA 的配置。
   */
  default int notificationQueueSize(LinkDefinition link) {
    return 256;
  }
}
