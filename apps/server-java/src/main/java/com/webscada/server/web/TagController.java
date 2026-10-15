package com.webscada.server.web;

import com.webscada.server.db.InfluxHolder;
import com.webscada.server.model.ApiError;
import com.webscada.server.model.TagMeta;
import com.webscada.server.service.AlarmRuntimeService;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.AlarmFileStore;
import com.webscada.server.store.DeviceFileStore;
import com.webscada.server.store.TagFileStore;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
public class TagController {
  private final TagFileStore tags;
  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final InfluxHolder influx;
  private final AlarmFileStore alarms;
  private final AlarmRuntimeService alarmRuntime;

  public TagController(
      TagFileStore tags,
      DeviceFileStore devices,
      TagRuntimeService runtime,
      InfluxHolder influx,
      AlarmFileStore alarms,
      AlarmRuntimeService alarmRuntime) {
    this.tags = tags;
    this.devices = devices;
    this.runtime = runtime;
    this.influx = influx;
    this.alarms = alarms;
    this.alarmRuntime = alarmRuntime;
  }

  @GetMapping("/api/tags")
  public Map<String, Object> list() throws Exception {
    return Map.of("items", tags.list(), "values", runtime.getCurrentValues());
  }

  @GetMapping("/api/tags/values")
  public Map<String, Object> values() {
    return Map.of("values", runtime.getCurrentValues());
  }

  @PostMapping("/api/tags")
  public ResponseEntity<?> create(@RequestBody TagMeta body) throws Exception {
    if (body == null || body.tagId() == null || body.name() == null || body.dataType() == null) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_tag_body"));
    }
    if (!body.tagId().matches("^[a-zA-Z0-9._\\-]+$")) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_tag_id"));
    }
    String deviceId = requireDevice(body.deviceId());
    if (deviceId == null) {
      return ResponseEntity.badRequest()
          .body(
              body.deviceId() == null || body.deviceId().isBlank()
                  ? ApiError.of("device_id_required")
                  : new ApiError("device_not_found", null, null, body.deviceId()));
    }
    if (tags.get(body.tagId()) != null) {
      return ResponseEntity.status(409).body(ApiError.of("tag_exists"));
    }
    TagMeta saved =
        tags.upsert(
            new TagMeta(
                body.tagId(),
                body.name(),
                body.group(),
                deviceId,
                body.address(),
                body.dataType(),
                body.unit(),
                body.writable(),
                body.description(),
                body.simulation(),
                body.onText(),
                body.offText(),
                body.scanPeriodMs(),
                body.pushEnabled(),
                body.pushPeriodMs(),
                body.history()));
    runtime.reload();
    return ResponseEntity.ok(saved);
  }

  @PutMapping("/api/tags/{tagId}")
  public ResponseEntity<?> update(@PathVariable String tagId, @RequestBody TagMeta body)
      throws Exception {
    TagMeta existing = tags.get(tagId);
    if (existing == null) return ResponseEntity.status(404).body(ApiError.of("tag_not_found"));
    String wantDevice = body != null && body.deviceId() != null ? body.deviceId() : existing.deviceId();
    String deviceId = requireDevice(wantDevice);
    if (deviceId == null) {
      return ResponseEntity.badRequest()
          .body(
              wantDevice == null || wantDevice.isBlank()
                  ? ApiError.of("device_id_required")
                  : new ApiError("device_not_found", null, null, wantDevice));
    }
    TagMeta merged =
        new TagMeta(
            tagId,
            body != null && body.name() != null ? body.name() : existing.name(),
            body != null && body.group() != null ? body.group() : existing.group(),
            deviceId,
            body != null && body.address() != null ? body.address() : existing.address(),
            body != null && body.dataType() != null ? body.dataType() : existing.dataType(),
            body != null && body.unit() != null ? body.unit() : existing.unit(),
            body != null ? body.writable() : existing.writable(),
            body != null && body.description() != null ? body.description() : existing.description(),
            body != null && body.simulation() != null ? body.simulation() : existing.simulation(),
            body != null && body.onText() != null ? body.onText() : existing.onText(),
            body != null && body.offText() != null ? body.offText() : existing.offText(),
            body != null && body.scanPeriodMs() != null ? body.scanPeriodMs() : existing.scanPeriodMs(),
            body != null && body.pushEnabled() != null ? body.pushEnabled() : existing.pushEnabled(),
            body != null && body.pushPeriodMs() != null ? body.pushPeriodMs() : existing.pushPeriodMs(),
            body != null && body.history() != null ? body.history() : existing.history());
    TagMeta saved = tags.upsert(merged);
    runtime.reload();
    return ResponseEntity.ok(saved);
  }

  @DeleteMapping("/api/tags/{tagId}")
  public ResponseEntity<?> delete(@PathVariable String tagId) throws Exception {
    if (!tags.delete(tagId)) return ResponseEntity.status(404).body(ApiError.of("tag_not_found"));
    alarms.deleteByTag(tagId);
    alarmRuntime.reloadConfigs();
    runtime.reload();
    return ResponseEntity.ok(Map.of("ok", true));
  }

  @PostMapping("/api/tags/{tagId}/write")
  public ResponseEntity<?> write(
      @PathVariable String tagId, @RequestBody Map<String, Object> body) {
    Object value = body == null ? null : body.get("value");
    TagRuntimeService.WriteResult res = runtime.writeTag(tagId, value);
    if (!res.ok()) {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("ok", false);
      err.put("message", res.message());
      return ResponseEntity.badRequest().body(err);
    }
    Map<String, Object> ok = new LinkedHashMap<>();
    ok.put("ok", true);
    ok.put("message", "ok");
    ok.put("value", res.value());
    return ResponseEntity.ok(ok);
  }

  @PostMapping("/api/tags/history")
  @SuppressWarnings("unchecked")
  public ResponseEntity<?> writeHistory(@RequestBody Map<String, Object> body) {
    if (!influx.isReady()) {
      return ResponseEntity.status(503)
          .body(new ApiError("influx_unavailable", influx.getLastError(), null, null));
    }
    Object samplesObj = body == null ? null : body.get("samples");
    if (!(samplesObj instanceof List<?> samples) || samples.isEmpty()) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_samples"));
    }
    List<Map<String, Object>> list = new java.util.ArrayList<>();
    for (Object s : samples) {
      if (s instanceof Map<?, ?> m) list.add((Map<String, Object>) m);
    }
    if (list.isEmpty()) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_samples"));
    }
    int written = influx.writeSamples(list);
    return ResponseEntity.ok(Map.of("ok", true, "written", written));
  }

  @GetMapping("/api/tags/{tagId}/history")
  public ResponseEntity<?> history(
      @PathVariable String tagId,
      @RequestParam(required = false) String start,
      @RequestParam(required = false) String stop,
      @RequestParam(required = false) Integer limit) {
    if (!influx.isReady()) {
      return ResponseEntity.status(503)
          .body(new ApiError("influx_unavailable", influx.getLastError(), null, null));
    }
    List<Map<String, Object>> points = influx.queryHistory(tagId, start, stop, limit);
    return ResponseEntity.ok(Map.of("tagId", tagId, "points", points));
  }

  private String requireDevice(String deviceId) throws Exception {
    if (deviceId == null || deviceId.isBlank()) return null;
    return devices.get(deviceId.trim()) == null ? null : deviceId.trim();
  }
}
