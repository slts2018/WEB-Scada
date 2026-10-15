package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 模拟设备上单个变量的出值方式。规则与 packages/core/src/mock/simulate.ts 对齐。 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TagSimulation(
    boolean enabled,
    double periodSec,
    Double min,
    Double max,
    Double step,
    String options,
    String mode) {}
