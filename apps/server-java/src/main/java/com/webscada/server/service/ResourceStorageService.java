package com.webscada.server.service;

import com.webscada.server.config.PathsProvider;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ResourceStorageService {
  private final PathsProvider paths;

  public ResourceStorageService(PathsProvider paths) {
    this.paths = paths;
  }

  public Map<String, Object> save(String projectId, MultipartFile file) throws IOException {
    Path root = paths.getResourcesRoot();
    Files.createDirectories(root);
    Path projectDir = root.resolve(projectId);
    Files.createDirectories(projectDir);

    String original = file.getOriginalFilename() == null ? "file" : file.getOriginalFilename();
    String id =
        "res_"
            + System.currentTimeMillis()
            + "_"
            + Integer.toString(ThreadLocalRandom.current().nextInt(0x100000), 36);
    String safe = safeFileName(original);
    String storedName = id + "_" + safe;
    Path disk = projectDir.resolve(storedName);
    try (InputStream in = file.getInputStream()) {
      Files.copy(in, disk);
    }
    long size = Files.size(disk);
    String mime = file.getContentType();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("name", original);
    out.put("kind", detectKind(original, mime));
    out.put("path", "/api/files/" + projectId + "/" + storedName);
    out.put("mimeType", mime);
    out.put("size", size);
    return out;
  }

  static String safeFileName(String name) {
    String s = name.replaceAll("[^\\w.\\-()\\u4e00-\\u9fff]+", "_");
    if (s.length() > 120) s = s.substring(0, 120);
    return s.isEmpty() ? "file" : s;
  }

  static String detectKind(String fileName, String mime) {
    String lower = fileName.toLowerCase();
    if (lower.endsWith(".svg") || "image/svg+xml".equals(mime)) return "svg";
    if (lower.endsWith(".glb")
        || lower.endsWith(".gltf")
        || lower.endsWith(".obj")
        || lower.endsWith(".fbx")
        || lower.endsWith(".stl")
        || (mime != null && (mime.contains("gltf") || mime.contains("fbx")))
        || "model/obj".equals(mime)
        || "model/stl".equals(mime)) {
      return "model";
    }
    if ((mime != null && mime.startsWith("image/"))
        || lower.matches(".*\\.(png|jpe?g|gif|webp|bmp)$")) {
      return "image";
    }
    return "other";
  }
}
