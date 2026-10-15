package com.webscada.server.db;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.InfluxDBClientFactory;
import com.influxdb.client.QueryApi;
import com.influxdb.client.WriteApiBlocking;
import com.influxdb.client.domain.WritePrecision;
import com.influxdb.client.write.Point;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import com.webscada.server.config.ScadaProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class InfluxHolder {
  private static final Logger log = LoggerFactory.getLogger(InfluxHolder.class);

  private final ScadaProperties props;
  private volatile InfluxDBClient client;
  private volatile WriteApiBlocking writeApi;
  private volatile QueryApi queryApi;
  private volatile boolean ready;
  private volatile String lastError;

  public InfluxHolder(ScadaProperties props) {
    this.props = props;
  }

  public synchronized boolean init() {
    close();
    ScadaProperties.Influx inf = props.getInflux();
    if (inf.getToken() == null || inf.getToken().isBlank()) {
      ready = false;
      lastError = "INFLUX_TOKEN is not set";
      return false;
    }
    try {
      client =
          InfluxDBClientFactory.create(
              inf.getUrl(), inf.getToken().toCharArray(), inf.getOrg(), inf.getBucket());
      writeApi = client.getWriteApiBlocking();
      queryApi = client.getQueryApi();
      String flux =
          """
          from(bucket: "%s")
            |> range(start: -1m)
            |> limit(n: 1)
          """
              .formatted(inf.getBucket());
      queryApi.query(flux);
      ready = true;
      lastError = null;
      log.info("Influx ready url={} org={} bucket={}", inf.getUrl(), inf.getOrg(), inf.getBucket());
      return true;
    } catch (Exception e) {
      ready = false;
      lastError = e.getMessage();
      log.warn("Influx init failed: {}", lastError);
      closeQuietly();
      if (inf.isRequired()) {
        throw new IllegalStateException("INFLUX_REQUIRED=true but Influx unavailable: " + lastError);
      }
      return false;
    }
  }

  public synchronized void close() {
    ready = false;
    closeQuietly();
  }

  private void closeQuietly() {
    writeApi = null;
    queryApi = null;
    if (client != null) {
      try {
        client.close();
      } catch (Exception e) {
        log.debug("close influx: {}", e.toString());
      }
      client = null;
    }
  }

  public boolean isReady() {
    return ready;
  }

  public String getLastError() {
    return lastError;
  }

  public Map<String, Object> status() {
    Map<String, Object> s = new LinkedHashMap<>();
    s.put("ready", ready);
    s.put("error", lastError);
    s.put("url", props.getInflux().getUrl());
    s.put("org", props.getInflux().getOrg());
    s.put("bucket", props.getInflux().getBucket());
    s.put("configured", props.getInflux().getToken() != null && !props.getInflux().getToken().isBlank());
    return s;
  }

  public Map<String, Object> test(Map<String, Object> opts) {
    ScadaProperties.Influx inf = props.getInflux();
    String url = str(opts, "url", inf.getUrl());
    String token =
        opts != null && opts.get("token") != null && !String.valueOf(opts.get("token")).isEmpty()
            ? String.valueOf(opts.get("token"))
            : inf.getToken();
    String org = str(opts, "org", inf.getOrg());
    String bucket = str(opts, "bucket", inf.getBucket());
    if (token == null || token.isBlank()) {
      return Map.of("ok", false, "error", "token is empty");
    }
    try (InfluxDBClient testClient =
        InfluxDBClientFactory.create(url, token.toCharArray(), org, bucket)) {
      String flux =
          """
          from(bucket: "%s")
            |> range(start: -1m)
            |> limit(n: 1)
          """
              .formatted(bucket);
      testClient.getQueryApi().query(flux);
      return Map.of("ok", true);
    } catch (Exception e) {
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("ok", false);
      r.put("error", e.getMessage());
      return r;
    }
  }

  public int writeSamples(List<Map<String, Object>> samples) {
    if (!ready || writeApi == null) {
      throw new IllegalStateException(lastError != null ? lastError : "InfluxDB is not ready");
    }
    String measurement = props.getInflux().getMeasurement();
    List<Point> points = new ArrayList<>();
    for (Map<String, Object> s : samples) {
      String tagId = String.valueOf(s.get("tagId"));
      String quality = s.get("quality") == null ? "Uncertain" : String.valueOf(s.get("quality"));
      long ts =
          s.get("timestamp") instanceof Number n ? n.longValue() : System.currentTimeMillis();
      Point point =
          Point.measurement(measurement)
              .addTag("tagId", tagId)
              .addTag("quality", quality)
              .time(Instant.ofEpochMilli(ts), WritePrecision.MS);
      Object value = s.get("value");
      Double num = toNumeric(value);
      if (num != null) {
        point.addField("value", num);
      } else if (value instanceof String str) {
        point.addField("value_str", str);
      } else {
        point.addField("value", 0.0);
      }
      points.add(point);
    }
    writeApi.writePoints(points);
    return samples.size();
  }

  /** Best-effort async write for runtime; never throws to caller of setTagValue path. */
  public void writeSampleQuiet(String tagId, Object value, String quality, long timestamp) {
    if (!ready) return;
    try {
      Map<String, Object> s = new LinkedHashMap<>();
      s.put("tagId", tagId);
      s.put("value", value);
      s.put("quality", quality);
      s.put("timestamp", timestamp);
      writeSamples(List.of(s));
    } catch (Exception e) {
      log.warn("influx write failed tagId={}: {}", tagId, e.toString());
    }
  }

  public List<Map<String, Object>> queryHistory(String tagId, String start, String stop, Integer limit) {
    if (!ready || queryApi == null) {
      throw new IllegalStateException(lastError != null ? lastError : "InfluxDB is not ready");
    }
    String startExpr = start == null || start.isBlank() ? "-1h" : start;
    String stopExpr = stop == null || stop.isBlank() ? "now()" : stop;
    int lim = limit == null ? 500 : Math.min(Math.max(limit, 1), 5000);
    String startFlux = fluxTimeLiteral(startExpr, "-1h");
    String stopFlux = fluxTimeLiteral(stopExpr, "now()");
    String safeTag = tagId.replace("\"", "\\\"");
    String flux =
        """
        from(bucket: "%s")
          |> range(start: %s, stop: %s)
          |> filter(fn: (r) => r._measurement == "%s")
          |> filter(fn: (r) => r.tagId == "%s")
          |> filter(fn: (r) => r._field == "value" or r._field == "value_str")
          |> sort(columns: ["_time"], desc: false)
          |> limit(n: %d)
        """
            .formatted(
                props.getInflux().getBucket(),
                startFlux,
                stopFlux,
                props.getInflux().getMeasurement(),
                safeTag,
                lim);

    List<Map<String, Object>> rows = new ArrayList<>();
    List<FluxTable> tables = queryApi.query(flux);
    for (FluxTable table : tables) {
      for (FluxRecord rec : table.getRecords()) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("tagId", rec.getValueByKey("tagId") != null ? String.valueOf(rec.getValueByKey("tagId")) : tagId);
        Instant t = rec.getTime();
        row.put("time", t != null ? t.toString() : "");
        row.put("value", rec.getValue());
        Object q = rec.getValueByKey("quality");
        row.put("quality", q != null ? String.valueOf(q) : "Uncertain");
        rows.add(row);
      }
    }
    return rows;
  }

  /**
   * 多变量批量历史查询：一条 Flux 查完所有 tagId，避免 N 次串行请求。
   *
   * <p>agg 为 none 时返回原始点（每条曲线取最近 maxPoints 个）；否则按
   * 跨度自动选聚合窗口（mean/max/min/last/first/sum）。
   *
   * <p>注意两个现实约束：
   * ① 只有数值字段 _field == "value" 能聚合，"value_str" 只能原样返回；
   * ② 质量 quality 是 Influx 的 tag，进入 series key，聚合时会把同一变量拆成多表
   * （质量好坏各一张），所以聚合前先 group(只按 tagId) －— 代价是聚合后不再带 quality。
   */
  public BatchHistory queryHistoryBatch(
      List<String> tagIds,
      String start,
      String stop,
      int maxPoints,
      String windowOverride,
      String agg) {
    if (!ready || queryApi == null) {
      throw new IllegalStateException(lastError != null ? lastError : "InfluxDB is not ready");
    }
    if (tagIds == null || tagIds.isEmpty()) {
      throw new IllegalArgumentException("tagIds is empty");
    }
    int lim = Math.min(Math.max(maxPoints, 10), 5000);
    Instant to = resolveInstant(stop, Instant.now());
    Instant from = resolveInstant(start, to.minus(Duration.ofHours(1)));
    if (!from.isBefore(to)) from = to.minus(Duration.ofHours(1));
    String mode = agg == null || agg.isBlank() ? "auto" : agg.trim().toLowerCase();
    boolean raw = "none".equals(mode) || "raw".equals(mode);

    StringBuilder tagFilter = new StringBuilder();
    for (int i = 0; i < tagIds.size(); i++) {
      if (i > 0) tagFilter.append(" or ");
      tagFilter.append("r.tagId == \"").append(tagIds.get(i).replace("\"", "\\\"")).append("\"");
    }

    // 调用方显式指定间隔（如 30s）时用它，否则按跨度自动选一个整齐的窗口。
    // 只接受 <数字><s|m|h|d>：窗口会直接拼进 Flux，不能让外部传任意字符串进来。
    String safeWindow =
        windowOverride != null && windowOverride.matches("^\\d+[smhd]$") ? windowOverride : null;
    String window = safeWindow != null ? safeWindow : niceWindow(Duration.between(from, to), lim);
    String flux;
    if (raw) {
      flux =
          """
          from(bucket: "%s")
            |> range(start: %s, stop: %s)
            |> filter(fn: (r) => r._measurement == "%s")
            |> filter(fn: (r) => %s)
            |> filter(fn: (r) => r._field == "value" or r._field == "value_str")
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: %d)
            |> sort(columns: ["_time"], desc: false)
          """
              .formatted(
                  props.getInflux().getBucket(),
                  from.toString(),
                  to.toString(),
                  props.getInflux().getMeasurement(),
                  tagFilter,
                  lim);
    } else {
      String fn = fluxFn(mode);
      flux =
          """
          from(bucket: "%s")
            |> range(start: %s, stop: %s)
            |> filter(fn: (r) => r._measurement == "%s")
            |> filter(fn: (r) => %s)
            |> filter(fn: (r) => r._field == "value")
            |> group(columns: ["tagId"])
            |> aggregateWindow(every: %s, fn: %s, createEmpty: false)
            |> sort(columns: ["_time"], desc: false)
          """
              .formatted(
                  props.getInflux().getBucket(),
                  from.toString(),
                  to.toString(),
                  props.getInflux().getMeasurement(),
                  tagFilter,
                  window,
                  fn);
    }

    Map<String, List<Map<String, Object>>> byTag = new LinkedHashMap<>();
    for (String id : tagIds) byTag.put(id, new ArrayList<>());
    for (FluxTable table : queryApi.query(flux)) {
      for (FluxRecord rec : table.getRecords()) {
        Object tagValue = rec.getValueByKey("tagId");
        String id = tagValue != null ? String.valueOf(tagValue) : null;
        if (id == null) continue;
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("tagId", id);
        Instant t = rec.getTime();
        row.put("time", t != null ? t.toString() : "");
        row.put("value", rec.getValue());
        Object q = rec.getValueByKey("quality");
        row.put("quality", q != null ? String.valueOf(q) : (raw ? "Uncertain" : null));
        byTag.computeIfAbsent(id, k -> new ArrayList<>()).add(row);
      }
    }
    List<BatchSeries> series = new ArrayList<>();
    for (Map.Entry<String, List<Map<String, Object>>> e : byTag.entrySet()) {
      series.add(new BatchSeries(e.getKey(), e.getValue()));
    }
    return new BatchHistory(
        from.toString(), to.toString(), raw ? null : window, raw ? "none" : mode, series);
  }

  /** 每条曲线（每个 tagId）的历史点 */
  public record BatchSeries(String tagId, List<Map<String, Object>> points) {}

  /** 批量历史查询的结果：实际窗口 + 聚合方式 + 各曲线 */
  public record BatchHistory(
      String from, String to, String window, String agg, List<BatchSeries> series) {}

  private static String fluxFn(String mode) {
    return switch (mode) {
      case "max" -> "max";
      case "min" -> "min";
      case "last" -> "last";
      case "first" -> "first";
      case "sum" -> "sum";
      default -> "mean";
    };
  }

  /** 相对时间（-15m/-1h/-8h/-24h/-7d/-1w）或 RFC3339 → Instant */
  private static Instant resolveInstant(String expr, Instant fallback) {
    if (expr == null || expr.isBlank() || "now()".equals(expr)) return fallback;
    String s = expr.trim();
    if (s.startsWith("-")) {
      java.util.regex.Matcher m =
          java.util.regex.Pattern.compile("^-(\\d+)([smhdw])$").matcher(s);
      if (m.matches()) {
        long n = Long.parseLong(m.group(1));
        return switch (m.group(2)) {
          case "s" -> fallback.minusSeconds(n);
          case "m" -> fallback.minus(Duration.ofMinutes(n));
          case "h" -> fallback.minus(Duration.ofHours(n));
          case "d" -> fallback.minus(Duration.ofDays(n));
          default -> fallback.minus(Duration.ofDays(n * 7));
        };
      }
      return fallback;
    }
    try {
      return Instant.parse(s);
    } catch (Exception e) {
      try {
        return java.time.OffsetDateTime.parse(s).toInstant();
      } catch (Exception ignored) {
        return fallback;
      }
    }
  }

  /** 按“点数不超过 maxPoints”选一个整齐的聚合窗口 */
  private static String niceWindow(Duration span, int maxPoints) {
    long seconds = Math.max(1, span.getSeconds());
    long want = Math.max(1, seconds / Math.max(1, maxPoints));
    long[] steps = {1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400};
    long pick = steps[steps.length - 1];
    for (long st : steps) {
      if (st >= want) {
        pick = st;
        break;
      }
    }
    return pick + "s";
  }

  /** 相对时间（-1h）和 RFC3339 都不加引号；Flux 把引号里的内容当成字符串，range 不认。 */
  private static String fluxTimeLiteral(String expr, String fallback) {
    if (expr == null || expr.isBlank()) return fallback;
    if ("now()".equals(expr) || expr.startsWith("-") || expr.matches("^\\d.*")) return expr;
    return "\"" + expr + "\"";
  }

  private static Double toNumeric(Object value) {
    if (value == null) return null;
    if (value instanceof Boolean b) return b ? 1.0 : 0.0;
    if (value instanceof Number n) {
      double d = n.doubleValue();
      return Double.isFinite(d) ? d : null;
    }
    try {
      double d = Double.parseDouble(String.valueOf(value));
      return Double.isFinite(d) ? d : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private static String str(Map<String, Object> opts, String key, String def) {
    if (opts == null || opts.get(key) == null) return def;
    String v = String.valueOf(opts.get(key));
    return v.isBlank() ? def : v;
  }
}
