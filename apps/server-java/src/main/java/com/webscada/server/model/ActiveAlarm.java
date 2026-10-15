package com.webscada.server.model;

public record ActiveAlarm(
    String alarmId,
    String tagId,
    String name,
    String level,
    String message,
    Object value,
    String quality,
    long raisedAt,
    long updatedAt,
    /** 条件是否仍成立。为 false 且已确认时，这一行不在实时表上。 */
    boolean active,
    boolean acked,
    Long clearedAt,
    Long ackedAt) {}
