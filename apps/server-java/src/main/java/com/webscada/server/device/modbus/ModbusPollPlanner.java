package com.webscada.server.device.modbus;

/**
 * Modbus 采集节拍与到期合并规则（纯计算，无 IO）。
 *
 * <ul>
 *   <li>每个变量按自己的 {@code scanPeriodMs} 独立到期。
 *   <li>{@code nextDue += period}；已超期则跳过错过的节拍，排到下一个未来时刻，不追赶、不按结束时间排程。
 *   <li>采集组 = 同一设备 + 同一扫描周期；不同周期（如 50ms 与 70ms）不能分到一组、也不能合并采集。
 *   <li>对齐窗口只用于已到期附近几乎同时到期的同组变量（默认 3ms），不会提前采集未到期点。
 * </ul>
 */
final class ModbusPollPlanner {
  /** 近同时到期对齐窗口，3ms。 */
  static final long ALIGN_NS = 3_000_000L;

  private ModbusPollPlanner() {}

  /** 与界面缺省一致：空则 50ms，最小 50ms。不改变配置字段本身。 */
  static int scanPeriodMs(Integer configured) {
    int ms = configured == null ? 50 : configured;
    return Math.max(50, ms);
  }

  static long periodNs(int periodMs) {
    return periodMs * 1_000_000L;
  }

  /** 采集组键：设备 + 扫描周期。 */
  static String groupKey(String deviceId, int periodMs) {
    return deviceId + "|" + periodMs;
  }

  /**
   * 本次已按 {@code scheduledDueNs} 开工后，计算下一拍。
   * 不使用「实际结束时间 + 周期」。若下一拍已过或恰为当前时刻，继续累加周期直到落在未来。
   */
  static long nextBeat(long scheduledDueNs, long periodNs, long nowNs) {
    if (periodNs <= 0) {
      throw new IllegalArgumentException("periodNs");
    }
    long next = scheduledDueNs + periodNs;
    if (next > nowNs) return next;
    long skipped = (nowNs - next) / periodNs;
    next += (skipped + 1) * periodNs;
    if (next <= nowNs) next += periodNs;
    return next;
  }

  /** 已经到期（到达或超过预定时刻）。未到期的点不得采集。 */
  static boolean isDue(long nextDueNs, long nowNs) {
    return nextDueNs <= nowNs;
  }

  /**
   * 同组内若已有到期点，且另有点将在对齐窗口内到期，则返回应再等待的纳秒数。
   * 不会把窗口外或不同组的点拉进来。若当前已明显迟到，不再为对齐而等待。
   */
  static long alignmentWaitNs(long nowNs, long[] dueTimesNs) {
    return alignmentWaitNs(nowNs, dueTimesNs, ALIGN_NS);
  }

  static long alignmentWaitNs(long nowNs, long[] dueTimesNs, long alignNs) {
    if (dueTimesNs == null || dueTimesNs.length == 0) return 0L;
    boolean anyDue = false;
    long earliestDue = Long.MAX_VALUE;
    long wait = 0L;
    for (long due : dueTimesNs) {
      if (due <= nowNs) {
        anyDue = true;
        if (due < earliestDue) earliestDue = due;
      } else if (due - nowNs <= alignNs) {
        wait = Math.max(wait, due - nowNs);
      }
    }
    if (!anyDue || wait <= 0L) return 0L;
    // 已迟到超过对齐窗口时不再拖延，避免把调度误差再放大。
    if (nowNs - earliestDue > alignNs) return 0L;
    return wait;
  }
}
