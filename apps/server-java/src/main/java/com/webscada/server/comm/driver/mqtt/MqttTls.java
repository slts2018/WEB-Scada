package com.webscada.server.comm.driver.mqtt;

import com.webscada.server.comm.config.MqttOptions;
import com.webscada.server.comm.driver.TlsSupport;
import com.webscada.server.comm.error.CommException;
import javax.net.ssl.SSLSocketFactory;

/** ssl:// 用的套接字工厂。证书和私钥加载在 {@link TlsSupport}。 */
final class MqttTls {
  private MqttTls() {}

  static SSLSocketFactory factory(MqttOptions options) throws CommException {
    return TlsSupport.socketFactory(options.caFile(), options.clientCert(), options.clientKey());
  }
}
