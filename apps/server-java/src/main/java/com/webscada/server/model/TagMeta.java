package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TagMeta(
    String tagId,
    String name,
    String group,
    String deviceId,
    String address,
    String dataType,
    String unit,
    boolean writable,
    String description,
    TagSimulation simulation,
    String onText,
    String offText,
    Integer scanPeriodMs,
    Boolean pushEnabled,
    Integer pushPeriodMs,
    TagHistory history) {}
