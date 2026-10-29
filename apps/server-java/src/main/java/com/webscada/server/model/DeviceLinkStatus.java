package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 设备链路状态。运行时计算，不写入设备配置。 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DeviceLinkStatus(
    String deviceId, boolean online, String state, Long checkedAt, String message) {}
