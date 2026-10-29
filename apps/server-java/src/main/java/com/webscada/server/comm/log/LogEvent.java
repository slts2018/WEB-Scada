package com.webscada.server.comm.log;

/** 结构化日志。sessionId、correlationId 始终占位，没有时为空串。 */
public record LogEvent(
    String ts,
    String level,
    String linkId,
    String deviceId,
    String protocol,
    String direction,
    String sessionId,
    String correlationId,
    String event,
    String code,
    String detail,
    Long durationMs,
    Integer attempt) {}
