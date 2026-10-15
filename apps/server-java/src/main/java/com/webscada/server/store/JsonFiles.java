package com.webscada.server.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class JsonFiles {
  private static final ObjectMapper MAPPER =
      new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

  private JsonFiles() {}

  public static ObjectMapper mapper() {
    return MAPPER;
  }

  public static <T> T read(Path path, Class<T> type) throws IOException {
    if (!Files.isRegularFile(path)) return null;
    return MAPPER.readValue(path.toFile(), type);
  }

  public static JsonNode readTree(Path path) throws IOException {
    if (!Files.isRegularFile(path)) return null;
    return MAPPER.readTree(path.toFile());
  }

  public static void write(Path path, Object value) throws IOException {
    Files.createDirectories(path.getParent());
    Path tmp = path.resolveSibling(path.getFileName() + "." + ProcessHandle.current().pid() + ".tmp");
    MAPPER.writeValue(tmp.toFile(), value);
    Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }
}
