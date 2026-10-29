package com.webscada.server.comm.event;

public interface LinkListener {
  default void onState(LinkEvents.StateChanged event) {}

  default void onData(LinkEvents.DataReceived event) {}

  default void onError(LinkEvents.ErrorOccurred event) {}

  default void onStats(LinkEvents.StatsUpdated event) {}
}
