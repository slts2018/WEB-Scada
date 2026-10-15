package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 历史存档。对象缺省表示沿用旧行为：setTagValue 记一条，模拟抖动不记。
 * mode=legacy 只在保存时出现，落库前会清成 null。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TagHistory(Boolean enabled, String mode, Integer intervalMs, Double deadband) {}
