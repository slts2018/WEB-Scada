package com.webscada.server.web;

import com.webscada.server.config.PathsProvider;
import java.nio.file.Files;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Vue history 模式：/designer、/runtime 等无实体文件，需回退到 index.html（对齐 Node setNotFoundHandler）。
 */
@Controller
public class SpaForwardController {
  private final PathsProvider paths;

  public SpaForwardController(PathsProvider paths) {
    this.paths = paths;
  }

  private boolean spaReady() {
    return Files.isRegularFile(paths.getWebRoot().resolve("index.html"));
  }

  @GetMapping({
    "/",
    "/designer",
    "/designer/",
    "/designer/**",
    "/runtime",
    "/runtime/",
    "/runtime/**"
  })
  public String spa() {
    if (!spaReady()) {
      return null;
    }
    return "forward:/index.html";
  }
}
