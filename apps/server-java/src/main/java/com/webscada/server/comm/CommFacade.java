package com.webscada.server.comm;

import com.webscada.server.comm.config.CommProperties;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkConfigStore;
import com.webscada.server.comm.config.LinkConfigValidator;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.PointCache;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.http.HttpDriver;
import com.webscada.server.comm.driver.modbus.ModbusTcpDriver;
import com.webscada.server.comm.driver.mqtt.MqttDriver;
import com.webscada.server.comm.driver.opcua.OpcUaDriver;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.event.CallbackDispatcher;
import com.webscada.server.comm.event.LinkListener;
import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.log.LogSink;
import com.webscada.server.comm.metrics.LinkStats;
import com.webscada.server.comm.supervisor.InProcessLinkLock;
import com.webscada.server.comm.supervisor.LinkIoPool;
import com.webscada.server.comm.supervisor.LinkScheduler;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.DoubleSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 启动、停止、重载、快照，以及监听和写值。没有协议业务。 */
public final class CommFacade implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(CommFacade.class);

  private final LinkConfigStore store;
  private final LinkScheduler scheduler;
  private final LinkIoPool io;
  private final Clock clock;
  private final InProcessLinkLock lock = new InProcessLinkLock();
  private final Map<String, LinkSupervisor> links = new LinkedHashMap<>();
  private final Map<String, ModbusTcpDriver> modbus = new LinkedHashMap<>();
  private final Map<String, OpcUaDriver> opcua = new LinkedHashMap<>();
  private final Map<String, MqttDriver> mqtt = new LinkedHashMap<>();
  private final Map<String, HttpDriver> http = new LinkedHashMap<>();
  private final List<CallbackDispatcher> dispatchers = new ArrayList<>();
  private final int queueSize;
  private final long graceMs;
  private final DoubleSupplier random;
  private final boolean ownIo;
  private final LogSink sink;
  private volatile LinkListener listener = new LinkListener() {};
  private final List<Runnable> reloadHooks = new CopyOnWriteArrayList<>();

  public static CommFacade create(CommProperties props) {
    LinkConfigValidator validator = new LinkConfigValidator();
    LinkConfigValidator.Result result = validator.validate(props.getLinks());
    if (!result.ok()) {
      throw new IllegalStateException("invalid comm config: " + String.join("; ", result.errors()));
    }
    LinkScheduler scheduler = new LinkScheduler.SharedTickScheduler(props.getTickMs());
    CommFacade facade =
        new CommFacade(
            scheduler,
            new LinkIoPool(props.getIoThreads()),
            Clock.systemUTC(),
            props.getGraceMs(),
            props.getCallbackQueueSize(),
            result.links(),
            null,
            Math::random,
            true,
            null);
    return facade;
  }

  public CommFacade(
      LinkScheduler scheduler,
      LinkIoPool io,
      Clock clock,
      long graceMs,
      int queueSize,
      List<LinkDefinition> links,
      ProtocolDriver driver,
      DoubleSupplier random,
      boolean ownIo,
      LogSink sink) {
    this.scheduler = scheduler;
    this.io = io;
    this.clock = clock;
    this.graceMs = graceMs;
    this.queueSize = queueSize;
    this.random = random == null ? Math::random : random;
    this.ownIo = ownIo;
    this.sink = sink;
    this.store = new LinkConfigStore(new LinkConfigValidator(), links);
    for (LinkDefinition link : links) {
      if (!link.enabled()) continue;
      ProtocolDriver chosen = driver;
      if (chosen == null && "modbus-tcp".equals(link.protocol())) {
        ModbusTcpDriver created = new ModbusTcpDriver(link);
        modbus.put(link.id(), created);
        chosen = created;
      }
      if (chosen == null && "opcua".equals(link.protocol())) {
        OpcUaDriver created = new OpcUaDriver(link);
        opcua.put(link.id(), created);
        chosen = created;
      }
      if (chosen == null && "mqtt".equals(link.protocol())) {
        MqttDriver created = new MqttDriver(link);
        mqtt.put(link.id(), created);
        chosen = created;
      }
      if (chosen == null && "http".equals(link.protocol())) {
        HttpDriver created = new HttpDriver(link);
        http.put(link.id(), created);
        chosen = created;
      }
      if (chosen == null) {
        log.error("link {} protocol {} has no driver; not started", link.id(), link.protocol());
        continue;
      }
      this.links.put(link.id(), newSupervisor(link, chosen));
    }
  }

  public void start() {
    for (LinkSupervisor link : links.values()) link.start();
  }

  public LinkConfigStore store() {
    return store;
  }

  public List<LinkDefinition> definitions() {
    return store.current();
  }

  /** 配置替换成功后调用。用来重建点到变量的映射。 */
  public void onReload(Runnable hook) {
    if (hook != null) reloadHooks.add(hook);
  }

  public LinkSupervisor supervisor(String linkId) {
    return links.get(linkId);
  }

  /** 转发给当前和之后创建的每条链路。后一次调用替换上一次。 */
  public void listen(LinkListener listener) {
    this.listener = listener == null ? new LinkListener() {} : listener;
    for (LinkSupervisor link : links.values()) link.setListener(this.listener);
  }

  public boolean drivesDevice(String deviceId) {
    return linkIdForDevice(deviceId) != null;
  }

  public String linkIdForDevice(String deviceId) {
    if (deviceId == null || deviceId.isBlank()) return null;
    for (LinkSupervisor link : links.values()) {
      if (deviceId.equals(link.definition().deviceId())) return link.id();
    }
    return null;
  }

  /** 先按点 id，再按 tagId。只有 pointIds、没有点表时，用这个 id 合成一个点。 */
  public DataPoint pointFor(String linkId, String tagOrPointId) {
    LinkSupervisor link = links.get(linkId);
    if (link == null || tagOrPointId == null || tagOrPointId.isBlank()) return null;
    DataPoint byTag = null;
    for (DataPoint point : link.definition().points()) {
      if (tagOrPointId.equals(point.id())) return point;
      if (byTag == null && tagOrPointId.equals(point.tagId())) byTag = point;
    }
    if (byTag != null) return byTag;
    if (link.definition().pointIds().contains(tagOrPointId)) {
      return new DataPoint(
          tagOrPointId, 0, 0, "", null, null, 1, 0, null, "", "", "", "", tagOrPointId);
    }
    return null;
  }

  /**
   * 找不到链路或点时返回明确错误。驱动抛出的 TIMEOUT、AUTH、CONFIG 原样带上类别和原因。
   * timeoutMs 小于等于 0 时用链路自己的响应超时。
   */
  public WriteOutcome write(
      String linkId, String pointId, Object value, String key, long timeoutMs) {
    if (linkId == null || linkId.isBlank()) {
      return WriteOutcome.fail("CONFIG", "linkId required");
    }
    LinkSupervisor link = links.get(linkId);
    if (link == null) return WriteOutcome.fail("CONFIG", "link not found: " + linkId);
    if (pointFor(linkId, pointId) == null) {
      return WriteOutcome.fail("CONFIG", "point not found: " + pointId);
    }
    String id = pointFor(linkId, pointId).id();
    try {
      link.write(id, value, key, timeoutMs);
      return WriteOutcome.success();
    } catch (IllegalStateException ex) {
      return WriteOutcome.fail("CONFIG", ex.getMessage());
    } catch (CommException ex) {
      String category = ex.category() == null ? "PROTOCOL" : ex.category().name();
      return WriteOutcome.fail(category, ex.getMessage() == null ? category : ex.getMessage());
    }
  }

  public Map<String, Object> snapshot(String linkId) {
    LinkSupervisor link = links.get(linkId);
    if (link == null) return Map.of();
    return link.stats().snapshot();
  }

  /** 校验失败则保留旧配置，并且不通知 Supervisor，当前生效地址不变。 */
  public boolean reload(List<LinkDefinition> next, List<String> errors) {
    if (!store.replace(next, errors)) return false;
    for (LinkDefinition link : store.current()) {
      ModbusTcpDriver existing = modbus.get(link.id());
      if (existing != null) existing.rebind(link);
      OpcUaDriver ua = opcua.get(link.id());
      if (ua != null) ua.rebind(link);
      MqttDriver mq = mqtt.get(link.id());
      if (mq != null) mq.rebind(link);
      HttpDriver httpDriver = http.get(link.id());
      if (httpDriver != null) httpDriver.rebind(link);
      LinkSupervisor supervisor = links.get(link.id());
      if (supervisor != null) supervisor.requestReload(link);
    }
    for (Runnable hook : reloadHooks) hook.run();
    return true;
  }

  private LinkSupervisor newSupervisor(LinkDefinition link, ProtocolDriver driver) {
    LinkStats stats = new LinkStats();
    LinkLog linkLog =
        new LinkLog(
            link.id(),
            link.deviceId(),
            link.protocol(),
            clock,
            sink == null ? LinkLog.slf4j(link.id()) : sink);
    CallbackDispatcher dispatcher = new CallbackDispatcher(Math.max(1, queueSize), stats);
    dispatchers.add(dispatcher);
    LinkSupervisor supervisor =
        new LinkSupervisor(
        link,
        driver,
        scheduler,
        io,
        clock,
        lock,
        linkLog,
        stats,
        new PointCache(),
        dispatcher,
        random,
        graceMs);
    supervisor.setListener(listener);
    return supervisor;
  }

  public record WriteOutcome(boolean ok, String category, String message) {
    public static WriteOutcome success() {
      return new WriteOutcome(true, "", "");
    }

    public static WriteOutcome fail(String category, String message) {
      return new WriteOutcome(false, category == null ? "" : category, message == null ? "" : message);
    }
  }

  @Override
  public void close() {
    for (LinkSupervisor link : links.values()) {
      try {
        link.stop();
      } catch (RuntimeException ex) {
        log.warn("stop {} failed: {}", link.id(), ex.toString());
      }
    }
    for (CallbackDispatcher dispatcher : dispatchers) dispatcher.close();
    if (ownIo) io.close();
    scheduler.close();
  }
}
