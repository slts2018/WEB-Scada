package com.webscada.server.service;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceLinkStatus;
import com.webscada.server.model.DeviceMeta;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class DeviceStatusService {
  private final ScadaProperties props;
  private final ConcurrentHashMap<String, DeviceLinkStatus> reported = new ConcurrentHashMap<>();

  public DeviceStatusService(ScadaProperties props) {
    this.props = props;
  }

  public void report(String deviceId, boolean online, String state, String message) {
    if (deviceId == null || deviceId.isBlank()) return;
    reported.put(
        deviceId,
        new DeviceLinkStatus(deviceId, online, state, System.currentTimeMillis(), message));
  }

  public List<DeviceLinkStatus> snapshot(List<DeviceMeta> devices) {
    boolean mcdEnabled = props.getMcd4000().isEnabled();
    List<DeviceLinkStatus> out = new ArrayList<>();
    for (DeviceMeta device : devices) {
      out.add(resolve(device, mcdEnabled));
    }
    return out;
  }

  private DeviceLinkStatus resolve(DeviceMeta device, boolean mcdEnabled) {
    String id = device.deviceId();
    if (!device.enabled()) {
      return new DeviceLinkStatus(id, false, "disabled", null, "已停用");
    }
    String protocol = device.protocol() == null ? "" : device.protocol();
    if ("mock".equalsIgnoreCase(protocol)) {
      return new DeviceLinkStatus(id, true, "online", null, null);
    }
    if ("mcd4000".equalsIgnoreCase(protocol)) {
      if (!mcdEnabled) {
        return new DeviceLinkStatus(id, false, "offline", null, "采集未启用");
      }
      DeviceLinkStatus known = reported.get(id);
      if (known == null) {
        return new DeviceLinkStatus(id, false, "unknown", null, "尚未检测");
      }
      return known;
    }
    DeviceLinkStatus known = reported.get(id);
    if (known != null) return known;
    return new DeviceLinkStatus(id, false, "unsupported", null, "未接入采集");
  }
}
