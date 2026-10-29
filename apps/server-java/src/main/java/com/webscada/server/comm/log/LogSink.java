package com.webscada.server.comm.log;

public interface LogSink {
  void accept(LogEvent event, String json);
}
