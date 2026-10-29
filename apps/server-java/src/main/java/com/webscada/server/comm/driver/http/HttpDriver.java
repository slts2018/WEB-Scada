package com.webscada.server.comm.driver.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.HttpOptions;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.JsonValues;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.driver.TlsSupport;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * JDK {@link HttpClient}。每条链路在 connect 时建一个客户端，请求上单独设 responseTimeoutMs。
 * 不支持订阅。读按 path 合并。不在请求里睡 Retry-After，也不自动重发 POST。
 */
public final class HttpDriver implements ProtocolDriver {
  private static final ObjectMapper JSON = new ObjectMapper();

  private volatile LinkDefinition link;
  private volatile HttpClient http;
  private final TokenGate tokens = new TokenGate();

  public HttpDriver(LinkDefinition link) {
    this.link = link;
  }

  public void rebind(LinkDefinition link) {
    if (link != null) this.link = link;
    tokens.clear();
  }

  @Override
  public String name() {
    return "http";
  }

  @Override
  public void connect(DriverContext ctx) throws CommException {
    HttpOptions options = link.http();
    if (options.baseUrl().isBlank()) throw config("baseUrl required");
    String auth = options.authType();
    if (!"none".equals(auth) && !"basic".equals(auth) && !"bearer".equals(auth) && !"oauth2".equals(auth)) {
      throw config("auth.type");
    }
    if ("basic".equals(auth) && options.username().isBlank()) throw config("username required");
    if ("bearer".equals(auth) && options.token().isBlank()) throw config("token required");
    if ("oauth2".equals(auth)
        && (options.tokenUrl().isBlank() || options.clientId().isBlank() || options.clientSecret().isBlank())) {
      throw config("oauth2 client credentials required");
    }
    HttpClient.Builder builder =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(Math.max(1, ctx.connectTimeoutMs())))
            .followRedirects(HttpClient.Redirect.NEVER);
    if (options.proxyConfigured()) {
      builder.proxy(ProxySelector.of(new InetSocketAddress(options.proxyHost(), options.proxyPort())));
    }
    if (options.tlsConfigured()) {
      builder.sslContext(TlsSupport.sslContext(options.caFile(), options.clientCert(), options.clientKey()));
    }
    this.http = builder.build();
  }

  @Override
  public void disconnect() {
    http = null;
    tokens.clear();
  }

  @Override
  public Health healthCheck(DriverContext ctx) throws CommException {
    String path = link.http().healthPath();
    if (path.isBlank()) {
      if (link.points().isEmpty()) throw config("healthPath required");
      path = link.points().get(0).path();
    }
    int status = statusOf(resolve(link.http().baseUrl(), path), ctx);
    if (status >= 200 && status < 300) return Health.OK;
    if (status == 401 || status == 403) {
      ctx.log()
          .warn("http_auth", "AUTH", "http " + status, null, null, ctx.sessionId(), ctx.correlationId());
      return Health.FAILED;
    }
    throw mapStatus(status, "absent", ctx);
  }

  @Override
  public IoResult read(DriverContext ctx, IoRequest request) throws CommException {
    Map<String, List<DataPoint>> groups = new LinkedHashMap<>();
    for (DataPoint point : link.points()) {
      groups.computeIfAbsent(point.path(), key -> new ArrayList<>()).add(point);
    }
    List<IoResult.PointUpdate> updates = new ArrayList<>();
    for (Map.Entry<String, List<DataPoint>> group : groups.entrySet()) {
      Loaded loaded = load("GET", resolve(link.http().baseUrl(), group.getKey()), null, null, ctx);
      updates.addAll(decode(group.getValue(), loaded.body, ctx));
    }
    String correlation = request == null ? ctx.correlationId() : request.correlationId();
    return new IoResult(true, correlation, updates, null);
  }

  @Override
  public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
    String key = request == null || request.correlationId() == null ? "" : request.correlationId().trim();
    if (key.isEmpty()) throw config("idempotencyKey required");
    if (request.pointId() == null || request.pointId().isBlank()) throw config("pointId required");
    String method = link.http().writeMethod();
    if (!"POST".equals(method) && !"PUT".equals(method)) throw config("writeMethod");
    byte[] body;
    try {
      ObjectNode node = JSON.createObjectNode();
      node.put("pointId", request.pointId());
      node.set("value", JSON.valueToTree(request.value()));
      body = JSON.writeValueAsBytes(node);
    } catch (Exception ex) {
      throw config("write body");
    }
    load(method, resolve(link.http().baseUrl(), link.http().writePath()), body, key, ctx);
    return new IoResult(true, key, List.of(), null);
  }

  @Override
  public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException {
    throw new CommException(ErrorCategory.CONFIG, false, false, "http has no subscribe");
  }

  /**
   * 健康检查只看状态码。用 discarding 把响应体读完再还连接，避免半开响应把这条 TCP 丢掉。
   */
  private int statusOf(URI uri, DriverContext ctx) throws CommException {
    int status = discard(uri, ctx, false);
    if (status == 401 && "oauth2".equals(link.http().authType())) {
      return discard(uri, ctx, true);
    }
    return status;
  }

  private int discard(URI uri, DriverContext ctx, boolean forceToken) throws CommException {
    HttpResponse<Void> response =
        transmit(
            request("GET", uri, null, null, ctx, forceToken),
            HttpResponse.BodyHandlers.discarding(),
            ctx);
    return response.statusCode();
  }

  /** 401 时 oauth2 只刷新并重放一次。5xx / 429 不在这次调用里再发。 */
  private Loaded load(String method, URI uri, byte[] body, String idempotency, DriverContext ctx)
      throws CommException {
    Exchange first = execute(method, uri, body, idempotency, ctx, false);
    try {
      if (first.status == 401 && "oauth2".equals(link.http().authType())) {
        first.close();
        Exchange second = execute(method, uri, body, idempotency, ctx, true);
        try {
          if (second.status == 401 || second.status == 403) throw auth(second.status);
          return materialize(second, ctx);
        } finally {
          second.close();
        }
      }
      return materialize(first, ctx);
    } finally {
      first.close();
    }
  }

  private Loaded materialize(Exchange exchange, DriverContext ctx) throws CommException {
    if (exchange.status < 200 || exchange.status >= 300) {
      throw mapStatus(exchange.status, exchange.retryAfter, ctx);
    }
    return new Loaded(readLimited(exchange.body, link.http().maxResponseBytes()));
  }

  private Exchange execute(
      String method, URI uri, byte[] body, String idempotency, DriverContext ctx, boolean forceToken)
      throws CommException {
    return send(request(method, uri, body, idempotency, ctx, forceToken), ctx);
  }

  private HttpRequest request(
      String method, URI uri, byte[] body, String idempotency, DriverContext ctx, boolean forceToken)
      throws CommException {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(uri).timeout(Duration.ofMillis(Math.max(1, ctx.responseTimeoutMs())));
    LinkedHashMap<String, String> headers = new LinkedHashMap<>(link.http().headers());
    if (body != null) headers.put("Content-Type", "application/json");
    if (idempotency != null) headers.put("Idempotency-Key", idempotency);
    String authorization = authorization(ctx, forceToken);
    if (authorization != null) headers.put("Authorization", authorization);
    headers.forEach(builder::header);
    if ("PUT".equals(method)) {
      builder.PUT(HttpRequest.BodyPublishers.ofByteArray(body == null ? new byte[0] : body));
    } else if ("POST".equals(method)) {
      builder.POST(HttpRequest.BodyPublishers.ofByteArray(body == null ? new byte[0] : body));
    } else {
      builder.GET();
    }
    try {
      return builder.build();
    } catch (IllegalArgumentException ex) {
      throw config(ex.getMessage() == null ? "http request" : ex.getMessage());
    }
  }

  private String authorization(DriverContext ctx, boolean forceToken) throws CommException {
    HttpOptions options = link.http();
    if ("basic".equals(options.authType())) {
      String raw = options.username() + ":" + options.password();
      return "Basic " + java.util.Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }
    if ("bearer".equals(options.authType())) return "Bearer " + options.token();
    if ("oauth2".equals(options.authType())) return "Bearer " + tokens.get(ctx, forceToken);
    return null;
  }

  private Issued fetchToken(DriverContext ctx) throws CommException {
    HttpOptions options = link.http();
    StringBuilder form = new StringBuilder();
    form.append("grant_type=client_credentials");
    form.append("&client_id=").append(url(options.clientId()));
    form.append("&client_secret=").append(url(options.clientSecret()));
    if (!options.scope().isBlank()) form.append("&scope=").append(url(options.scope()));
    HttpRequest request;
    try {
      request =
          HttpRequest.newBuilder(URI.create(options.tokenUrl()))
              .timeout(Duration.ofMillis(Math.max(1, ctx.responseTimeoutMs())))
              .header("Content-Type", "application/x-www-form-urlencoded")
              .POST(HttpRequest.BodyPublishers.ofString(form.toString()))
              .build();
    } catch (IllegalArgumentException ex) {
      throw config("tokenUrl");
    }
    Exchange exchange = send(request, ctx);
    try {
      if (exchange.status < 200 || exchange.status >= 300) {
        throw mapStatus(exchange.status, exchange.retryAfter, ctx);
      }
      byte[] body = readLimited(exchange.body, options.maxResponseBytes());
      JsonNode root;
      try {
        root = JsonValues.readTree(body);
      } catch (Exception ex) {
        throw config("token response");
      }
      if (root == null || !root.isObject() || text(root.get("access_token")).isEmpty()) {
        throw config("token response");
      }
      long seconds = 3600;
      JsonNode ttl = root.get("expires_in");
      if (ttl != null && ttl.isNumber() && ttl.asLong() > 0) seconds = ttl.asLong();
      return new Issued(root.get("access_token").asText(), seconds * 1000L);
    } finally {
      exchange.close();
    }
  }

  private Exchange send(HttpRequest request, DriverContext ctx) throws CommException {
    HttpResponse<InputStream> response =
        transmit(request, HttpResponse.BodyHandlers.ofInputStream(), ctx);
    String retryAfter = response.headers().firstValue("Retry-After").orElse("absent");
    return new Exchange(response.statusCode(), retryAfter, response.body());
  }

  private <T> HttpResponse<T> transmit(
      HttpRequest request, HttpResponse.BodyHandler<T> handler, DriverContext ctx) throws CommException {
    HttpClient client = http;
    if (client == null) throw new CommException(ErrorCategory.CONNECT, true, true, "http not connected");
    try {
      return client.send(request, handler);
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      ctx.stats().timeouts().increment();
      throw new CommException(ErrorCategory.TIMEOUT, true, false, "http interrupted", ex);
    } catch (HttpConnectTimeoutException ex) {
      throw failedConnect(ex);
    } catch (HttpTimeoutException ex) {
      ctx.stats().timeouts().increment();
      throw new CommException(ErrorCategory.TIMEOUT, true, false, "http timeout", ex);
    } catch (IOException ex) {
      if (isTimeout(ex)) {
        ctx.stats().timeouts().increment();
        throw new CommException(ErrorCategory.TIMEOUT, true, false, "http timeout", ex);
      }
      throw failedConnect(ex);
    } catch (IllegalArgumentException ex) {
      throw config(ex.getMessage() == null ? "http request" : ex.getMessage());
    }
  }

  private List<IoResult.PointUpdate> decode(List<DataPoint> points, byte[] body, DriverContext ctx) {
    JsonNode root;
    try {
      root = JsonValues.readTree(body);
    } catch (Exception ex) {
      return bad(points, body, ctx);
    }
    if (root == null || !root.isObject()) return bad(points, body, ctx);
    Long ts;
    try {
      JsonNode tsNode = JsonValues.at(root, link.http().tsField());
      ts = tsNode == null || tsNode.isNull() ? null : JsonValues.timestamp(tsNode);
    } catch (RuntimeException ex) {
      return bad(points, body, ctx);
    }
    Long source = ts != null ? ts : ctx.clock().millis();
    List<IoResult.PointUpdate> updates = new ArrayList<>();
    for (DataPoint point : points) {
      try {
        JsonNode node = point.field().isBlank() ? root : JsonValues.at(root, point.field());
        if (node == null || node.isNull() || node.isContainerNode()) {
          throw new IllegalArgumentException("missing " + point.field());
        }
        Quality quality = Quality.GOOD;
        if (ts != null
            && link.staleTimeoutMs() > 0
            && ctx.clock().millis() - ts >= link.staleTimeoutMs()) {
          quality = Quality.STALE;
        }
        updates.add(new IoResult.PointUpdate(point.id(), JsonValues.cast(point, node), quality, source));
      } catch (RuntimeException ex) {
        updates.add(new IoResult.PointUpdate(point.id(), null, Quality.BAD_CONFIG, source));
      }
    }
    return updates;
  }

  private List<IoResult.PointUpdate> bad(List<DataPoint> points, byte[] body, DriverContext ctx) {
    ctx.stats().decodeErrors().increment();
    ctx.log()
        .warn(
            "http_decode",
            "CONFIG",
            "hex=" + JsonValues.hexPrefix(body),
            null,
            null,
            ctx.sessionId(),
            ctx.correlationId());
    List<IoResult.PointUpdate> updates = new ArrayList<>();
    for (DataPoint point : points) {
      updates.add(new IoResult.PointUpdate(point.id(), null, Quality.BAD_CONFIG, null));
    }
    return updates;
  }

  private CommException mapStatus(int status, String retryAfter, DriverContext ctx) {
    if (status == 401 || status == 403) return auth(status);
    if (status == 408) {
      ctx.stats().timeouts().increment();
      return new CommException(ErrorCategory.TIMEOUT, true, false, "http 408");
    }
    if (status == 400 || status == 404 || status == 405) {
      return new CommException(ErrorCategory.CONFIG, false, false, "http " + status);
    }
    if (status == 429) {
      ctx.stats().rateLimited().increment();
      String after = retryAfter == null || retryAfter.isBlank() ? "absent" : retryAfter;
      ctx.log()
          .warn(
              "http_rate_limit",
              "DEVICE",
              "Retry-After=" + after,
              null,
              null,
              ctx.sessionId(),
              ctx.correlationId());
      return new CommException(ErrorCategory.DEVICE, true, false, "http 429");
    }
    if (status >= 500 && status <= 599) {
      ctx.stats().protocolErrors().increment();
      ctx.log()
          .warn(
              "http_status",
              "DEVICE",
              "status=" + status,
              null,
              null,
              ctx.sessionId(),
              ctx.correlationId());
      return new CommException(ErrorCategory.DEVICE, true, false, "http " + status);
    }
    return new CommException(ErrorCategory.CONFIG, false, false, "http " + status);
  }

  private static byte[] readLimited(InputStream in, int max) throws CommException {
    if (in == null) return new byte[0];
    byte[] buf = new byte[8192];
    ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(Math.max(max, 1), 8192));
    int total = 0;
    try {
      while (true) {
        int n = in.read(buf);
        if (n < 0) break;
        if ((long) total + n > max) {
          throw new CommException(ErrorCategory.CONFIG, false, false, "response exceeds maxResponseBytes");
        }
        out.write(buf, 0, n);
        total += n;
      }
    } catch (CommException ex) {
      throw ex;
    } catch (IOException ex) {
      if (isTimeout(ex)) {
        throw new CommException(ErrorCategory.TIMEOUT, true, false, "http timeout", ex);
      }
      throw failedConnect(ex);
    }
    return out.toByteArray();
  }

  private static URI resolve(String baseUrl, String path) throws CommException {
    String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    String rel = path == null ? "" : path.trim();
    try {
      if (rel.isEmpty()) return URI.create(base);
      if (!rel.startsWith("/")) rel = "/" + rel;
      return URI.create(base + rel);
    } catch (IllegalArgumentException ex) {
      throw new CommException(ErrorCategory.CONFIG, false, false, "http path", ex);
    }
  }

  private static boolean isTimeout(Throwable ex) {
    Throwable cur = ex;
    while (cur != null) {
      if (cur instanceof HttpConnectTimeoutException) return false;
      if (cur instanceof HttpTimeoutException) return true;
      cur = cur.getCause();
    }
    return false;
  }

  private static CommException failedConnect(Throwable ex) {
    Throwable cur = ex;
    while (cur != null) {
      if (cur instanceof ConnectException
          || cur instanceof UnknownHostException
          || cur instanceof HttpConnectTimeoutException) {
        return new CommException(ErrorCategory.CONNECT, true, true, "http connect", ex);
      }
      cur = cur.getCause();
    }
    return new CommException(ErrorCategory.CONNECT, true, true, "http connect", ex);
  }

  private static CommException auth(int status) {
    return new CommException(ErrorCategory.AUTH, false, false, "http " + status);
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }

  private static String url(String value) {
    return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
  }

  private static String text(JsonNode node) {
    if (node == null || node.isNull()) return "";
    String value = node.asText();
    return value == null ? "" : value.trim();
  }

  private record Loaded(byte[] body) {}

  private record Issued(String token, long ttlMs) {}

  private static final class Exchange implements AutoCloseable {
    private final int status;
    private final String retryAfter;
    private InputStream body;

    private Exchange(int status, String retryAfter, InputStream body) {
      this.status = status;
      this.retryAfter = retryAfter;
      this.body = body;
    }

    @Override
    public void close() {
      InputStream in = body;
      body = null;
      if (in == null) return;
      try {
        in.close();
      } catch (IOException ignored) {
        // 取消未读完的响应，避免把剩余字节收进内存。
      }
    }
  }

  /** 过期或 401 之后只允许一个线程去换 token，其余等同一次结果。 */
  private final class TokenGate {
    private final Object lock = new Object();
    private String token = "";
    private long fetchedAt;
    private long ttlMs;
    private CompletableFuture<String> flight;

    void clear() {
      synchronized (lock) {
        token = "";
        fetchedAt = 0;
        ttlMs = 0;
      }
    }

    String get(DriverContext ctx, boolean force) throws CommException {
      long now = ctx.clock().millis();
      CompletableFuture<String> wait;
      boolean leader;
      synchronized (lock) {
        if (!force && flight == null && fresh(now)) return token;
        if (flight != null) {
          wait = flight;
          leader = false;
        } else {
          if (force) {
            token = "";
            ttlMs = 0;
          }
          flight = new CompletableFuture<>();
          wait = flight;
          leader = true;
        }
      }
      if (!leader) {
        try {
          return wait.get(Math.max(1, ctx.responseTimeoutMs()), TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "token wait timeout", ex);
        } catch (InterruptedException ex) {
          Thread.currentThread().interrupt();
          throw new CommException(ErrorCategory.TIMEOUT, true, false, "token wait interrupted", ex);
        } catch (ExecutionException ex) {
          throw unwrap(ex.getCause() == null ? ex : ex.getCause());
        }
      }
      try {
        Issued issued = fetchToken(ctx);
        synchronized (lock) {
          token = issued.token;
          fetchedAt = ctx.clock().millis();
          ttlMs = issued.ttlMs;
          flight = null;
        }
        wait.complete(issued.token);
        return issued.token;
      } catch (CommException ex) {
        synchronized (lock) {
          flight = null;
        }
        wait.completeExceptionally(ex);
        throw ex;
      } catch (RuntimeException ex) {
        synchronized (lock) {
          flight = null;
        }
        CommException wrapped =
            new CommException(ErrorCategory.CONFIG, false, false, "token refresh failed", ex);
        wait.completeExceptionally(wrapped);
        throw wrapped;
      }
    }

    private boolean fresh(long now) {
      if (token.isBlank() || ttlMs <= 0) return false;
      long lead = Math.max((long) (ttlMs * 0.2d), 30_000L);
      return now < fetchedAt + ttlMs - lead;
    }

    private CommException unwrap(Throwable ex) {
      if (ex instanceof CommException comm) return comm;
      return new CommException(ErrorCategory.CONFIG, false, false, "token refresh failed", ex);
    }
  }
}
