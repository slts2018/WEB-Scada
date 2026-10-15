package com.webscada.server.config;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final PathsProvider paths;

  public WebConfig(PathsProvider paths) {
    this.paths = paths;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/**").allowedOriginPatterns("*").allowedMethods("*").allowedHeaders("*");
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    Path resources = paths.getResourcesRoot().toAbsolutePath().normalize();
    try {
      Files.createDirectories(resources);
    } catch (Exception ignored) {
    }
    registry
        .addResourceHandler("/api/files/**")
        .addResourceLocations(resources.toUri().toString());

    Path web = paths.getWebRoot().toAbsolutePath().normalize();
    if (Files.isRegularFile(web.resolve("index.html"))) {
      registry.addResourceHandler("/**").addResourceLocations(web.toUri().toString());
    }
  }

  // SPA 路由回退见 SpaForwardController（/designer、/runtime）
}
