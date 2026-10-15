package com.webscada.server.web;

import com.webscada.server.model.ApiError;
import com.webscada.server.service.ResourceStorageService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ResourceController {
  private final ResourceStorageService resources;

  public ResourceController(ResourceStorageService resources) {
    this.resources = resources;
  }

  @PostMapping("/api/resources/upload")
  public ResponseEntity<?> upload(
      @RequestParam(required = false) String projectId,
      @RequestParam(value = "file", required = false) MultipartFile file) {
    try {
      if (projectId == null || projectId.isBlank()) {
        return ResponseEntity.badRequest().body(ApiError.of("project_id_required"));
      }
      if (!projectId.matches("^[a-zA-Z0-9._\\-]+$")) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_project_id"));
      }
      if (file == null || file.isEmpty()) {
        return ResponseEntity.badRequest().body(ApiError.of("file_required"));
      }
      return ResponseEntity.ok(resources.save(projectId, file));
    } catch (Exception e) {
      return ResponseEntity.status(500)
          .body(ApiError.of("upload_failed", e.getMessage()));
    }
  }
}
