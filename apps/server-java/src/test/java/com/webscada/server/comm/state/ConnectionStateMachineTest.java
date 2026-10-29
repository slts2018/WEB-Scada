package com.webscada.server.comm.state;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.metrics.LinkStats;
import com.webscada.server.comm.state.ConnectionStateMachine.Signal;
import java.time.Clock;
import org.junit.jupiter.api.Test;

class ConnectionStateMachineTest {
  @Test
  void walksTheHappyPathAndRestart() {
    ConnectionStateMachine machine = machine(false);
    assertTrue(machine.transition(Signal.START, "start", 10, "s", "c"));
    assertEquals(ConnectionState.CONNECTING, machine.state());
    assertTrue(machine.transition(Signal.CONNECT_OK, "up", 20, "s", "c"));
    assertTrue(machine.transition(Signal.HANDSHAKE_OK, "hs", 30, "s", "c"));
    assertEquals(ConnectionState.RUNNING, machine.state());
    assertTrue(machine.transition(Signal.DEGRADE, "slow", 40, "s", "c"));
    assertEquals(ConnectionState.DEGRADED, machine.state());
    assertTrue(machine.transition(Signal.RECOVER, "ok", 50, "s", "c"));
    assertTrue(machine.transition(Signal.IO_FAIL, "drop", 60, "s", "c"));
    assertEquals(ConnectionState.RECONNECTING, machine.state());
    assertTrue(machine.transition(Signal.MAX_ATTEMPTS, "max", 70, "s", "c"));
    assertEquals(ConnectionState.FAILED, machine.state());
    assertTrue(machine.transition(Signal.PROBE_OK, "probe", 80, "s", "c"));
    assertEquals(ConnectionState.HANDSHAKE, machine.state());
    assertTrue(machine.transition(Signal.STOP, "stop", 90, "s", "c"));
    assertTrue(machine.transition(Signal.RELEASED, "done", 100, "s", "c"));
    assertEquals(ConnectionState.STOPPED, machine.state());
    assertTrue(machine.transition(Signal.START, "again", 110, "s", "c"));
    assertEquals(ConnectionState.CONNECTING, machine.state());
  }

  @Test
  void rejectedTransitionIsCountedAndStrictOnlyThrowsInTests() {
    LinkStats stats = new LinkStats();
    ConnectionStateMachine machine = machine(stats, false);
    assertFalse(machine.transition(Signal.HANDSHAKE_OK, "nope", 5, "s", ""));
    assertEquals(ConnectionState.DISCONNECTED, machine.state());
    assertEquals(1L, stats.rejectedTransitions().sum());
    assertEquals(1L, stats.snapshot().get("rejected_transition_total"));

    machine.setStrict(true);
    assertThrows(
        IllegalStateException.class,
        () -> machine.transition(Signal.HANDSHAKE_OK, "nope", 6, "s", ""));
    assertEquals(2, stats.rejectedTransitions().sum());
  }

  private static ConnectionStateMachine machine(boolean strict) {
    return machine(new LinkStats(), strict);
  }

  private static ConnectionStateMachine machine(LinkStats stats, boolean strict) {
    LinkLog log =
        new LinkLog("l", "d", "modbus-tcp", Clock.systemUTC(), (event, json) -> {});
    ConnectionStateMachine machine = new ConnectionStateMachine(stats, log, 0);
    machine.setStrict(strict);
    return machine;
  }
}
