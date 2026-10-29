package com.webscada.server.comm.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.config.CommProperties;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.data.PointSample;
import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.event.LinkEvents;
import com.webscada.server.comm.state.ConnectionState;
import com.webscada.server.comm.support.Harness;
import com.webscada.server.comm.support.LinkFixtures;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagValue;
import com.webscada.server.service.DeviceStatusService;
import com.webscada.server.service.TagRuntimeService;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

class CommBridgeTest {
  @Test
  void disabledSwitchDoesNotCreateTheBridgeOrWriteTags() {
    ConditionalOnProperty gate = CommBridge.class.getAnnotation(ConditionalOnProperty.class);
    assertNotNull(gate);
    assertEquals("webscada.comm", gate.prefix());
    assertEquals("enabled", gate.name()[0]);
    assertEquals("true", gate.havingValue());
    CommProperties props = new CommProperties();
    assertFalse(props.isEnabled());
    assertFalse(props.isUseSourceTimestamp());
    assertFalse(props.isAllowWrite());
    assertEquals(4096, props.getBridgeQueueSize());

    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    try {
      harness.driver.readResult.set(List.of(new IoResult.PointUpdate("flow", 12.5, Quality.GOOD)));
      harness.start();
      harness.until(() -> harness.driver.reads.get() >= 1);
      assertTrue(runtime.getCurrentValues().isEmpty());
    } finally {
      harness.close();
    }
  }

  @Test
  void fakeLinkReachesCurrentValuesAndKeepsReceiveTime() {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    DeviceStatusService devices = new DeviceStatusService(new ScadaProperties());
    CommBridge bridge = bridge(harness, runtime, devices, false, 4096);
    try {
      bridge.start();
      harness.driver.readResult.set(
          List.of(new IoResult.PointUpdate("flow", 12.5, Quality.GOOD, 5L)));
      harness.start();
      harness.until(
          () -> harness.supervisor.state() == ConnectionState.RUNNING && harness.driver.reads.get() >= 1);
      waitUntil(() -> bridge.pending() > 0);
      assertTrue(runtime.getCurrentValues().isEmpty());
      bridge.drain();
      TagValue flow = runtime.getTagValue("plant.flow");
      assertNotNull(flow);
      assertEquals(12.5, ((Number) flow.value()).doubleValue());
      assertEquals("Good", flow.quality());
      assertNotEquals(5L, flow.timestamp());
    } finally {
      harness.close();
    }
  }

  @Test
  void sourceTimestampIsUsedOnlyWhenEnabled() {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    CommBridge bridge = bridge(harness, runtime, new DeviceStatusService(new ScadaProperties()), true, 16);
    try {
      bridge.acceptData(sample("plc", "flow", 12.5, Quality.GOOD, 5L));
      bridge.drain();
      assertEquals(5L, runtime.getTagValue("plant.flow").timestamp());
    } finally {
      harness.close();
    }
  }

  @Test
  void mapsTheFourLegacyQualitiesAndForwardsAQualityChange() {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    CommBridge bridge = bridge(harness, runtime, new DeviceStatusService(new ScadaProperties()), false, 16);
    try {
      bridge.acceptData(sample("plc", "g", 1, Quality.GOOD, null));
      bridge.acceptData(sample("plc", "s", 1, Quality.STALE, null));
      bridge.acceptData(sample("plc", "o", 1, Quality.BAD_COMM_FAILURE, null));
      bridge.acceptData(sample("plc", "b", 1, Quality.BAD_CONFIG, null));
      bridge.drain();
      assertEquals("Good", runtime.getTagValue("g").quality());
      assertEquals("Uncertain", runtime.getTagValue("s").quality());
      assertEquals(1, ((Number) runtime.getTagValue("s").value()).intValue());
      assertEquals("Offline", runtime.getTagValue("o").quality());
      assertEquals("Bad", runtime.getTagValue("b").quality());

      bridge.acceptData(sample("plc", "hold", 3, Quality.GOOD, null));
      bridge.acceptData(sample("plc", "hold", 3, Quality.GOOD, null));
      bridge.drain();
      assertEquals(5, bridge.forwarded());
      bridge.acceptData(sample("plc", "hold", 3, Quality.STALE, null));
      bridge.drain();
      assertEquals(6, bridge.forwarded());
      assertEquals("Uncertain", runtime.getTagValue("hold").quality());
      assertEquals(3, ((Number) runtime.getTagValue("hold").value()).intValue());
    } finally {
      harness.close();
    }
  }

  @Test
  void linkDownMarksEveryPointOfflineAndRecoveryBringsValuesBack() {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    DeviceStatusService devices = new DeviceStatusService(new ScadaProperties());
    CommBridge bridge = bridge(harness, runtime, devices, false, 16);
    try {
      bridge.acceptState(state(ConnectionState.DISCONNECTED, ConnectionState.RUNNING, "up"));
      bridge.acceptState(state(ConnectionState.RUNNING, ConnectionState.DEGRADED, "slow"));
      assertEquals("DEGRADED", status(devices).state());
      assertTrue(status(devices).online());
      bridge.acceptState(state(ConnectionState.DEGRADED, ConnectionState.CONNECTING, "again"));
      assertEquals("DEGRADED", status(devices).state());

      bridge.acceptState(state(ConnectionState.DEGRADED, ConnectionState.RECONNECTING, "link down"));
      bridge.drain();
      assertFalse(status(devices).online());
      assertEquals("RECONNECTING", status(devices).state());
      assertEquals("link down", status(devices).message());
      assertEquals("Offline", runtime.getTagValue("plant.flow").quality());
      assertEquals("Offline", runtime.getTagValue("plant.pressure").quality());

      bridge.acceptState(state(ConnectionState.RECONNECTING, ConnectionState.RUNNING, "up"));
      bridge.acceptData(sample("plc", "flow", 12.5, Quality.GOOD, null));
      bridge.acceptData(sample("plc", "pressure", 3, Quality.GOOD, null));
      bridge.drain();
      assertTrue(status(devices).online());
      assertEquals("RUNNING", status(devices).state());
      assertEquals(12.5, ((Number) runtime.getTagValue("plant.flow").value()).doubleValue());
      assertEquals("Good", runtime.getTagValue("plant.flow").quality());
      assertEquals(3, ((Number) runtime.getTagValue("plant.pressure").value()).intValue());

      DeviceMeta mock = new DeviceMeta("demo", "demo", "mock", "", true, "");
      assertTrue(devices.snapshot(List.of(mock)).get(0).online());
      DeviceMeta mcd = new DeviceMeta("m1", "m", "mcd4000", "", true, "");
      assertEquals("unknown", devices.snapshot(List.of(mcd)).get(0).state());
    } finally {
      harness.close();
    }
  }

  @Test
  void droppedPointIsSentAgainOnTheNextCycle() {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    CommBridge bridge = bridge(harness, runtime, new DeviceStatusService(new ScadaProperties()), false, 1);
    try {
      bridge.acceptData(sample("plc", "a", 1, Quality.GOOD, null));
      bridge.acceptData(sample("plc", "b", 2, Quality.GOOD, null));
      assertEquals(1, bridge.dropped());
      bridge.drain();
      assertNull(runtime.getTagValue("a"));
      assertEquals(2, ((Number) runtime.getTagValue("b").value()).intValue());

      bridge.acceptData(sample("plc", "a", 1, Quality.GOOD, null));
      bridge.acceptData(sample("plc", "b", 2, Quality.GOOD, null));
      bridge.drain();
      assertEquals(1, ((Number) runtime.getTagValue("a").value()).intValue());
      assertEquals("Good", runtime.getTagValue("a").quality());
      assertEquals(2, ((Number) runtime.getTagValue("b").value()).intValue());
    } finally {
      harness.close();
    }
  }

  @Test
  void fiveHundredPointsStayOnTheCallbackThread() throws Exception {
    List<DataPoint> points = new ArrayList<>();
    List<PointSample> samples = new ArrayList<>();
    long now = System.currentTimeMillis();
    for (int i = 0; i < 500; i++) {
      points.add(
          new DataPoint(
              "p" + i, 3, i, "uint16", "high-first", "big", 1, 0, null, "", "", "", "", "t" + i));
      samples.add(new PointSample("p" + i, i, Quality.GOOD, null, now, now));
    }
    Harness harness =
        Harness.open(LinkFixtures.withPoints(LinkFixtures.polling("plc", 60_000, 502), points), 2_000);
    TagRuntimeService runtime = TagRuntimeService.memory();
    CommBridge bridge = bridge(harness, runtime, new DeviceStatusService(new ScadaProperties()), false, 4096);
    try {
      LinkEvents.DataReceived event = new LinkEvents.DataReceived("plc", samples, now);
      long[] nanos = new long[1];
      Thread callback =
          new Thread(
              () -> {
                long started = System.nanoTime();
                bridge.acceptData(event);
                nanos[0] = System.nanoTime() - started;
              },
              "comm-callback");
      callback.start();
      callback.join(2_000);
      assertFalse(callback.isAlive());
      assertTrue(nanos[0] < TimeUnit.MILLISECONDS.toNanos(500), "callback took ns=" + nanos[0]);
      assertEquals(500, bridge.pending());
      assertTrue(runtime.getCurrentValues().isEmpty());
    } finally {
      harness.close();
    }
  }

  @Test
  void fullQueueDropsTheOldestWithoutBlockingTheCallbackThread() throws Exception {
    Harness harness = open();
    TagRuntimeService runtime = TagRuntimeService.memory();
    CommBridge bridge = bridge(harness, runtime, new DeviceStatusService(new ScadaProperties()), false, 2);
    try {
      Thread callback =
          new Thread(
              () -> {
                bridge.acceptData(sample("plc", "t1", 1, Quality.GOOD, null));
                bridge.acceptData(sample("plc", "t2", 2, Quality.GOOD, null));
                bridge.acceptData(sample("plc", "t3", 3, Quality.GOOD, null));
              },
              "comm-callback");
      long started = System.nanoTime();
      callback.start();
      callback.join(500);
      assertFalse(callback.isAlive());
      assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 500);
      assertEquals(1, bridge.dropped());
      assertEquals(2, bridge.pending());
      assertTrue(runtime.getCurrentValues().isEmpty());
      bridge.drain();
      assertNull(runtime.getTagValue("t1"));
      assertEquals(2, ((Number) runtime.getTagValue("t2").value()).intValue());
      assertEquals(3, ((Number) runtime.getTagValue("t3").value()).intValue());
    } finally {
      harness.close();
    }
  }

  private static Harness open() {
    DataPoint flow =
        new DataPoint("flow", 3, 0, "float32", "high-first", "big", 1, 0, null, "", "", "", "", "plant.flow");
    DataPoint pressure =
        new DataPoint(
            "pressure", 3, 2, "float32", "high-first", "big", 1, 0, null, "", "", "", "", "plant.pressure");
    LinkDefinition link =
        LinkFixtures.withPoints(LinkFixtures.polling("plc", 60_000, 502), List.of(flow, pressure));
    return Harness.open(link, 2_000);
  }

  private static CommBridge bridge(
      Harness harness,
      TagRuntimeService runtime,
      DeviceStatusService devices,
      boolean useSourceTimestamp,
      int capacity) {
    return new CommBridge(harness.facade, runtime, devices, useSourceTimestamp, capacity);
  }

  private static LinkEvents.DataReceived sample(
      String linkId, String pointId, Object value, Quality quality, Long sourceTs) {
    long now = System.currentTimeMillis();
    return new LinkEvents.DataReceived(
        linkId, List.of(new PointSample(pointId, value, quality, sourceTs, now, now)), now);
  }

  private static LinkEvents.StateChanged state(ConnectionState from, ConnectionState to, String reason) {
    return new LinkEvents.StateChanged("plc", from, to, reason, System.currentTimeMillis());
  }

  private static com.webscada.server.model.DeviceLinkStatus status(DeviceStatusService devices) {
    DeviceMeta device = new DeviceMeta("dev-plc", "plc", "modbus-tcp", "", true, "");
    return devices.snapshot(List.of(device)).get(0);
  }

  private static void waitUntil(BooleanSupplier cond) {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
    while (!cond.getAsBoolean()) {
      if (System.nanoTime() > end) throw new AssertionError("timed out waiting for comm callback");
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(5));
    }
  }
}
