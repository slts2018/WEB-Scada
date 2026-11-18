package com.webscada.server.service;

import com.webscada.server.model.DeviceMeta;
import com.webscada.server.store.DeviceFileStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 对可探测协议（Modbus/OPC/MQTT/HTTP）做周期连通性探测，结果写入 {@link DeviceStatusService}。
 * 不启动 Comm 采集；MCD4000 / Mock 仍由各自逻辑负责。
 */
@Service
public class DeviceConnectivityMonitor {
  private static final Logger log = LoggerFactory.getLogger(DeviceConnectivityMonitor.class);

  private final DeviceFileStore devices;
  private final DeviceStatusService status;
  private final DeviceConnectionProbeService probe;
  private final CommsEventLogService commsLog;
  private final ConcurrentHashMap<String, Boolean> lastOnline = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, String> lastOnlineDetail = new ConcurrentHashMap<>();
  private final AtomicBoolean busy = new AtomicBoolean(false);
  private final ExecutorService pool =
      Executors.newFixedThreadPool(
          4,
          r -> {
            Thread t = new Thread(r, "device-probe");
            t.setDaemon(true);
            return t;
          });

  public DeviceConnectivityMonitor(
      DeviceFileStore devices,
      DeviceStatusService status,
      DeviceConnectionProbeService probe,
      CommsEventLogService commsLog) {
    this.devices = devices;
    this.status = status;
    this.probe = probe;
    this.commsLog = commsLog;
  }

  public static boolean isProbeable(String protocol) {
    if (protocol == null) return false;
    return switch (protocol.trim().toLowerCase(Locale.ROOT)) {
      case "modbus_tcp", "modbus-tcp", "modbus_udp", "modbus-udp", "opcua", "mqtt", "http" -> true;
      default -> false;
    };
  }

  @Scheduled(fixedDelayString = "${webscada.device-probe-ms:15000}", initialDelay = 4000)
  public void scheduledProbe() {
    try {
      probeAll();
    } catch (Exception e) {
      log.warn("device probe tick failed: {}", e.toString());
    }
  }

  /** 立即探测全部可探测设备；返回实际探测台数。若已有探测在跑则等待其结束。 */
  public int probeAll() throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
    while (!busy.compareAndSet(false, true)) {
      if (System.nanoTime() >= deadline) return 0;
      Thread.sleep(200);
    }
    try {
      List<DeviceMeta> all = devices.list();
      java.util.HashSet<String> active = new java.util.HashSet<>();
      for (DeviceMeta device : all) {
        if (shouldProbe(device) && isStatusLogProtocol(device.protocol())) {
          active.add(device.deviceId());
        }
      }
      for (String id : new ArrayList<>(lastOnline.keySet())) {
        if (!active.contains(id)) {
          lastOnline.remove(id);
          lastOnlineDetail.remove(id);
        }
      }
      List<CompletableFuture<Void>> jobs = new ArrayList<>();
      int planned = 0;
      for (DeviceMeta device : all) {
        if (!shouldProbe(device)) continue;
        planned++;
        DeviceMeta snap = device;
        jobs.add(CompletableFuture.runAsync(() -> probeOne(snap), pool));
      }
      if (jobs.isEmpty()) return 0;
      CompletableFuture.allOf(jobs.toArray(CompletableFuture[]::new))
          .get(20, TimeUnit.SECONDS);
      return planned;
    } finally {
      busy.set(false);
    }
  }

  public void probeOne(DeviceMeta device) {
    if (device == null || device.deviceId() == null) return;
    String id = device.deviceId();
    if (!device.enabled()) {
      status.report(id, false, "disabled", "已停用");
      lastOnline.remove(id);
      lastOnlineDetail.remove(id);
      return;
    }
    String channel = device.channel() == null ? "" : device.channel().trim();
    if (channel.isEmpty()) {
      status.report(id, false, "offline", "未配置连接");
      noteProbe(device, false, "未配置连接");
      return;
    }
    Map<String, Object> result = probe.probe(device.protocol(), channel);
    boolean ok = Boolean.TRUE.equals(result.get("ok"));
    String message = result.get("message") == null ? null : String.valueOf(result.get("message"));
    status.report(id, ok, ok ? "online" : "offline", message);
    noteProbe(device, ok, message);
  }

  /** OPC UA / MQTT / HTTP 探测边沿写入通讯日志；Modbus 仍由轮询服务负责，避免重复。 */
  public static boolean isStatusLogProtocol(String protocol) {
    if (protocol == null) return false;
    return switch (protocol.trim().toLowerCase(Locale.ROOT)) {
      case "opcua", "mqtt", "http" -> true;
      default -> false;
    };
  }

  private void noteProbe(DeviceMeta device, boolean online, String detail) {
    if (device == null || !isStatusLogProtocol(device.protocol())) return;
    String id = device.deviceId();
    if (id == null || id.isBlank()) return;
    if (detail != null && !detail.isBlank()) commsLog.rememberReason(id, detail);
    String det = detail == null ? "" : detail;
    Boolean prev = lastOnline.put(id, online);
    String prevDet = lastOnlineDetail.put(id, det);
    if (prev != null && prev == online) {
      if (online) return;
      if (det.equals(prevDet == null ? "" : prevDet)) return;
    }
    commsLog.deviceOnlineChanged(id, online, detail, 0, false);
  }

  private static boolean shouldProbe(DeviceMeta device) {
    if (device == null || !device.enabled()) return false;
    return isProbeable(device.protocol());
  }
}
