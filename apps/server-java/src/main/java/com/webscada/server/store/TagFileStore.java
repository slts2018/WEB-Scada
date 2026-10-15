package com.webscada.server.store;

import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.mock.MockTagData;
import com.webscada.server.model.TagHistory;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagSimulation;
import java.io.IOException;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class TagFileStore {
  private static final String DEFAULT_DEVICE = "demo.plc";
  private final Path file;
  private final MysqlBootstrap mysql;
  private final ScadaProperties props;

  public TagFileStore(PathsProvider paths, MysqlBootstrap mysql, ScadaProperties props) {
    this.file = paths.getDataRoot().resolve("tags.json");
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

  private TagMeta normalize(TagMeta raw) {
    String deviceId =
        raw.deviceId() == null || raw.deviceId().isBlank() ? DEFAULT_DEVICE : raw.deviceId().trim();
    return new TagMeta(
        raw.tagId(),
        raw.name(),
        raw.group(),
        deviceId,
        raw.address(),
        raw.dataType(),
        raw.unit(),
        raw.writable(),
        raw.description(),
        raw.simulation(),
        blankToNull(raw.onText()),
        blankToNull(raw.offText()),
        clampPeriod(raw.scanPeriodMs()),
        raw.pushEnabled(),
        clampPeriod(raw.pushPeriodMs()),
        normalizeHistory(raw.history()));
  }

  public synchronized List<TagMeta> list() throws IOException {
    if (useFile()) return listFile();
    if (!mysql.isReady()) return Arrays.stream(MockTagData.MOCK_TAGS).map(this::normalize).toList();
    return mysql
        .jdbc()
        .query(
            """
            SELECT tag_id, name, tag_group, device_id, address, data_type, unit, writable, description, simulation_json,
                   on_text, off_text, scan_period_ms, push_enabled, push_period_ms, history_json
            FROM tags ORDER BY tag_group IS NULL, tag_group ASC, tag_id ASC
            """,
            (rs, i) ->
                normalize(
                    new TagMeta(
                        rs.getString("tag_id"),
                        rs.getString("name"),
                        blankToNull(rs.getString("tag_group")),
                        rs.getString("device_id"),
                        blankToNull(rs.getString("address")),
                        rs.getString("data_type"),
                        blankToNull(rs.getString("unit")),
                        rs.getBoolean("writable"),
                        blankToNull(rs.getString("description")),
                        readSimulation(rs.getString("simulation_json")),
                        blankToNull(rs.getString("on_text")),
                        blankToNull(rs.getString("off_text")),
                        readInt(rs, "scan_period_ms"),
                        readBool(rs, "push_enabled"),
                        readInt(rs, "push_period_ms"),
                        readHistory(rs.getString("history_json")))));
  }

  private List<TagMeta> listFile() throws IOException {
    TagMeta[] items = JsonFiles.read(file, TagMeta[].class);
    if (items == null || items.length == 0) return List.of();
    List<TagMeta> list = new ArrayList<>();
    for (TagMeta t : items) list.add(normalize(t));
    list.sort(
        Comparator.comparing(
                (TagMeta t) -> t.group() == null ? "" : t.group(),
                (a, b) -> {
                  if (a.isEmpty() && !b.isEmpty()) return 1;
                  if (!a.isEmpty() && b.isEmpty()) return -1;
                  return a.compareTo(b);
                })
            .thenComparing(TagMeta::tagId));
    return list;
  }

  public synchronized TagMeta get(String tagId) throws IOException {
    return list().stream().filter(t -> t.tagId().equals(tagId)).findFirst().orElse(null);
  }

  public synchronized TagMeta upsert(TagMeta meta) throws IOException {
    requireWritableBackend();
    if (meta.deviceId() == null || meta.deviceId().isBlank()) {
      throw new IllegalArgumentException("device_id_required");
    }
    TagMeta next = normalize(meta);
    if (useFile()) {
      List<TagMeta> items = new ArrayList<>(listFile());
      int idx = -1;
      for (int i = 0; i < items.size(); i++) {
        if (items.get(i).tagId().equals(next.tagId())) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) items.set(idx, next);
      else items.add(next);
      JsonFiles.write(file, items);
      return next;
    }
    long now = System.currentTimeMillis();
    mysql
        .jdbc()
        .update(
            """
            INSERT INTO tags
              (tag_id, name, tag_group, device_id, address, data_type, unit, writable, description, simulation_json,
               on_text, off_text, scan_period_ms, push_enabled, push_period_ms, history_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              tag_group = VALUES(tag_group),
              device_id = VALUES(device_id),
              address = VALUES(address),
              data_type = VALUES(data_type),
              unit = VALUES(unit),
              writable = VALUES(writable),
              description = VALUES(description),
              simulation_json = VALUES(simulation_json),
              on_text = VALUES(on_text),
              off_text = VALUES(off_text),
              scan_period_ms = VALUES(scan_period_ms),
              push_enabled = VALUES(push_enabled),
              push_period_ms = VALUES(push_period_ms),
              history_json = VALUES(history_json),
              updated_at = VALUES(updated_at)
            """,
            next.tagId(),
            next.name(),
            next.group(),
            next.deviceId(),
            next.address(),
            next.dataType(),
            next.unit(),
            next.writable() ? 1 : 0,
            next.description(),
            writeSimulation(next.simulation()),
            next.onText(),
            next.offText(),
            next.scanPeriodMs(),
            next.pushEnabled() == null ? null : (next.pushEnabled() ? 1 : 0),
            next.pushPeriodMs(),
            writeHistory(next.history()),
            now,
            now);
    return next;
  }

  public synchronized boolean delete(String tagId) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<TagMeta> items = new ArrayList<>(listFile());
      boolean removed = items.removeIf(t -> t.tagId().equals(tagId));
      if (removed) JsonFiles.write(file, items);
      return removed;
    }
    return mysql.jdbc().update("DELETE FROM tags WHERE tag_id = ?", tagId) > 0;
  }

  public synchronized void seedIfEmpty() throws IOException {
    if (useFile()) {
      TagMeta[] items = JsonFiles.read(file, TagMeta[].class);
      if (items != null && items.length > 0) return;
      List<TagMeta> seed = Arrays.stream(MockTagData.MOCK_TAGS).map(this::normalize).toList();
      JsonFiles.write(file, seed);
      return;
    }
    if (!mysql.isReady()) return;
    Integer count = mysql.jdbc().queryForObject("SELECT COUNT(*) FROM tags", Integer.class);
    if (count != null && count > 0) return;
    for (TagMeta meta : MockTagData.MOCK_TAGS) {
      upsert(normalize(meta));
    }
  }

  public int count() throws IOException {
    return list().size();
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }

  private static TagSimulation readSimulation(String json) {
    if (json == null || json.isBlank()) return null;
    try {
      return JsonFiles.mapper().readValue(json, TagSimulation.class);
    } catch (Exception e) {
      return null;
    }
  }

  private static String writeSimulation(TagSimulation sim) {
    if (sim == null) return null;
    try {
      return JsonFiles.mapper().writeValueAsString(sim);
    } catch (Exception e) {
      return null;
    }
  }

  private static TagHistory readHistory(String json) {
    if (json == null || json.isBlank()) return null;
    try {
      return normalizeHistory(JsonFiles.mapper().readValue(json, TagHistory.class));
    } catch (Exception e) {
      return null;
    }
  }

  private static String writeHistory(TagHistory history) {
    if (history == null) return null;
    try {
      return JsonFiles.mapper().writeValueAsString(history);
    } catch (Exception e) {
      return null;
    }
  }

  /** mode=legacy 或未标明开关时清回缺省，运行时沿用旧的写值记历史。 */
  static TagHistory normalizeHistory(TagHistory history) {
    if (history == null) return null;
    if (history.mode() != null && history.mode().equalsIgnoreCase("legacy")) return null;
    if (history.enabled() == null) return null;
    if (!history.enabled()) return new TagHistory(false, null, null, null);
    String mode = "interval".equalsIgnoreCase(history.mode()) ? "interval" : "change";
    int interval = history.intervalMs() == null ? 1000 : Math.max(200, Math.min(history.intervalMs(), 86_400_000));
    double band = history.deadband() == null ? 0 : Math.max(0, history.deadband());
    return new TagHistory(true, mode, interval, band);
  }

  private static Integer clampPeriod(Integer ms) {
    if (ms == null) return null;
    return Math.max(200, Math.min(ms, 86_400_000));
  }

  private static Integer readInt(ResultSet rs, String column) throws SQLException {
    int value = rs.getInt(column);
    return rs.wasNull() ? null : value;
  }

  private static Boolean readBool(ResultSet rs, String column) throws SQLException {
    Object value = rs.getObject(column);
    if (value == null || rs.wasNull()) return null;
    if (value instanceof Boolean b) return b;
    if (value instanceof Number n) return n.intValue() != 0;
    return Boolean.valueOf(String.valueOf(value));
  }
}
