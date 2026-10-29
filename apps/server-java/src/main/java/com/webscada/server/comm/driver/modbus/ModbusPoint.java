package com.webscada.server.comm.driver.modbus;

import com.webscada.server.comm.driver.modbus.RegisterCodec.Endian;
import com.webscada.server.comm.driver.modbus.RegisterCodec.WordOrder;

public record ModbusPoint(
    String id,
    int unit,
    int function,
    int pduAddress,
    int width,
    String type,
    WordOrder wordOrder,
    Endian endian,
    double scale,
    double offset) {

  public boolean bit() {
    return "bool".equals(type);
  }

  public boolean pollable() {
    return function >= 1 && function <= 4;
  }
}
