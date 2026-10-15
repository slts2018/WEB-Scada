/**
 * 历史报警 → 历史趋势 的反向联动。
 *
 * 现场排查的动线是"表里看到一条报警 → 想看那一刻曲线"，所以点历史报警的一行，
 * 就把同一画面上的历史趋势跳到该时刻（窗口冻结到那一段 + 落游标）。
 *
 * 谁注册：运行端 / 实时预览挂载历史趋势工具条时登记（图元 + 它的曲线变量）。
 * 选谁跳：优先选"曲线里有这条报警变量"的趋势图元，没有就跳第一张。
 * 只改运行态窗口与游标，不写工程 JSON。
 */
import { setTrendHistoryCursor } from '@/shared/runtime/trendHistoryCursor'
import {
  setTrendHistoryFollow,
  setTrendHistoryWindow,
  trendHistoryWindowOf,
} from '@/shared/runtime/trendHistoryQuery'

export interface TrendHistoryLinkTarget {
  widgetId: string
  tagIds: string[]
}

const targets = new Map<string, TrendHistoryLinkTarget>()

/** 登记一个可被报警联动的历史趋势图元；返回注销函数 */
export function registerTrendHistoryLinkTarget(target: TrendHistoryLinkTarget): () => void {
  targets.set(target.widgetId, { widgetId: target.widgetId, tagIds: target.tagIds.slice() })
  return () => {
    const current = targets.get(target.widgetId)
    if (current && current.tagIds.join('|') === target.tagIds.join('|')) targets.delete(target.widgetId)
  }
}

export function trendHistoryLinkTargets(): TrendHistoryLinkTarget[] {
  return [...targets.values()]
}

export interface TrendHistoryJump {
  widgetId: string
  at: number
  /** 目标时刻不在原窗口里 → 顺势把窗口挪过去 */
  windowMoved: boolean
}

/**
 * 把**指定**图元的游标跳到某个时刻（工具栏「时刻」控件 = 手动选/输一个时间点）。
 * 报警联动与工具栏共用这一份：
 *  1. 先冻结窗口 —— 跟随模式下窗口一直滚，刚落的游标马上飘出视口；
 *  2. 该时刻不在当前区间里 → 按当前跨度把它挪到窗口中间
 *     （右边缘超过"现在"时整段左移，不给还没发生的时间留空）；
 *  3. 最后落游标（读数自动吸附到最近的采样点）。
 */
export function jumpTrendHistoryWidgetToTime(
  widgetId: string,
  at: number,
): { windowMoved: boolean } {
  if (!Number.isFinite(at) || at <= 0) return { windowMoved: false }
  const win = trendHistoryWindowOf(widgetId)
  const span = win && win.to > win.from ? win.to - win.from : 3600_000
  setTrendHistoryFollow(widgetId, false)
  const inside = win != null && at >= win.from && at <= win.to
  if (!inside) {
    const half = Math.max(1000, Math.round(span / 2))
    const now = Date.now()
    let from = Math.round(at - half)
    let to = Math.round(at + half)
    if (to > now) {
      to = now
      from = to - span
    }
    setTrendHistoryWindow(widgetId, from, to)
  }
  setTrendHistoryCursor(widgetId, at)
  return { windowMoved: !inside }
}

/** 历史报警点一行 → 挑一张趋势图元跳过去（优先"曲线里有这条变量"的那张） */
export function jumpTrendHistoryToTime(at: number, tagId?: string): TrendHistoryJump | null {
  if (!Number.isFinite(at)) return null
  const list = [...targets.values()]
  if (!list.length) return null
  const byTag = tagId ? list.find((item) => item.tagIds.includes(tagId)) : undefined
  const target = byTag ?? list[0]
  if (!target) return null
  const { windowMoved } = jumpTrendHistoryWidgetToTime(target.widgetId, at)
  return { widgetId: target.widgetId, at, windowMoved }
}
