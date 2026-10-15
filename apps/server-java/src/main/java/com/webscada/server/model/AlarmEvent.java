package com.webscada.server.model;

/** 报警事件。触发、恢复、确认各一行，不是每个采集周期。 */
public record AlarmEvent(
    String alarmId,
    String tagId,
    String name,
    String level,
    String kind,
    String eventKind,
    String message,
    String valueText,
    String quality,
    long eventAt) {}
