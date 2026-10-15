package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record DeviceMeta(
    String deviceId,
    String name,
    String protocol,
    String channel,
    boolean enabled,
    String description) {}
