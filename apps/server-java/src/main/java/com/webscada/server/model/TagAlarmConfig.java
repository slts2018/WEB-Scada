package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TagAlarmConfig(
    String alarmId,
    String tagId,
    String name,
    boolean enabled,
    String level,
    String kind,
    String limit,
    Double threshold,
    Double deadband,
    Boolean boolValue,
    String quality,
    double delaySec,
    Double target,
    Double windowSec,
    String expectText) {}
