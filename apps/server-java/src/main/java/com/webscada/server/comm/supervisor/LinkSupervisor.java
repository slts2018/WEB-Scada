package com.webscada.server.comm.supervisor;

import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.PointCache;
import com.webscada.server.comm.data.PointSample;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import com.webscada.server.comm.event.CallbackDispatcher;
import com.webscada.server.comm.event.LinkEvents;
import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.metrics.LinkStats;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.state.ConnectionStateMachine;
import com.webscada.server.comm.state.ConnectionStateMachine.Signal;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.LockSupport;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.DoubleSupplier;

/**
 * 一条链路的生命周期。tick 只做状态决策：不调用 Driver，也不等待锁。
 * 连接和读写都提交到 {@link LinkIoPool}。
 */
public final class LinkSupervisor {
  private static final int HEALTH_FAILS_TO_DROP = 3;
  /** 订阅连续失败这么多次后，交给链路重连。退避为 1s、2s、4s，上限 30s。 */
  private static final int SUBSCRIBE_FAILS_TO_RECONNECT = 4;
  private static final long SUBSCRIBE_RETRY_BASE_MS = 1_000L;
  private static final long SUBSCRIBE_RETRY_MAX_MS = 30_000L;

  private final ProtocolDriver driver;
  private final LinkScheduler scheduler;
  private final LinkIoPool io;
  private final Clock clock;
  private final InProcessLinkLock lock;
  private final LinkStats stats;
  private final LinkLog log;
  private final PointCache points;
  private final CallbackDispatcher dispatcher;
  private final ConnectionStateMachine machine;
  private final DoubleSupplier random;
  private final long graceMs;
  private final ConcurrentLinkedQueue<Note> notes = new ConcurrentLinkedQueue<>();
  private final AtomicReference<LinkDefinition> pendingReload = new AtomicReference<>();
  private final AtomicInteger endpointIndex = new AtomicInteger();
  private final AtomicInteger ioGen = new AtomicInteger();
  private final AtomicBoolean startRequested = new AtomicBoolean();
  private final AtomicBoolean stopRequested = new AtomicBoolean();
  private final AtomicBoolean forceRelease = new AtomicBoolean();
  private final AtomicBoolean held = new AtomicBoolean();

  private volatile LinkDefinition definition;
  private volatile CountDownLatch done = new CountDownLatch(1);
  private volatile boolean cleanupDone = true;
  private volatile boolean alignPending;
  private volatile boolean probeArmed = true;
  private volatile boolean stableCleared;
  private volatile int connectFailures;
  private volatile int handshakeFailures;
  private volatile long handshakeStartAt = -1;
  private volatile boolean handshakeReady;
  private volatile boolean holdHandshake;
  private volatile int consecutiveHealthFails;
  private volatile int failoverStreak;
  /** 健康检查的 CONFIG（路径配错）只记一次，避免把配置错误打成断线重连。 */
  private boolean healthConfigLogged;
  private volatile long nextReadAt = Long.MAX_VALUE;
  private final SubscriptionInbox inbox;
  private final AtomicReference<Subscription> liveSub = new AtomicReference<>();
  private volatile boolean subscriptionActive;
  private volatile long lastNotifyAt;
  private volatile boolean rebuilding;
  private volatile boolean pendingRebuild;
  private volatile int subscribeFails;
  private volatile long nextRebuildAt;
  private volatile long nextAttemptAt;
  private volatile long nextHealthAt;
  private volatile long nextProbeAt = Long.MAX_VALUE;
  private volatile long runningSince;
  private volatile long ioStartedAt;
  private volatile int ioKind;
  private volatile String sessionId = "";
  private final AtomicBoolean stopFinished = new AtomicBoolean(true);

  public LinkSupervisor(
      LinkDefinition definition,
      ProtocolDriver driver,
      LinkScheduler scheduler,
      LinkIoPool io,
      Clock clock,
      InProcessLinkLock lock,
      LinkLog log,
      LinkStats stats,
      PointCache points,
      CallbackDispatcher dispatcher,
      DoubleSupplier random,
      long graceMs) {
    this.definition = definition;
    this.inbox = new SubscriptionInbox(Math.max(1, driver.notificationQueueSize(definition)));
    this.driver = driver;
    this.scheduler = scheduler;
    this.io = io;
    this.clock = clock;
    this.lock = lock;
    this.log = log;
    this.stats = stats;
    this.points = points;
    this.dispatcher = dispatcher;
    this.random = random == null ? Math::random : random;
    this.graceMs = graceMs;
    this.machine = new ConnectionStateMachine(stats, log, clock.millis());
    points.seed(definition.pointIds(), clock.millis());
    publishEndpoint();
    scheduler.register(this::onTick);
  }

  public String id() {
    return definition.id();
  }

  public ConnectionState state() {
    return machine.state();
  }

  public LinkDefinition definition() {
    return definition;
  }

  public LinkDefinition.Endpoint activeEndpoint() {
    return definition.endpoint(endpointIndex.get());
  }

  public LinkStats stats() {
    return stats;
  }

  public PointCache points() {
    return points;
  }

  public void setStrict(boolean strict) {
    machine.setStrict(strict);
  }

  public boolean start() {
    if (!lock.tryAcquire(definition.id())) return false;
    held.set(true);
    stopFinished.set(false);
    stopRequested.set(false);
    forceRelease.set(false);
    done = new CountDownLatch(1);
    startRequested.set(true);
    scheduler.requestTick();
    return true;
  }

  /** 不得从 tick 线程调用。等待 grace 后仍未停则强制释放。 */
  public void stop() {
    if (scheduler.isTickThread()) {
      throw new IllegalStateException("stop() must not be called from the tick thread");
    }
    if (stopFinished.get() && !held.get()) {
      endpointIndex.set(0);
      publishEndpoint();
      return;
    }
    startRequested.set(false);
    stopRequested.set(true);
    scheduler.requestTick();
    if (!awaitDone(graceMs)) {
      forceRelease.set(true);
      ioGen.incrementAndGet();
      io.cancel(definition.id());
      scheduler.requestTick();
      awaitDone(1000);
    }
    if (held.compareAndSet(true, false)) lock.release(definition.id());
  }

  public void requestReload(LinkDefinition next) {
    pendingReload.set(next);
    scheduler.requestTick();
  }

  public void setListener(com.webscada.server.comm.event.LinkListener listener) {
    dispatcher.setListener(listener);
  }

  /**
   * 在 IO 池上执行 driver.write，并在调用线程等待。禁止从 tick 线程调用，否则会和 IO 完成回调互相卡住。
   * timeoutMs 小于等于 0 时用链路的 responseTimeoutMs。
   */
  public IoResult write(String pointId, Object value, String idempotencyKey, long timeoutMs)
      throws CommException {
    if (scheduler.isTickThread()) {
      throw new IllegalStateException("write() must not be called from the tick thread");
    }
    if (pointId == null || pointId.isBlank()) {
      throw CommException.of(ErrorCategory.CONFIG, "pointId required");
    }
    long budget = timeoutMs > 0 ? timeoutMs : Math.max(1, definition.responseTimeoutMs());
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budget);
    String correlation = idempotencyKey == null ? "" : idempotencyKey;
    CompletableFuture<IoResult> future = new CompletableFuture<>();
    boolean submitted = false;
    while (!submitted) {
      String sid = sessionId;
      submitted =
          io.submit(
              definition.id(),
              () -> {
                try {
                  IoResult result =
                      driver.write(
                          context(sid, correlation, activeEndpoint()),
                          new IoRequest(correlation, pointId, value));
                  if (result == null) {
                    future.completeExceptionally(
                        CommException.of(ErrorCategory.PROTOCOL, "write returned null"));
                  } else if (result.error() != null) {
                    future.completeExceptionally(result.error());
                  } else if (!result.ok()) {
                    future.completeExceptionally(
                        CommException.of(ErrorCategory.DEVICE, "write rejected"));
                  } else {
                    future.complete(result);
                  }
                } catch (CommException ex) {
                  future.completeExceptionally(ex);
                } catch (RuntimeException ex) {
                  future.completeExceptionally(CommException.of(ErrorCategory.PROTOCOL, ex.toString()));
                }
              },
              scheduler::requestTick);
      if (submitted) break;
      if (System.nanoTime() >= deadline) {
        throw new CommException(ErrorCategory.TIMEOUT, true, false, "write timed out waiting for io");
      }
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(2));
    }
    long left = deadline - System.nanoTime();
    if (left <= 0) {
      io.cancel(definition.id());
      throw new CommException(ErrorCategory.TIMEOUT, true, false, "write timed out");
    }
    try {
      return future.get(left, TimeUnit.NANOSECONDS);
    } catch (TimeoutException ex) {
      io.cancel(definition.id());
      throw new CommException(ErrorCategory.TIMEOUT, true, false, "write timed out");
    } catch (ExecutionException ex) {
      Throwable cause = ex.getCause();
      if (cause instanceof CommException comm) throw comm;
      throw CommException.of(
          ErrorCategory.PROTOCOL, cause == null ? "write failed" : cause.toString());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      io.cancel(definition.id());
      throw new CommException(ErrorCategory.TIMEOUT, true, false, "write interrupted");
    }
  }

  public void onTick() {
    long now = clock.millis();
    applyReload(now);
    if (forceRelease.get() && machine.state() != ConnectionState.STOPPED) {
      forceStop(now);
      return;
    }
    drain(now);
    if (stopRequested.get()
        && machine.state() != ConnectionState.STOPPING
        && machine.state() != ConnectionState.STOPPED) {
      move(Signal.STOP, "stop", "", now);
      submitDisconnect();
      return;
    }
    switch (machine.state()) {
      case DISCONNECTED, STOPPED -> {
        if (startRequested.compareAndSet(true, false) && move(Signal.START, "start", "", now)) {
          submitConnect(false);
        }
      }
      case CONNECTING -> {
        if (!connectTimedOut(now)) submitConnect(false);
      }
      case RECONNECTING -> {
        if (!cleanupDone) submitDisconnect();
        else if (now >= nextAttemptAt && move(Signal.BACKOFF_ELAPSED, "backoff elapsed", "", now)) {
          submitConnect(false);
        }
      }
      case FAILED -> {
        if (probeArmed && now >= nextProbeAt) submitConnect(true);
      }
      case RUNNING, DEGRADED -> {
        observeSubscription(now);
        drainPushes(now);
        tryRebuild(now);
        clearStable(now);
        int stale = points.applyStale(now, definition.staleTimeoutMs());
        if (stale > 0) emitData(now);
        if (alignPending || now >= nextReadAt) submitRead();
        else if (now >= nextHealthAt) submitHealth();
      }
      case HANDSHAKE -> finishHandshake(now);
      case STOPPING -> {}
      default -> {}
    }
  }

  private void applyReload(long now) {
    LinkDefinition next = pendingReload.getAndSet(null);
    if (next == null) return;
    definition = next;
    endpointIndex.set(0);
    publishEndpoint();
    log.info(
        "config_reload",
        "PRIMARY",
        endpointText() + " reset to primary",
        null,
        null,
        sessionId,
        "");
    ConnectionState st = machine.state();
    if (st == ConnectionState.RUNNING) {
      move(Signal.IO_FAIL, "config reload", "", now);
      beginReconnect("config reload", true, now);
    } else if (st == ConnectionState.DEGRADED) {
      move(Signal.GIVE_UP, "config reload", "", now);
      beginReconnect("config reload", true, now);
    }
  }

  private void drain(long now) {
    Note note;
    while ((note = notes.poll()) != null) {
      if (note.generation != ioGen.get()) continue;
      switch (note.kind) {
        case Note.CONNECT -> onConnect(note, now);
        case Note.DISCONNECT -> onDisconnect(now);
        case Note.HEALTH -> onHealth(note, now);
        case Note.READ -> onRead(note, now);
        case Note.SUBSCRIBE -> dropLink(now, note.error == null ? "subscribe failed" : note.error.getMessage());
        default -> {}
      }
    }
  }

  private void onConnect(Note note, long now) {
    if (note.probe && machine.state() == ConnectionState.FAILED) {
      if (note.error == null) {
        if (move(Signal.PROBE_OK, "probe ok", note.correlationId, now)) armHandshake(now);
      } else {
        remember(note.error);
        if (!note.error.retryable()) probeArmed = false;
        nextProbeAt = now + definition.failedProbeMs();
        emitError(note.error, now);
      }
      return;
    }
    if (note.error == null) {
      if (move(Signal.CONNECT_OK, "connect ok", note.correlationId, now)) armHandshake(now);
      return;
    }
    remember(note.error);
    emitError(note.error, now);
    if (note.error.category() == ErrorCategory.HANDSHAKE) {
      handshakeFailures++;
      noteStreak(note.error);
      if (shouldFailover(note.error)) advanceEndpoint(note.error);
      move(Signal.CONNECT_OK, "tcp up", note.correlationId, now);
      move(Signal.HANDSHAKE_FAIL, note.error.getMessage(), note.correlationId, now);
    } else {
      connectFailures++;
      noteStreak(note.error);
      if (shouldFailover(note.error)) advanceEndpoint(note.error);
      move(Signal.CONNECT_FAIL, note.error.getMessage(), note.correlationId, now);
    }
    beginReconnect(note.error.getMessage(), note.error.retryable(), now);
  }

  private void onDisconnect(long now) {
    cleanupDone = true;
    if (machine.state() == ConnectionState.STOPPING) finishStop(now, "released");
  }

  private void onHealth(Note note, long now) {
    if (note.error != null) {
      if (note.error.category() == ErrorCategory.CONFIG) {
        noteHealthConfig(note, now);
        scheduleNextHealth(now);
        return;
      }
      remember(note.error);
      emitError(note.error, now);
      if (note.error.category() == ErrorCategory.PROTOCOL) {
        dropLink(now, note.error.getMessage());
        return;
      }
      failHealth(now, note.error.getMessage());
      scheduleNextHealth(now);
      return;
    }
    if (note.health == Health.OK) {
      healthConfigLogged = false;
      consecutiveHealthFails = 0;
      failoverStreak = 0;
      stats.lastSuccess(now);
      if (machine.state() == ConnectionState.DEGRADED) {
        move(Signal.RECOVER, "health recovered", note.correlationId, now);
      }
      scheduleNextHealth(now);
      return;
    }
    if (note.health == Health.FAILED) stats.timeouts().increment();
    failHealth(now, "health " + note.health);
    scheduleNextHealth(now);
  }

  private void onRead(Note note, long now) {
    alignPending = false;
    scheduleNextRead(now);
    if (note.error != null) {
      remember(note.error);
      emitError(note.error, now);
      if (note.error.category() == ErrorCategory.PROTOCOL) {
        dropLink(now, note.error.getMessage());
        return;
      }
      if (note.error.category() == ErrorCategory.TIMEOUT) {
        failoverStreak++;
        if (maybeSwitch(note.error)) {
          dropLink(now, note.error.getMessage());
          return;
        }
      }
      points.applyRead(List.of(), now);
      emitData(now);
      return;
    }
    failoverStreak = 0;
    if (applyUpdates(note.result == null ? List.of() : note.result.points(), now)) emitData(now);
  }

  /** @return 这次写入了至少一个点 */
  private boolean applyUpdates(List<IoResult.PointUpdate> updates, long now) {
    List<String> good = new ArrayList<>();
    List<IoResult.PointUpdate> rest = new ArrayList<>();
    boolean anyGood = false;
    for (IoResult.PointUpdate update : updates) {
      Quality q = update.quality() == null ? Quality.GOOD : update.quality();
      if (q == Quality.GOOD) {
        points.putValue(update.pointId(), update.value(), Quality.GOOD, update.sourceTs(), now);
        good.add(update.pointId());
        anyGood = true;
      } else {
        rest.add(update);
      }
    }
    points.applyRead(good, now);
    for (IoResult.PointUpdate update : rest) {
      Quality q = update.quality() == null ? Quality.GOOD : update.quality();
      Object value = q == Quality.UNCERTAIN || q == Quality.STALE ? update.value() : null;
      points.putValue(update.pointId(), value, q, update.sourceTs(), now);
    }
    if (anyGood) stats.lastSuccess(now);
    return updates != null && !updates.isEmpty();
  }

  /** 400/404/405 和 healthPath 配错是配置问题，不进 failoverStreak，也不重连。 */
  private void noteHealthConfig(Note note, long now) {
    if (healthConfigLogged) return;
    healthConfigLogged = true;
    remember(note.error);
    emitError(note.error, now);
    log.error(
        "health_config",
        "CONFIG",
        note.error.getMessage(),
        null,
        1,
        sessionId,
        note.correlationId);
  }

  private void failHealth(long now, String reason) {
    consecutiveHealthFails++;
    failoverStreak++;
    maybeSwitch(new CommException(ErrorCategory.TIMEOUT, true, true, reason));
    ConnectionState st = machine.state();
    if (st == ConnectionState.RUNNING) {
      move(Signal.DEGRADE, reason, "", now);
      return;
    }
    if (st == ConnectionState.DEGRADED && consecutiveHealthFails >= HEALTH_FAILS_TO_DROP) {
      move(Signal.GIVE_UP, reason, "", now);
      beginReconnect(reason, true, now);
    }
  }

  /** 测试用：connect 成功后停在 HANDSHAKE，直到握手超时。 */
  void holdHandshake() {
    holdHandshake = true;
  }

  private void armHandshake(long now) {
    handshakeStartAt = now;
    handshakeReady = !holdHandshake;
  }

  private void finishHandshake(long now) {
    int timeout = Math.max(1, definition.handshakeTimeoutMs());
    if (handshakeStartAt >= 0 && now - handshakeStartAt >= timeout) {
      handshakeReady = false;
      handshakeStartAt = -1;
      handshakeFailures++;
      CommException error =
          new CommException(ErrorCategory.HANDSHAKE, true, true, "handshake timeout");
      remember(error);
      emitError(error, now);
      noteStreak(error);
      if (shouldFailover(error)) advanceEndpoint(error);
      move(Signal.HANDSHAKE_FAIL, "handshake timeout", "", now);
      beginReconnect("handshake timeout", true, now);
      return;
    }
    if (!handshakeReady) return;
    handshakeReady = false;
    handshakeStartAt = -1;
    move(Signal.HANDSHAKE_OK, "handshake ok", "", now);
    enterRunning(now);
  }

  private void enterRunning(long now) {
    runningSince = now;
    stableCleared = false;
    consecutiveHealthFails = 0;
    failoverStreak = 0;
    alignPending = true;
    nextHealthAt = now + Math.max(1, definition.heartbeatIntervalMs());
    lastNotifyAt = now;
    if (driver.supportsSubscription()) {
      subscribeFails = 0;
      pendingRebuild = true;
      nextRebuildAt = now;
      tryRebuild(now);
    }
    cleanupDone = true;
    stats.lastSuccess(now);
    publishEndpoint();
    log.info(
        "link_up",
        "RUNNING",
        endpointText(),
        null,
        null,
        sessionId,
        "");
  }

  private void beginReconnect(String reason, boolean retryable, long now) {
    points.markAll(Quality.BAD_COMM_FAILURE, now);
    emitData(now);
    cleanupDone = false;
    alignPending = false;
    int attempt = Math.max(connectFailures, handshakeFailures);
    long delay =
        Backoff.delayMs(
            Math.max(0, attempt - 1),
            definition.reconnectBaseMs(),
            definition.reconnectMaxMs(),
            definition.jitter(),
            random);
    nextAttemptAt = now + delay;
    stats.reconnectTotal().increment();
    log.warn(
        "reconnect",
        "RECONNECTING",
        reason + " " + endpointText(),
        delay,
        attempt,
        sessionId,
        "");
    boolean exhausted =
        connectFailures >= definition.connectMaxAttempts()
            || handshakeFailures >= definition.handshakeMaxAttempts();
    if (!retryable || exhausted) {
      move(Signal.MAX_ATTEMPTS, exhausted ? "max attempts" : "not retryable", "", now);
      probeArmed = retryable;
      nextProbeAt = retryable ? now + definition.failedProbeMs() : Long.MAX_VALUE;
      submitDisconnect();
      return;
    }
    submitDisconnect();
  }

  private void clearStable(long now) {
    if (machine.state() != ConnectionState.RUNNING || stableCleared) return;
    if (now - runningSince < definition.stablePeriodMs()) return;
    connectFailures = 0;
    handshakeFailures = 0;
    stableCleared = true;
    log.info("reconnect_count_cleared", "STABLE", "stablePeriod elapsed", null, 0, sessionId, "");
  }

  private void noteStreak(CommException error) {
    ErrorCategory category = error.category();
    boolean counted =
        error.failoverAllowed()
            && (category == ErrorCategory.CONNECT
                || category == ErrorCategory.TIMEOUT
                || category == ErrorCategory.HANDSHAKE);
    if (counted) failoverStreak++;
    else failoverStreak = 0;
  }

  private boolean maybeSwitch(CommException error) {
    if (definition.endpoints().size() < 2) return false;
    int need = definition.failoverThreshold();
    if (need < 1) need = 3;
    if (failoverStreak < need) return false;
    int before = endpointIndex.get();
    advanceEndpoint(error);
    return endpointIndex.get() != before;
  }

  private boolean shouldFailover(CommException error) {
    if (!error.failoverAllowed() || definition.endpoints().size() < 2) return false;
    ErrorCategory category = error.category();
    if (category != ErrorCategory.CONNECT
        && category != ErrorCategory.TIMEOUT
        && category != ErrorCategory.HANDSHAKE) {
      return false;
    }
    int need = definition.failoverThreshold();
    if (need < 1) need = 3;
    return failoverStreak >= need;
  }

  private void advanceEndpoint(CommException error) {
    int current = endpointIndex.get();
    int last = definition.endpoints().size() - 1;
    if (current >= last) {
      log.warn(
          "endpoint_failover",
          error.category().name(),
          "stay on last " + endpointText(),
          null,
          null,
          sessionId,
          "");
      return;
    }
    endpointIndex.set(current + 1);
    failoverStreak = 0;
    publishEndpoint();
    log.warn(
        "endpoint_failover",
        error.category().name(),
        "stick to " + endpointText(),
        null,
        null,
        sessionId,
        "");
  }

  private boolean connectTimedOut(long now) {
    if (ioKind != Note.CONNECT || !io.busy(definition.id())) return false;
    if (now - ioStartedAt < definition.connectTimeoutMs()) return false;
    ioGen.incrementAndGet();
    io.cancel(definition.id());
    CommException timeout =
        new CommException(ErrorCategory.TIMEOUT, true, true, "connect timeout");
    onConnect(Note.fail(Note.CONNECT, ioGen.get(), timeout, false, "timeout"), now);
    return true;
  }

  private void submitConnect(boolean probe) {
    if (io.busy(definition.id())) return;
    int gen = ioGen.incrementAndGet();
    ioKind = Note.CONNECT;
    ioStartedAt = clock.millis();
    String sid = UUID.randomUUID().toString();
    sessionId = sid;
    stats.session(sid);
    String correlation = "connect-" + gen;
    LinkDefinition.Endpoint ep = activeEndpoint();
    publishEndpoint();
    DriverContext ctx = context(sid, correlation, ep);
    long started = System.nanoTime();
    boolean ok =
        io.submit(
            definition.id(),
            () -> {
              stats.txFrames().increment();
              try {
                driver.connect(ctx);
                stats.connectDuration(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
                stats.rxFrames().increment();
                stats.recordLatency(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
                notes.add(Note.ok(Note.CONNECT, gen, probe, correlation));
              } catch (CommException ex) {
                stats.rxFrames().increment();
                notes.add(Note.fail(Note.CONNECT, gen, ex, probe, correlation));
              } catch (RuntimeException ex) {
                notes.add(
                    Note.fail(
                        Note.CONNECT,
                        gen,
                        CommException.of(ErrorCategory.RESOURCE, ex.toString()),
                        probe,
                        correlation));
              }
            },
            scheduler::requestTick);
    if (!ok) ioGen.compareAndSet(gen, gen - 1);
  }

  private void submitDisconnect() {
    if (io.busy(definition.id())) return;
    if (cleanupDone && machine.state() != ConnectionState.STOPPING) return;
    pendingRebuild = false;
    int gen = ioGen.incrementAndGet();
    ioKind = Note.DISCONNECT;
    Subscription old = liveSub.getAndSet(null);
    subscriptionActive = false;
    boolean ok =
        io.submit(
            definition.id(),
            () -> {
              try {
                if (old != null) old.cancel();
                driver.disconnect();
              } catch (RuntimeException ex) {
                log.warn("disconnect_failed", "DISCONNECT", ex.toString(), null, null, sessionId, "");
              }
              notes.add(Note.ok(Note.DISCONNECT, gen, false, "disconnect"));
            },
            scheduler::requestTick);
    if (!ok) ioGen.compareAndSet(gen, gen - 1);
  }

  private void submitHealth() {
    if (io.busy(definition.id())) return;
    int gen = ioGen.incrementAndGet();
    ioKind = Note.HEALTH;
    String correlation = "health-" + gen;
    DriverContext ctx = context(sessionId, correlation, activeEndpoint());
    long started = System.nanoTime();
    boolean ok =
        io.submit(
            definition.id(),
            () -> {
              stats.txFrames().increment();
              try {
                Health health = driver.healthCheck(ctx);
                stats.rxFrames().increment();
                stats.recordLatency(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
                notes.add(Note.health(gen, health, correlation));
              } catch (CommException ex) {
                notes.add(Note.fail(Note.HEALTH, gen, ex, false, correlation));
              }
            },
            scheduler::requestTick);
    if (ok) scheduleNextHealth(clock.millis());
    else ioGen.compareAndSet(gen, gen - 1);
  }

  private void submitRead() {
    if (io.busy(definition.id())) return;
    int gen = ioGen.incrementAndGet();
    ioKind = Note.READ;
    String correlation = "read-" + gen;
    DriverContext ctx = context(sessionId, correlation, activeEndpoint());
    boolean ok =
        io.submit(
            definition.id(),
            () -> {
              stats.txFrames().increment();
              try {
                IoResult result = driver.read(ctx, new IoRequest(correlation, "*", null));
                stats.rxFrames().increment();
                notes.add(Note.read(gen, result, correlation));
              } catch (CommException ex) {
                notes.add(Note.fail(Note.READ, gen, ex, false, correlation));
              }
            },
            scheduler::requestTick);
    if (!ok) ioGen.compareAndSet(gen, gen - 1);
  }

  private void dropLink(long now, String reason) {
    ConnectionState st = machine.state();
    boolean moved = false;
    if (st == ConnectionState.RUNNING) moved = move(Signal.IO_FAIL, reason, "", now);
    else if (st == ConnectionState.DEGRADED) moved = move(Signal.GIVE_UP, reason, "", now);
    if (moved) beginReconnect(reason, true, now);
  }

  private void scheduleNextRead(long now) {
    long interval = driver.resyncIntervalMs(definition);
    if (interval <= 0) {
      nextReadAt = Long.MAX_VALUE;
      return;
    }
    nextReadAt = now + interval;
  }

  private void onPush(IoResult result) {
    int lost = inbox.offer(result);
    for (int i = 0; i < lost; i++) stats.dropped().increment();
    scheduler.requestTick();
  }

  private void observeSubscription(long now) {
    if (liveSub.get() != null && !subscriptionActive) {
      subscriptionActive = true;
      lastNotifyAt = now;
      rebuilding = false;
    }
  }

  private void drainPushes(long now) {
    boolean changed = false;
    for (IoResult result : inbox.drain()) {
      if (result.error() != null && "subscription silent".equals(result.error().getMessage())) {
        requestRebuild(now);
        continue;
      }
      lastNotifyAt = now;
      if (result.points() != null && !result.points().isEmpty() && applyUpdates(result.points(), now)) {
        changed = true;
      }
    }
    long silence = silenceLimitMs();
    if (subscriptionActive && !rebuilding && !pendingRebuild && silence > 0 && now - lastNotifyAt >= silence) {
      requestRebuild(now);
    }
    if (changed) emitData(now);
  }

  private long silenceLimitMs() {
    return driver.silenceTimeoutMs(definition);
  }

  private void requestRebuild(long now) {
    if (!driver.supportsSubscription()) return;
    if (!pendingRebuild) {
      pendingRebuild = true;
      nextRebuildAt = now;
    }
    tryRebuild(now);
  }

  /**
   * IO 正忙时保留 liveSub 和 subscriptionActive，只留下 pendingRebuild，下一拍再试。
   * 句柄要在 IO 任务里先 cancel，再 getAndSet(null)。
   */
  private void tryRebuild(long now) {
    if (!pendingRebuild || rebuilding || now < nextRebuildAt) return;
    if (!driver.supportsSubscription()) {
      pendingRebuild = false;
      return;
    }
    if (io.busy(definition.id())) return;
    rebuilding = true;
    if (liveSub.get() != null) {
      log.warn("subscription_silent", "SUBSCRIBE", "rebuild subscription", null, null, sessionId, "");
    }
    int gen = ioGen.incrementAndGet();
    String correlation = "sub-" + gen;
    boolean ok =
        io.submit(
            definition.id(),
            () -> {
              Subscription created = null;
              try {
                Subscription old = liveSub.get();
                if (old != null) old.cancel();
                liveSub.getAndSet(null);
                subscriptionActive = false;
                created =
                    driver.subscribe(
                        context(sessionId, correlation, activeEndpoint()),
                        new IoRequest(correlation, "*", null),
                        this::onPush);
                if (gen != ioGen.get()) {
                  created.cancel();
                  return;
                }
                liveSub.set(created);
                subscribeFails = 0;
                pendingRebuild = false;
                alignPending = true;
              } catch (CommException ex) {
                onSubscribeFailed(gen, ex);
              } catch (RuntimeException ex) {
                onSubscribeFailed(gen, new CommException(ErrorCategory.CONNECT, true, true, ex.toString(), ex));
              } finally {
                rebuilding = false;
              }
            },
            scheduler::requestTick);
    if (!ok) {
      rebuilding = false;
      ioGen.compareAndSet(gen, gen - 1);
    }
  }

  private void onSubscribeFailed(int gen, CommException error) {
    subscribeFails++;
    alignPending = true;
    if (subscribeFails >= SUBSCRIBE_FAILS_TO_RECONNECT) {
      pendingRebuild = false;
      log.error(
          "subscribe_failed",
          "SUBSCRIBE",
          "subscribe failed, reconnect",
          null,
          subscribeFails,
          sessionId,
          "");
      notes.add(Note.fail(Note.SUBSCRIBE, gen, error, false, "sub-" + gen));
      return;
    }
    long delay = subscribeRetryDelayMs(subscribeFails);
    nextRebuildAt = clock.millis() + delay;
    pendingRebuild = true;
    log.warn(
        "subscribe_failed",
        "SUBSCRIBE",
        "retry in " + delay + "ms",
        delay,
        subscribeFails,
        sessionId,
        "");
  }

  static long subscribeRetryDelayMs(int fails) {
    long delay = SUBSCRIBE_RETRY_BASE_MS;
    for (int i = 1; i < fails; i++) {
      if (delay >= SUBSCRIBE_RETRY_MAX_MS) return SUBSCRIBE_RETRY_MAX_MS;
      delay = Math.min(SUBSCRIBE_RETRY_MAX_MS, delay * 2);
    }
    return delay;
  }

  private void scheduleNextHealth(long now) {
    int interval = definition.heartbeatIntervalMs();
    if (machine.state() == ConnectionState.DEGRADED) interval = Math.max(1, interval / 2);
    nextHealthAt = now + interval;
  }

  private DriverContext context(String sid, String correlation, LinkDefinition.Endpoint ep) {
    return new DriverContext(
        definition.id(),
        sid,
        correlation,
        ep,
        definition.connectTimeoutMs(),
        definition.responseTimeoutMs(),
        log,
        stats,
        clock);
  }

  private void remember(CommException error) {
    if (error.category() == ErrorCategory.TIMEOUT) stats.timeouts().increment();
    else if (error.category() == ErrorCategory.PROTOCOL) stats.protocolErrors().increment();
    else if (error.category() == ErrorCategory.CONFIG) stats.decodeErrors().increment();
  }

  private void emitError(CommException error, long now) {
    dispatcher.emit(
        new LinkEvents.ErrorOccurred(
            definition.id(), error.category(), error.category().name(), error.getMessage(), now));
  }

  private void emitData(long now) {
    List<PointSample> snap = points.snapshot();
    dispatcher.emit(new LinkEvents.DataReceived(definition.id(), snap, now));
  }

  private boolean move(Signal signal, String reason, String correlationId, long now) {
    ConnectionState from = machine.state();
    boolean ok = machine.transition(signal, reason, now, sessionId, correlationId);
    if (!ok) return false;
    dispatcher.emit(
        new LinkEvents.StateChanged(definition.id(), from, machine.state(), reason, now));
    dispatcher.emit(new LinkEvents.StatsUpdated(definition.id(), stats.snapshot(), now));
    return true;
  }

  private void forceStop(long now) {
    ioGen.incrementAndGet();
    if (machine.state() != ConnectionState.STOPPING) {
      move(Signal.STOP, "force", "", now);
    }
    if (machine.state() == ConnectionState.STOPPING) {
      move(Signal.RELEASED, "force", "", now);
    }
    log.warn(
        "force_release",
        "WARN",
        "stop exceeded graceMs=" + graceMs + " " + endpointText(),
        graceMs,
        null,
        sessionId,
        "");
    finishStop(now, "forced");
  }

  private void finishStop(long now, String reason) {
    if (!stopFinished.compareAndSet(false, true)) return;
    endpointIndex.set(0);
    publishEndpoint();
    if (machine.state() != ConnectionState.STOPPED) {
      log.warn("stop_incomplete", reason, "state=" + machine.state(), null, null, sessionId, "");
    }
    log.info("link_down", "STOPPED", endpointText(), null, null, sessionId, "");
    done.countDown();
  }

  private void publishEndpoint() {
    LinkDefinition.Endpoint ep = activeEndpoint();
    stats.activeEndpoint(ep.host(), ep.port());
  }

  private String endpointText() {
    LinkDefinition.Endpoint ep = activeEndpoint();
    return ep.host() + ":" + ep.port();
  }

  private boolean awaitDone(long timeoutMs) {
    try {
      return done.await(Math.max(1, timeoutMs), TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return done.getCount() == 0;
    }
  }

  private static final class Note {
    static final int CONNECT = 1;
    static final int DISCONNECT = 2;
    static final int HEALTH = 3;
    static final int READ = 4;
    static final int SUBSCRIBE = 5;

    final int kind;
    final int generation;
    final CommException error;
    final IoResult result;
    final Health health;
    final boolean probe;
    final String correlationId;

    private Note(
        int kind,
        int generation,
        CommException error,
        IoResult result,
        Health health,
        boolean probe,
        String correlationId) {
      this.kind = kind;
      this.generation = generation;
      this.error = error;
      this.result = result;
      this.health = health;
      this.probe = probe;
      this.correlationId = correlationId;
    }

    static Note ok(int kind, int generation, boolean probe, String correlationId) {
      return new Note(kind, generation, null, null, null, probe, correlationId);
    }

    static Note fail(
        int kind, int generation, CommException error, boolean probe, String correlationId) {
      return new Note(kind, generation, error, null, null, probe, correlationId);
    }

    static Note health(int generation, Health health, String correlationId) {
      return new Note(Note.HEALTH, generation, null, null, health, false, correlationId);
    }

    static Note read(int generation, IoResult result, String correlationId) {
      return new Note(Note.READ, generation, null, result, null, false, correlationId);
    }
  }
}
