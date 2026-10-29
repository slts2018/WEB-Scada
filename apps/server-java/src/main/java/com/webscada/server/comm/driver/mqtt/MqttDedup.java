package com.webscada.server.comm.driver.mqtt;

import java.util.Iterator;
import java.util.LinkedHashMap;

/** 有界 LRU。QoS1 至少一次，重复键直接丢掉。 */
final class MqttDedup {
  private final int limit;
  private final LinkedHashMap<String, Boolean> keys;

  MqttDedup(int limit) {
    this.limit = Math.max(1, limit);
    this.keys = new LinkedHashMap<>(16, 0.75f, true);
  }

  /** 第一次见到返回 false 并记下；已经见过返回 true。 */
  synchronized boolean alreadySeen(String key) {
    if (key == null || key.isBlank()) return false;
    if (keys.containsKey(key)) {
      keys.get(key);
      return true;
    }
    keys.put(key, Boolean.TRUE);
    evict();
    return false;
  }

  synchronized boolean contains(String key) {
    return key != null && keys.containsKey(key);
  }

  synchronized void add(String key) {
    if (key == null || key.isBlank()) return;
    keys.put(key, Boolean.TRUE);
    evict();
  }

  private void evict() {
    Iterator<String> it = keys.keySet().iterator();
    while (keys.size() > limit && it.hasNext()) {
      it.next();
      it.remove();
    }
  }
}
