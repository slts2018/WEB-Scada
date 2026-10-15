package com.webscada.server.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.webscada.server.model.ApiError;
import com.webscada.server.service.PackageException;
import com.webscada.server.service.ProjectPackageService;
import com.webscada.server.service.SitePackageService;
import com.webscada.server.store.ProjectFileStore;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ProjectController {
  private final ProjectFileStore store;
  private final ProjectPackageService packages;
  private final SitePackageService sitePackages;

  public ProjectController(
      ProjectFileStore store, ProjectPackageService packages, SitePackageService sitePackages) {
    this.store = store;
    this.packages = packages;
    this.sitePackages = sitePackages;
  }

  @GetMapping("/api/projects")
  public Map<String, Object> list() throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", store.listProjects());
    body.put("lastProjectId", store.getLastProjectId());
    return body;
  }

  @GetMapping("/api/projects/{id}")
  public ResponseEntity<?> get(@PathVariable String id) throws Exception {
    JsonNode doc = store.getProject(id);
    if (doc == null) return ResponseEntity.status(404).body(ApiError.of("project_not_found"));
    return ResponseEntity.ok(doc);
  }

  @PostMapping("/api/projects")
  public ResponseEntity<?> create(@RequestBody JsonNode body) throws Exception {
    try {
      if (body == null || !body.has("meta") || !body.get("meta").has("id")) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_project_body"));
      }
      String id = body.get("meta").get("id").asText();
      if (store.getProject(id) != null) {
        return ResponseEntity.status(409).body(ApiError.of("project_exists"));
      }
      return ResponseEntity.ok(store.saveProject(body));
    } catch (IllegalArgumentException e) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_project_body"));
    }
  }

  @PutMapping("/api/projects/{id}")
  public ResponseEntity<?> put(@PathVariable String id, @RequestBody JsonNode body)
      throws Exception {
    if (body == null || !body.has("meta") || !id.equals(body.get("meta").path("id").asText())) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_project_body"));
    }
    return ResponseEntity.ok(store.saveProject(body));
  }

  @DeleteMapping("/api/projects/{id}")
  public ResponseEntity<?> delete(@PathVariable String id) throws Exception {
    if (!store.deleteProject(id)) {
      return ResponseEntity.status(404).body(ApiError.of("project_not_found"));
    }
    return ResponseEntity.ok(Map.of("ok", true));
  }

  @GetMapping("/api/projects/{id}/export")
  public ResponseEntity<?> export(@PathVariable String id) {
    try {
      ProjectPackageService.ExportResult r = packages.exportProject(id);
      return ResponseEntity.ok()
          .header(HttpHeaders.CONTENT_DISPOSITION, ProjectPackageService.contentDisposition(r.fileName()))
          .contentType(MediaType.parseMediaType("application/zip"))
          .body(r.zip());
    } catch (PackageException e) {
      if ("project_not_found".equals(e.getCode())) {
        return ResponseEntity.status(404).body(ApiError.of("project_not_found"));
      }
      return ResponseEntity.status(500).body(ApiError.of("export_failed"));
    } catch (Exception e) {
      return ResponseEntity.status(500).body(ApiError.of("export_failed", e.getMessage()));
    }
  }

  @GetMapping("/api/projects/{id}/export/site")
  public ResponseEntity<?> exportSite(@PathVariable String id) {
    try {
      SitePackageService.ExportResult r = sitePackages.exportSite(id);
      return ResponseEntity.ok()
          .header(HttpHeaders.CONTENT_DISPOSITION, ProjectPackageService.contentDisposition(r.fileName()))
          .contentType(MediaType.parseMediaType("application/zip"))
          .body(r.zip());
    } catch (PackageException e) {
      return switch (e.getCode()) {
        case "project_not_found" ->
            ResponseEntity.status(404).body(ApiError.of("project_not_found"));
        case "site_template_missing" ->
            ResponseEntity.status(503)
                .body(new ApiError("site_template_missing", null, e.getMessage(), null));
        case "site_export_windows_only" ->
            ResponseEntity.status(501).body(ApiError.of("site_export_windows_only"));
        default -> ResponseEntity.status(500).body(ApiError.of("site_export_failed"));
      };
    } catch (Exception e) {
      return ResponseEntity.status(500).body(ApiError.of("site_export_failed", e.getMessage()));
    }
  }

  @PostMapping("/api/projects/import")
  public ResponseEntity<?> importZip(@RequestParam(value = "file", required = false) MultipartFile file) {
    try {
      if (file == null || file.isEmpty()) {
        return ResponseEntity.badRequest().body(ApiError.of("file_required"));
      }
      return ResponseEntity.ok(packages.importProject(file));
    } catch (PackageException e) {
      String code = e.getCode();
      int status =
          switch (code) {
            case "invalid_zip",
                "missing_project_json",
                "invalid_project_json",
                "invalid_project_body",
                "unsupported_package_format",
                "file_required" ->
                400;
            default -> 500;
          };
      return ResponseEntity.status(status).body(ApiError.of(code));
    } catch (Exception e) {
      return ResponseEntity.status(500).body(ApiError.of("import_failed", e.getMessage()));
    }
  }
}
