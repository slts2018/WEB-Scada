package com.webscada.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.config.PathsProvider;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagAlarmConfig;
import com.webscada.server.model.TagMeta;
import com.webscada.server.store.AlarmFileStore;
import com.webscada.server.store.DeviceFileStore;
import com.webscada.server.store.JsonFiles;
import com.webscada.server.store.ProjectFileStore;
import com.webscada.server.store.TagFileStore;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 工程包 zip：manifest.json + project.json + devices.json + tags.json + alarms.json + resources/*
 *
 * <p>设备/变量/报警为服务端全局配置；打进工程包后，另一台机器导入即可采集。
 * 导入时若包内含 devices/tags/alarms，会先清空本机全部设备/变量/报警再写入包内内容（整表替换，不合并）。
 * 旧包（无 io 文件）仍可导入，且不会清空本机 IO。
 */
@Service
public class ProjectPackageService {
  private static final Logger log = LoggerFactory.getLogger(ProjectPackageService.class);

  public static final String PACKAGE_FORMAT = "web-scada-project";
  /** 2 = 含 devices/tags/alarms；1 = 仅工程+资源（仍兼容导入） */
  public static final int PACKAGE_VERSION = 2;

  private final ProjectFileStore projects;
  private final PathsProvider paths;
  private final DeviceFileStore devices;
  private final TagFileStore tags;
  private final AlarmFileStore alarms;
  private final TagRuntimeService tagRuntime;
  private final ObjectMapper mapper = JsonFiles.mapper();

  public ProjectPackageService(
      ProjectFileStore projects,
      PathsProvider paths,
      DeviceFileStore devices,
      TagFileStore tags,
      AlarmFileStore alarms,
      TagRuntimeService tagRuntime) {
    this.projects = projects;
    this.paths = paths;
    this.devices = devices;
    this.tags = tags;
    this.alarms = alarms;
    this.tagRuntime = tagRuntime;
  }

  public record ExportResult(byte[] zip, String fileName, String projectName) {}

  public ExportResult exportProject(String projectId) throws IOException {
    JsonNode doc = projects.getProject(projectId);
    if (doc == null) throw new PackageException("project_not_found");

    List<DeviceMeta> deviceList = devices.list();
    List<TagMeta> tagList = tags.list();
    List<TagAlarmConfig> alarmList = alarms.list();

    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    try (ZipOutputStream zos = new ZipOutputStream(bos)) {
      zos.setLevel(6);
      Map<String, Object> manifest = new LinkedHashMap<>();
      manifest.put("format", PACKAGE_FORMAT);
      manifest.put("version", PACKAGE_VERSION);
      manifest.put("exportedAt", System.currentTimeMillis());
      manifest.put("sourceProjectId", doc.path("meta").path("id").asText());
      manifest.put("sourceProjectName", doc.path("meta").path("name").asText(""));
      manifest.put("deviceCount", deviceList.size());
      manifest.put("tagCount", tagList.size());
      manifest.put("alarmCount", alarmList.size());
      putEntry(zos, "manifest.json", mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest));
      putEntry(zos, "project.json", mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(doc));
      putEntry(
          zos,
          "devices.json",
          mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(deviceList));
      putEntry(
          zos, "tags.json", mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(tagList));
      putEntry(
          zos,
          "alarms.json",
          mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(alarmList));

      Path dir = paths.getResourcesRoot().resolve(projectId);
      if (Files.isDirectory(dir)) {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
          for (Path p : stream) {
            if (!Files.isRegularFile(p)) continue;
            putEntry(zos, "resources/" + p.getFileName().toString(), Files.readAllBytes(p));
          }
        }
      }
    }

    String name = doc.path("meta").path("name").asText("project");
    String safe = safeName(name, 80);
    return new ExportResult(
        bos.toByteArray(), (safe.isEmpty() ? "project" : safe) + ".webscada.zip", name);
  }

  public JsonNode importProject(MultipartFile file) throws IOException {
    if (file == null || file.isEmpty()) throw new PackageException("file_required");
    byte[] bytes = file.getBytes();
    Map<String, byte[]> entries = unzip(bytes);

    byte[] projectRaw = entries.get("project.json");
    if (projectRaw == null) throw new PackageException("missing_project_json");

    JsonNode source;
    try {
      source = mapper.readTree(projectRaw);
    } catch (Exception e) {
      throw new PackageException("invalid_project_json");
    }
    if (source == null
        || !source.has("meta")
        || !source.get("meta").has("id")
        || !source.has("pages")
        || !source.get("pages").isArray()) {
      throw new PackageException("invalid_project_body");
    }

    byte[] manifestRaw = entries.get("manifest.json");
    if (manifestRaw != null) {
      try {
        JsonNode man = mapper.readTree(manifestRaw);
        if (man.has("format") && !PACKAGE_FORMAT.equals(man.path("format").asText())) {
          throw new PackageException("unsupported_package_format");
        }
      } catch (PackageException e) {
        throw e;
      } catch (Exception ignored) {
        // manifest 损坏不阻断
      }
    }

    // 含 devices/tags 的包：先清空本机设备/变量/报警，再整表替换为包内配置（不合并残留）
    boolean hasIo =
        entries.containsKey("devices.json")
            || entries.containsKey("tags.json")
            || entries.containsKey("alarms.json");
    if (hasIo) {
      clearAllIo();
      int deviceN = importDevices(entries.get("devices.json"));
      int tagN = importTags(entries.get("tags.json"));
      int alarmN = importAlarms(entries.get("alarms.json"));
      try {
        tagRuntime.reload();
      } catch (Exception e) {
        log.warn("reload tag runtime after import failed: {}", e.toString());
      }
      log.info(
          "project package IO replaced devices={} tags={} alarms={}", deviceN, tagN, alarmN);
    }

    String oldId = source.get("meta").get("id").asText();
    long now = System.currentTimeMillis();
    String newId =
        "prj_"
            + now
            + "_"
            + Integer.toString(ThreadLocalRandom.current().nextInt(0x100000), 36);

    String remapped = mapper.writeValueAsString(source);
    remapped = remapped.replace("/api/files/" + oldId + "/", "/api/files/" + newId + "/");
    ObjectNode doc = (ObjectNode) mapper.readTree(remapped);
    ObjectNode meta = (ObjectNode) doc.get("meta");
    meta.put("id", newId);
    String baseName = meta.path("name").asText("导入工程");
    meta.put("name", baseName + " (导入)");
    meta.put("createdAt", now);
    meta.put("updatedAt", now);

    Path destDir = paths.getResourcesRoot().resolve(newId);
    Files.createDirectories(destDir);
    for (Map.Entry<String, byte[]> e : entries.entrySet()) {
      if (!e.getKey().startsWith("resources/")) continue;
      String base = safeSegment(e.getKey().substring("resources/".length()));
      if (base == null) continue;
      Files.write(destDir.resolve(base), e.getValue());
    }

    return projects.saveProject(doc);
  }

  /** 导入前清空本机全局 IO，避免旧设备/变量残留。 */
  private void clearAllIo() {
    try {
      for (TagAlarmConfig a : new ArrayList<>(alarms.list())) {
        if (a.alarmId() != null) alarms.delete(a.alarmId());
      }
      for (TagMeta t : new ArrayList<>(tags.list())) {
        if (t.tagId() != null) tags.delete(t.tagId());
      }
      for (DeviceMeta d : new ArrayList<>(devices.list())) {
        if (d.deviceId() != null) devices.delete(d.deviceId());
      }
      log.info("project package cleared local devices/tags/alarms before replace");
    } catch (Exception e) {
      log.warn("clear local IO before import failed: {}", e.toString());
      throw new PackageException("import_io_clear_failed");
    }
  }

  private int importDevices(byte[] raw) {
    if (raw == null) return 0;
    try {
      DeviceMeta[] items = raw.length == 0 ? new DeviceMeta[0] : mapper.readValue(raw, DeviceMeta[].class);
      if (items == null) return 0;
      int n = 0;
      for (DeviceMeta d : items) {
        if (d == null || d.deviceId() == null || d.deviceId().isBlank()) continue;
        devices.upsert(d);
        n++;
      }
      return n;
    } catch (PackageException e) {
      throw e;
    } catch (Exception e) {
      log.warn("import devices.json failed: {}", e.toString());
      throw new PackageException("import_devices_failed");
    }
  }

  private int importTags(byte[] raw) {
    if (raw == null) return 0;
    try {
      TagMeta[] items = raw.length == 0 ? new TagMeta[0] : mapper.readValue(raw, TagMeta[].class);
      if (items == null) return 0;
      int n = 0;
      for (TagMeta t : items) {
        if (t == null || t.tagId() == null || t.tagId().isBlank()) continue;
        if (t.deviceId() == null || t.deviceId().isBlank()) continue;
        tags.upsert(t);
        n++;
      }
      return n;
    } catch (PackageException e) {
      throw e;
    } catch (Exception e) {
      log.warn("import tags.json failed: {}", e.toString());
      throw new PackageException("import_tags_failed");
    }
  }

  private int importAlarms(byte[] raw) {
    if (raw == null) return 0;
    try {
      TagAlarmConfig[] items =
          raw.length == 0 ? new TagAlarmConfig[0] : mapper.readValue(raw, TagAlarmConfig[].class);
      if (items == null) return 0;
      int n = 0;
      for (TagAlarmConfig a : items) {
        if (a == null || a.alarmId() == null || a.alarmId().isBlank()) continue;
        alarms.upsert(a);
        n++;
      }
      return n;
    } catch (PackageException e) {
      throw e;
    } catch (Exception e) {
      log.warn("import alarms.json failed: {}", e.toString());
      throw new PackageException("import_alarms_failed");
    }
  }

  private static void putEntry(ZipOutputStream zos, String name, byte[] data) throws IOException {
    ZipEntry entry = new ZipEntry(name);
    zos.putNextEntry(entry);
    zos.write(data);
    zos.closeEntry();
  }

  private static Map<String, byte[]> unzip(byte[] zipBytes) {
    Map<String, byte[]> out = new LinkedHashMap<>();
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
      ZipEntry entry;
      while ((entry = zis.getNextEntry()) != null) {
        if (entry.isDirectory()) continue;
        out.put(entry.getName().replace('\\', '/'), zis.readAllBytes());
      }
    } catch (Exception e) {
      throw new PackageException("invalid_zip");
    }
    return out;
  }

  static String safeName(String name, int max) {
    String s = name.replaceAll("[^\\w.\\-()\\u4e00-\\u9fff]+", "_");
    if (s.length() > max) s = s.substring(0, max);
    return s;
  }

  private static String safeSegment(String name) {
    String base = Path.of(name).getFileName().toString().replaceAll("[/\\\\]", "_");
    if (base.isEmpty() || ".".equals(base) || "..".equals(base)) return null;
    return base;
  }

  /** Content-Disposition filename*=UTF-8''… */
  public static String contentDisposition(String fileName) {
    return "attachment; filename*=UTF-8''"
        + java.net.URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
  }
}
