package com.webscada.server.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.stereotype.Component;

@Component
public class PathsProvider {
  public Path getScadaHome() {
    String env = System.getenv("SCADA_HOME");
    if (env != null && !env.isBlank()) return Paths.get(env).toAbsolutePath().normalize();
    Path cwd = Paths.get("").toAbsolutePath().normalize();
    if (Files.isRegularFile(cwd.resolve("public").resolve("index.html"))) return cwd;
    // apps/server-java → apps
    Path apps = cwd.getFileName().toString().equals("server-java") ? cwd.getParent() : cwd;
    if (apps != null && Files.isDirectory(apps.resolve("data"))) return apps;
    if (cwd.getParent() != null && Files.isDirectory(cwd.getParent().resolve("data"))) {
      return cwd.getParent();
    }
    return cwd;
  }

  public Path getDataRoot() {
    String env = System.getenv("SCADA_DATA");
    if (env != null && !env.isBlank()) return Paths.get(env).toAbsolutePath().normalize();
    return getScadaHome().resolve("data");
  }

  public Path getWebRoot() {
    String env = System.getenv("SCADA_WEB_ROOT");
    if (env != null && !env.isBlank()) return Paths.get(env).toAbsolutePath().normalize();
    Path beside = Paths.get("").toAbsolutePath().normalize().resolve("public");
    if (Files.isRegularFile(beside.resolve("index.html"))) return beside;
    return getScadaHome().resolve("public");
  }

  public Path getResourcesRoot() {
    return getDataRoot().resolve("resources");
  }

  public Path getSettingsFile() {
    return getDataRoot().resolve("db-settings.json");
  }
}
