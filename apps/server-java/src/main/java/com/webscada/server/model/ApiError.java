package com.webscada.server.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String error, String detail, String message, String deviceId) {
  public static ApiError of(String error) {
    return new ApiError(error, null, null, null);
  }

  public static ApiError of(String error, String detail) {
    return new ApiError(error, detail, null, null);
  }
}
