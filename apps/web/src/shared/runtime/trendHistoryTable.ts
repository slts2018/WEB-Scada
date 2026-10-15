/**
 * 历史趋势点表（图下弹出的数据表）的显隐状态。
 *
 * 为什么单独一个模块：表是 HTML 叠层画的，但**图表要知道它占了多高**才能把绘图区让出来
 * （否则表会盖住下半部分曲线）。两边通过这里的开关对齐，和游标状态同一套做法：只放内存。
 */
const visible = new Set<string>()
const listeners = new Set<() => void>()

/** 点表在图元里占的高度（页面坐标） */
export const TREND_TABLE_H = 150

function emit(): void {
  for (const listener of listeners) listener()
}

export function trendHistoryTableVisibleOf(widgetId: string): boolean {
  return visible.has(widgetId)
}

export function setTrendHistoryTableVisible(widgetId: string, on: boolean): void {
  const had = visible.has(widgetId)
  if (on === had) return
  if (on) visible.add(widgetId)
  else visible.delete(widgetId)
  emit()
}

/** 图表底部要让出的高度（0 = 没有点表） */
export function trendHistoryTableHeightOf(widgetId: string): number {
  return visible.has(widgetId) ? TREND_TABLE_H : 0
}

export function onTrendHistoryTableChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}