package com.webscada.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.store.JsonFiles;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 收集工程文档里实际引用的 /api/files/{projectId}/{file}，拷到目标工程目录并改写路径。
 * 另存为与导出共用，以兼容「路径仍指向旧工程目录」的副本。
 */
public final class ProjectResourceSupport {
  private static final Logger log = LoggerFactory.getLogger(ProjectResourceSupport.class);

  static final Pattern FILE_URL =
      Pattern.compile("/api/files/([^/\"\\\\]+)/([^/\"\\\\?\\s]+)");

  private ProjectResourceSupport() {}

  public record FileRef(String ownerProjectId, String rawName) {}

  /** 准备结果：内存中已改写的文档 + 要打进包/拷到目标目录的文件（磁盘文件名 -> 源路径）。 */
  public static final class PreparedResources {
    public final ObjectNode document;
    public final Map<String, Path> files;
    public final int missing;

    PreparedResources(ObjectNode document, Map<String, Path> files, int missing) {
      this.document = document;
      this.files = files;
      this.missing = missing;
    }
  }

  public static List<FileRef> collectRefs(String json) {
    LinkedHashSet<String> seen = new LinkedHashSet<>();
    List<FileRef> out = new ArrayList<>();
    Matcher m = FILE_URL.matcher(json);
    while (m.find()) {
      String key = m.group(1) + "/" + m.group(2);
      if (!seen.add(key)) continue;
      out.add(new FileRef(m.group(1), m.group(2)));
    }
    return out;
  }

  public static Path resolveStoredFile(Path resourcesRoot, String ownerProjectId, String rawName) {
    if (resourcesRoot == null || ownerProjectId == null || rawName == null) return null;
    if (ownerProjectId.contains("..")
        || ownerProjectId.indexOf('/') >= 0
        || ownerProjectId.indexOf('\\') >= 0) {
      return null;
    }
    Path dir = resourcesRoot.resolve(ownerProjectId).toAbsolutePath().normalize();
    List<String> candidates = new ArrayList<>();
    candidates.add(rawName);
    try {
      String decoded = URLDecoder.decode(rawName, StandardCharsets.UTF_8);
      if (!decoded.equals(rawName)) candidates.add(decoded);
    } catch (Exception ignored) {
    }
    for (String name : candidates) {
      Path file = dir.resolve(Path.of(name).getFileName().toString()).toAbsolutePath().normalize();
      if (!file.startsWith(dir)) continue;
      if (Files.isRegularFile(file)) return file;
    }
    return null;
  }

  public static PreparedResources prepare(JsonNode source, String targetProjectId, Path resourcesRoot)
      throws IOException {
    if (source == null || targetProjectId == null || targetProjectId.isBlank()) {
      throw new IllegalArgumentException("invalid_project_body");
    }
    String json = JsonFiles.mapper().writeValueAsString(source);
    List<FileRef> refs = collectRefs(json);
    Map<String, Path> files = new LinkedHashMap<>();
    Set<String> oldIds = new LinkedHashSet<>();
    Map<String, String> exactRenames = new LinkedHashMap<>();
    int missing = 0;

    Path destDir = resourcesRoot.resolve(targetProjectId);
    Set<String> usedNames = new LinkedHashSet<>();
    if (Files.isDirectory(destDir)) {
      try (DirectoryStream<Path> stream = Files.newDirectoryStream(destDir)) {
        for (Path p : stream) {
          if (Files.isRegularFile(p)) usedNames.add(p.getFileName().toString());
        }
      }
    }

    for (FileRef ref : refs) {
      Path src = resolveStoredFile(resourcesRoot, ref.ownerProjectId(), ref.rawName());
      if (src == null) {
        missing += 1;
        log.warn("project resource missing: /api/files/{}/{}", ref.ownerProjectId(), ref.rawName());
        oldIds.add(ref.ownerProjectId());
        continue;
      }
      oldIds.add(ref.ownerProjectId());
      String destName = src.getFileName().toString();
      Path existing = files.get(destName);
      if (existing != null && !sameFile(existing, src)) {
        destName = uniqueName(usedNames, ref.ownerProjectId() + "_" + destName);
        String oldPath = "/api/files/" + ref.ownerProjectId() + "/" + ref.rawName();
        exactRenames.put(oldPath, "/api/files/" + targetProjectId + "/" + destName);
      } else if (usedNames.contains(destName) && existing == null) {
        Path already = destDir.resolve(destName);
        if (Files.isRegularFile(already) && !sameFile(already, src)) {
          destName = uniqueName(usedNames, ref.ownerProjectId() + "_" + destName);
          String oldPath = "/api/files/" + ref.ownerProjectId() + "/" + ref.rawName();
          exactRenames.put(oldPath, "/api/files/" + targetProjectId + "/" + destName);
        }
      }
      usedNames.add(destName);
      files.putIfAbsent(destName, src);
    }

    if (Files.isDirectory(destDir)) {
      try (DirectoryStream<Path> stream = Files.newDirectoryStream(destDir)) {
        for (Path p : stream) {
          if (!Files.isRegularFile(p)) continue;
          files.putIfAbsent(p.getFileName().toString(), p);
        }
      }
    }

    String remapped = json;
    for (Map.Entry<String, String> e : exactRenames.entrySet()) {
      remapped = remapped.replace(e.getKey(), e.getValue());
    }
    for (String oldId : oldIds) {
      if (oldId.equals(targetProjectId)) continue;
      remapped =
          remapped.replace("/api/files/" + oldId + "/", "/api/files/" + targetProjectId + "/");
    }
    ObjectNode doc = (ObjectNode) JsonFiles.mapper().readTree(remapped);
    if (doc.has("meta") && doc.get("meta").isObject()) {
      ((ObjectNode) doc.get("meta")).put("id", targetProjectId);
    }
    return new PreparedResources(doc, files, missing);
  }

  /** 把引用的文件拷到目标工程目录，并返回改写路径后的文档（不负责入库）。 */
  public static ObjectNode adopt(JsonNode source, String targetProjectId, Path resourcesRoot)
      throws IOException {
    PreparedResources prepared = prepare(source, targetProjectId, resourcesRoot);
    Path destDir = resourcesRoot.resolve(targetProjectId);
    Files.createDirectories(destDir);
    Path destRoot = destDir.toAbsolutePath().normalize();
    for (Map.Entry<String, Path> e : prepared.files.entrySet()) {
      Path dest = destDir.resolve(e.getKey()).toAbsolutePath().normalize();
      if (!dest.startsWith(destRoot)) continue;
      Path src = e.getValue().toAbsolutePath().normalize();
      if (dest.equals(src)) continue;
      if (Files.isRegularFile(dest) && sameFile(dest, src)) continue;
      Files.copy(src, dest, StandardCopyOption.REPLACE_EXISTING);
    }
    return prepared.document;
  }

  private static boolean sameFile(Path a, Path b) {
    try {
      if (Files.isSameFile(a, b)) return true;
    } catch (IOException ignored) {
    }
    try {
      return Files.size(a) == Files.size(b)
          && Files.getLastModifiedTime(a).equals(Files.getLastModifiedTime(b));
    } catch (IOException e) {
      return false;
    }
  }

  private static String uniqueName(Set<String> used, String preferred) {
    String safe = Path.of(preferred).getFileName().toString();
    if (!used.contains(safe)) return safe;
    String stem = safe;
    String ext = "";
    int dot = safe.lastIndexOf('.');
    if (dot > 0) {
      stem = safe.substring(0, dot);
      ext = safe.substring(dot);
    }
    for (int i = 2; i < 10000; i++) {
      String n = stem + "_" + i + ext;
      if (!used.contains(n)) return n;
    }
    return stem + "_" + System.nanoTime() + ext;
  }
}