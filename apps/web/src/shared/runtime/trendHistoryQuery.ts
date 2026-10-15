import { apiGetTagHistory } from '@/shared/api/client'

/** 历史趋势的查询窗口，写入图元 props.range。 */
export const TREND_RANGES = [
  { id: '-15m', label: '最近15分钟' },
  { id: '-1h', label: '最近1小时' },
  { id: '-8h', label: '最近8小时' },
  { id: '-24h', label: '最近24小时' },
  { id: '-7d', label: '最近7天' },
] as const

export function trendRangeLabel(id: string): string {
  return TREND_RANGES.find((item) => item.id === id)?.label ?? '最近1小时'
}

interface TrendHistoryQuery {
  tagId: string
  start: string
  /** 绝对结束时间（RFC3339）。空着表示查到现在 */
  stop?: string
  limit: number
}

/** 图元上一次「按时间搜索」的绝对区间。有它时覆盖属性里的预设范围。 */
const customRange = new Map<string, { from: number; to: number }>()

export function trendHistorySearchOf(widgetId: string): { from: number; to: number } | undefined {
  return customRange.get(widgetId)
}

/** 标题栏上的时间说明：搜过就显示起止时间，否则用预设范围的名字 */
export function trendHistoryRangeText(widgetId: string, preset: string): string {
  const custom = customRange.get(widgetId)
  if (!custom) return trendRangeLabel(preset)
  const fmt = (ms: number) => {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return `${fmt(custom.from)} ~ ${fmt(custom.to)}`
}

export function setTrendHistorySearch(widgetId: string, from: number, to: number): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return
  customRange.set(widgetId, { from, to })
  const start = new Date(from).toISOString()
  const stop = new Date(to).toISOString()
  const prefix = `${widgetId}|`
  for (const [key, query] of queries) {
    if (!key.startsWith(prefix)) continue
    queries.set(key, { ...query, start, stop })
    void loadTrendHistory(key, true)
  }
}

/**
 * 缓存键 = `widgetId|tagId`。
 * 一个历史趋势图元可以绑多条曲线，每条曲线各自查一次 /api/tags/{tagId}/history，
 * 各自缓存、各自去重；轮询刷新时逐条刷新。
 */
function cacheKey(widgetId: string, tagId: string): string {
  return `${widgetId}|${tagId}`
}

const queries = new Map<string, TrendHistoryQuery>()
const seriesByKey = new Map<string, number[]>()
/** 同一条曲线的采样时间戳（ms），历史趋势用时间轴绘制时需要 */
const timesByKey = new Map<string, number[]>()
const loadedKey = new Map<string, string>()
const pendingKey = new Map<string, string>()
const generation = new Map<string, number>()
const loadedListeners = new Set<() => void>()

function queryKey(query: TrendHistoryQuery): string {
  return `${query.tagId}|${query.start}|${query.stop ?? ''}|${query.limit}`
}

function emitLoaded() {
  for (const listener of loadedListeners) listener()
}

/** 某控件的历史曲线加载完成后通知画面重绘。 */
export function onTrendHistoryLoaded(listener: () => void): () => void {
  loadedListeners.add(listener)
  return () => loadedListeners.delete(listener)
}

/** 已加载的历史点。还没返回过时为 undefined，调用方继续显示示例曲线。 */
export function trendHistorySeries(widgetId: string, tagId: string): number[] | undefined {
  return seriesByKey.get(cacheKey(widgetId, tagId))
}

/** 同一条曲线的时间戳（epoch ms）；用于历史趋势的时间轴 */
export function trendHistoryTimes(widgetId: string, tagId: string): number[] | undefined {
  const list = timesByKey.get(cacheKey(widgetId, tagId))
  return list && list.length ? list : undefined
}

/**
 * 旧路径（单曲线，没有 props.curves）用：取该图元第一条已注册查询的时间戳。
 * 单曲线模式下每个图元只会有一条查询。
 */
export function trendHistoryTimesForFirstQuery(widgetId: string): number[] | undefined {
  const prefix = `${widgetId}|`
  for (const [key, times] of timesByKey) {
    if (key.startsWith(prefix) && times.length) return times
  }
  return undefined
}

async function loadTrendHistory(key: string, force: boolean): Promise<void> {
  const query = queries.get(key)
  if (!query) return
  const qk = queryKey(query)
  if (!force && loadedKey.get(key) === qk) return
  if (!force && pendingKey.get(key) === qk) return
  const gen = (generation.get(key) ?? 0) + 1
  generation.set(key, gen)
  pendingKey.set(key, qk)
  try {
    const res = await apiGetTagHistory(query.tagId, {
      start: query.start,
      stop: query.stop,
      limit: query.limit,
    })
    if (generation.get(key) !== gen) return
    const points = res.points ?? []
    const series = points
      .map((point) => (typeof point.value === 'number' ? point.value : Number(point.value)))
      .filter((value) => Number.isFinite(value))
    const times = points
      .map((point) => Date.parse(String(point.time)))
      .filter((t) => Number.isFinite(t))
    seriesByKey.set(key, series)
    // 时间戳与值一一对应才用来画时间轴，否则退回按序号
    if (times.length === series.length && times.length) timesByKey.set(key, times)
    else timesByKey.delete(key)
    loadedKey.set(key, qk)
    emitLoaded()
  } catch {
    // 查询失败时保留上一份曲线。Influx 未启动时每次轮询都会失败，这里刻意不打日志，避免刷屏。
  } finally {
    if (generation.get(key) === gen) pendingKey.delete(key)
  }
}

/** 实时预览或运行时按当前变量和时间范围取历史。范围没变则不重复请求。 */
export function requestTrendHistory(
  widgetId: string,
  tagId: string,
  start: string,
  limit: number,
): void {
  const key = cacheKey(widgetId, tagId)
  const custom = customRange.get(widgetId)
  queries.set(key, {
    tagId,
    start: custom ? new Date(custom.from).toISOString() : start,
    stop: custom ? new Date(custom.to).toISOString() : undefined,
    limit,
  })
  void loadTrendHistory(key, false)
}

/** 曲线被删除 / 变量被换掉时释放缓存，避免继续无意义轮询。 */
export function releaseTrendHistory(widgetId: string, tagId: string): void {
  const key = cacheKey(widgetId, tagId)
  queries.delete(key)
  seriesByKey.delete(key)
  timesByKey.delete(key)
  loadedKey.delete(key)
  pendingKey.delete(key)
  generation.delete(key)
}

/** 轮询时刷新已经打开过的历史趋势控件（多条曲线各自刷新）。 */
export async function reloadTrendHistoryQueries(): Promise<void> {
  const keys = [...queries.keys()]
  await Promise.all(keys.map((key) => loadTrendHistory(key, true)))
}