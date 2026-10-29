package com.webscada.server.comm.driver;

import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.error.CommException;
import java.util.List;

public record IoResult(
    boolean ok, String correlationId, List<PointUpdate> points, CommException error) {

  public IoResult {
    points = points == null ? List.of() : List.copyOf(points);
  }

  public record PointUpdate(String pointId, Object value, Quality quality, Long sourceTs) {
    public PointUpdate(String pointId, Object value, Quality quality) {
      this(pointId, value, quality, null);
    }
  }
}
