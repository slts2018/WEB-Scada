package com.webscada.server.comm.log;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 脱敏后写入 SLF4J，并在内存保留最近一段。写出失败只降级到内存，不把异常抛给调用方。 */
public final class LinkLog {
  private static final int RING = 200;
  private static final Pattern SECRET =
      Pattern.compile(
          "(?i)(password|passwd|token|secret|api[-_]?key)\\s*[:=]\\s*(\"[^\"]*\"|\\S+)");
  private static final Pattern PEM =
      Pattern.compile(
          "-----BEGIN [^-]*PRIVATE KEY-----[\\s\\S]*?-----END [^-]*PRIVATE KEY-----");

  private final String linkId;
  private final String deviceId;
  private final String protocol;
  private final Clock clock;
  private final LogSink sink;
  private final ArrayDeque<LogEvent> ring = new ArrayDeque<>();
  private final AtomicBoolean diskWarned = new AtomicBoolean(false);
  private final Object ringLock = new Object();

  public LinkLog(
      String linkId, String deviceId, String protocol, Clock clock, LogSink sink) {
    this.linkId = linkId;
    this.deviceId = deviceId == null ? "" : deviceId;
    this.protocol = protocol == null ? "" : protocol;
    this.clock = clock;
    this.sink = sink;
  }

  public static LogSink slf4j(String linkId) {
    Logger logger = LoggerFactory.getLogger("com.webscada.server.comm." + linkId);
    return (event, json) -> {
      switch (event.level()) {
        case "ERROR" -> logger.error(json);
        case "WARN" -> logger.warn(json);
        case "DEBUG" -> logger.debug(json);
        case "TRACE" -> logger.trace(json);
        default -> logger.info(json);
      }
    };
  }

  public void info(
      String event,
      String code,
      String detail,
      Long durationMs,
      Integer attempt,
      String sessionId,
      String correlationId) {
    emit("INFO", "none", event, code, detail, durationMs, attempt, sessionId, correlationId);
  }

  public void warn(
      String event,
      String code,
      String detail,
      Long durationMs,
      Integer attempt,
      String sessionId,
      String correlationId) {
    emit("WARN", "none", event, code, detail, durationMs, attempt, sessionId, correlationId);
  }

  public void error(
      String event,
      String code,
      String detail,
      Long durationMs,
      Integer attempt,
      String sessionId,
      String correlationId) {
    emit("ERROR", "none", event, code, detail, durationMs, attempt, sessionId, correlationId);
  }

  public void debug(
      String event,
      String code,
      String detail,
      Integer attempt,
      String sessionId,
      String correlationId) {
    emit("DEBUG", "none", event, code, detail, null, attempt, sessionId, correlationId);
  }

  public static String redact(String text) {
    if (text == null || text.isEmpty()) return "";
    String s = PEM.matcher(text).replaceAll("***");
    return SECRET.matcher(s).replaceAll("$1=***");
  }

  public List<LogEvent> recent() {
    synchronized (ringLock) {
      return new ArrayList<>(ring);
    }
  }

  private void emit(
      String level,
      String direction,
      String event,
      String code,
      String detail,
      Long durationMs,
      Integer attempt,
      String sessionId,
      String correlationId) {
    LogEvent logEvent =
        new LogEvent(
            Instant.ofEpochMilli(clock.millis()).toString(),
            level,
            linkId,
            deviceId,
            protocol,
            direction,
            sessionId == null ? "" : sessionId,
            correlationId == null ? "" : correlationId,
            event == null ? "" : event,
            redact(code),
            redact(detail),
            durationMs,
            attempt);
    synchronized (ringLock) {
      ring.addLast(logEvent);
      while (ring.size() > RING) ring.removeFirst();
    }
    try {
      sink.accept(logEvent, toJson(logEvent));
    } catch (RuntimeException ex) {
      if (diskWarned.compareAndSet(false, true)) {
        LoggerFactory.getLogger(LinkLog.class)
            .warn("comm log sink failed linkId={} : {}", linkId, ex.toString());
      }
    }
  }

  static String toJson(LogEvent e) {
    return "{"
        + f("ts", e.ts())
        + ","
        + f("level", e.level())
        + ","
        + f("linkId", e.linkId())
        + ","
        + f("deviceId", e.deviceId())
        + ","
        + f("protocol", e.protocol())
        + ","
        + f("direction", e.direction())
        + ","
        + f("sessionId", e.sessionId())
        + ","
        + f("correlationId", e.correlationId())
        + ","
        + f("event", e.event())
        + ","
        + f("code", e.code())
        + ","
        + f("detail", e.detail())
        + ",\"durationMs\":"
        + (e.durationMs() == null ? "null" : e.durationMs())
        + ",\"attempt\":"
        + (e.attempt() == null ? "null" : e.attempt())
        + "}";
  }

  private static String f(String key, String value) {
    return "\"" + key + "\":\"" + esc(value) + "\"";
  }

  private static String esc(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
  }
}
