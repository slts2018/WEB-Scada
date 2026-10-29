package com.webscada.server.comm.driver.modbus;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.webscada.server.comm.driver.modbus.RegisterCodec.Endian;
import com.webscada.server.comm.driver.modbus.RegisterCodec.WordOrder;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReadPlannerTest {
  @Test
  void splitsRegistersAt125AndCoilsAt2000OnPointBoundaries() {
    List<ModbusPoint> registers = new ArrayList<>();
    for (int i = 0; i < 126; i++) registers.add(holding(i, 1, "uint16"));
    List<ReadPlanner.Chunk> split = ReadPlanner.plan(registers);
    assertEquals(2, split.size());
    assertEquals(0, split.get(0).start());
    assertEquals(125, split.get(0).count());
    assertEquals(125, split.get(1).start());
    assertEquals(1, split.get(1).count());

    List<ModbusPoint> boundary = new ArrayList<>();
    for (int i = 0; i < 124; i++) boundary.add(holding(i, 1, "uint16"));
    boundary.add(holding(124, 2, "int32"));
    List<ReadPlanner.Chunk> kept = ReadPlanner.plan(boundary);
    assertEquals(124, kept.get(0).count());
    assertEquals(124, kept.get(1).start());
    assertEquals(2, kept.get(1).count());

    List<ModbusPoint> coils = new ArrayList<>();
    for (int i = 0; i < 2001; i++) coils.add(coil(i));
    List<ReadPlanner.Chunk> coilSplit = ReadPlanner.plan(coils);
    assertEquals(2000, coilSplit.get(0).count());
    assertEquals(2000, coilSplit.get(1).start());
    assertEquals(1, coilSplit.get(1).count());
  }

  private static ModbusPoint holding(int address, int width, String type) {
    return new ModbusPoint(
        "r" + address, 1, 3, address, width, type, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0);
  }

  private static ModbusPoint coil(int address) {
    return new ModbusPoint(
        "c" + address, 1, 1, address, 1, "bool", WordOrder.HIGH_FIRST, Endian.BIG, 1, 0);
  }
}
