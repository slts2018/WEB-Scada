package com.webscada.server.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.model.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class ApiTokenAuthFilter extends OncePerRequestFilter {
  private final ScadaProperties props;
  private final ObjectMapper mapper = new ObjectMapper();

  public ApiTokenAuthFilter(ScadaProperties props) {
    this.props = props;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    if (!props.getAuth().isEnabled()) {
      filterChain.doFilter(request, response);
      return;
    }
    String path = request.getRequestURI();
    String method = request.getMethod();
    if (isPublic(method, path)) {
      filterChain.doFilter(request, response);
      return;
    }
    if (!tokenMatches(extractToken(request))) {
      response.setStatus(401);
      response.setContentType("application/json");
      mapper.writeValue(response.getOutputStream(), ApiError.of("unauthorized"));
      return;
    }
    filterChain.doFilter(request, response);
  }

  private boolean isPublic(String method, String pathname) {
    if ("/api/health".equals(pathname)) return true;
    if (!"GET".equalsIgnoreCase(method)) return false;
    if (pathname.startsWith("/api/files/")) return true;
    if ("/api/ws/tags".equals(pathname)) return true;
    if ("/api/tags".equals(pathname) || "/api/tags/values".equals(pathname)) return true;
    if ("/api/alarms".equals(pathname) || "/api/alarms/active".equals(pathname)) return true;
    if (pathname.matches("^/api/tags/[^/]+/history$")) return true;
    if ("/api/projects".equals(pathname) || pathname.matches("^/api/projects/[^/]+$")) return true;
    if ("/api/publishes".equals(pathname)
        || "/api/publishes/latest".equals(pathname)
        || pathname.matches("^/api/publishes/[^/]+$")) return true;
    if ("/api/devices".equals(pathname)) return true;
    if ("/api/settings/database".equals(pathname)) return true;
    return false;
  }

  private String extractToken(HttpServletRequest req) {
    String auth = req.getHeader("Authorization");
    if (auth != null && auth.toLowerCase().startsWith("bearer ")) {
      String t = auth.substring(7).trim();
      if (!t.isEmpty()) return t;
    }
    String hdr = req.getHeader("X-SCADA-Token");
    if (hdr != null && !hdr.isBlank()) return hdr.trim();
    String q = req.getParameter("token");
    if (q != null && !q.isBlank()) return q.trim();
    return null;
  }

  private boolean tokenMatches(String token) {
    return token != null && token.equals(props.getAuth().getApiToken());
  }
}
