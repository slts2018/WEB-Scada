package com.webscada.server.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.config.PathsProvider;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.MysqlBootstrap;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class ProjectFileStore {
  private final Path projectsDir;
  private final Path publishesDir;
  private final Path metaFile;
  private final MysqlBootstrap mysql;
  private final ScadaProperties props;

  public ProjectFileStore(PathsProvider paths, MysqlBootstrap mysql, ScadaProperties props) {
    Path data = paths.getDataRoot();
    this.projectsDir = data.resolve("projects");
    this.publishesDir = data.resolve("publishes");
    this.metaFile = data.resolve("meta.json");
    this.mysql = mysql;
    this.props = props;
  }

  private Mode mode() {
    if (mysql.isReady()) return Mode.MYSQL;
    if (props.getMysql().isFallbackToFile()) return Mode.FILE;
    throw new IllegalStateException("MySQL is not ready");
  }

  private enum Mode {
    MYSQL,
    FILE
  }

  private void ensureDirs() throws IOException {
    Files.createDirectories(projectsDir);
    Files.createDirectories(publishesDir);
  }

  public List<Map<String, Object>> listProjects() throws IOException {
    if (mode() == Mode.FILE) return listProjectsFile();
    return mysql
        .jdbc()
        .query(
            "SELECT id, name, updated_at, version FROM projects ORDER BY updated_at DESC",
            (rs, i) -> {
              Map<String, Object> row = new HashMap<>();
              row.put("id", rs.getString("id"));
              row.put("name", rs.getString("name"));
              row.put("updatedAt", rs.getLong("updated_at"));
              row.put("version", rs.getString("version"));
              return row;
            });
  }

  private List<Map<String, Object>> listProjectsFile() throws IOException {
    ensureDirs();
    List<Map<String, Object>> items = new ArrayList<>();
    try (DirectoryStream<Path> stream = Files.newDirectoryStream(projectsDir, "*.json")) {
      for (Path p : stream) {
        JsonNode doc = JsonFiles.readTree(p);
        if (doc == null || !doc.has("meta")) continue;
        JsonNode meta = doc.get("meta");
        if (!meta.has("id")) continue;
        Map<String, Object> row = new HashMap<>();
        row.put("id", meta.get("id").asText());
        row.put("name", meta.path("name").asText(""));
        row.put("updatedAt", meta.path("updatedAt").asLong(0));
        row.put("version", meta.path("version").asText("0.1.0"));
        items.add(row);
      }
    }
    items.sort(Comparator.comparingLong(a -> -((Number) a.get("updatedAt")).longValue()));
    return items;
  }

  public JsonNode getProject(String id) throws IOException {
    if (mode() == Mode.FILE) return JsonFiles.readTree(projectsDir.resolve(id + ".json"));
    List<String> rows =
        mysql
            .jdbc()
            .query(
                "SELECT document_json FROM projects WHERE id = ? LIMIT 1",
                (rs, i) -> rs.getString("document_json"),
                id);
    if (rows.isEmpty()) return null;
    return JsonFiles.mapper().readTree(rows.get(0));
  }

  public JsonNode saveProject(JsonNode doc) throws IOException {
    ObjectNode root = (ObjectNode) doc.deepCopy();
    ObjectNode meta = (ObjectNode) root.get("meta");
    if (meta == null || !meta.has("id")) {
      throw new IllegalArgumentException("invalid_project_body");
    }
    meta.put("updatedAt", System.currentTimeMillis());
    String id = meta.get("id").asText();

    if (mode() == Mode.FILE) {
      ensureDirs();
      JsonFiles.write(projectsDir.resolve(id + ".json"), root);
      Map<String, Object> m = readMetaFile();
      m.put("lastProjectId", id);
      JsonFiles.write(metaFile, m);
      return root;
    }

    JdbcTemplate jdbc = mysql.jdbc();
    long updatedAt = meta.path("updatedAt").asLong();
    long createdAt = meta.path("createdAt").asLong(updatedAt);
    String name = meta.path("name").asText("");
    String version = meta.path("version").asText("0.1.0");
    String json = JsonFiles.mapper().writeValueAsString(root);
    jdbc.update(
        """
        INSERT INTO projects (id, name, version, updated_at, document_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          version = VALUES(version),
          updated_at = VALUES(updated_at),
          document_json = VALUES(document_json)
        """,
        id,
        name,
        version,
        updatedAt,
        json,
        createdAt);
    jdbc.update(
        """
        INSERT INTO app_meta (meta_key, meta_value) VALUES ('last_project_id', ?)
        ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)
        """,
        id);
    if (props.getMysql().isFallbackToFile()) {
      try {
        ensureDirs();
        JsonFiles.write(projectsDir.resolve(id + ".json"), root);
        Map<String, Object> m = readMetaFile();
        m.put("lastProjectId", id);
        JsonFiles.write(metaFile, m);
      } catch (Exception ignored) {
      }
    }
    return root;
  }

  public boolean deleteProject(String id) throws IOException {
    if (mode() == Mode.FILE) {
      ensureDirs();
      boolean removed = Files.deleteIfExists(projectsDir.resolve(id + ".json"));
      Files.deleteIfExists(publishesDir.resolve(id + ".json"));
      Map<String, Object> m = readMetaFile();
      if (id.equals(m.get("lastProjectId"))) {
        m.put("lastProjectId", null);
        JsonFiles.write(metaFile, m);
      }
      return removed;
    }

    JdbcTemplate jdbc = mysql.jdbc();
    int n = jdbc.update("DELETE FROM projects WHERE id = ?", id);
    jdbc.update("DELETE FROM publishes WHERE project_id = ?", id);
    List<String> meta =
        jdbc.query(
            "SELECT meta_value FROM app_meta WHERE meta_key = 'last_project_id' LIMIT 1",
            (rs, i) -> rs.getString("meta_value"));
    if (!meta.isEmpty() && id.equals(meta.get(0))) {
      jdbc.update("UPDATE app_meta SET meta_value = NULL WHERE meta_key = 'last_project_id'");
    }
    if (props.getMysql().isFallbackToFile()) {
      try {
        Files.deleteIfExists(projectsDir.resolve(id + ".json"));
        Files.deleteIfExists(publishesDir.resolve(id + ".json"));
      } catch (Exception ignored) {
      }
    }
    return n > 0;
  }

  public String getLastProjectId() throws IOException {
    if (mode() == Mode.FILE) {
      Object v = readMetaFile().get("lastProjectId");
      return v == null ? null : String.valueOf(v);
    }
    List<String> rows =
        mysql
            .jdbc()
            .query(
                "SELECT meta_value FROM app_meta WHERE meta_key = 'last_project_id' LIMIT 1",
                (rs, i) -> rs.getString("meta_value"));
    if (rows.isEmpty() || rows.get(0) == null) return null;
    return rows.get(0);
  }

  public List<Map<String, Object>> listPublishes() throws IOException {
    if (mode() == Mode.FILE) return listPublishesFile();
    return mysql
        .jdbc()
        .query(
            """
            SELECT project_id, project_name, publish_version, published_at
            FROM publishes ORDER BY published_at DESC
            """,
            (rs, i) -> {
              Map<String, Object> row = new HashMap<>();
              row.put("projectId", rs.getString("project_id"));
              row.put("projectName", rs.getString("project_name"));
              row.put("publishVersion", rs.getString("publish_version"));
              row.put("publishedAt", rs.getLong("published_at"));
              return row;
            });
  }

  private List<Map<String, Object>> listPublishesFile() throws IOException {
    ensureDirs();
    List<Map<String, Object>> items = new ArrayList<>();
    try (DirectoryStream<Path> stream = Files.newDirectoryStream(publishesDir, "*.json")) {
      for (Path p : stream) {
        JsonNode pkg = JsonFiles.readTree(p);
        if (pkg == null || !pkg.has("manifest")) continue;
        JsonNode man = pkg.get("manifest");
        Map<String, Object> row = new HashMap<>();
        row.put("projectId", man.path("projectId").asText());
        row.put("projectName", man.path("projectName").asText(""));
        row.put("publishVersion", man.path("publishVersion").asText(""));
        row.put("publishedAt", man.path("publishedAt").asLong(0));
        items.add(row);
      }
    }
    items.sort(Comparator.comparingLong(a -> -((Number) a.get("publishedAt")).longValue()));
    return items;
  }

  public JsonNode getPublish(String projectId) throws IOException {
    if (mode() == Mode.FILE) return JsonFiles.readTree(publishesDir.resolve(projectId + ".json"));
    List<String> rows =
        mysql
            .jdbc()
            .query(
                "SELECT package_json FROM publishes WHERE project_id = ? LIMIT 1",
                (rs, i) -> rs.getString("package_json"),
                projectId);
    if (rows.isEmpty()) return null;
    return JsonFiles.mapper().readTree(rows.get(0));
  }

  public JsonNode getLatestPublish() throws IOException {
    String last = getLastProjectId();
    if (last != null) {
      JsonNode p = getPublish(last);
      if (p != null) return p;
    }
    List<Map<String, Object>> items = listPublishes();
    if (items.isEmpty()) return null;
    return getPublish(String.valueOf(items.get(0).get("projectId")));
  }

  public JsonNode savePublish(JsonNode pkg) throws IOException {
    JsonNode man = pkg.get("manifest");
    if (man == null || !man.has("projectId")) {
      throw new IllegalArgumentException("invalid_publish_body");
    }
    String id = man.get("projectId").asText();
    if (mode() == Mode.FILE) {
      ensureDirs();
      JsonFiles.write(publishesDir.resolve(id + ".json"), pkg);
      return pkg;
    }
    mysql
        .jdbc()
        .update(
            """
            INSERT INTO publishes (project_id, project_name, publish_version, published_at, package_json)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              project_name = VALUES(project_name),
              publish_version = VALUES(publish_version),
              published_at = VALUES(published_at),
              package_json = VALUES(package_json)
            """,
            id,
            man.path("projectName").asText(""),
            man.path("publishVersion").asText(""),
            man.path("publishedAt").asLong(0),
            JsonFiles.mapper().writeValueAsString(pkg));
    if (props.getMysql().isFallbackToFile()) {
      try {
        ensureDirs();
        JsonFiles.write(publishesDir.resolve(id + ".json"), pkg);
      } catch (Exception ignored) {
      }
    }
    return pkg;
  }

  public String storageMode() {
    return mysql.isReady() ? "mysql" : "file";
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> readMetaFile() throws IOException {
    Map<String, Object> m = JsonFiles.read(metaFile, Map.class);
    if (m == null) {
      m = new HashMap<>();
      m.put("lastProjectId", null);
    }
    return m;
  }
}
