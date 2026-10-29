package com.webscada.server.comm.error;

/** Driver 失败只抛这一种异常。Supervisor 用类别、是否重试、是否允许切备用地址做决定。 */
public final class CommException extends Exception {
  private final ErrorCategory category;
  private final boolean retryable;
  private final boolean failoverAllowed;

  public CommException(
      ErrorCategory category, boolean retryable, boolean failoverAllowed, String message) {
    this(category, retryable, failoverAllowed, message, null);
  }

  public CommException(
      ErrorCategory category,
      boolean retryable,
      boolean failoverAllowed,
      String message,
      Throwable cause) {
    super(message, cause);
    if (category == null) {
      throw new IllegalArgumentException("category required");
    }
    this.category = category;
    this.retryable = retryable;
    this.failoverAllowed = failoverAllowed;
  }

  public static CommException of(ErrorCategory category, String message) {
    return new CommException(
        category, category.defaultRetryable(), category.defaultFailover(), message);
  }

  public ErrorCategory category() {
    return category;
  }

  public boolean retryable() {
    return retryable;
  }

  public boolean failoverAllowed() {
    return failoverAllowed;
  }
}
