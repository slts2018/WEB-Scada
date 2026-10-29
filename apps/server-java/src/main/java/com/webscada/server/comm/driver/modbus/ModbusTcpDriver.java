package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.driver.DriverContext;
import com.webscada.server.comm.driver.Health;
import com.webscada.server.comm.driver.IoRequest;
import com.webscada.server.comm.driver.IoResult;
import com.webscada.server.comm.driver.ProtocolDriver;
import com.webscada.server.comm.driver.Subscription;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Modbus TCP 驱动。只做一次建链和一次请求，不重连、不改状态、不切备用地址。
 * 手写 MBAP，避免第三方库自带的连接管理抢 Supervisor 的职责。
 */
public final class ModbusTcpDriver implements ProtocolDriver {
  private final AtomicBoolean busy = new AtomicBoolean();
  private final AtomicBoolean placeholderWarned = new AtomicBoolean();
  private final MbapClient session = new MbapClient();
  private volatile LinkDefinition link;

  public ModbusTcpDriver(LinkDefinition link) {
    this.link = link;
  }

  public void rebind(LinkDefinition next) {
    if (next != null) link = next;
  }

  @Override
  public String name() {
    return "modbus-tcp";
  }

  @Override
  public void connect(DriverContext ctx) throws CommException {
    enter();
    try {
      session.connect(ctx.endpoint().host(), ctx.endpoint().port(), ctx.connectTimeoutMs());
    } finally {
      leave();
    }
  }

  @Override
  public void disconnect() {
    session.disconnect();
  }

  @Override
  public Health healthCheck(DriverContext ctx) throws CommException {
    enter();
    try {
      if (!session.connected()) return Health.FAILED;
      LinkDefinition current = link;
      int function = current.healthFc();
      int count = current.healthCount();
      int address;
      try {
        address = Addressing.toPdu(current.addressBase(), function, current.healthAddress());
        Addressing.requireSpan(address, count);
      } catch (IllegalArgumentException ex) {
        warn(ctx, "health_config", ex.getMessage());
        return Health.FAILED;
      }
      try {
        byte[] pdu =
            exchange(ctx, current.unitId(), Pdu.readRequest(function, address, count), false);
        Pdu.parseRead(function, count, pdu);
        return Health.OK;
      } catch (CommException ex) {
        warn(ctx, "health_probe", ex.getMessage());
        if (ex.category() == ErrorCategory.PROTOCOL || ex.category() == ErrorCategory.CONNECT) {
          throw ex;
        }
        if (ex.category() == ErrorCategory.DEVICE && !Pdu.gateway(ex)) return Health.OK;
        return Health.FAILED;
      }
    } finally {
      leave();
    }
  }

  @Override
  public IoResult read(DriverContext ctx, IoRequest request) throws CommException {
    enter();
    try {
      List<ModbusPoint> points = selectable(request == null ? null : request.pointId());
      if (points.isEmpty()) {
        if (link.points().isEmpty() && placeholderWarned.compareAndSet(false, true)) {
          warn(ctx, "points_placeholder", "pointIds have no modbus mapping");
        }
        return ok(ctx, request, List.of());
      }
      Map<String, IoResult.PointUpdate> updates = new LinkedHashMap<>();
      for (ReadPlanner.Chunk chunk : ReadPlanner.plan(points)) {
        byte[] data =
            readData(ctx, chunk.unit(), chunk.function(), chunk.start(), chunk.count(), true);
        for (ModbusPoint point : chunk.points()) {
          updates.put(point.id(), decodePoint(ctx, point, data, chunk.start()));
        }
      }
      List<IoResult.PointUpdate> ordered = new ArrayList<>();
      for (ModbusPoint point : points) {
        IoResult.PointUpdate update = updates.get(point.id());
        if (update != null) ordered.add(update);
      }
      return ok(ctx, request, ordered);
    } finally {
      leave();
    }
  }

  @Override
  public IoResult write(DriverContext ctx, IoRequest request) throws CommException {
    enter();
    try {
      if (request == null || request.pointId() == null || request.pointId().isBlank()) {
        throw config("write pointId required");
      }
      ModbusPoint point = find(request.pointId());
      if (!point.pollable() && point.function() != 5 && point.function() != 6
          && point.function() != 15 && point.function() != 16) {
        throw config(point.id() + " is not writable");
      }
      if (point.function() == 2 || point.function() == 4) throw config(point.id() + " is read-only");
      int attempts = Math.max(0, link.writeRetries());
      for (int i = 0; ; i++) {
        byte[] sent = writeOnce(ctx, point, request.value());
        if (i >= attempts) break;
        if (Arrays.equals(sent, readWire(ctx, point))) break;
        ctx.log()
            .warn(
                "write_retry",
                "WRITE",
                "可能重复 point=" + point.id(),
                null,
                i + 1,
                ctx.sessionId(),
                ctx.correlationId());
      }
      return ok(ctx, request, List.of());
    } finally {
      leave();
    }
  }

  @Override
  public Subscription subscribe(DriverContext ctx, IoRequest request, Consumer<IoResult> callback)
      throws CommException {
    throw new CommException(ErrorCategory.CONFIG, false, false, "modbus-tcp has no subscribe");
  }

  private byte[] writeOnce(DriverContext ctx, ModbusPoint point, Object value) throws CommException {
    if (point.bit() || RegisterCodec.bitFunction(point.function())) {
      boolean on = RegisterCodec.encodeBit(value);
      byte[] sent = new byte[] {(byte) (on ? 1 : 0)};
      byte[] request = Pdu.writeCoil(point.pduAddress(), on);
      if (point.function() == 15) {
        request = Pdu.writeCoils(point.pduAddress(), 1, sent);
        byte[] response = exchange(ctx, point.unit(), request, false);
        Pdu.parseWriteMultiple(15, point.pduAddress(), 1, response);
        return sent;
      }
      byte[] response = exchange(ctx, point.unit(), request, false);
      Pdu.parseWriteSingle(request, response);
      return sent;
    }
    byte[] data = RegisterCodec.encodeRegisters(point, value);
    if (point.width() == 1 && point.function() != 16) {
      byte[] request = Pdu.writeRegister(point.pduAddress(), Bytes.u16(data, 0));
      byte[] response = exchange(ctx, point.unit(), request, false);
      Pdu.parseWriteSingle(request, response);
      return data;
    }
    byte[] request = Pdu.writeRegisters(point.pduAddress(), point.width(), data);
    byte[] response = exchange(ctx, point.unit(), request, false);
    Pdu.parseWriteMultiple(16, point.pduAddress(), point.width(), response);
    return data;
  }

  /** 回读原始寄存器或线圈位，不经过 scale。 */
  private byte[] readWire(DriverContext ctx, ModbusPoint point) throws CommException {
    if (point.bit() || RegisterCodec.bitFunction(point.function())) {
      byte[] data = readData(ctx, point.unit(), 1, point.pduAddress(), 1, false);
      int bit = data.length == 0 ? 0 : data[0] & 0x01;
      return new byte[] {(byte) bit};
    }
    return readData(ctx, point.unit(), 3, point.pduAddress(), point.width(), false);
  }

  private IoResult.PointUpdate decodePoint(
      DriverContext ctx, ModbusPoint point, byte[] data, int start) {
    int rel = point.pduAddress() - start;
    RegisterCodec.Decoded decoded = decode(point, data, rel);
    if (decoded.quality() != com.webscada.server.comm.data.Quality.GOOD) {
      warn(ctx, "decode_rejected", "point=" + point.id() + " " + decoded.detail());
    }
    return new IoResult.PointUpdate(point.id(), decoded.value(), decoded.quality());
  }

  private static RegisterCodec.Decoded decode(ModbusPoint point, byte[] data, int rel) {
    if (point.bit()) {
      int byteIndex = rel / 8;
      if (data == null || byteIndex < 0 || byteIndex >= data.length) {
        return RegisterCodec.Decoded.bad("length raw=" + Bytes.hex(data));
      }
      int bit = (data[byteIndex] >> (rel % 8)) & 0x01;
      return RegisterCodec.decode(point, new byte[] {(byte) bit});
    }
    int from = rel * 2;
    int to = from + point.width() * 2;
    if (data == null || from < 0 || to > data.length) {
      return RegisterCodec.Decoded.bad("length raw=" + Bytes.hex(data));
    }
    byte[] slice = new byte[to - from];
    System.arraycopy(data, from, slice, 0, slice.length);
    return RegisterCodec.decode(point, slice);
  }

  private byte[] readData(
      DriverContext ctx, int unit, int function, int address, int count, boolean retryRead)
      throws CommException {
    return exchange(ctx, unit, Pdu.readRequest(function, address, count), retryRead, function, count);
  }

  private byte[] exchange(DriverContext ctx, int unit, byte[] pdu, boolean retryRead)
      throws CommException {
    return exchange(ctx, unit, pdu, retryRead, -1, 0);
  }

  private byte[] exchange(
      DriverContext ctx, int unit, byte[] pdu, boolean retryRead, int readFunction, int readCount)
      throws CommException {
    int attempt = 0;
    while (true) {
      attempt++;
      try {
        byte[] response = session.exchange(unit, pdu, ctx);
        if (readFunction > 0) return Pdu.parseRead(readFunction, readCount, response);
        return response;
      } catch (CommException ex) {
        if (ex.category() == ErrorCategory.DEVICE) {
          warn(ctx, "modbus_exception", ex.getMessage());
        }
        int max = 1;
        if (retryRead && ex.category() == ErrorCategory.TIMEOUT) {
          max = 1 + Math.max(0, link.readRetries());
        } else if (retryRead && Pdu.gateway(ex)) {
          max = 2;
        }
        if (attempt >= max) throw ex;
        ctx.log()
            .warn(
                "read_retry",
                ex.category().name(),
                ex.getMessage(),
                null,
                attempt,
                ctx.sessionId(),
                ctx.correlationId());
      }
    }
  }

  private List<ModbusPoint> selectable(String pointId) throws CommException {
    List<ModbusPoint> all = resolve();
    if (pointId == null || pointId.isBlank() || "*".equals(pointId)) {
      List<ModbusPoint> poll = new ArrayList<>();
      for (ModbusPoint point : all) {
        if (point.pollable()) poll.add(point);
      }
      return poll;
    }
    return List.of(findReadable(pointId));
  }

  private ModbusPoint findReadable(String pointId) throws CommException {
    ModbusPoint point = find(pointId);
    if (!point.pollable()) throw config(point.id() + " is not readable");
    return point;
  }

  private ModbusPoint find(String id) throws CommException {
    for (ModbusPoint point : resolve()) {
      if (point.id().equals(id)) return point;
    }
    throw config("unknown point " + id);
  }

  private List<ModbusPoint> resolve() throws CommException {
    LinkDefinition current = link;
    List<ModbusPoint> out = new ArrayList<>();
    for (DataPoint point : current.points()) {
      try {
        String type = point.type().trim().toLowerCase(Locale.ROOT);
        int function = point.fc();
        int pdu = Addressing.toPdu(current.addressBase(), function, point.address());
        int width = RegisterCodec.width(type);
        Addressing.requireSpan(pdu, width);
        RegisterCodec.WordOrder word = RegisterCodec.wordOrder(point.wordOrder());
        RegisterCodec.Endian endian = RegisterCodec.endian(point.byteOrder());
        if (word == null || endian == null || !RegisterCodec.compatible(function, type)) {
          throw new IllegalArgumentException("bad point " + point.id());
        }
        int unit = point.unit() == null ? current.unitId() : point.unit();
        out.add(
            new ModbusPoint(
                point.id(),
                unit,
                function,
                pdu,
                width,
                type,
                word,
                endian,
                point.scale(),
                point.offset()));
      } catch (IllegalArgumentException ex) {
        throw config(point.id() + ": " + ex.getMessage());
      }
    }
    return out;
  }

  private void enter() {
    if (!busy.compareAndSet(false, true)) {
      throw new IllegalStateException("modbus tcp: one request in flight");
    }
  }

  private void leave() {
    busy.set(false);
  }

  private static IoResult ok(DriverContext ctx, IoRequest request, List<IoResult.PointUpdate> points) {
    String correlation = request != null && request.correlationId() != null
        ? request.correlationId()
        : ctx.correlationId();
    return new IoResult(true, correlation, points, null);
  }

  private static void warn(DriverContext ctx, String event, String detail) {
    ctx.log().warn(event, "MODBUS", detail, null, null, ctx.sessionId(), ctx.correlationId());
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }
}
