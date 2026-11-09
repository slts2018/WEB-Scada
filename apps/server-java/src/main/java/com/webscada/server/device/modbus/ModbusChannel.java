package com.webscada.server.device.modbus;

/**
 * Modbus 设备 channel：{@code host:port}、{@code host:port|字排序|双字排序}，
 * 或再加备用 {@code host:port|字排序|双字排序|备用host:port}。
 * 默认字排序 SwapNone、双字排序 SwapWords（兼容原 low-word-first）。
 * 备用留空时只连主地址。主断切备，备断切回主，备通着不主动切回主。
 */
public record ModbusChannel(
    String host,
    int port,
    ModbusSwap wordSwap,
    ModbusSwap dwordSwap,
    String backupHost,
    int backupPort) {

  public boolean hasBackup() {
    if (backupHost == null || backupHost.isBlank() || backupPort < 1 || backupPort > 65535) {
      return false;
    }
    return !(backupHost.equals(host) && backupPort == port);
  }

  public String activeHost(boolean backup) {
    return backup && hasBackup() ? backupHost : host;
  }

  public int activePort(boolean backup) {
    return backup && hasBackup() ? backupPort : port;
  }

  public static ModbusChannel parse(String channel) {
    if (channel == null || channel.isBlank()) return null;
    String[] parts = channel.trim().split("\\|");
    Endpoint primary = endpoint(parts[0], 0);
    if (primary == null) return null;
    ModbusSwap word =
        parts.length > 1 ? ModbusSwap.parse(parts[1], ModbusSwap.SwapNone) : ModbusSwap.SwapNone;
    ModbusSwap dword =
        parts.length > 2 ? ModbusSwap.parse(parts[2], ModbusSwap.SwapWords) : ModbusSwap.SwapWords;
    Endpoint backup = parts.length > 3 ? endpoint(parts[3], primary.port) : null;
    if (backup != null && backup.host.equals(primary.host) && backup.port == primary.port) {
      backup = null;
    }
    return new ModbusChannel(
        primary.host,
        primary.port,
        word,
        dword,
        backup == null ? null : backup.host,
        backup == null ? 0 : backup.port);
  }

  private static Endpoint endpoint(String raw, int defaultPort) {
    if (raw == null) return null;
    String hp = raw.trim();
    if (hp.isEmpty()) return null;
    int colon = hp.lastIndexOf(':');
    try {
      if (colon <= 0 || colon >= hp.length() - 1) {
        if (defaultPort < 1) return null;
        return new Endpoint(hp, defaultPort);
      }
      int port = Integer.parseInt(hp.substring(colon + 1).trim());
      String host = hp.substring(0, colon).trim();
      if (host.isEmpty() || port < 1 || port > 65535) return null;
      return new Endpoint(host, port);
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private record Endpoint(String host, int port) {}
}
