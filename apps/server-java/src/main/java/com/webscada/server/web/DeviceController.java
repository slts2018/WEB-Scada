package com.webscada.server.web;

import com.webscada.server.model.ApiError;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.service.DeviceConnectionProbeService;
import com.webscada.server.service.DeviceConnectivityMonitor;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.store.DeviceFileStore;
import java.util.LinkedHashMap;
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
  private final DeviceStatusService linkStatus;
  private final DeviceConnectionProbeService probe;
  private final DeviceConnectivityMonitor monitor;

  public DeviceController(
      DeviceFileStore devices,
      DeviceStatusService linkStatus,
      DeviceConnectionProbeService probe,
      DeviceConnectivityMonitor monitor) {
    this.devices = devices;
    this.linkStatus = linkStatus;
    this.probe = probe;
    this.monitor = monitor;
  }

  @GetMapping("/api/devices")
  public Map<String, Object> list() throws Exception {
    return Map.of("items", devices.list());
  }

  @GetMapping("/api/devices/status")
  public Map<String, Object> status() throws Exception {
    return Map.of("items", linkStatus.snapshot(devices.list()));
  }

  /** 立即对全部可探测设备做连通性检测，并返回最新状态快照。 */
  @PostMapping("/api/devices/probe-now")
  public Map<String, Object> probeNow() throws Exception {
    int probed = monitor.probeAll();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("ok", true);
    out.put("probed", probed);
    out.put("items", linkStatus.snapshot(devices.list()));
    return out;
  }

  /** 按表单中的协议/通道做一次性连通性探测（可不先保存设备）。 */
  @PostMapping("/api/devices/test-connection")
  public ResponseEntity<?> testConnection(@RequestBody Map<String, Object> body) {
    if (body == null || body.get("protocol") == null) {
      return ResponseEntity.badRequest().body(ApiError.of("invalid_device_body"));
    }
    String protocol = String.valueOf(body.get("protocol"));
    String channel = body.get("channel") == null ? "" : String.valueOf(body.get("channel"));
    Map<String, Object> result = probe.probe(protocol, channel);
    Object deviceIdRaw = body.get("deviceId");
    if (deviceIdRaw != null) {
      String deviceId = String.valueOf(deviceIdRaw).trim();
      if (!deviceId.isEmpty() && DeviceConnectivityMonitor.isProbeable(protocol)) {
        boolean ok = Boolean.TRUE.equals(result.get("ok"));
        String message = result.get("message") == null ? null : String.valueOf(result.get("message"));
        linkStatus.report(deviceId, ok, ok ? "online" : "offline", message);
      }
    }
    return ResponseEntity.ok(result);
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
      linkStatus.clear(deviceId);
      return ResponseEntity.ok(Map.of("ok", true));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(503)
          .body(ApiError.of("mysql_unavailable", e.getMessage()));
    }
  }
}
