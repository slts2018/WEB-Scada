package com.webscada.server.device.modbus;

import java.util.concurrent.ConcurrentHashMap;

/** 套接字连续连不上才冷却。读超时不进这里。 */
final class ModbusDeviceHealth {
  private final ConcurrentHashMap<String, State> states = new ConcurrentHashMap<>();

  private static final class State {
    int fails;
    int lastStreak;
    long cooldownUntil;
    boolean enteredCooldown;
  }

  boolean inCooldown(String deviceId, long now) {
    State s = states.get(deviceId);
    return s != null && s.cooldownUntil > now;
  }

  long cooldownRemainingMs(String deviceId, long now) {
    State s = states.get(deviceId);
    if (s == null) return 0;
    return Math.max(0, s.cooldownUntil - now);
  }

  void onSuccess(String deviceId) {
    states.remove(deviceId);
  }

  /** @return true 若本次失败使设备刚进入冷却 */
  boolean onFailure(String deviceId, long now, long cooldownMs, int maxFailBeforeCooldown) {
    int need = Math.max(1, maxFailBeforeCooldown);
    long cool = Math.max(0, cooldownMs);
    State s = states.computeIfAbsent(deviceId, k -> new State());
    s.fails++;
    s.lastStreak = s.fails;
    s.enteredCooldown = false;
    if (s.fails >= need) {
      s.cooldownUntil = now + cool;
      s.fails = 0;
      s.enteredCooldown = true;
      return true;
    }
    return false;
  }

  int failCount(String deviceId) {
    State s = states.get(deviceId);
    if (s == null) return 0;
    return s.lastStreak > 0 ? s.lastStreak : s.fails;
  }

  boolean consumeEnteredCooldown(String deviceId) {
    State s = states.get(deviceId);
    if (s == null || !s.enteredCooldown) return false;
    s.enteredCooldown = false;
    return true;
  }

  void clear(String deviceId) {
    states.remove(deviceId);
  }
}
