package com.webscada.server.comm.driver.modbus;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** 把同一单元、同一功能码上相邻的点合成一次读，并在 125 寄存器 / 2000 线圈处按点边界切开。 */
public final class ReadPlanner {
  public static final int MAX_REGISTERS = 125;
  public static final int MAX_COILS = 2000;

  private ReadPlanner() {}

  public record Chunk(int unit, int function, int start, int count, List<ModbusPoint> points) {}

  public static List<Chunk> plan(List<ModbusPoint> points) {
    if (points == null || points.isEmpty()) return List.of();
    List<ModbusPoint> sorted = new ArrayList<>(points);
    sorted.sort(
        Comparator.comparingInt(ModbusPoint::unit)
            .thenComparingInt(ModbusPoint::function)
            .thenComparingInt(ModbusPoint::pduAddress)
            .thenComparing(ModbusPoint::id));
    List<Chunk> chunks = new ArrayList<>();
    List<ModbusPoint> span = new ArrayList<>();
    for (ModbusPoint point : sorted) {
      if (!span.isEmpty() && !continues(span, point)) {
        flush(chunks, span);
        span.clear();
      }
      int max = maxCount(point.function());
      int used = spanCount(span);
      if (!span.isEmpty() && used + point.width() > max) {
        flush(chunks, span);
        span.clear();
      }
      span.add(point);
    }
    flush(chunks, span);
    return List.copyOf(chunks);
  }

  private static boolean continues(List<ModbusPoint> span, ModbusPoint next) {
    ModbusPoint first = span.get(0);
    if (first.unit() != next.unit() || first.function() != next.function()) return false;
    return next.pduAddress() == first.pduAddress() + spanCount(span);
  }

  private static int spanCount(List<ModbusPoint> span) {
    int n = 0;
    for (ModbusPoint point : span) n += point.width();
    return n;
  }

  private static int maxCount(int function) {
    return function <= 2 ? MAX_COILS : MAX_REGISTERS;
  }

  private static void flush(List<Chunk> chunks, List<ModbusPoint> span) {
    if (span.isEmpty()) return;
    int max = maxCount(span.get(0).function());
    int index = 0;
    while (index < span.size()) {
      int start = span.get(index).pduAddress();
      int count = 0;
      int end = index;
      while (end < span.size()) {
        int next = count + span.get(end).width();
        if (next > max && count > 0) break;
        count = next;
        end++;
      }
      chunks.add(
          new Chunk(
              span.get(index).unit(),
              span.get(index).function(),
              start,
              count,
              List.copyOf(span.subList(index, end))));
      index = end;
    }
  }
}
