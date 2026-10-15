package com.webscada.server.web;

import com.webscada.server.model.ApiError;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.store.DeviceFileStore;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DeviceController {
  private final DeviceFileStore devices;

  public DeviceController(DeviceFileStore devices) {
    this.devices = devices;
  }

  @GetMapping("/api/devices")
  public Map<String, Object> list() throws Exception {
    return Map.of("items", devices.list());
  }

  @PostMapping("/api/devices")
  public ResponseEntity<?> create(@RequestBody DeviceMeta body) throws Exception {
    if (body == null || body.deviceId() == null || body.name() == null || body.protocol() == null) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_device_body"));
    }
    if (!body.deviceId().matches("^[a-zA-Z0-9._\\-]+$")) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_device_id"));
    }
    if (devices.get(body.deviceId()) != null) {
      return ResponseEntity.status(409).body(ApiError.of("device_exists"));
    }
    try {
      return ResponseEntity.ok(
          devices.upsert(
              new DeviceMeta(
                  body.deviceId(),
                  body.name(),
                  body.protocol(),
                  body.channel(),
                  body.enabled(),
                  body.description())));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(503)
          .body(ApiError.of("mysql_unavailable", e.getMessage()));
    }
  }

  @PutMapping("/api/devices/{deviceId}")
  public ResponseEntity<?> update(@PathVariable String deviceId, @RequestBody DeviceMeta body)
      throws Exception {
    DeviceMeta existing = devices.get(deviceId);
    if (existing == null) return ResponseEntity.status(404).body(ApiError.of("device_not_found"));
    DeviceMeta next =
        new DeviceMeta(
            deviceId,
            body != null && body.name() != null ? body.name() : existing.name(),
            body != null && body.protocol() != null ? body.protocol() : existing.protocol(),
            body != null && body.channel() != null ? body.channel() : existing.channel(),
            body != null ? body.enabled() : existing.enabled(),
            body != null && body.description() != null ? body.description() : existing.description());
    try {
      return ResponseEntity.ok(devices.upsert(next));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(503)
          .body(ApiError.of("mysql_unavailable", e.getMessage()));
    }
  }

  @DeleteMapping("/api/devices/{deviceId}")
  public ResponseEntity<?> delete(@PathVariable String deviceId) throws Exception {
    try {
      if (!devices.delete(deviceId)) {
        return ResponseEntity.status(404).body(ApiError.of("device_not_found"));
      }
      return ResponseEntity.ok(Map.of("ok", true));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(503)
          .body(ApiError.of("mysql_unavailable", e.getMessage()));
    }
  }
}
