package com.webscada.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.config.PathsProvider;
import com.webscada.server.store.JsonFiles;
import com.webscada.server.store.ProjectFileStore;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Comparator;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 网站包导出：复制 Spring 安装模板（server.jar）并注入 data/。
 */
@Service
public class SitePackageService {
  private static final Logger log = LoggerFactory.getLogger(SitePackageService.class);
  private static final String SITE_VERSION = "0.1.0";
  private static final String BASE_PACK_NAME = "WebScada-" + SITE_VERSION + "-win-x64-java";

  private final ProjectFileStore projects;
  private final PathsProvider paths;

  public SitePackageService(ProjectFileStore projects, PathsProvider paths) {
    this.projects = projects;
    this.paths = paths;
  }

  public record ExportResult(byte[] zip, String fileName, String projectName) {}

  public ExportResult exportSite(String projectId) throws IOException {
    Path template = resolveSiteTemplateDir();
    if (template == null) {
      throw new PackageException(
          "site_template_missing",
          "缺少网站模板。请先执行 pnpm pack:win，或设置 SCADA_SITE_TEMPLATE");
    }

    JsonNode doc = projects.getProject(projectId);
    if (doc == null) throw new PackageException("project_not_found");
    JsonNode pkg = ensurePublish(projectId, doc);

    if (!System.getProperty("os.name", "").toLowerCase().contains("win")) {
      throw new PackageException("site_export_windows_only");
    }

    Path tmpRoot = Files.createTempDirectory("webscada-site-");
    String folderName = "WebScada-Site-" + SITE_VERSION + "-win-x64";
    Path dest = tmpRoot.resolve(folderName);
    Path zipPath = tmpRoot.resolve(folderName + ".zip");
    try {
      copyTemplate(template, dest);
      injectProjectData(dest, projectId, doc, pkg);
      zipDirectoryWindows(dest, zipPath);
      byte[] zip = Files.readAllBytes(zipPath);
      String name = doc.path("meta").path("name").asText("site");
      String safe = ProjectPackageService.safeName(name, 60);
      return new ExportResult(
          zip, (safe.isEmpty() ? "site" : safe) + "-WebScada-Site.zip", name);
    } finally {
      try (Stream<Path> walk = Files.walk(tmpRoot)) {
        walk.sorted(Comparator.reverseOrder())
            .forEach(
                p -> {
                  try {
                    Files.deleteIfExists(p);
                  } catch (IOException e) {
                    log.debug("cleanup {}: {}", p, e.toString());
                  }
                });
      }
    }
  }

  public Path resolveSiteTemplateDir() {
    String fromEnv = System.getenv("SCADA_SITE_TEMPLATE");
    if (fromEnv != null && !fromEnv.isBlank()) {
      Path p = Path.of(fromEnv).toAbsolutePath().normalize();
      if (isTemplate(p)) return p;
    }
    Path home = paths.getScadaHome();
    if (isTemplate(home)) return home;

    java.util.List<Path> candidates = new java.util.ArrayList<>();
    candidates.add(home.resolve("..").resolve("release").resolve(BASE_PACK_NAME).normalize());
    candidates.add(home.resolve("../..").resolve("release").resolve(BASE_PACK_NAME).normalize());
    candidates.add(Path.of("").toAbsolutePath().resolve("release").resolve(BASE_PACK_NAME));
    for (Path c : candidates) {
      if (isTemplate(c)) return c;
    }
    return null;
  }

  private static boolean isTemplate(Path dir) {
    return Files.isDirectory(dir) && Files.isRegularFile(dir.resolve("server.jar"));
  }

  private JsonNode ensurePublish(String projectId, JsonNode doc) throws IOException {
    JsonNode existing = projects.getPublish(projectId);
    if (existing != null) return existing;
    long now = System.currentTimeMillis();
    ObjectNode pkg = JsonFiles.mapper().createObjectNode();
    ObjectNode man = pkg.putObject("manifest");
    man.put("projectId", doc.path("meta").path("id").asText());
    man.put("projectName", doc.path("meta").path("name").asText(""));
    man.put("publishVersion", doc.path("meta").path("version").asText("1.0.0"));
    man.put("publishedAt", now);
    if (doc.has("homePageId") && !doc.get("homePageId").isNull()) {
      man.put("homePageId", doc.get("homePageId").asText());
    } else {
      man.putNull("homePageId");
    }
    man.put("documentPath", "document.json");
    ArrayNode idx = man.putArray("resourceIndex");
    if (doc.has("resources") && doc.get("resources").isArray()) {
      for (JsonNode r : doc.get("resources")) {
        ObjectNode item = idx.addObject();
        item.put("id", r.path("id").asText());
        item.put("path", r.path("path").asText());
        item.put("kind", r.path("kind").asText());
      }
    }
    pkg.set("document", doc);
    return projects.savePublish(pkg);
  }

  private void copyTemplate(Path template, Path dest) throws IOException {
    Files.createDirectories(dest);
    try (Stream<Path> stream = Files.list(template)) {
      for (Path from : stream.toList()) {
        if ("data".equals(from.getFileName().toString())) continue;
        Path to = dest.resolve(from.getFileName().toString());
        if (Files.isDirectory(from)) {
          copyTree(from, to);
        } else {
          Files.copy(from, to, StandardCopyOption.REPLACE_EXISTING);
        }
      }
    }
  }

  private static void copyTree(Path source, Path target) throws IOException {
    Files.walkFileTree(
        source,
        new SimpleFileVisitor<>() {
          @Override
          public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs)
              throws IOException {
            Path rel = source.relativize(dir);
            Files.createDirectories(target.resolve(rel.toString()));
            return FileVisitResult.CONTINUE;
          }

          @Override
          public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            Path rel = source.relativize(file);
            Files.copy(file, target.resolve(rel.toString()), StandardCopyOption.REPLACE_EXISTING);
            return FileVisitResult.CONTINUE;
          }
        });
  }

  private void injectProjectData(Path dest, String projectId, JsonNode doc, JsonNode pkg)
      throws IOException {
    Path dataDir = dest.resolve("data");
    Files.createDirectories(dataDir.resolve("projects"));
    Files.createDirectories(dataDir.resolve("publishes"));
    Files.createDirectories(dataDir.resolve("resources").resolve(projectId));

    JsonFiles.write(dataDir.resolve("projects").resolve(projectId + ".json"), doc);
    JsonFiles.write(dataDir.resolve("publishes").resolve(projectId + ".json"), pkg);
    JsonFiles.write(
        dataDir.resolve("meta.json"), java.util.Map.of("lastProjectId", projectId));

    Path resSrc = paths.getResourcesRoot().resolve(projectId);
    Path resDst = dataDir.resolve("resources").resolve(projectId);
    if (Files.isDirectory(resSrc)) {
      copyTree(resSrc, resDst);
    }

    for (String name : new String[] {"tags.json", "devices.json"}) {
      Path src = paths.getDataRoot().resolve(name);
      if (Files.isRegularFile(src)) {
        Files.copy(src, dataDir.resolve(name), StandardCopyOption.REPLACE_EXISTING);
      }
    }

    String startBat = siteStartBat();
    String readme = siteReadme();
    Files.writeString(dest.resolve("start.bat"), startBat, StandardCharsets.UTF_8);
    Files.writeString(dest.resolve("start-site.bat"), startBat, StandardCharsets.UTF_8);
    Files.writeString(dest.resolve("README.txt"), readme, StandardCharsets.UTF_8);
    Files.writeString(dest.resolve("README-SITE.txt"), readme, StandardCharsets.UTF_8);
  }

  private String siteStartBat() throws IOException {
    Path home = paths.getScadaHome();
    Path[] candidates =
        new Path[] {
          home.resolve("../../packaging/templates/start-site.bat").normalize(),
          home.resolve("../packaging/templates/start-site.bat").normalize(),
          home.resolve("start-site.bat"),
        };
    for (Path p : candidates) {
      if (Files.isRegularFile(p)) return Files.readString(p);
    }
    return "@echo off\r\ncd /d \"%~dp0\"\r\nset SCADA_URL=http://127.0.0.1:8787/runtime\r\ncall \"%~dp0start.bat\"\r\n";
  }

  private String siteReadme() throws IOException {
    Path home = paths.getScadaHome();
    Path[] candidates =
        new Path[] {
          home.resolve("../../packaging/templates/README-SITE.txt").normalize(),
          home.resolve("../packaging/templates/README-SITE.txt").normalize(),
          home.resolve("README-SITE.txt"),
        };
    for (Path p : candidates) {
      if (Files.isRegularFile(p)) return Files.readString(p);
    }
    return "WebScada Site — open http://SERVER_IP:8787/runtime\r\n";
  }

  private static void zipDirectoryWindows(Path dirPath, Path zipPath) throws IOException {
    Files.deleteIfExists(zipPath);
    ProcessBuilder pb =
        new ProcessBuilder(
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Compress-Archive -LiteralPath '"
                + dirPath.toString().replace("'", "''")
                + "' -DestinationPath '"
                + zipPath.toString().replace("'", "''")
                + "' -Force");
    pb.redirectErrorStream(true);
    Process p = pb.start();
    try {
      int code = p.waitFor();
      if (code != 0 || !Files.isRegularFile(zipPath)) {
        throw new IOException("Compress-Archive failed exit=" + code);
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IOException("zip interrupted", e);
    }
  }

}
