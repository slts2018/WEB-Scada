package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.config.DataPoint;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 点表校验。失败信息带上链路下标、点 id 和字段名。 */
public final class ModbusConfig {
  private ModbusConfig() {}

  public record Checked(
      int unitId,
      String addressBase,
      int healthFc,
      int healthAddress,
      int healthCount,
      List<DataPoint> points) {}

  public static Checked check(
      String where,
      int unitId,
      String addressBase,
      int healthFc,
      int healthAddress,
      int healthCount,
      List<DataPoint> points,
      List<String> errors) {
    String base = addressBase == null || addressBase.isBlank() ? "0" : addressBase.trim();
    if (!"0".equals(base) && !"40001".equals(base)) {
      errors.add(where + ".addressBase: must be 0 or 40001");
    }
    if (unitId < 0 || unitId > 255) errors.add(where + ".unitId: must be 0..255");
    int fc = healthFc <= 0 ? 3 : healthFc;
    int count = healthCount <= 0 ? 1 : healthCount;
    int address = healthAddress;
    if ("40001".equals(base) && address == 0) {
      address =
          switch (fc) {
            case 1 -> 1;
            case 2 -> 10001;
            case 4 -> 30001;
            default -> 40001;
          };
    }
    if (fc < 1 || fc > 4) {
      errors.add(where + ".healthProbe.fc: must be 1..4");
    } else {
      int max = fc <= 2 ? ReadPlanner.MAX_COILS : ReadPlanner.MAX_REGISTERS;
      if (count < 1 || count > max) {
        errors.add(where + ".healthProbe.count: must be 1.." + max);
      }
      try {
        int pdu = Addressing.toPdu(base, fc, address);
        Addressing.requireSpan(pdu, count);
      } catch (IllegalArgumentException ex) {
        errors.add(where + ".healthProbe.address: " + ex.getMessage());
      }
    }
    List<DataPoint> normalized = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    List<DataPoint> source = points == null ? List.of() : points;
    for (int i = 0; i < source.size(); i++) {
      DataPoint point = source.get(i);
      String id = point == null || point.id() == null ? "" : point.id().trim();
      String at = where + ".points[" + i + "](" + id + ")";
      if (id.isEmpty()) {
        errors.add(at + ".id: required");
      }
      if (point == null || point.tagId() == null || point.tagId().isBlank()) {
        errors.add(at + ".tagId: required");
      }
      if (id.isEmpty()) continue;
      if (!ids.add(id)) errors.add(at + ".id: duplicate");
      if (point == null) continue;
      String type = point.type().trim().toLowerCase(Locale.ROOT);
      int width = RegisterCodec.width(type);
      if (width < 0) {
        errors.add(at + ".type: must be bool|int16|uint16|int32|uint32|float32|float64");
        continue;
      }
      if (point.fc() == 0) {
        errors.add(at + ".fc: required");
      } else if (!RegisterCodec.compatible(point.fc(), type)) {
        errors.add(at + ".fc: does not match type " + type);
      }
      if (RegisterCodec.wordOrder(point.wordOrder()) == null) {
        errors.add(at + ".wordOrder: must be high-first or low-first");
      }
      if (RegisterCodec.endian(point.byteOrder()) == null) {
        errors.add(at + ".byteOrder: must be big or little");
      }
      if (Double.isNaN(point.scale()) || Double.isInfinite(point.scale())) {
        errors.add(at + ".scale: must be finite");
      }
      if (Double.isNaN(point.offset()) || Double.isInfinite(point.offset())) {
        errors.add(at + ".offset: must be finite");
      }
      if (point.unit() != null && (point.unit() < 0 || point.unit() > 255)) {
        errors.add(at + ".unit: must be 0..255");
      }
      try {
        int pdu = Addressing.toPdu(base, point.fc(), point.address());
        Addressing.requireSpan(pdu, width);
        int quantityMax = RegisterCodec.bitFunction(point.fc()) ? ReadPlanner.MAX_COILS : ReadPlanner.MAX_REGISTERS;
        if (width > quantityMax) errors.add(at + ".address: count " + width + " exceeds " + quantityMax);
      } catch (IllegalArgumentException ex) {
        errors.add(at + ".address: " + ex.getMessage());
      }
      normalized.add(
          new DataPoint(
              id,
              point.fc(),
              point.address(),
              type,
              point.wordOrder(),
              point.byteOrder(),
              point.scale() == 0d ? 0d : point.scale(),
              point.offset(),
              point.unit(),
              point.nodeId(),
              point.topic(),
              point.field(),
              point.path(),
              point.tagId()));
    }
    return new Checked(unitId, base, fc, address, count, List.copyOf(normalized));
  }
}
