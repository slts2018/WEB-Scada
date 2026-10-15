package com.webscada.server.store;

import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.mock.MockTagData;
import com.webscada.server.model.DeviceMeta;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class DeviceFileStore {
  private final Path file;
  private final MysqlBootstrap mysql;
  private final ScadaProperties props;

  public DeviceFileStore(PathsProvider paths, MysqlBootstrap mysql, ScadaProperties props) {
    this.file = paths.getDataRoot().resolve("devices.json");
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

  public synchronized List<DeviceMeta> list() throws IOException {
    if (useFile()) return listFile();
    if (!mysql.isReady()) return List.of(MockTagData.MOCK_DEVICES);
    return mysql
        .jdbc()
        .query(
            """
            SELECT device_id, name, protocol, channel, enabled, description
            FROM devices ORDER BY device_id ASC
            """,
            (rs, i) ->
                new DeviceMeta(
                    rs.getString("device_id"),
                    rs.getString("name"),
                    rs.getString("protocol"),
                    blankToNull(rs.getString("channel")),
                    rs.getBoolean("enabled"),
                    blankToNull(rs.getString("description"))));
  }

  private List<DeviceMeta> listFile() throws IOException {
    DeviceMeta[] items = JsonFiles.read(file, DeviceMeta[].class);
    if (items == null || items.length == 0) return List.of();
    List<DeviceMeta> list = new ArrayList<>(Arrays.asList(items));
    list.sort(Comparator.comparing(DeviceMeta::deviceId));
    return list;
  }

  public synchronized DeviceMeta get(String deviceId) throws IOException {
    return list().stream().filter(d -> d.deviceId().equals(deviceId)).findFirst().orElse(null);
  }

  public synchronized DeviceMeta upsert(DeviceMeta meta) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<DeviceMeta> items = new ArrayList<>(listFile());
      int idx = -1;
      for (int i = 0; i < items.size(); i++) {
        if (items.get(i).deviceId().equals(meta.deviceId())) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) items.set(idx, meta);
      else items.add(meta);
      items.sort(Comparator.comparing(DeviceMeta::deviceId));
      JsonFiles.write(file, items);
      return meta;
    }
    long now = System.currentTimeMillis();
    mysql
        .jdbc()
        .update(
            """
            INSERT INTO devices
              (device_id, name, protocol, channel, enabled, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              protocol = VALUES(protocol),
              channel = VALUES(channel),
              enabled = VALUES(enabled),
              description = VALUES(description),
              updated_at = VALUES(updated_at)
            """,
            meta.deviceId(),
            meta.name(),
            meta.protocol(),
            meta.channel(),
            meta.enabled() ? 1 : 0,
            meta.description(),
            now,
            now);
    return meta;
  }

  public synchronized boolean delete(String deviceId) throws IOException {
    requireWritableBackend();
    if (useFile()) {
      List<DeviceMeta> items = new ArrayList<>(listFile());
      boolean removed = items.removeIf(d -> d.deviceId().equals(deviceId));
      if (removed) JsonFiles.write(file, items);
      return removed;
    }
    return mysql.jdbc().update("DELETE FROM devices WHERE device_id = ?", deviceId) > 0;
  }

  public synchronized void seedIfEmpty() throws IOException {
    if (useFile()) {
      DeviceMeta[] items = JsonFiles.read(file, DeviceMeta[].class);
      if (items != null && items.length > 0) return;
      JsonFiles.write(file, MockTagData.MOCK_DEVICES);
      return;
    }
    if (!mysql.isReady()) return;
    Integer count = mysql.jdbc().queryForObject("SELECT COUNT(*) FROM devices", Integer.class);
    if (count != null && count > 0) return;
    for (DeviceMeta meta : MockTagData.MOCK_DEVICES) {
      upsert(meta);
    }
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }
}
