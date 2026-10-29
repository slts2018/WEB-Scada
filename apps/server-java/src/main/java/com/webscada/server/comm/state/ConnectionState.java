package com.webscada.server.comm.state;

public enum ConnectionState {
  DISCONNECTED,
  CONNECTING,
  HANDSHAKE,
  RUNNING,
  DEGRADED,
  RECONNECTING,
  STOPPING,
  STOPPED,
  FAILED
}
