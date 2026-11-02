package com.webscada.server.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.device.mcd4000.Mcd4000Channel;
import com.webscada.server.device.mcd4000.Mcd4000Client;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * 一次性连通性探测（不启动 Comm 采集、不改设备状态）。
 * Modbus：TCP + 读保持寄存器探测；OPC/MQTT：TCP；HTTP/MCD：HTTP GET。
 */
@Service
public class DeviceConnectionProbeService {
  private static final int CONNECT_MS = 3000;
  private static final int IO_MS = 3000;

  private final ScadaProperties props;
  private final ObjectMapper mapper;
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofMillis(CONNECT_MS))
          .followRedirects(HttpClient.Redirect.NORMAL)
          .build();

  public DeviceConnectionProbeService(ScadaProperties props, ObjectMapper mapper) {
    this.props = props;
    this.mapper = mapper;
  }

  public Map<String, Object> probe(String protocol, String channel) {
    String proto = protocol == null ? "" : protocol.trim().toLowerCase(Locale.ROOT);
    String ch = channel == null ? "" : channel.trim();
    return switch (proto) {
      case "mock" -> ok("Mock 设备无需网络连接");
      case "modbus_tcp", "modbus-tcp" -> modbus(ch);
      case "opcua" -> opcua(ch);
      case "mqtt" -> mqtt(ch);
      case "http" -> httpGet(ch, "HTTP");
      case "mcd4000" -> mcd4000(ch);
      case "other", "" -> fail("该协议不支持测试连接");
      default -> fail("不支持的协议: " + protocol);
    };
  }

  private Map<String, Object> modbus(String channel) {
    HostPort hp = parseHostPort(channel, 502);
    if (hp == null) return fail("请填写主机和端口，如 192.168.1.10:502");
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(hp.host, hp.port), CONNECT_MS);
      socket.setTcpNoDelay(true);
      socket.setSoTimeout(IO_MS);
      // unit=1, FC03, addr=0, count=1
      byte[] req =
          new byte[] {
            0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x00, 0x00, 0x00, 0x01
          };
      OutputStream out = socket.getOutputStream();
      out.write(req);
      out.flush();
      InputStream in = socket.getInputStream();
      byte[] buf = new byte[256];
      int n = in.read(buf);
      if (n < 9) {
        return fail("TCP 已连通，但未收到有效 Modbus 响应");
      }
      int protoId = ((buf[2] & 0xff) << 8) | (buf[3] & 0xff);
      if (protoId != 0) {
        return fail("收到非 Modbus TCP 响应（protocolId=" + protoId + "）");
      }
      int fc = buf[7] & 0xff;
      if ((fc & 0x80) != 0) {
        int ex = n > 8 ? (buf[8] & 0xff) : -1;
        return ok(
            "Modbus 已连通（设备返回异常码 "
                + ex
                + "，属正常应答，说明链路可用）");
      }
      return ok("Modbus TCP 已连通 " + hp.host + ":" + hp.port);
    } catch (Exception e) {
      return fail(shortMsg(e));
    }
  }

  private Map<String, Object> opcua(String channel) {
    HostPort hp = parseOpcUa(channel);
    if (hp == null) {
      return fail("请填写 Endpoint，如 opc.tcp://192.168.1.10:4840");
    }
    return tcp(hp.host, hp.port, "OPC UA TCP");
  }

  private Map<String, Object> mqtt(String channel) {
    String broker = channel;
    int bar = channel.indexOf('|');
    if (bar >= 0) broker = channel.substring(0, bar).trim();
    HostPort hp = parseHostPort(broker, 1883);
    if (hp == null) return fail("请填写 Broker 主机和端口");
    return tcp(hp.host, hp.port, "MQTT Broker TCP");
  }

  private Map<String, Object> mcd4000(String channel) {
    Mcd4000Channel parsed = Mcd4000Channel.parse(channel);
    if (parsed == null) {
      return fail("请填写 Base URL 与 DeviceId");
    }
    try {
      ScadaProperties.Mcd4000 cfg = props.getMcd4000();
      Mcd4000Client client =
          new Mcd4000Client(
              mapper,
              Duration.ofMillis(Math.max(500, cfg.getTimeoutMs())),
              cfg.getLookbackSec(),
              cfg.isInsecureSsl());
      client.reachable(parsed.baseUrl());
      return ok("数据中台可达 " + parsed.baseUrl());
    } catch (Exception e) {
      return fail(shortMsg(e));
    }
  }

  private Map<String, Object> httpGet(String url, String label) {
    if (url == null || url.isBlank()) return fail("请填写 URL");
    String normalized = url.trim();
    if (!normalized.contains("://")) normalized = "http://" + normalized;
    try {
      URI uri = URI.create(normalized);
      if (uri.getHost() == null || uri.getHost().isBlank()) {
        return fail("URL 无效");
      }
      HttpRequest req =
          HttpRequest.newBuilder(uri)
              .timeout(Duration.ofMillis(IO_MS))
              .method("GET", HttpRequest.BodyPublishers.noBody())
              .build();
      HttpResponse<Void> res = http.send(req, HttpResponse.BodyHandlers.discarding());
      return ok(label + " 可达（HTTP " + res.statusCode() + "）");
    } catch (IllegalArgumentException e) {
      return fail("URL 无效");
    } catch (Exception e) {
      return fail(shortMsg(e));
    }
  }

  private Map<String, Object> tcp(String host, int port, String label) {
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(host, port), CONNECT_MS);
      return ok(label + " 可达 " + host + ":" + port);
    } catch (Exception e) {
      return fail(shortMsg(e));
    }
  }

  private static HostPort parseHostPort(String channel, int defaultPort) {
    if (channel == null || channel.isBlank()) return null;
    // Modbus channel 可带 |字排序|双字排序，探测只取 host:port
    String s = channel.trim();
    int bar = s.indexOf('|');
    if (bar >= 0) s = s.substring(0, bar).trim();
    int colon = s.lastIndexOf(':');
    if (colon > 0 && colon < s.length() - 1) {
      String host = s.substring(0, colon).trim();
      try {
        int port = Integer.parseInt(s.substring(colon + 1).trim());
        if (host.isEmpty() || port < 1 || port > 65535) return null;
        return new HostPort(host, port);
      } catch (NumberFormatException e) {
        return null;
      }
    }
    if (s.isEmpty()) return null;
    return new HostPort(s, defaultPort);
  }

  private static HostPort parseOpcUa(String channel) {
    if (channel == null || channel.isBlank()) return null;
    String s = channel.trim();
    try {
      if (s.contains("://")) {
        URI uri = URI.create(s);
        String host = uri.getHost();
        int port = uri.getPort() > 0 ? uri.getPort() : 4840;
        if (host == null || host.isBlank()) return null;
        return new HostPort(host, port);
      }
      return parseHostPort(s, 4840);
    } catch (Exception e) {
      return null;
    }
  }

  private static Map<String, Object> ok(String message) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("ok", true);
    out.put("message", message);
    return out;
  }

  private static Map<String, Object> fail(String message) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("ok", false);
    out.put("message", message == null || message.isBlank() ? "连接失败" : message);
    return out;
  }

  private static String shortMsg(Exception e) {
    String m = e.getMessage();
    if (m == null || m.isBlank()) return e.getClass().getSimpleName();
    if (m.length() > 180) return m.substring(0, 180) + "…";
    return m;
  }

  private record HostPort(String host, int port) {}
}
