package com.webscada.server.web;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.InfluxHolder;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.store.TagFileStore;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final ScadaProperties props;
  private final TagFileStore tags;
  private final MysqlBootstrap mysql;
  private final InfluxHolder influx;

  public HealthController(
      ScadaProperties props, TagFileStore tags, MysqlBootstrap mysql, InfluxHolder influx) {
    this.props = props;
    this.tags = tags;
    this.mysql = mysql;
    this.influx = influx;
  }

  @GetMapping("/api/health")
  public Map<String, Object> health() throws Exception {
    Map<String, Object> mysqlStatus = new LinkedHashMap<>(mysql.status());
    Map<String, Object> influxStatus = new LinkedHashMap<>(influx.status());
    influxStatus.put("measurement", props.getInflux().getMeasurement());

    Map<String, Object> auth = new LinkedHashMap<>();
    auth.put("enabled", props.getAuth().isEnabled());
    auth.put("required", props.getAuth().isRequired());

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("ok", true);
    body.put("service", "web-scada-server");
    body.put("time", System.currentTimeMillis());
    body.put("mysql", mysqlStatus);
    body.put("influx", influxStatus);
    body.put("storage", mysql.isReady() ? "mysql" : "file");
    body.put("tags", tags.count());
    body.put("auth", auth);
    body.put("backend", "spring");
    return body;
  }
}
