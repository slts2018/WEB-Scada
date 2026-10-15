package com.webscada.server.web;

import com.webscada.server.db.InfluxHolder;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.model.ApiError;
import com.webscada.server.service.DatabaseSettingsService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SettingsController {
  private final DatabaseSettingsService settings;
  private final MysqlBootstrap mysql;
  private final InfluxHolder influx;

  public SettingsController(
      DatabaseSettingsService settings, MysqlBootstrap mysql, InfluxHolder influx) {
    this.settings = settings;
    this.mysql = mysql;
    this.influx = influx;
  }

  @GetMapping("/api/settings/database")
  public Map<String, Object> get() {
    return Map.of("settings", settings.publicSettings(), "status", settings.status());
  }

  @PutMapping("/api/settings/database")
  public ResponseEntity<?> put(@RequestBody Map<String, Object> body) throws Exception {
    if (body == null || (!body.containsKey("mysql") && !body.containsKey("influx"))) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_settings_body"));
    }
    settings.applyUpdate(body);
    settings.savePersisted();
    boolean mysqlOk = settings.reinitMysql();
    boolean influxOk = settings.reinitInflux();
    settings.reloadRuntime();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("ok", true);
    out.put("mysqlOk", mysqlOk);
    out.put("influxOk", influxOk);
    out.put("settings", settings.publicSettings());
    out.put("status", settings.status());
    return ResponseEntity.ok(out);
  }

  @PostMapping("/api/settings/database/test")
  @SuppressWarnings("unchecked")
  public Map<String, Object> test(@RequestBody(required = false) Map<String, Object> body) {
    Map<String, Object> mysqlOpts =
        body != null && body.get("mysql") instanceof Map<?, ?> m
            ? (Map<String, Object>) m
            : null;
    Map<String, Object> influxOpts =
        body != null && body.get("influx") instanceof Map<?, ?> m
            ? (Map<String, Object>) m
            : null;
    return Map.of("mysql", mysql.test(mysqlOpts), "influx", influx.test(influxOpts));
  }
}
