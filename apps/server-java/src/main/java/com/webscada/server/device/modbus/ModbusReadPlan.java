package com.webscada.server.device.modbus;

import com.webscada.server.model.TagMeta;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 将同设备到期点按功能码合并为连续（或紧挨）区间，减少报文数。
 * 寄存器最多 125；线圈/离散最多 2000。
 */
final class ModbusReadPlan {
  static final int MAX_REGS = 125;
  static final int MAX_BITS = 2000;

  record Slot(TagMeta meta, ModbusAddress addr, int offset, int length) {}

  record Group(int fc, boolean bitSpace, int start, int quantity, List<Slot> slots) {}

  private ModbusReadPlan() {}

  static List<Group> plan(List<TagMeta> due) {
    List<Slot> slots = new ArrayList<>();
    for (TagMeta meta : due) {
      ModbusAddress addr = ModbusAddress.parse(meta.address());
      if (addr == null) continue;
      int len = span(meta, addr);
      slots.add(new Slot(meta, addr, addr.offset(), len));
    }
    slots.sort(
        Comparator.comparingInt((Slot s) -> s.addr().readFc())
            .thenComparingInt(Slot::offset)
            .thenComparingInt(Slot::length));

    List<Group> groups = new ArrayList<>();
    Group cur = null;
    for (Slot slot : slots) {
      int fc = slot.addr().readFc();
      boolean bitSpace = slot.addr().isCoilSpace();
      int maxQty = bitSpace ? MAX_BITS : MAX_REGS;
      int end = slot.offset() + slot.length();
      if (cur == null
          || cur.fc() != fc
          || cur.bitSpace() != bitSpace
          || slot.offset() > cur.start() + cur.quantity()
          || end - cur.start() > maxQty) {
        List<Slot> list = new ArrayList<>();
        list.add(slot);
        cur = new Group(fc, bitSpace, slot.offset(), slot.length(), list);
        groups.add(cur);
      } else {
        int newQty = Math.max(cur.quantity(), end - cur.start());
        cur.slots().add(slot);
        cur = new Group(cur.fc(), cur.bitSpace(), cur.start(), newQty, cur.slots());
        groups.set(groups.size() - 1, cur);
      }
    }
    return groups;
  }

  static int span(TagMeta meta, ModbusAddress addr) {
    if (addr.isCoilSpace()) return 1;
    String dt = ModbusTagIo.normalizeType(meta.dataType());
    if ("bool".equals(dt) || addr.bit() != null) return 1;
    return ModbusTagIo.resolveLength(dt, addr);
  }
}
