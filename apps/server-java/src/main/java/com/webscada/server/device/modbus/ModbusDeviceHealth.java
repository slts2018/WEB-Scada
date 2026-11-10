package com.webscada.server.device.modbus;

import java.util.concurrent.ConcurrentHashMap;

/** 设备级在线/冷却状态：坏设备冷却期内不再发起 TCP。 */
final class ModbusDeviceHealth {
  private final ConcurrentHashMap<String, State> states = new ConcurrentHashMap<>();

  private static final class State {
    int fails;
    long cooldownUntil;
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

  void onFailure(String deviceId, long now, long cooldownMs, int maxFailBeforeCooldown) {
    int need = Math.max(1, maxFailBeforeCooldown);
    long cool = Math.max(0, cooldownMs);
    State s = states.computeIfAbsent(deviceId, k -> new State());
    s.fails++;
    if (s.fails >= need) {
      s.cooldownUntil = now + cool;
      s.fails = 0;
    }
  }

  void clear(String deviceId) {
    states.remove(deviceId);
  }
}
