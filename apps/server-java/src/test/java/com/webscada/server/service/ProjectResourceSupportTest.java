package com.webscada.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectResourceSupportTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void adoptCopiesForeignFilesAndRewritesPaths(@TempDir Path tmp) throws Exception {
    Path root = tmp.resolve("resources");
    Path oldA = root.resolve("prj_old_a");
    Path oldB = root.resolve("prj_old_b");
    Files.createDirectories(oldA);
    Files.createDirectories(oldB);
    Files.writeString(oldA.resolve("valve.glb"), "VALVE", StandardCharsets.UTF_8);
    Files.writeString(oldB.resolve("panel.png"), "PNG", StandardCharsets.UTF_8);

    ObjectNode doc = mapper.createObjectNode();
    ObjectNode meta = doc.putObject("meta");
    meta.put("id", "prj_copy");
    meta.put("name", "副本");
    var resources = doc.putArray("resources");
    resources.addObject().put("id", "res_1").put("path", "/api/files/prj_old_a/valve.glb");
    resources.addObject().put("id", "res_2").put("path", "/api/files/prj_old_b/panel.png");
    doc.put("note", "also /api/files/prj_old_a/valve.glb in prose");

    ObjectNode adopted = ProjectResourceSupport.adopt(doc, "prj_copy", root);
    String json = mapper.writeValueAsString(adopted);
    assertFalse(json.contains("/api/files/prj_old_a/"));
    assertFalse(json.contains("/api/files/prj_old_b/"));
    assertTrue(json.contains("/api/files/prj_copy/valve.glb"));
    assertTrue(json.contains("/api/files/prj_copy/panel.png"));
    assertEquals("prj_copy", adopted.path("meta").path("id").asText());
    assertEquals("VALVE", Files.readString(root.resolve("prj_copy").resolve("valve.glb")));
    assertEquals("PNG", Files.readString(root.resolve("prj_copy").resolve("panel.png")));
    assertTrue(Files.isRegularFile(oldA.resolve("valve.glb")));
  }

  @Test
  void prepareExportFindsReferencedFilesWithoutCurrentDir(@TempDir Path tmp) throws Exception {
    Path root = tmp.resolve("resources");
    Path old = root.resolve("prj_src");
    Files.createDirectories(old);
    Files.writeString(old.resolve("model.glb"), "GLB", StandardCharsets.UTF_8);
    ObjectNode doc = mapper.createObjectNode();
    doc.putObject("meta").put("id", "prj_empty");
    doc.putArray("resources")
        .addObject()
        .put("path", "/api/files/prj_src/model.glb");

    var prepared = ProjectResourceSupport.prepare(doc, "prj_empty", root);
    assertEquals(0, prepared.missing);
    assertTrue(prepared.files.containsKey("model.glb"));
    assertEquals("prj_empty", prepared.document.path("meta").path("id").asText());
    String json = mapper.writeValueAsString(prepared.document);
    assertTrue(json.contains("/api/files/prj_empty/model.glb"));
    assertFalse(Files.isDirectory(root.resolve("prj_empty")));
  }

  @Test
  void collectRefsDedupesAndResolvesEncodedName(@TempDir Path tmp) throws Exception {
    Path root = tmp.resolve("resources");
    Path old = root.resolve("prj_src");
    Files.createDirectories(old);
    Files.writeString(old.resolve("图片1.png"), "IMG", StandardCharsets.UTF_8);
    String json =
        "{\"a\":\"/api/files/prj_src/%E5%9B%BE%E7%89%871.png\","
            + "\"b\":\"/api/files/prj_src/%E5%9B%BE%E7%89%871.png\"}";
    List<ProjectResourceSupport.FileRef> refs = ProjectResourceSupport.collectRefs(json);
    assertEquals(1, refs.size());
    Path found = ProjectResourceSupport.resolveStoredFile(root, "prj_src", refs.get(0).rawName());
    assertEquals("IMG", Files.readString(found));
  }
}