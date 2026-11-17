package com.webscada.server.device.modbus;

import java.io.IOException;

/** Modbus 读写会话。TCP 与 UDP 共用功能码和异常文案，传输各自实现。 */
interface ModbusClient extends AutoCloseable {
  String host();

  int port();

  void ensureConnected() throws IOException;

  int[] readRegisters(int fc, int address, int quantity) throws IOException;

  boolean[] readBits(int fc, int address, int quantity) throws IOException;

  void writeSingleRegister(int address, int value) throws IOException;

  void writeRegisters(int address, int[] values) throws IOException;

  void writeCoil(int address, boolean on) throws IOException;

  @Override
  void close();
}
