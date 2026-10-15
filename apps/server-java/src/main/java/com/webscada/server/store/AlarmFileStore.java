package com.webscada.server.store;

import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.model.TagAlarmConfig;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class AlarmFileStore {
  private final Path file;
  private final MysqlBootstrap mysql;
  private final ScadaProperties props;

  public AlarmFileStore(PathsProvider paths, MysqlBootstrap mysql, ScadaProperties props) {
    this.file = paths.getDataRoot().resolve("alarms.json");
    this.mysql = mysql;
    this.props = props;
  }

  private boolean useFile() {
    return !mysql.isReady() && props.getMysql().isFallbackToFile();
  }

  private void requireWritableBackend() {
    if (!mysql.isReady() && !props.getMysql().isFallbackToFile()) {
      throw new IllegalStateException("MySQL is not ready");
    }
  }

  public synchronized List<TagAlarmConfig> list() throws IOException {
    if (useFile()) return listFile();
    if (!mysql.isReady()) return List.of();
    return mysql
        .jdbc()
        .query(
            """
            SELECT alarm_id, tag_id, name, enabled, level, kind, limit_code, threshold, deadband,
                   bool_value, quality_code, delay_sec, target_value, window_sec, expect_text
            FROM tag_alarms ORDER BY tag_id ASC, alarm_id ASC
            """,
            (rs, i) -> mapRow(rs));
  }

  public synchronized List<TagAlarmConfig> listByTag(String tagId) throws IOException {
    List<TagAlarmConfig> all = new ArrayList<>();
    for (TagAlarmConfig c : list()) {
      if (c.tagId().equals(tagId)) all.add(c);
    }
    return all;
  }

  public synchronized TagAlarmConfig get(String alarmId) throws IOException {
    for (TagAlarmConfig c : list()) {
      if (c.alarmId().equals(alarmId)) return c;
    }
    return null;
  }

  public synchronized TagAlarmConfig upsert(TagAlarmConfig cfg) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<TagAlarmConfig> items = new ArrayList<>(listFile());
      int idx = -1;
      for (int i = 0; i < items.size(); i++) {
        if (items.get(i).alarmId().equals(cfg.alarmId())) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) items.set(idx, cfg);
      else items.add(cfg);
      items.sort(Comparator.comparing(TagAlarmConfig::tagId).thenComparing(TagAlarmConfig::alarmId));
      JsonFiles.write(file, items);
      return cfg;
    }
    long now = System.currentTimeMillis();
    mysql
        .jdbc()
        .update(
            """
            INSERT INTO tag_alarms
              (alarm_id, tag_id, name, enabled, level, kind, limit_code, threshold, deadband,
               bool_value, quality_code, delay_sec, target_value, window_sec, expect_text, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              tag_id = VALUES(tag_id),
              name = VALUES(name),
              enabled = VALUES(enabled),
              level = VALUES(level),
              kind = VALUES(kind),
              limit_code = VALUES(limit_code),
              threshold = VALUES(threshold),
              deadband = VALUES(deadband),
              bool_value = VALUES(bool_value),
              quality_code = VALUES(quality_code),
              delay_sec = VALUES(delay_sec),
              target_value = VALUES(target_value),
              window_sec = VALUES(window_sec),
              expect_text = VALUES(expect_text),
              updated_at = VALUES(updated_at)
            """,
            cfg.alarmId(),
            cfg.tagId(),
            cfg.name(),
            cfg.enabled() ? 1 : 0,
            cfg.level(),
            cfg.kind(),
            cfg.limit(),
            cfg.threshold(),
            cfg.deadband(),
            cfg.boolValue() == null ? null : (cfg.boolValue() ? 1 : 0),
            cfg.quality(),
            cfg.delaySec(),
            cfg.target(),
            cfg.windowSec(),
            cfg.expectText(),
            now,
            now);
    return cfg;
  }

  public synchronized boolean delete(String alarmId) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<TagAlarmConfig> items = new ArrayList<>(listFile());
      boolean removed = items.removeIf(c -> c.alarmId().equals(alarmId));
      if (removed) JsonFiles.write(file, items);
      return removed;
    }
    return mysql.jdbc().update("DELETE FROM tag_alarms WHERE alarm_id = ?", alarmId) > 0;
  }

  public synchronized int deleteByTag(String tagId) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<TagAlarmConfig> items = new ArrayList<>(listFile());
      int before = items.size();
      items.removeIf(c -> c.tagId().equals(tagId));
      if (items.size() != before) JsonFiles.write(file, items);
      return before - items.size();
    }
    return mysql.jdbc().update("DELETE FROM tag_alarms WHERE tag_id = ?", tagId);
  }

  private List<TagAlarmConfig> listFile() throws IOException {
    TagAlarmConfig[] items = JsonFiles.read(file, TagAlarmConfig[].class);
    if (items == null || items.length == 0) return List.of();
    List<TagAlarmConfig> list = new ArrayList<>();
    for (TagAlarmConfig c : items) list.add(c);
    list.sort(Comparator.comparing(TagAlarmConfig::tagId).thenComparing(TagAlarmConfig::alarmId));
    return list;
  }

  private static TagAlarmConfig mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
    Object boolObj = rs.getObject("bool_value");
    Boolean boolValue = boolObj == null ? null : rs.getInt("bool_value") != 0;
    Object th = rs.getObject("threshold");
    Object db = rs.getObject("deadband");
    Object target = rs.getObject("target_value");
    Object window = rs.getObject("window_sec");
    return new TagAlarmConfig(
        rs.getString("alarm_id"),
        rs.getString("tag_id"),
        rs.getString("name"),
        rs.getBoolean("enabled"),
        rs.getString("level"),
        rs.getString("kind"),
        blankToNull(rs.getString("limit_code")),
        th == null ? null : ((Number) th).doubleValue(),
        db == null ? null : ((Number) db).doubleValue(),
        boolValue,
        blankToNull(rs.getString("quality_code")),
        rs.getDouble("delay_sec"),
        target == null ? null : ((Number) target).doubleValue(),
        window == null ? null : ((Number) window).doubleValue(),
        rs.getString("expect_text"));
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }
}
