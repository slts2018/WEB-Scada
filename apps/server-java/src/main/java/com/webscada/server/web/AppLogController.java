package com.webscada.server.web;

import com.webscada.server.service.AppLogService;
import com.webscada.server.service.AppLogService.LogItem;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AppLogController {
  private final AppLogService logs;

  public AppLogController(AppLogService logs) {
    this.logs = logs;
  }

  @GetMapping("/api/logs")
  public Map<String, Object> list(
      @RequestParam(required = false) Long from,
      @RequestParam(required = false) Long to,
      @RequestParam(required = false) String level,
      @RequestParam(required = false) String source,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset) {
    int lim = limit == null ? 500 : limit;
    int off = offset == null ? 0 : offset;
    List<LogItem> items = logs.query(from, to, level, source, lim, off);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", items);
    body.put("total", logs.count(from, to, level, source));
    body.put("filePath", logs.getFilePath().toString());
    body.put("sources", logs.sources());
    return body;
  }

  @PostMapping("/api/logs")
  public Map<String, Object> post(@RequestBody(required = false) Map<String, Object> body) {
    Map<String, Object> in = body == null ? Map.of() : body;
    String id = in.get("id") == null ? null : String.valueOf(in.get("id"));
    String level = in.get("level") == null ? null : String.valueOf(in.get("level"));
    String source = in.get("source") == null ? null : String.valueOf(in.get("source"));
    String message = in.get("message") == null ? "" : String.valueOf(in.get("message"));
    Long time = null;
    if (in.get("time") instanceof Number n) time = n.longValue();
    else if (in.get("time") != null) {
      try {
        time = Long.parseLong(String.valueOf(in.get("time")));
      } catch (NumberFormatException ignored) {
      }
    }
    LogItem item = logs.append(id, time, level, source, message);
    return Map.of("ok", true, "item", item);
  }
}
