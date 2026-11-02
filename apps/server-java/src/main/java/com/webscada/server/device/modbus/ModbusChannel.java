package com.webscada.server.device.modbus;

/**
 * Modbus 设备 channel：{@code host:port} 或 {@code host:port|字排序|双字排序}。
 * 默认字排序 SwapNone、双字排序 SwapWords（兼容原 low-word-first）。
 */
public record ModbusChannel(String host, int port, ModbusSwap wordSwap, ModbusSwap dwordSwap) {
  public static ModbusChannel parse(String channel) {
    if (channel == null || channel.isBlank()) return null;
    String[] parts = channel.trim().split("\\|");
    String hp = parts[0].trim();
    int colon = hp.lastIndexOf(':');
    if (colon <= 0 || colon >= hp.length() - 1) return null;
    try {
      int port = Integer.parseInt(hp.substring(colon + 1).trim());
      String host = hp.substring(0, colon).trim();
      if (host.isEmpty() || port < 1 || port > 65535) return null;
      ModbusSwap word =
          parts.length > 1 ? ModbusSwap.parse(parts[1], ModbusSwap.SwapNone) : ModbusSwap.SwapNone;
      ModbusSwap dword =
          parts.length > 2 ? ModbusSwap.parse(parts[2], ModbusSwap.SwapWords) : ModbusSwap.SwapWords;
      return new ModbusChannel(host, port, word, dword);
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
