package com.webscada.server.service;

public class PackageException extends RuntimeException {
  private final String code;

  public PackageException(String code) {
    super(code);
    this.code = code;
  }

  public PackageException(String code, String message) {
    super(message);
    this.code = code;
  }

  public String getCode() {
    return code;
  }
}
