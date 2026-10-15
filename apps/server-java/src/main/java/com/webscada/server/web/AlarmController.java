package com.webscada.server.web;

import com.webscada.server.model.ApiError;
import com.webscada.server.model.TagAlarmConfig;
import com.webscada.server.model.TagMeta;
import com.webscada.server.service.AlarmRuntimeService;
import com.webscada.server.store.AlarmEventStore;
import com.webscada.server.store.AlarmFileStore;
import com.webscada.server.store.TagFileStore;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AlarmController {
  private static final Set<String> LEVELS = Set.of("info", "alarm", "fault");
  private static final Set<String> KINDS =
      Set.of("limit", "bool", "quality", "target", "rate", "match", "mismatch");
  private static final Set<String> LIMITS = Set.of("HH", "H", "L", "LL");
  private static final Set<String> HIGH_GRADES = Set.of("HH", "H");
  private static final Set<String> QUALITIES = Set.of("Bad", "Offline");

  private final AlarmFileStore alarms;
  private final AlarmEventStore eventStore;
  private final TagFileStore tags;
  private final AlarmRuntimeService runtime;

  public AlarmController(
      AlarmFileStore alarms, AlarmEventStore eventStore, TagFileStore tags, AlarmRuntimeService runtime) {
    this.alarms = alarms;
    this.eventStore = eventStore;
    this.tags = tags;
    this.runtime = runtime;
  }

  @GetMapping("/api/alarms")
  public Map<String, Object> list(@RequestParam(required = false) String tagId) throws Exception {
    List<TagAlarmConfig> items = tagId == null || tagId.isBlank() ? alarms.list() : alarms.listByTag(tagId);
    return Map.of("items", items);
  }

  @GetMapping("/api/alarms/active")
  public Map<String, Object> active() {
    return Map.of("items", runtime.active());
  }

  @GetMapping("/api/alarms/events")
  public Map<String, Object> events(
      @RequestParam(required = false) String tagId,
      @RequestParam(required = false) Long from,
      @RequestParam(required = false) Long to,
      @RequestParam(required = false, defaultValue = "50") int limit) {
    return Map.of("items", eventStore.list(tagId, from, to, limit));
  }

  @PostMapping("/api/alarms/{alarmId}/ack")
  public ResponseEntity<?> ack(@PathVariable String alarmId) {
    AlarmRuntimeService.AckResult result = runtime.ack(alarmId);
    if (!result.found()) return ResponseEntity.status(404).body(ApiError.of("alarm_not_found"));
    Map<String, Object> body = new java.util.LinkedHashMap<>();
    body.put("ok", true);
    body.put("removed", result.alarm() == null);
    if (result.alarm() != null) body.put("alarm", result.alarm());
    return ResponseEntity.ok(body);
  }

  @PostMapping("/api/alarms")
  public ResponseEntity<?> create(@RequestBody TagAlarmConfig body) throws Exception {
    if (body == null) return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
    String id =
        body.alarmId() == null || body.alarmId().isBlank()
            ? "alm_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
            : body.alarmId().trim();
    if (!id.matches("^[a-zA-Z0-9._\\-]+$")) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm_id"));
    }
    if (alarms.get(id) != null) return ResponseEntity.status(409).body(ApiError.of("alarm_exists"));
    TagAlarmConfig cfg = copy(id, body);
    ResponseEntity<?> err = validate(cfg, null);
    if (err != null) return err;
    TagAlarmConfig saved = alarms.upsert(cfg);
    runtime.reloadConfigs();
    return ResponseEntity.ok(saved);
  }

  @PutMapping("/api/alarms/{alarmId}")
  public ResponseEntity<?> update(@PathVariable String alarmId, @RequestBody TagAlarmConfig body)
      throws Exception {
    TagAlarmConfig existing = alarms.get(alarmId);
    if (existing == null) return ResponseEntity.status(404).body(ApiError.of("alarm_not_found"));
    TagAlarmConfig cfg = copy(alarmId, body == null ? existing : body);
    ResponseEntity<?> err = validate(cfg, alarmId);
    if (err != null) return err;
    TagAlarmConfig saved = alarms.upsert(cfg);
    runtime.reloadConfigs();
    return ResponseEntity.ok(saved);
  }

  @DeleteMapping("/api/alarms/{alarmId}")
  public ResponseEntity<?> delete(@PathVariable String alarmId) throws Exception {
    if (!alarms.delete(alarmId)) return ResponseEntity.status(404).body(ApiError.of("alarm_not_found"));
    runtime.reloadConfigs();
    return ResponseEntity.ok(Map.of("ok", true));
  }

  private ResponseEntity<?> validate(TagAlarmConfig cfg, String ignoreId) throws Exception {
    if (cfg.tagId() == null || cfg.tagId().isBlank() || cfg.name() == null || cfg.name().isBlank()) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
    }
    if (!LEVELS.contains(cfg.level()) || !KINDS.contains(cfg.kind())) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
    }
    if (cfg.delaySec() < 0 || cfg.delaySec() > 86400) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
    }
    if (cfg.deadband() != null && cfg.deadband() < 0) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
    }
    TagMeta tag = tags.get(cfg.tagId());
    if (tag == null) return ResponseEntity.badRequest().body(ApiError.of("tag_not_found"));
    String type = tag.dataType() == null ? "" : tag.dataType();
    boolean numeric = "int".equals(type) || "float".equals(type);
    switch (cfg.kind()) {
      case "limit", "target", "rate" -> {
        if (!numeric) return ResponseEntity.badRequest().body(ApiError.of("alarm_type_mismatch"));
      }
      case "bool" -> {
        if (!"bool".equals(type) || cfg.boolValue() == null) {
          return ResponseEntity.badRequest().body(ApiError.of("alarm_type_mismatch"));
        }
      }
      case "match", "mismatch" -> {
        if (!"string".equals(type)) {
          return ResponseEntity.badRequest().body(ApiError.of("alarm_type_mismatch"));
        }
      }
      case "quality" -> {
        if (cfg.quality() == null || !QUALITIES.contains(cfg.quality())) {
          return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
        }
      }
      default -> {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
      }
    }
    if ("limit".equals(cfg.kind())) {
      if (cfg.limit() == null || !LIMITS.contains(cfg.limit()) || cfg.threshold() == null) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
      }
    } else if ("target".equals(cfg.kind())) {
      if (cfg.target() == null
          || cfg.threshold() == null
          || cfg.threshold() < 0
          || !HIGH_GRADES.contains(grade(cfg))) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
      }
    } else if ("rate".equals(cfg.kind())) {
      if (cfg.threshold() == null
          || cfg.threshold() < 0
          || cfg.windowSec() == null
          || cfg.windowSec() <= 0
          || cfg.windowSec() > 86400
          || !HIGH_GRADES.contains(grade(cfg))) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
      }
    } else if ("bool".equals(cfg.kind())
        || "match".equals(cfg.kind())
        || "mismatch".equals(cfg.kind())) {
      if (!HIGH_GRADES.contains(grade(cfg))) {
        return ResponseEntity.badRequest().body(ApiError.of("invalid_alarm"));
      }
    }
    for (TagAlarmConfig other : alarms.listByTag(cfg.tagId())) {
      if (ignoreId != null && ignoreId.equals(other.alarmId())) continue;
      if (sameSlot(cfg, other)) return ResponseEntity.status(409).body(ApiError.of("alarm_exists"));
    }
    return null;
  }

  private static boolean sameSlot(TagAlarmConfig a, TagAlarmConfig b) {
    if (a.kind() == null || !a.kind().equals(b.kind())) return false;
    return switch (a.kind()) {
      case "limit", "target", "rate" -> grade(a).equals(grade(b));
      case "bool" -> a.boolValue() != null && a.boolValue().equals(b.boolValue()) && grade(a).equals(grade(b));
      case "match", "mismatch" -> grade(a).equals(grade(b));
      case "quality" -> a.quality() != null && a.quality().equals(b.quality());
      default -> false;
    };
  }

  /** 没填档位的旧布尔报警占「高」。 */
  private static String grade(TagAlarmConfig cfg) {
    if (cfg.limit() == null || cfg.limit().isBlank()) return "H";
    return cfg.limit();
  }

  private static TagAlarmConfig copy(String alarmId, TagAlarmConfig body) {
    String kind = body.kind();
    String limit = body.limit();
    boolean graded =
        "bool".equals(kind)
            || "target".equals(kind)
            || "rate".equals(kind)
            || "match".equals(kind)
            || "mismatch".equals(kind);
    if (graded && (limit == null || limit.isBlank())) limit = "H";
    String expect = body.expectText();
    if ("match".equals(kind) || "mismatch".equals(kind)) {
      expect = expect == null ? "" : expect;
    }
    return new TagAlarmConfig(
        alarmId,
        body.tagId() == null ? null : body.tagId().trim(),
        body.name() == null ? null : body.name().trim(),
        body.enabled(),
        body.level(),
        kind,
        limit,
        body.threshold(),
        body.deadband(),
        body.boolValue(),
        body.quality(),
        body.delaySec(),
        body.target(),
        body.windowSec(),
        expect);
  }
}
