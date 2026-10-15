package com.webscada.server.device.mcd4000;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
  private final ScadaProperties props;
  private final ObjectMapper mapper;
  private final AtomicBoolean busy = new AtomicBoolean(false);
  private volatile long lastWarnAt;

  private volatile Mcd4000Client client;

  public Mcd4000PollService(
      DeviceFileStore devices,
      TagRuntimeService runtime,
      ScadaProperties props,
      ObjectMapper mapper) {
    this.devices = devices;
    this.runtime = runtime;
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

  @Scheduled(fixedDelayString = "${webscada.mcd4000.poll-ms:2000}")
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
    List<TagMeta> metas = runtime.getMetas();
    if (allDevices.isEmpty() || metas.isEmpty()) return;

    Map<String, DeviceMeta> mcdById = new HashMap<>();
    for (DeviceMeta d : allDevices) {
      if (d.enabled() && "mcd4000".equalsIgnoreCase(d.protocol())) {
        mcdById.put(d.deviceId(), d);
      }
    }
    if (mcdById.isEmpty()) return;

    // deviceId → tags with address
    Map<String, List<BoundTag>> byDevice = new HashMap<>();
    for (TagMeta meta : metas) {
      DeviceMeta dev = mcdById.get(meta.deviceId());
      if (dev == null) continue;
      Mcd4000Channel.TagAddr addr = Mcd4000Channel.TagAddr.parse(meta.address());
      if (addr == null) continue;
      byDevice.computeIfAbsent(meta.deviceId(), k -> new ArrayList<>()).add(new BoundTag(meta, addr));
    }

    Mcd4000Client cli = client();
    for (Map.Entry<String, List<BoundTag>> e : byDevice.entrySet()) {
      DeviceMeta dev = mcdById.get(e.getKey());
      if (dev == null) continue;
      Mcd4000Channel ch = Mcd4000Channel.parse(dev.channel());
      if (ch == null) {
        markBad(e.getValue());
        continue;
      }
      try {
        List<Mcd4000Channel.TagAddr> addrs =
            e.getValue().stream().map(BoundTag::addr).toList();
        Map<String, Object> latest = cli.queryLatest(ch, addrs);
        for (BoundTag bt : e.getValue()) {
          Object raw = latest.get(Mcd4000Client.key(bt.addr.sensor(), bt.addr.field()));
          if (raw == null) {
            TagValue cur = runtime.getTagValue(bt.meta.tagId());
            if (cur != null) runtime.setTagValue(bt.meta.tagId(), cur.value(), "Uncertain");
            continue;
          }
          Object normalized = coerce(bt.meta.dataType(), raw);
          if (normalized == COERCE_FAIL) {
            runtime.setTagValue(bt.meta.tagId(), String.valueOf(raw), "Uncertain");
          } else {
            runtime.setTagValue(bt.meta.tagId(), normalized, "Good");
          }
        }
      } catch (Exception ex) {
        warn("device " + dev.deviceId() + " query failed", ex);
        markBad(e.getValue());
      }
    }
  }

  private void markBad(List<BoundTag> tags) {
    for (BoundTag bt : tags) {
      TagValue cur = runtime.getTagValue(bt.meta.tagId());
      Object v = cur != null ? cur.value() : fallback(bt.meta.dataType());
      runtime.setTagValue(bt.meta.tagId(), v, "Bad");
    }
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
