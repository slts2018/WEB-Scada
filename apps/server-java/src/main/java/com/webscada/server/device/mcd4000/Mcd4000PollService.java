package com.webscada.server.device.mcd4000;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class Mcd4000PollService {
  private static final Logger log = LoggerFactory.getLogger(Mcd4000PollService.class);

  private final DeviceFileStore devices;
  private final TagRuntimeService runtime;
  private final DeviceStatusService linkStatus;
  private final ScadaProperties props;
  private final ObjectMapper mapper;
  private final AtomicBoolean busy = new AtomicBoolean(false);
  private volatile long lastWarnAt;
  /** tagId 或探测键 → 上次发起读取的时间 */
  private final ConcurrentHashMap<String, Long> lastScanAt = new ConcurrentHashMap<>();

  private volatile Mcd4000Client client;

  public Mcd4000PollService(
      DeviceFileStore devices,
      TagRuntimeService runtime,
      DeviceStatusService linkStatus,
      ScadaProperties props,
      ObjectMapper mapper) {
    this.devices = devices;
    this.runtime = runtime;
    this.linkStatus = linkStatus;
    this.props = props;
    this.mapper = mapper;
  }

  private Mcd4000Client client() {
    Mcd4000Client c = client;
    if (c == null) {
      ScadaProperties.Mcd4000 cfg = props.getMcd4000();
      c =
          new Mcd4000Client(
              mapper,
              Duration.ofMillis(Math.max(500, cfg.getTimeoutMs())),
              cfg.getLookbackSec(),
              cfg.isInsecureSsl());
      client = c;
    }
    return c;
  }

  @Scheduled(fixedDelay = 50)
  public void poll() {
    if (!props.getMcd4000().isEnabled()) return;
    if (!busy.compareAndSet(false, true)) return;
    try {
      doPoll();
    } catch (Exception e) {
      warn("poll failed", e);
    } finally {
      busy.set(false);
    }
  }

  private void doPoll() throws Exception {
    List<DeviceMeta> allDevices = devices.list();
    if (allDevices.isEmpty()) return;

    Map<String, DeviceMeta> mcdById = new HashMap<>();
    for (DeviceMeta d : allDevices) {
      if (d.enabled() && "mcd4000".equalsIgnoreCase(d.protocol())) {
        mcdById.put(d.deviceId(), d);
      }
    }
    if (mcdById.isEmpty()) return;

    // deviceId → tags with address
    Map<String, List<BoundTag>> byDevice = new HashMap<>();
    for (TagMeta meta : runtime.getMetas()) {
      DeviceMeta dev = mcdById.get(meta.deviceId());
      if (dev == null) continue;
      Mcd4000Channel.TagAddr addr = Mcd4000Channel.TagAddr.parse(meta.address());
      if (addr == null) continue;
      byDevice.computeIfAbsent(meta.deviceId(), k -> new ArrayList<>()).add(new BoundTag(meta, addr));
    }

    Mcd4000Client cli = client();
    long now = System.currentTimeMillis();
    long pingEvery = Math.max(1000L, props.getMcd4000().getPollMs());
    for (DeviceMeta dev : mcdById.values()) {
      List<BoundTag> tags = byDevice.getOrDefault(dev.deviceId(), List.of());
      Mcd4000Channel ch = Mcd4000Channel.parse(dev.channel());
      if (ch == null) {
        if (!scanDue("badch:" + dev.deviceId(), pingEvery, now)) continue;
        lastScanAt.put("badch:" + dev.deviceId(), now);
        linkStatus.report(dev.deviceId(), false, "offline", "通道无效");
        markBad(tags);
        continue;
      }
      List<BoundTag> due = new ArrayList<>();
      try {
        if (tags.isEmpty()) {
          if (!scanDue("ping:" + dev.deviceId(), pingEvery, now)) continue;
          lastScanAt.put("ping:" + dev.deviceId(), now);
          cli.reachable(ch.baseUrl());
        } else {
          for (BoundTag bt : tags) {
            if (!scanDue(bt.meta.tagId(), scanPeriod(bt.meta), now)) continue;
            due.add(bt);
            lastScanAt.put(bt.meta.tagId(), now);
          }
          if (due.isEmpty()) continue;
          List<Mcd4000Channel.TagAddr> addrs = due.stream().map(BoundTag::addr).toList();
          Map<String, Mcd4000Client.Point> latest = cli.queryLatest(ch, addrs);
          for (BoundTag bt : due) {
            Mcd4000Client.Point point =
                latest.get(Mcd4000Client.key(bt.addr.sensor(), bt.addr.field()));
            if (point == null || point.value() == null) {
              markOne(bt, "Bad");
              continue;
            }
            Object normalized = coerce(bt.meta.dataType(), point.value());
            if (normalized == COERCE_FAIL) {
              runtime.setTagValue(bt.meta.tagId(), String.valueOf(point.value()), "Bad");
            } else {
              runtime.setTagValue(bt.meta.tagId(), normalized, point.quality());
            }
          }
        }
        linkStatus.report(dev.deviceId(), true, "online", null);
      } catch (Exception ex) {
        warn("device " + dev.deviceId() + " query failed", ex);
        linkStatus.report(dev.deviceId(), false, "offline", "连接失败");
        markBad(due);
      }
    }
  }

  private static int scanPeriod(TagMeta meta) {
    int ms = meta.scanPeriodMs() == null ? 1000 : meta.scanPeriodMs();
    return Math.max(50, ms);
  }

  private boolean scanDue(String key, long periodMs, long now) {
    long last = lastScanAt.getOrDefault(key, 0L);
    return last == 0L || now - last >= periodMs;
  }

  private void markBad(List<BoundTag> tags) {
    for (BoundTag bt : tags) markOne(bt, "Bad");
  }

  private void markOne(BoundTag bt, String quality) {
    TagValue cur = runtime.getTagValue(bt.meta.tagId());
    Object v = cur != null ? cur.value() : fallback(bt.meta.dataType());
    runtime.setTagValue(bt.meta.tagId(), v, quality);
  }

  private static final Object COERCE_FAIL = new Object();

  private static Object coerce(String dataType, Object raw) {
    if (raw == null) return COERCE_FAIL;
    return switch (dataType == null ? "float" : dataType) {
      case "bool" -> {
        if (raw instanceof Boolean b) yield b;
        if (raw instanceof Number n) yield n.doubleValue() != 0;
        String s = String.valueOf(raw).trim().toLowerCase();
        yield "true".equals(s) || "1".equals(s) || "on".equals(s);
      }
      case "int" -> {
        if (raw instanceof Number n) yield (int) Math.rint(n.doubleValue());
        try {
          yield (int) Math.rint(Double.parseDouble(String.valueOf(raw)));
        } catch (NumberFormatException e) {
          yield COERCE_FAIL;
        }
      }
      case "string" -> String.valueOf(raw);
      default -> {
        if (raw instanceof Number n) yield n.doubleValue();
        try {
          yield Double.parseDouble(String.valueOf(raw));
        } catch (NumberFormatException e) {
          yield COERCE_FAIL;
        }
      }
    };
  }

  private static Object fallback(String dataType) {
    return switch (dataType == null ? "float" : dataType) {
      case "bool" -> false;
      case "string" -> "";
      default -> 0;
    };
  }

  private void warn(String msg, Exception e) {
    long now = System.currentTimeMillis();
    if (now - lastWarnAt > 10_000) {
      lastWarnAt = now;
      log.warn("mcd4000: {} — {}", msg, e.toString());
    }
  }

  private record BoundTag(TagMeta meta, Mcd4000Channel.TagAddr addr) {}
}
