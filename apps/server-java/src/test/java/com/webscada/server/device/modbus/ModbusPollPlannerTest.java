package com.webscada.server.device.modbus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ModbusPollPlannerTest {
  private static final long MS = 1_000_000L;

  @Test
  void scanPeriodDefaultsAndFloor() {
    assertEquals(50, ModbusPollPlanner.scanPeriodMs(null));
    assertEquals(50, ModbusPollPlanner.scanPeriodMs(50));
    assertEquals(50, ModbusPollPlanner.scanPeriodMs(10));
    assertEquals(70, ModbusPollPlanner.scanPeriodMs(70));
  }

  @Test
  void differentPeriodsAreDifferentGroups() {
    assertEquals("devA|50", ModbusPollPlanner.groupKey("devA", 50));
    assertNotEquals(
        ModbusPollPlanner.groupKey("devA", 50), ModbusPollPlanner.groupKey("devA", 70));
    assertNotEquals(
        ModbusPollPlanner.groupKey("devA", 50), ModbusPollPlanner.groupKey("devB", 50));
  }

  @Test
  void nextBeatAddsPeriodWithoutDrift() {
    long due = 100 * MS;
    long period = 50 * MS;
    assertEquals(150 * MS, ModbusPollPlanner.nextBeat(due, period, due));
    assertEquals(150 * MS, ModbusPollPlanner.nextBeat(due, period, due + 10 * MS));
    assertEquals(150 * MS, ModbusPollPlanner.nextBeat(due, period, 149 * MS));
  }

  @Test
  void nextBeatSkipsMissedTicksAndDoesNotCatchUp() {
    long due = 100 * MS;
    long period = 50 * MS;
    // finished exactly at the next tick: that tick is already here, skip to the following one
    assertEquals(200 * MS, ModbusPollPlanner.nextBeat(due, period, 150 * MS));
    // finished 10ms after the next tick
    assertEquals(200 * MS, ModbusPollPlanner.nextBeat(due, period, 160 * MS));
    // missed several beats; land on the next future 50ms boundary from the original due
    assertEquals(300 * MS, ModbusPollPlanner.nextBeat(due, period, 260 * MS));
  }

  @Test
  void isDueDoesNotCollectEarly() {
    assertTrue(ModbusPollPlanner.isDue(100, 100));
    assertTrue(ModbusPollPlanner.isDue(100, 101));
    assertFalse(ModbusPollPlanner.isDue(100, 99));
  }

  @Test
  void alignmentWaitsOnlyForNearlySimultaneousSameWindow() {
    long now = 1000 * MS;
    long[] dues = {now, now + 2 * MS, now + 10 * MS};
    assertEquals(2 * MS, ModbusPollPlanner.alignmentWaitNs(now, dues));
    // 10ms is outside the 3ms window and must not be included
    long[] onlyFar = {now, now + 10 * MS};
    assertEquals(0L, ModbusPollPlanner.alignmentWaitNs(now, onlyFar));
    // nothing due yet
    long[] future = {now + 2 * MS};
    assertEquals(0L, ModbusPollPlanner.alignmentWaitNs(now, future));
  }

  @Test
  void alignmentDoesNotWaitWhenAlreadyLate() {
    long now = 1000 * MS;
    long[] dues = {now - 5 * MS, now + 2 * MS};
    assertEquals(0L, ModbusPollPlanner.alignmentWaitNs(now, dues));
  }
}
