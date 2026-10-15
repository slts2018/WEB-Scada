package com.webscada.server.store;

import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.model.AlarmEvent;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class AlarmEventStore {
  private static final Logger log = LoggerFactory.getLogger(AlarmEventStore.class);
  private static final int FILE_CAP = 2000;

  private final Path file;
  private final MysqlBootstrap mysql;
  private final ScadaProperties props;

  public AlarmEventStore(PathsProvider paths, MysqlBootstrap mysql, ScadaProperties props) {
    this.file = paths.getDataRoot().resolve("alarm-events.json");
    this.mysql = mysql;
    this.props = props;
  }

  public void append(AlarmEvent event) {
    if (event == null || event.alarmId() == null) return;
    try {
      if (mysql.isReady()) {
        mysql
            .jdbc()
            .update(
                """
                INSERT INTO alarm_events
                  (alarm_id, tag_id, name, level, kind, event_kind, message, value_text, quality, event_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                event.alarmId(),
                event.tagId(),
                event.name(),
                event.level() == null ? "alarm" : event.level(),
                event.kind(),
                event.eventKind(),
                clip(event.message(), 512),
                clip(event.valueText(), 255),
                event.quality(),
                event.eventAt());
        return;
      }
      if (!props.getMysql().isFallbackToFile()) return;
      List<AlarmEvent> items = new ArrayList<>(readFile());
      items.add(event);
      if (items.size() > FILE_CAP) {
        items.sort(Comparator.comparingLong(AlarmEvent::eventAt));
        items = new ArrayList<>(items.subList(items.size() - FILE_CAP, items.size()));
      }
      JsonFiles.write(file, items);
    } catch (Exception e) {
      log.warn("alarm event write failed: {}", e.toString());
    }
  }

  public List<AlarmEvent> list(String tagId, int limit) {
    return list(tagId, null, null, limit);
  }

  /** from、to 为事件时间（毫秒）。不传则不限制这一侧。最多 500 条。 */
  public List<AlarmEvent> list(String tagId, Long from, Long to, int limit) {
    int n = Math.min(500, Math.max(1, limit));
    try {
      if (mysql.isReady()) {
        StringBuilder sql =
            new StringBuilder(
                """
                SELECT alarm_id, tag_id, name, level, kind, event_kind, message, value_text, quality, event_at
                FROM alarm_events WHERE 1=1
                """);
        List<Object> args = new ArrayList<>();
        if (tagId != null && !tagId.isBlank()) {
          sql.append(" AND tag_id = ?");
          args.add(tagId);
        }
        if (from != null) {
          sql.append(" AND event_at >= ?");
          args.add(from);
        }
        if (to != null) {
          sql.append(" AND event_at <= ?");
          args.add(to);
        }
        sql.append(" ORDER BY event_at DESC, id DESC LIMIT ?");
        args.add(n);
        return mysql.jdbc().query(sql.toString(), (rs, i) -> map(rs), args.toArray());
      }
      if (!props.getMysql().isFallbackToFile()) return List.of();
      List<AlarmEvent> items = new ArrayList<>(readFile());
      items.sort(Comparator.comparingLong(AlarmEvent::eventAt).reversed());
      List<AlarmEvent> out = new ArrayList<>();
      for (AlarmEvent event : items) {
        if (tagId != null && !tagId.isBlank() && !tagId.equals(event.tagId())) continue;
        if (from != null && event.eventAt() < from) continue;
        if (to != null && event.eventAt() > to) continue;
        out.add(event);
        if (out.size() >= n) break;
      }
      return out;
    } catch (Exception e) {
      log.warn("alarm event list failed: {}", e.toString());
      return List.of();
    }
  }

  private List<AlarmEvent> readFile() throws IOException {
    AlarmEvent[] arr = JsonFiles.read(file, AlarmEvent[].class);
    if (arr == null) return List.of();
    return List.of(arr);
  }

  private static AlarmEvent map(java.sql.ResultSet rs) throws java.sql.SQLException {
    return new AlarmEvent(
        rs.getString("alarm_id"),
        rs.getString("tag_id"),
        rs.getString("name"),
        rs.getString("level"),
        rs.getString("kind"),
        rs.getString("event_kind"),
        rs.getString("message"),
        rs.getString("value_text"),
        rs.getString("quality"),
        rs.getLong("event_at"));
  }

  private static String clip(String text, int max) {
    if (text == null || text.length() <= max) return text;
    return text.substring(0, max);
  }
}
