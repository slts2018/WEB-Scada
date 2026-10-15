package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TagValue(String tagId, Object value, String quality, long timestamp) {}
