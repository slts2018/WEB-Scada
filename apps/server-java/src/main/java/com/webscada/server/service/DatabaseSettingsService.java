package com.webscada.server.service;

import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.InfluxHolder;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.store.DeviceFileStore;
import com.webscada.server.store.JsonFiles;
import com.webscada.server.store.TagFileStore;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DatabaseSettingsService {
  private static final Logger log = LoggerFactory.getLogger(DatabaseSettingsService.class);

  private final ScadaProperties props;
  private final PathsProvider paths;
  private final MysqlBootstrap mysql;
  private final InfluxHolder influx;
  private final DeviceFileStore devices;
  private final TagFileStore tags;
  private final TagRuntimeService runtime;

  public DatabaseSettingsService(
      ScadaProperties props,
      PathsProvider paths,
      MysqlBootstrap mysql,
      InfluxHolder influx,
      DeviceFileStore devices,
      TagFileStore tags,
      TagRuntimeService runtime) {
    this.props = props;
    this.paths = paths;
    this.mysql = mysql;
    this.influx = influx;
    this.devices = devices;
    this.tags = tags;
    this.runtime = runtime;
  }

  @SuppressWarnings("unchecked")
  public void loadPersisted() {
    try {
      if (!Files.isRegularFile(paths.getSettingsFile())) return;
      Map<String, Object> saved = JsonFiles.read(paths.getSettingsFile(), Map.class);
      if (saved == null) return;
      if (saved.get("mysql") instanceof Map<?, ?> m) applyMysqlMap((Map<String, Object>) m, false);
      if (saved.get("influx") instanceof Map<?, ?> m) applyInfluxMap((Map<String, Object>) m, false);
    } catch (Exception e) {
      log.warn("load db-settings.json failed: {}", e.toString());
    }
  }

  public void savePersisted() throws Exception {
    Files.createDirectories(paths.getDataRoot());
    Map<String, Object> payload = new LinkedHashMap<>();
    Map<String, Object> mysql = new LinkedHashMap<>();
    mysql.put("host", props.getMysql().getHost());
    mysql.put("port", props.getMysql().getPort());
    mysql.put("user", props.getMysql().getUser());
    mysql.put("password", props.getMysql().getPassword());
    mysql.put("database", props.getMysql().getDatabase());
    mysql.put("fallbackToFile", props.getMysql().isFallbackToFile());
    Map<String, Object> influxMap = new LinkedHashMap<>();
    influxMap.put("url", props.getInflux().getUrl());
    influxMap.put("token", props.getInflux().getToken());
    influxMap.put("org", props.getInflux().getOrg());
    influxMap.put("bucket", props.getInflux().getBucket());
    influxMap.put("measurement", props.getInflux().getMeasurement());
    influxMap.put("required", props.getInflux().isRequired());
    payload.put("mysql", mysql);
    payload.put("influx", influxMap);
    JsonFiles.write(paths.getSettingsFile(), payload);
  }

  public void applyUpdate(Map<String, Object> body) {
    if (body.get("mysql") instanceof Map<?, ?> m) {
      @SuppressWarnings("unchecked")
      Map<String, Object> mysql = (Map<String, Object>) m;
      applyMysqlMap(mysql, true);
    }
    if (body.get("influx") instanceof Map<?, ?> m) {
      @SuppressWarnings("unchecked")
      Map<String, Object> influxMap = (Map<String, Object>) m;
      applyInfluxMap(influxMap, true);
    }
  }

  private void applyMysqlMap(Map<String, Object> m, boolean skipEmptySecrets) {
    if (m.containsKey("host") && m.get("host") != null) props.getMysql().setHost(String.valueOf(m.get("host")));
    if (m.containsKey("port") && m.get("port") instanceof Number n) props.getMysql().setPort(n.intValue());
    if (m.containsKey("user") && m.get("user") != null) props.getMysql().setUser(String.valueOf(m.get("user")));
    if (m.containsKey("database") && m.get("database") != null)
      props.getMysql().setDatabase(String.valueOf(m.get("database")));
    if (m.containsKey("fallbackToFile") && m.get("fallbackToFile") != null)
      props.getMysql().setFallbackToFile(Boolean.parseBoolean(String.valueOf(m.get("fallbackToFile"))));
    if (m.containsKey("password")) {
      String pw = m.get("password") == null ? "" : String.valueOf(m.get("password"));
      if (!skipEmptySecrets || !pw.isEmpty()) props.getMysql().setPassword(pw);
    }
  }

  private void applyInfluxMap(Map<String, Object> m, boolean skipEmptySecrets) {
    if (m.containsKey("url") && m.get("url") != null) props.getInflux().setUrl(String.valueOf(m.get("url")));
    if (m.containsKey("org") && m.get("org") != null) props.getInflux().setOrg(String.valueOf(m.get("org")));
    if (m.containsKey("bucket") && m.get("bucket") != null)
      props.getInflux().setBucket(String.valueOf(m.get("bucket")));
    if (m.containsKey("measurement") && m.get("measurement") != null)
      props.getInflux().setMeasurement(String.valueOf(m.get("measurement")));
    if (m.containsKey("required") && m.get("required") != null)
      props.getInflux().setRequired(Boolean.parseBoolean(String.valueOf(m.get("required"))));
    if (m.containsKey("token")) {
      String token = m.get("token") == null ? "" : String.valueOf(m.get("token"));
      if (!skipEmptySecrets || !token.isEmpty()) props.getInflux().setToken(token);
    }
  }

  public boolean reinitMysql() {
    boolean ok = mysql.init();
    if (ok) {
      try {
        devices.seedIfEmpty();
        tags.seedIfEmpty();
      } catch (Exception e) {
        log.warn("seed after mysql: {}", e.toString());
      }
    }
    return ok;
  }

  public boolean reinitInflux() {
    return influx.init();
  }

  public void reloadRuntime() {
    runtime.reload();
  }

  public Map<String, Object> publicSettings() {
    Map<String, Object> mysql = new LinkedHashMap<>();
    mysql.put("host", props.getMysql().getHost());
    mysql.put("port", props.getMysql().getPort());
    mysql.put("user", props.getMysql().getUser());
    mysql.put("database", props.getMysql().getDatabase());
    mysql.put("fallbackToFile", props.getMysql().isFallbackToFile());
    mysql.put(
        "passwordSet",
        props.getMysql().getPassword() != null && !props.getMysql().getPassword().isEmpty());
    mysql.put("passwordMasked", mask(props.getMysql().getPassword()));

    Map<String, Object> influxMap = new LinkedHashMap<>();
    influxMap.put("url", props.getInflux().getUrl());
    influxMap.put("org", props.getInflux().getOrg());
    influxMap.put("bucket", props.getInflux().getBucket());
    influxMap.put("measurement", props.getInflux().getMeasurement());
    influxMap.put("required", props.getInflux().isRequired());
    influxMap.put("tokenSet", props.getInflux().getToken() != null && !props.getInflux().getToken().isBlank());
    influxMap.put("tokenMasked", mask(props.getInflux().getToken()));

    return Map.of("mysql", mysql, "influx", influxMap);
  }

  public Map<String, Object> status() {
    return Map.of(
        "mysql",
        mysql.status(),
        "influx",
        influx.status(),
        "storage",
        mysql.isReady() ? "mysql" : "file");
  }

  private static String mask(String value) {
    if (value == null || value.isEmpty()) return "";
    if (value.length() <= 4) return "****";
    return value.substring(0, 2)
        + "*".repeat(Math.min(8, value.length() - 4))
        + value.substring(value.length() - 2);
  }
}
