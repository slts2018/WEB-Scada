package com.webscada.server.comm.bridge;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.CommProperties;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.PointSample;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.event.LinkEvents;
import com.webscada.server.comm.event.LinkListener;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.service.TagRuntimeService;
import jakarta.annotation.PostConstruct;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 把通信回调转成变量值和设备状态。回调线程只入队，排空才调 setTagValue。
 * 跟随 {@code webscada.comm.enabled}，关闭时这个 Bean 不会创建。
 */
@Component
@ConditionalOnProperty(prefix = "webscada.comm", name = "enabled", havingValue = "true")
public class CommBridge {
  private final CommFacade comm;
  private final TagRuntimeService runtime;
  private final DeviceStatusService devices;
  private final boolean useSourceTimestamp;
  private final int capacity;
  private final ArrayDeque<Pending> queue = new ArrayDeque<>();
  private final Object gate = new Object();
  private final ConcurrentHashMap<String, Stamp> last = new ConcurrentHashMap<>();
  /** linkId → (pointId → tagId)。启动和 reload 时整表替换。 */
  private volatile Map<String, Map<String, String>> tags = Map.of();
  private long dropped;
  private long forwarded;

  @Autowired
  public CommBridge(
      CommFacade comm,
      TagRuntimeService runtime,
      DeviceStatusService devices,
      CommProperties properties) {
    this(
        comm,
        runtime,
        devices,
        properties.isUseSourceTimestamp(),
        properties.getBridgeQueueSize());
  }

  CommBridge(
      CommFacade comm,
      TagRuntimeService runtime,
      DeviceStatusService devices,
      boolean useSourceTimestamp,
      int capacity) {
    if (capacity < 1) throw new IllegalArgumentException("bridge queue < 1");
    this.comm = comm;
    this.runtime = runtime;
    this.devices = devices;
    this.useSourceTimestamp = useSourceTimestamp;
    this.capacity = capacity;
    rebuildTags();
  }

  @PostConstruct
  public void start() {
    rebuildTags();
    comm.onReload(this::rebuildTags);
    comm.listen(
        new LinkListener() {
          @Override
          public void onData(LinkEvents.DataReceived event) {
            acceptData(event);
          }

          @Override
          public void onState(LinkEvents.StateChanged event) {
            acceptState(event);
          }
        });
  }

  void acceptData(LinkEvents.DataReceived event) {
    if (event == null || event.points() == null) return;
    for (PointSample sample : event.points()) {
      if (sample == null || sample.pointId() == null || sample.pointId().isBlank()) continue;
      String quality = sample.quality() == null ? "Uncertain" : sample.quality().toLegacy();
      offer(tagIdOf(event.linkId(), sample.pointId()), sample.value(), quality, sample.sourceTs());
    }
  }

  void acceptState(LinkEvents.StateChanged event) {
    if (event == null || event.to() == null) return;
    Boolean online = onlineOf(event.to());
    if (online == null) return;
    LinkSupervisor supervisor = comm.supervisor(event.linkId());
    String deviceId =
        supervisor == null ? event.linkId() : supervisor.definition().deviceId();
    devices.report(deviceId, online, event.to().name(), event.reason());
    if (!online) markOffline(event.linkId());
  }

  @Scheduled(fixedRate = 200)
  public void drain() {
    List<Pending> batch;
    synchronized (gate) {
      if (queue.isEmpty()) return;
      batch = new ArrayList<>(queue);
      queue.clear();
    }
    for (Pending item : batch) {
      forwarded++;
      if (useSourceTimestamp && item.sourceTs != null) {
        runtime.setTagValue(item.tagId, item.value, item.quality, item.sourceTs);
      } else {
        runtime.setTagValue(item.tagId, item.value, item.quality);
      }
    }
  }

  public long dropped() {
    synchronized (gate) {
      return dropped;
    }
  }

  public long forwarded() {
    return forwarded;
  }

  public int pending() {
    synchronized (gate) {
      return queue.size();
    }
  }

  private void markOffline(String linkId) {
    Map<String, String> map = tags.get(linkId);
    if (map == null || map.isEmpty()) return;
    String offline = Quality.BAD_COMM_FAILURE.toLegacy();
    for (String tagId : map.values()) offer(tagId, null, offline, null);
  }

  private void rebuildTags() {
    Map<String, Map<String, String>> next = new HashMap<>();
    for (LinkDefinition link : comm.definitions()) {
      Map<String, String> map = new HashMap<>();
      if (!link.points().isEmpty()) {
        for (DataPoint point : link.points()) {
          if (point.id() == null || point.id().isBlank()) continue;
          map.put(point.id(), point.tagId());
        }
      } else {
        for (String id : link.pointIds()) {
          if (id == null || id.isBlank()) continue;
          map.put(id, id);
        }
      }
      next.put(link.id(), Map.copyOf(map));
    }
    tags = Map.copyOf(next);
  }

  private String tagIdOf(String linkId, String pointId) {
    Map<String, String> map = tags.get(linkId);
    if (map == null) return pointId;
    String tagId = map.get(pointId);
    return tagId == null ? pointId : tagId;
  }

  private void offer(String tagId, Object value, String quality, Long sourceTs) {
    if (tagId == null || tagId.isBlank()) return;
    Stamp stamp = new Stamp(value, quality);
    synchronized (gate) {
      if (stamp.equals(last.get(tagId))) return;
      while (queue.size() >= capacity) {
        Pending droppedItem = queue.pollFirst();
        if (droppedItem == null) break;
        dropped++;
        last.remove(droppedItem.tagId());
      }
      queue.addLast(new Pending(tagId, value, quality, sourceTs));
      last.put(tagId, stamp);
    }
  }

  private static Boolean onlineOf(ConnectionState state) {
    return switch (state) {
      case RUNNING, DEGRADED -> Boolean.TRUE;
      case RECONNECTING, FAILED, STOPPED -> Boolean.FALSE;
      default -> null;
    };
  }

  private record Stamp(Object value, String quality) {}

  private record Pending(String tagId, Object value, String quality, Long sourceTs) {}
}
