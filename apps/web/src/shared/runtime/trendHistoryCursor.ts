/**
 * 历史趋势的游标（竖线读数）。
 *
 * 为什么单独一个模块：游标是"看数据的方式"，属于运行态，不能写进工程 JSON；
 * 和 trendZoomOf / trendHistoryQuery 的窗口状态一样放内存里，按 图元 id 存。
 *
 * 取值语义：默认**吸附到最近采样点**（返回 snapped 供界面标注），
 * 不做插值 —— 历史库里没有的点不凭空造一个出来。
 */
import {
  trendHistoryQualities,
  trendHistorySeries,
  trendHistoryTimes,
} from '@/shared/runtime/trendHistoryQuery'

const cursors = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 游标变化（落点/移动/清除）→ 通知界面重画读数与曲线 */
export function onTrendHistoryCursor(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTrendHistoryCursor(widgetId: string, at: number): void {
  if (!Number.isFinite(at)) return
  cursors.set(widgetId, at)
  emit()
}

export function clearTrendHistoryCursor(widgetId: string): void {
  if (!cursors.delete(widgetId)) return
  emit()
}

/** 当前游标时间（epoch ms）；null = 没有游标 */
export function trendHistoryCursorOf(widgetId: string): number | null {
  const at = cursors.get(widgetId)
  return typeof at === 'number' ? at : null
}

export interface CursorRow {
  tagId: string
  /** 该曲线在游标处的值；null = 那一段是缺口（质量坏/没数据） */
  value: number | null
  quality: string | null
  /** 实际吸附到的采样时间 */
  snapped: number | null
}

export interface CursorReadout {
  time: number
  rows: CursorRow[]
}

/** 二分找 <= at 的最近采样点（没有则取第一个点） */
function nearestIndex(times: number[], at: number): number {
  let lo = 0
  let hi = times.length - 1
  if (hi < 0) return -1
  if (at <= (times[0] as number)) return 0
  if (at >= (times[hi] as number)) return hi
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((times[mid] as number) <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 游标处的读数（时间 + 每条曲线吸附到的值/质量） */
export function trendHistoryCursorReadout(widgetId: string, tagIds: string[]): CursorReadout | null {
  const at = trendHistoryCursorOf(widgetId)
  if (at == null) return null
  const rows: CursorRow[] = []
  for (const tagId of tagIds) {
    const times = trendHistoryTimes(widgetId, tagId)
    const values = trendHistorySeries(widgetId, tagId)
    const qualities = trendHistoryQualities(widgetId, tagId)
    if (!times || !values) {
      rows.push({ tagId, value: null, quality: null, snapped: null })
      continue
    }
    const i = nearestIndex(times, at)
    const snapped = i >= 0 ? (times[i] as number) : null
    const value = i >= 0 ? (values[i] as number | null) : null
    const quality = i >= 0 ? (qualities?.[i] ?? null) : null
    rows.push({ tagId, value: typeof value === 'number' ? value : null, quality, snapped })
  }
  return { time: at, rows }
}

/** 把游标按"采样点"前后移动一格（面板上的 ◀ / ▶） */
export function stepTrendHistoryCursor(widgetId: string, dir: -1 | 1, tagIds: string[]): void {
  const all: number[] = []
  for (const tagId of tagIds) {
    const times = trendHistoryTimes(widgetId, tagId)
    if (times) all.push(...times)
  }
  if (!all.length) return
  const sorted = [...new Set(all)].sort((a, b) => a - b)
  const at = trendHistoryCursorOf(widgetId)
  if (at == null) {
    setTrendHistoryCursor(widgetId, dir > 0 ? (sorted[0] as number) : (sorted[sorted.length - 1] as number))
    return
  }
  const i = nearestIndex(sorted, at)
  const next = sorted[Math.min(sorted.length - 1, Math.max(0, i + dir))]
  if (typeof next === 'number') setTrendHistoryCursor(widgetId, next)
}

/** 复制到工单/聊天用的单行文本 */
export function trendHistoryCursorText(widgetId: string, tagIds: string[]): string {
  const readout = trendHistoryCursorReadout(widgetId, tagIds)
  if (!readout) return ''
  const at = new Date(readout.time)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`
  const parts = readout.rows.map(
    (row) => `${row.tagId}=${row.value == null ? '—' : String(row.value)}`,
  )
  return `${stamp}  ${parts.join('  ')}`
}