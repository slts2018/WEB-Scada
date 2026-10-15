package com.webscada.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.config.PathsProvider;
import com.webscada.server.store.JsonFiles;
import com.webscada.server.store.ProjectFileStore;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 工程包 zip：manifest.json + project.json + resources/* （对齐 Node projectPackage.ts）
 */
@Service
public class ProjectPackageService {
  public static final String PACKAGE_FORMAT = "web-scada-project";
  public static final int PACKAGE_VERSION = 1;

  private final ProjectFileStore projects;
  private final PathsProvider paths;
  private final ObjectMapper mapper = JsonFiles.mapper();

  public ProjectPackageService(ProjectFileStore projects, PathsProvider paths) {
    this.projects = projects;
    this.paths = paths;
  }

  public record ExportResult(byte[] zip, String fileName, String projectName) {}

  public ExportResult exportProject(String projectId) throws IOException {
    JsonNode doc = projects.getProject(projectId);
    if (doc == null) throw new PackageException("project_not_found");

    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    try (ZipOutputStream zos = new ZipOutputStream(bos)) {
      zos.setLevel(6);
      Map<String, Object> manifest = new LinkedHashMap<>();
      manifest.put("format", PACKAGE_FORMAT);
      manifest.put("version", PACKAGE_VERSION);
      manifest.put("exportedAt", System.currentTimeMillis());
      manifest.put("sourceProjectId", doc.path("meta").path("id").asText());
      manifest.put("sourceProjectName", doc.path("meta").path("name").asText(""));
      putEntry(zos, "manifest.json", mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest));
      putEntry(zos, "project.json", mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(doc));

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
    return new ExportResult(bos.toByteArray(), (safe.isEmpty() ? "project" : safe) + ".webscada.zip", name);
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
    if (out.isEmpty() && zipBytes.length > 0) {
      // empty zip still valid structure; invalid_zip only on parse failure
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
