package com.webscada.server.service;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceLinkStatus;
import com.webscada.server.model.DeviceMeta;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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

  public void clear(String deviceId) {
    if (deviceId == null || deviceId.isBlank()) return;
    reported.remove(deviceId);
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
    String protocol = device.protocol() == null ? "" : device.protocol().trim().toLowerCase(Locale.ROOT);
    if ("mock".equals(protocol)) {
      return new DeviceLinkStatus(id, true, "online", null, "模拟设备");
    }
    if ("mcd4000".equals(protocol)) {
      if (!mcdEnabled) {
        return new DeviceLinkStatus(id, false, "offline", null, "采集未启用");
      }
      DeviceLinkStatus known = reported.get(id);
      if (known == null) {
        return new DeviceLinkStatus(id, false, "unknown", null, "尚未检测");
      }
      return known;
    }
    if (DeviceConnectivityMonitor.isProbeable(protocol)) {
      String channel = device.channel() == null ? "" : device.channel().trim();
      if (channel.isEmpty()) {
        return new DeviceLinkStatus(id, false, "offline", null, "未配置连接");
      }
      DeviceLinkStatus known = reported.get(id);
      if (known == null) {
        return new DeviceLinkStatus(id, false, "unknown", null, "等待连通性检测");
      }
      return known;
    }
    // other / 未知协议：无法自动判断
    DeviceLinkStatus known = reported.get(id);
    if (known != null) return known;
    return new DeviceLinkStatus(id, false, "unsupported", null, "该协议不支持自动连通性检测");
  }
}
