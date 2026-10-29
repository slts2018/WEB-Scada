package com.webscada.server.comm.supervisor;

import java.util.concurrent.ConcurrentHashMap;

/** 同一进程内同一个 linkId 只有一个持有者。tryAcquire / release 都不阻塞。 */
public final class InProcessLinkLock {
  private final ConcurrentHashMap<String, Boolean> held = new ConcurrentHashMap<>();

  public boolean tryAcquire(String linkId) {
    return held.putIfAbsent(linkId, Boolean.TRUE) == null;
  }

  public void release(String linkId) {
    held.remove(linkId);
  }
}
