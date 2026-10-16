/**
 * 历史趋势点表（图下弹出的数据表）的显隐、翻页与高度。
 *
 * 为什么单独一个模块：表是 HTML 叠层画的，但**图表要知道它占了多高**才能把绘图区让出来。
 * 两边必须用同一份高度 —— 所以高度由图元在屏幕上的实际尺寸算（`trendTableHeightFor`），
 * 图表侧（trendNativeCharts）和表本身（TrendHistoryTable.vue）都调它，不会再出现
 * "表画在上面、图把下面让出来"导致曲线被压扁的情况。
 *
 * 表贴在**图元底部**（`chromeBottom` 让出的那一条），不是工具栏下面。
 */
const visible = new Set<string>()
const listeners = new Set<() => void>()
/** 图表侧算好并写回来的"点表实际占多高"（屏幕像素）—— 表本身按这个值撑开 */
const heights = new Map<string, number>()

/** 点表高度上限/下限（屏幕像素） */
export const TREND_TABLE_MAX_H = 150
export const TREND_TABLE_MIN_H = 56

/** 每页行数可选项 */
export const TREND_TABLE_PAGE_SIZES = [11, 20, 50, 100] as const

interface TablePageState {
  page: number
  size: number
}

const pageState = new Map<string, TablePageState>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * 绘图区至少留多高（屏幕像素）：点表只能吃"剩下的"，
 * 不然短图元上"给表 150px"会把曲线压成一条缝。
 */
const MIN_PLOT_H = 90

/**
 * 点表能占多高：`availablePlot` 是"没有表时绘图区能有多少高"（图表按真实排版算出来的），
 * 让出 MIN_PLOT_H 之后剩下的都归表，再夹到 56~150px。
 */
export function trendTableHeightBudget(availablePlot: number): number {
  const avail = Number.isFinite(availablePlot) && availablePlot > 0 ? availablePlot : 0
  const rest = Math.round(avail - MIN_PLOT_H)
  return Math.max(TREND_TABLE_MIN_H, Math.min(TREND_TABLE_MAX_H, rest))
}

/** 兜底（图表还没报过高度时按图元高度估一个）：最多四成、56~150px */
export function trendTableHeightFor(widgetHeight: number): number {
  const h = Number.isFinite(widgetHeight) && widgetHeight > 0 ? widgetHeight : 0
  if (!h) return TREND_TABLE_MAX_H
  return Math.max(TREND_TABLE_MIN_H, Math.min(TREND_TABLE_MAX_H, Math.round(h * 0.35)))
}

export function trendHistoryTableVisibleOf(widgetId: string): boolean {
  return visible.has(widgetId)
}

export function setTrendHistoryTableVisible(widgetId: string, on: boolean): void {
  const had = visible.has(widgetId)
  if (on === had) return
  if (on) visible.add(widgetId)
  else {
    visible.delete(widgetId)
    // 关掉就忘掉翻页位置：下次打开还是第 1 页（不然会停在上次翻到的页码上）
    pageState.delete(widgetId)
  }
  emit()
}

/** 图表算好的点表高度写回来（自己会 emit，让表和图表同步重排） */
export function setTrendHistoryTableHeight(widgetId: string, height: number): void {
  const next = Math.max(0, Math.round(Number.isFinite(height) ? height : 0))
  if (heights.get(widgetId) === next) return
  heights.set(widgetId, next)
  emit()
}

/** 图表底部要让出的高度（屏幕像素；0 = 没有点表） */
export function trendHistoryTableHeightOf(widgetId: string): number {
  if (!visible.has(widgetId)) return 0
  return heights.get(widgetId) ?? 0
}

/** 翻页状态（运行态，不写工程） */
export function trendHistoryTablePageOf(widgetId: string): TablePageState {
  const existing = pageState.get(widgetId)
  if (existing) return existing
  const next: TablePageState = { page: 1, size: TREND_TABLE_PAGE_SIZES[0] }
  pageState.set(widgetId, next)
  return next
}

export function setTrendHistoryTablePage(widgetId: string, page: number, size?: number): void {
  const state = trendHistoryTablePageOf(widgetId)
  const nextSize = size == null ? state.size : Math.max(1, Math.trunc(size) || state.size)
  const nextPage = Math.max(1, Math.trunc(page) || 1)
  if (state.page === nextPage && state.size === nextSize) return
  state.page = nextPage
  state.size = nextSize
  emit()
}


export function onTrendHistoryTableChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
