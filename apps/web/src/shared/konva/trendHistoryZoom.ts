/**
 * 历史趋势"缩放 → 按新窗口重查"的小桥接。
 *
 * 为什么需要它：`trendZoomOf` 本来是**纯显示**的缩放（存的是当前数据窗口的 0~1 百分比），
 * 数据只查一次；历史区间一长就会失真 —— 24 小时 x 2000 点，放大到 1 分钟只剩约 1.4 个点，
 * 图上是空的。所以历史趋势在缩放/框选结束后按新窗口重新查询，
 * 等新数据回来再把显示缩放清掉（新窗口就是整段数据窗口）。
 */
import type { Widget2D } from '@web-scada/core'
import { setTrendZoom } from '@/shared/konva/trendChart'
import {
  onTrendHistoryLoaded,
  setTrendHistoryWindow,
  trendHistoryStatusOf,
  trendHistoryWindowOf,
} from '@/shared/runtime/trendHistoryQuery'

export interface TrendHistoryZoomBridge {
  /** 原生叠层 / 位图路径缩放变化时调用 */
  handleZoom: (widgetId: string, zoom: { start: number; end: number } | null) => void
  /** 双击还原：只清显示缩放，不重查 */
  handleReset: (widgetId: string) => void
  dispose: () => void
}

export function createTrendHistoryZoomBridge(opts: {
  resolveWidget: (widgetId: string) => Widget2D | undefined
  /** 数据到位后重画（原生叠层 + 位图都刷） */
  repaint: () => void
  /** 缩放后重查的防抖（毫秒）：滚轮会连续触发，别每次都查 */
  debounceMs?: number
}): TrendHistoryZoomBridge {
  const debounceMs = Math.max(120, opts.debounceMs ?? 400)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** widgetId → 发起重查的时间；新数据回来后清显示缩放 */
  const pending = new Map<string, number>()

  const off = onTrendHistoryLoaded(() => {
    if (!pending.size) return
    const now = Date.now()
    let changed = false
    for (const [widgetId, since] of [...pending]) {
      const status = trendHistoryStatusOf(widgetId)
      // updatedAt 比发起时间新 = 这次缩放对应的数据已经回来了
      if (status && status.updatedAt >= since && !status.error) {
        pending.delete(widgetId)
        setTrendZoom(widgetId, null)
        changed = true
      } else if (now - since > 15000) {
        pending.delete(widgetId)
      }
    }
    if (changed) opts.repaint()
  })

  const handleZoom = (widgetId: string, zoom: { start: number; end: number } | null) => {
    const widget = opts.resolveWidget(widgetId)
    if (!widget || widget.type !== 'trendHistory') return
    if (!zoom) return
    const prev = timers.get(widgetId)
    if (prev) clearTimeout(prev)
    timers.set(
      widgetId,
      setTimeout(() => {
        timers.delete(widgetId)
        const win = trendHistoryWindowOf(widgetId)
        if (!win) return
        const span = win.to - win.from
        if (!Number.isFinite(span) || span <= 0) return
        const from = Math.round(win.from + span * zoom.start)
        const to = Math.round(win.from + span * zoom.end)
        if (to - from < 1000) return
        pending.set(widgetId, Date.now())
        setTrendHistoryWindow(widgetId, from, to)
      }, debounceMs),
    )
  }

  const handleReset = (widgetId: string) => {
    const timer = timers.get(widgetId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(widgetId)
    }
    setTrendZoom(widgetId, null)
    opts.repaint()
  }

  return {
    handleZoom,
    handleReset,
    dispose: () => {
      off()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      pending.clear()
    },
  }
}