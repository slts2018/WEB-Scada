package com.webscada.server.comm.config;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * HTTP 链路参数。一个链路一个 {@code HttpClient}，请求超时用 responseTimeoutMs。
 *
 * <pre>
 * http:
 *   baseUrl: https://10.0.0.8/api
 *   auth:
 *     type: oauth2
 *     tokenUrl: https://10.0.0.8/oauth/token
 *     clientId: scada
 *     clientSecret: ${HTTP_CLIENT_SECRET}
 *     scope: read
 *   headers:
 *     X-Site: plant-a
 *   proxy:
 *     host: 10.0.0.1
 *     port: 8080
 *   tls:
 *     caFile: /etc/scada/ca.pem
 *     clientCert: /etc/scada/client.pem
 *     clientKey: /etc/scada/client.key
 *   maxResponseBytes: 1048576
 *   healthPath: /health
 *   writePath: /commands
 *   writeMethod: POST
 *   tsField: ts
 * points:
 *   - id: temp
 *     path: /values
 *     jsonPath: sensors.temp
 *     type: double
 *     scale: 1
 *     offset: 0
 * </pre>
 *
 * 写出必须带 Idempotency-Key，值是 {@code IoRequest.correlationId}。驱动不自动重发 POST。
 * 不跟随 3xx 重定向，前置代理必须直连。
 */
public record HttpOptions(
    String baseUrl,
    String authType,
    String username,
    String password,
    String token,
    String tokenUrl,
    String clientId,
    String clientSecret,
    String scope,
    Map<String, String> headers,
    String proxyHost,
    int proxyPort,
    String caFile,
    String clientCert,
    String clientKey,
    int maxResponseBytes,
    String healthPath,
    String writePath,
    String writeMethod,
    String tsField) {

  public static final int DEFAULT_MAX_BYTES = 1_048_576;

  public HttpOptions {
    if (baseUrl == null) baseUrl = "";
    if (authType == null || authType.isBlank()) authType = "none";
    else authType = authType.trim().toLowerCase(Locale.ROOT);
    if (username == null) username = "";
    if (password == null) password = "";
    if (token == null) token = "";
    if (tokenUrl == null) tokenUrl = "";
    if (clientId == null) clientId = "";
    if (clientSecret == null) clientSecret = "";
    if (scope == null) scope = "";
    headers = copyHeaders(headers);
    if (proxyHost == null) proxyHost = "";
    if (caFile == null) caFile = "";
    if (clientCert == null) clientCert = "";
    if (clientKey == null) clientKey = "";
    if (maxResponseBytes <= 0) maxResponseBytes = DEFAULT_MAX_BYTES;
    if (healthPath == null) healthPath = "";
    if (writePath == null) writePath = "";
    if (writeMethod == null || writeMethod.isBlank()) writeMethod = "POST";
    else writeMethod = writeMethod.trim().toUpperCase(Locale.ROOT);
    if (tsField == null || tsField.isBlank()) tsField = "ts";
  }

  public static HttpOptions defaults() {
    return new HttpOptions(
        "", "none", "", "", "", "", "", "", "", Map.of(), "", 0, "", "", "",
        DEFAULT_MAX_BYTES, "", "", "POST", "ts");
  }

  public boolean proxyConfigured() {
    return !proxyHost.isBlank();
  }

  public boolean tlsConfigured() {
    return !caFile.isBlank() || !clientCert.isBlank() || !clientKey.isBlank();
  }

  private static Map<String, String> copyHeaders(Map<String, String> headers) {
    if (headers == null || headers.isEmpty()) return Map.of();
    LinkedHashMap<String, String> copy = new LinkedHashMap<>();
    headers.forEach(
        (key, value) -> {
          if (key != null && !key.isBlank() && value != null) copy.put(key, value);
        });
    return Map.copyOf(copy);
  }
}
