package com.webscada.server.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.webscada.server.model.ApiError;
import com.webscada.server.store.ProjectFileStore;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PublishController {
  private final ProjectFileStore store;

  public PublishController(ProjectFileStore store) {
    this.store = store;
  }

  @GetMapping("/api/publishes")
  public Map<String, Object> list() throws Exception {
    return Map.of("items", store.listPublishes());
  }

  @GetMapping("/api/publishes/latest")
  public ResponseEntity<?> latest() throws Exception {
    JsonNode pkg = store.getLatestPublish();
    if (pkg == null) return ResponseEntity.status(404).body(ApiError.of("publish_not_found"));
    return ResponseEntity.ok(pkg);
  }

  @GetMapping("/api/publishes/{projectId}")
  public ResponseEntity<?> get(@PathVariable String projectId) throws Exception {
    JsonNode pkg = store.getPublish(projectId);
    if (pkg == null) return ResponseEntity.status(404).body(ApiError.of("publish_not_found"));
    return ResponseEntity.ok(pkg);
  }

  @PutMapping("/api/publishes/{projectId}")
  public ResponseEntity<?> put(@PathVariable String projectId, @RequestBody JsonNode body)
      throws Exception {
    if (body == null
        || !body.has("manifest")
        || !projectId.equals(body.get("manifest").path("projectId").asText())) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_publish_body"));
    }
    return ResponseEntity.ok(store.savePublish(body));
  }
}
