package com.webscada.server.comm.event;

import com.webscada.server.comm.data.PointSample;
import com.webscada.server.comm.error.ErrorCategory;
import com.webscada.server.comm.state.ConnectionState;
import java.util.List;
import java.util.Map;

public final class LinkEvents {
  private LinkEvents() {}

  public record StateChanged(
      String linkId, ConnectionState from, ConnectionState to, String reason, long ts) {}

  public record DataReceived(String linkId, List<PointSample> points, long ts) {}

  public record ErrorOccurred(
      String linkId, ErrorCategory category, String code, String detail, long ts) {}

  public record StatsUpdated(String linkId, Map<String, Object> stats, long ts) {}
}
