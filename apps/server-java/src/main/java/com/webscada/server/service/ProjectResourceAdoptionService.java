package com.webscada.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webscada.server.config.PathsProvider;
import java.io.IOException;
import org.springframework.stereotype.Service;

@Service
public class ProjectResourceAdoptionService {
  private final PathsProvider paths;

  public ProjectResourceAdoptionService(PathsProvider paths) {
    this.paths = paths;
  }

  public ObjectNode adopt(JsonNode document, String targetProjectId) throws IOException {
    return ProjectResourceSupport.adopt(document, targetProjectId, paths.getResourcesRoot());
  }
}