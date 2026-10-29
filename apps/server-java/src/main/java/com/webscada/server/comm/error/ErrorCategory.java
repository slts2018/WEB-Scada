package com.webscada.server.comm.error;

/** 错误分类。默认重试/切地址供 {@link CommException} 的便捷构造使用，Supervisor 以异常上的字段为准。 */
public enum ErrorCategory {
  CONNECT(true, true),
  HANDSHAKE(true, true),
  AUTH(false, false),
  /** 是否切备用地址由 Supervisor 在连续多次之后决定。 */
  TIMEOUT(true, true),
  PROTOCOL(true, false),
  DEVICE(false, false),
  CONFIG(false, false),
  RESOURCE(false, false);

  private final boolean defaultRetryable;
  private final boolean defaultFailover;

  ErrorCategory(boolean defaultRetryable, boolean defaultFailover) {
    this.defaultRetryable = defaultRetryable;
    this.defaultFailover = defaultFailover;
  }

  public boolean defaultRetryable() {
    return defaultRetryable;
  }

  public boolean defaultFailover() {
    return defaultFailover;
  }
}
