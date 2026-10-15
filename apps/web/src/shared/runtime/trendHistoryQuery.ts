import { apiQueryTagHistory } from '@/shared/api/client'

/**
 * 历史趋势的数据层：**每个图元一次批量查询**（不再每条曲线各发一次）。
 *
 * 为什么改成批量：一张 8 曲线的历史图原来要发 8 次 HTTP，而且各曲线的
 * start/stop 各自算，容易对不齐；现在一条 `GET /api/tags/history/batch` 查完，
 * 服务端顺手按跨度做聚合（见 §4.1 方案），前端只负责窗口、缓存与状态。
 *
 * 为什么窗口状态放这里而不写工程 JSON：运行端改区间/缩放属于"看数据的方式"，
 * 和工程配置无关（同 trendSeries / trendZoomOf 的做法）。
 */

/** 历史趋势图元顶部工具栏的高度（页面坐标，与 trendChartLayout 预留的空位一致） */
export const TREND_TOOLBAR_H = 26

/** 工具栏在图元内的位置，换算到定位父元素的像素坐标（与 historySearchClientRect 同一套做法） */
export function trendToolbarClientRect(
  point: (p: { x: number; y: number }) => { x: number; y: number },
  widget: { transform: { width: number; height: number } },
  origin = { x: 0, y: 0 },
) {
  const top = 2
  const p1 = point({ x: 6, y: top })
  const p2 = point({ x: Math.max(12, widget.transform.width - 6), y: top + TREND_TOOLBAR_H - 4 })
  return {
    x: origin.x + Math.min(p1.x, p2.x),
    y: origin.y + Math.min(p1.y, p2.y),
    w: Math.max(60, Math.abs(p2.x - p1.x)),
    h: Math.max(16, Math.abs(p2.y - p1.y)),
  }
}

/** 设计端预设区间（props.range） */
export const TREND_RANGES = [
  { id: '-15m', label: '最近15分钟' },
  { id: '-1h', label: '最近1小时' },
  { id: '-8h', label: '最近8小时' },
  { id: '-24h', label: '最近24小时' },
  { id: '-7d', label: '最近7天' },
] as const

const PRESET_MS: Record<string, number> = {
  '-15m': 15 * 60 * 1000,
  '-1h': 60 * 60 * 1000,
  '-8h': 8 * 60 * 60 * 1000,
  '-24h': 24 * 60 * 60 * 1000,
  '-7d': 7 * 24 * 60 * 60 * 1000,
}

export function trendRangeLabel(id: string): string {
  return TREND_RANGES.find((item) => item.id === id)?.label ?? '最近1小时'
}

export function trendPresetSpanMs(id: string): number {
  return PRESET_MS[id] ?? PRESET_MS['-1h']
}

/** 采样间隔（运行端/设计端可选）：auto = 按跨度自动聚合；raw = 原始点 */
export const TREND_INTERVALS = [
  { id: 'auto', label: '自动' },
  { id: 'raw', label: '原始点' },
  { id: '1s', label: '1 秒' },
  { id: '5s', label: '5 秒' },
  { id: '30s', label: '30 秒' },
  { id: '1m', label: '1 分钟' },
  { id: '5m', label: '5 分钟' },
  { id: '1h', label: '1 小时' },
] as const

export function trendIntervalLabel(id: string): string {
  return TREND_INTERVALS.find((item) => item.id === id)?.label ?? '自动'
}

export type TrendHistoryState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface TrendHistoryWindow {
  from: number
  to: number
}

export interface TrendHistoryStatus {
  state: TrendHistoryState
  /** 'influx_unavailable' 等错误码 / 文本；无错时为 null */
  error: string | null
  window: TrendHistoryWindow | null
  preset: string
  /** 实际生效的采样间隔（auto/raw 或 1s/5s/...） */
  interval: string
  /** 服务端实际使用的聚合窗口（如 "30s"），raw 时为 null */
  aggWindow: string | null
  follow: boolean
  queryMs: number
  updatedAt: number
  /** 已开过历史保存、但区间内没有点 */
  emptyTags: string[]
}

interface CurveHistory {
  t: number[]
  v: Array<number | null>
  q: Array<string | null>
  /** 末端实时点：窗口跟随时用它把曲线接到"现在" */
  live: { t: number; v: number | null; q: string | null } | null
}

interface WidgetHistory {
  widgetId: string
  tagIds: string[]
  preset: string
  propInterval: string
  /** 运行端选的间隔（优先于 props） */
  runtimeInterval: string | null
  /** 手动搜索 / 缩放后的绝对窗口；有它时覆盖 preset */
  custom: TrendHistoryWindow | null
  /**
   * custom 是不是"没跟随 → 自动冻结的相对预设"。
   * 是的话「刷新」= 重新按预设取到最新的一段；手动设的绝对窗口则原样重查。
   */
  autoFrozen: boolean
  follow: boolean
  maxPoints: number
  series: Map<string, CurveHistory>
  status: TrendHistoryStatus
  generation: number
  loading: boolean
  loadedKey: string
  dirty: boolean
  customRange: TrendHistoryWindow | null
}

const widgets = new Map<string, WidgetHistory>()
const loadedListeners = new Set<() => void>()

function emitLoaded(): void {
  for (const listener of loadedListeners) listener()
}

/** 某控件的历史曲线加载/状态变化后通知画面重绘（工具栏也靠它刷新状态） */
export function onTrendHistoryLoaded(listener: () => void): () => void {
  loadedListeners.add(listener)
  return () => loadedListeners.delete(listener)
}

function ensureWidget(widgetId: string, preset = '-1h'): WidgetHistory {
  let w = widgets.get(widgetId)
  if (!w) {
    w = {
      widgetId,
      tagIds: [],
      preset,
      propInterval: 'auto',
      runtimeInterval: null,
      custom: null,
      autoFrozen: false,
      // 历史趋势默认**不跟随**：区间是"一次查询的静态快照"（见 loadWidget 里的冻结），
      // 想看滚动/自动刷新要显式勾工具条上的"跟随"。
      follow: false,
      maxPoints: 240,
      series: new Map(),
      status: {
        state: 'idle',
        error: null,
        window: null,
        preset,
        interval: 'auto',
        aggWindow: null,
        follow: false,
        queryMs: 0,
        updatedAt: 0,
        emptyTags: [],
      },
      generation: 0,
      loading: false,
      loadedKey: '',
      dirty: false,
      customRange: null,
    }
    widgets.set(widgetId, w)
  }
  return w
}

function effectiveInterval(w: WidgetHistory): string {
  const id = w.runtimeInterval ?? w.propInterval ?? 'auto'
  return TREND_INTERVAL_IDS.has(id) ? id : 'auto'
}

const TREND_INTERVAL_IDS = new Set<string>([...TREND_INTERVALS.map((i) => i.id)])

/** 当前窗口：自定义（搜索/缩放）优先，否则按预设相对"现在" */
export function effectiveTrendWindow(w: WidgetHistory): TrendHistoryWindow {
  if (w.custom) return w.custom
  const to = Date.now()
  return { from: to - trendPresetSpanMs(w.preset), to }
}

function intervalToQuery(interval: string): { agg: string; window: string | null } {
  if (interval === 'raw') return { agg: 'none', window: null }
  if (interval === 'auto') return { agg: 'auto', window: null }
  return { agg: 'mean', window: interval }
}

function queryKey(w: WidgetHistory): string {
  const { agg, window } = intervalToQuery(effectiveInterval(w))
  const tags = w.tagIds.slice().sort().join(',')
  const rangeKey = w.custom
    ? `${Math.round(w.custom.from)}-${Math.round(w.custom.to)}`
    : `rel:${w.preset}`
  return `${tags}|${rangeKey}|${w.maxPoints}|${agg}|${window ?? ''}`
}

/** 一次渲染里会对同一图元调用多次 requestTrendHistory：微任务里合并成一次请求 */
let flushScheduled = false
function scheduleFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    for (const w of [...widgets.values()]) {
      if (w.dirty) void loadWidget(w, false)
    }
  })
}

async function loadWidget(w: WidgetHistory, force: boolean): Promise<void> {
  if (!w.tagIds.length) return
  w.dirty = false
  // 没开"跟随" = 静态区间：相对预设（-1h / -24h …）只在**第一次查询**时按"现在"解析一次，
  // 然后固定成绝对窗口。否则每次查询都按新的"现在"重算，曲线会像实时趋势一样一直往前爬
  // （现场看到的就是"历史曲线也在实时刷新"）。
  if (!w.follow && !w.custom) {
    w.custom = effectiveTrendWindow(w)
    w.customRange = w.custom
    w.autoFrozen = true
  }
  const key = queryKey(w)
  if (!force && w.loadedKey === key) return
  if (!force && w.loading) return
  const win = effectiveTrendWindow(w)
  const { agg, window } = intervalToQuery(effectiveInterval(w))
  const gen = ++w.generation
  w.loading = true
  w.status = {
    ...w.status,
    state: w.series.size ? w.status.state : 'loading',
    error: null,
    window: win,
    preset: w.preset,
    interval: effectiveInterval(w),
    follow: w.follow,
  }
  emitLoaded()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('trend history timeout', 'TimeoutError')), 25_000)
  const started = Date.now()
  try {
    const res = await apiQueryTagHistory({
      tagIds: w.tagIds,
      start: new Date(win.from).toISOString(),
      stop: new Date(win.to).toISOString(),
      maxPoints: w.maxPoints,
      agg,
      window,
      signal: ctrl.signal,
    })
    if (w.generation !== gen) return
    const emptyTags: string[] = []
    const next = new Map<string, CurveHistory>()
    for (const tagId of w.tagIds) next.set(tagId, { t: [], v: [], q: [], live: w.series.get(tagId)?.live ?? null })
    for (const item of res.series ?? []) {
      const bucket = next.get(item.tagId)
      if (!bucket) continue
      const seen = new Set<number>()
      const rows: Array<{ t: number; v: number | null; q: string | null }> = []
      for (const point of item.points ?? []) {
        const t = Date.parse(String(point.time))
        if (!Number.isFinite(t) || seen.has(t)) continue
        seen.add(t)
        const raw = point.value
        const num = typeof raw === 'number' ? raw : raw == null || raw === '' ? null : Number(raw)
        rows.push({ t, v: num != null && Number.isFinite(num) ? num : null, q: point.quality ?? null })
      }
      // 同一时刻可能有多条（写值 / 质量变化各一条）：按时间去重、保留最后一条
      rows.sort((a, b) => a.t - b.t)
      for (const row of rows) {
        bucket.t.push(row.t)
        bucket.v.push(row.v)
        bucket.q.push(row.q)
      }
      if (!bucket.t.length) emptyTags.push(item.tagId)
    }
    w.series = next
    w.loadedKey = key
    w.status = {
      ...w.status,
      state: next.size && [...next.values()].some((c) => c.t.length) ? 'ready' : 'empty',
      error: null,
      window: { from: Date.parse(res.from) || win.from, to: Date.parse(res.to) || win.to },
      aggWindow: res.window ?? null,
      interval: res.agg === 'none' ? 'raw' : effectiveInterval(w),
      queryMs: Date.now() - started,
      updatedAt: Date.now(),
      emptyTags,
    }
  } catch (err) {
    if (w.generation !== gen) return
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    if (!aborted) {
      const message =
        err && typeof err === 'object' && 'status' in err && 'body' in err
          ? String((err as { body?: { error?: string } }).body?.error ?? (err as { status?: number }).status)
          : String((err as Error)?.message ?? err)
      w.status = { ...w.status, state: w.series.size ? w.status.state : 'error', error: message, updatedAt: Date.now() }
    }
  } finally {
    clearTimeout(timer)
    if (w.generation === gen) w.loading = false
    emitLoaded()
  }
}

/** 图元在渲染时声明"我要这条曲线的历史"（每次求值都会调，必须幂等且廉价） */
export function requestTrendHistory(
  widgetId: string,
  tagId: string,
  start: string,
  limit: number,
  interval?: string,
): void {
  const w = ensureWidget(widgetId, start || '-1h')
  const nextLimit = Math.max(10, Math.min(5000, limit || 240))
  let changed = false
  if (w.preset !== (start || '-1h')) {
    w.preset = start || '-1h'
    // 预设变了（设计端改了"时间范围"）→ 丢掉旧的绝对窗口，按新预设重新解析一次
    w.custom = null
    w.customRange = null
    w.autoFrozen = false
    changed = true
  }
  if (w.maxPoints !== nextLimit) {
    w.maxPoints = nextLimit
    changed = true
  }
  if (interval && w.propInterval !== interval) {
    w.propInterval = interval
    changed = true
  }
  if (!w.tagIds.includes(tagId)) {
    w.tagIds.push(tagId)
    changed = true
  }
  if (changed) {
    w.dirty = true
    scheduleFlush()
  }
}

/**
 * 已加载的历史点（还没返回过时 undefined，调用方继续显示示例曲线）。
 * null = 该时刻没有有效值（质量坏），折线会在那里断开 —— 与实时趋势语义一致。
 */
export function trendHistorySeries(widgetId: string, tagId: string): Array<number | null> | undefined {
  const curve = widgets.get(widgetId)?.series.get(tagId)
  if (!curve || !curve.t.length) return undefined
  const values = curve.v.slice()
  if (curve.live && curve.live.t > (curve.t[curve.t.length - 1] ?? 0)) values.push(curve.live.v)
  return values
}

/** 同一条曲线的时间戳（epoch ms），历史趋势画时间轴用 */
export function trendHistoryTimes(widgetId: string, tagId: string): number[] | undefined {
  const curve = widgets.get(widgetId)?.series.get(tagId)
  if (!curve || !curve.t.length) return undefined
  const times = curve.t.slice()
  if (curve.live && curve.live.t > (curve.t[curve.t.length - 1] ?? 0)) times.push(curve.live.t)
  return times
}

/** 旧路径（单曲线）用：取该图元第一条有数据的曲线时间戳 */
export function trendHistoryTimesForFirstQuery(widgetId: string): number[] | undefined {
  const w = widgets.get(widgetId)
  if (!w) return undefined
  for (const tagId of w.tagIds) {
    const times = trendHistoryTimes(widgetId, tagId)
    if (times?.length) return times
  }
  return undefined
}

/** 曲线质量（与 times 一一对应），缺省 null = 未知 */
export function trendHistoryQualities(widgetId: string, tagId: string): Array<string | null> | undefined {
  const curve = widgets.get(widgetId)?.series.get(tagId)
  if (!curve || !curve.t.length) return undefined
  const out = curve.q.slice()
  if (curve.live && curve.live.t > (curve.t[curve.t.length - 1] ?? 0)) out.push(curve.live.q)
  return out
}

/** 末端接实时值：窗口跟随时把当前实时点接到曲线末端（下一次查询会覆盖它） */
export function appendTrendHistoryLivePoint(
  widgetId: string,
  tagId: string,
  t: number,
  v: number | null,
  quality: string | null,
): void {
  const w = widgets.get(widgetId)
  const curve = w?.series.get(tagId)
  if (!w || !curve || !curve.t.length || !Number.isFinite(t)) return
  if (w.custom && Date.now() - w.custom.to > 5000) return
  curve.live = { t, v, q: quality }
}

export function trendHistoryStatusOf(widgetId: string): TrendHistoryStatus | null {
  const w = widgets.get(widgetId)
  return w ? w.status : null
}

export function trendHistoryWindowOf(widgetId: string): TrendHistoryWindow | null {
  const w = widgets.get(widgetId)
  return w ? effectiveTrendWindow(w) : null
}

/** 当前生效的预设区间 id（运行端在工具条上改过就以改过的为准，不再是设计端的 props.range） */
export function trendHistoryPresetOf(widgetId: string): string {
  return widgets.get(widgetId)?.preset ?? ''
}

/**
 * 当前窗口是不是"用户自己指定的绝对区间"（起止时间 / 缩放 / 平移 / 报警跳转）。
 * 是的话工具条上的区间下拉要显示"自定义区间"，否则会让人以为还在按预设（比如"最近1小时"）取数，
 * 而实际窗口是另一段绝对时间。
 */
export function trendHistoryIsManualWindow(widgetId: string): boolean {
  const w = widgets.get(widgetId)
  return Boolean(w?.custom && !w.autoFrozen)
}

export function trendHistorySearchOf(widgetId: string): TrendHistoryWindow | undefined {
  return widgets.get(widgetId)?.customRange ?? undefined
}

function fmt(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 标题栏上的时间说明：搜过/缩放过显示起止，否则用预设名；聚合时补一句"按 Xs 平均" */
export function trendHistoryRangeText(widgetId: string, preset: string): string {
  const w = widgets.get(widgetId)
  const win = effectiveTrendWindow(w ?? ensureWidget(widgetId, preset))
  const base = w?.custom ? `${fmt(win.from)} ~ ${fmt(win.to)}` : trendRangeLabel(preset)
  const status = w?.status
  if (status?.aggWindow) return `${base} · 按 ${status.aggWindow} 平均`
  if (status?.interval === 'raw') return `${base} · 原始点`
  return base
}

/** 查询失败/空数据时给图元用的提示（null = 一切正常） */
export function trendHistoryNoticeOf(widgetId: string): { kind: 'error' | 'empty'; text: string } | null {
  const status = trendHistoryStatusOf(widgetId)
  if (!status) return null
  if (status.error === 'influx_unavailable') {
    return { kind: 'error', text: '历史库（InfluxDB）未启用或未连接，历史曲线不可用' }
  }
  if (status.error) return { kind: 'error', text: `历史查询失败：${status.error}` }
  if (status.state === 'empty') return { kind: 'empty', text: '该区间没有历史数据（检查变量是否开启"历史保存"）' }
  return null
}

/** 设置绝对窗口（工具栏自定义区间 / 缩放后重查都用它） */
export function setTrendHistoryWindow(widgetId: string, from: number, to: number): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return
  const w = ensureWidget(widgetId)
  if (w.custom && w.custom.from === from && w.custom.to === to) return
  w.custom = { from, to }
  w.customRange = { from, to }
  // 用户自己定的窗口（自定义区间 / 缩放 / 平移 / 报警跳转）：刷新时原样重查，别跳到最新
  w.autoFrozen = false
  w.dirty = true
  emitLoaded()
  scheduleFlush()
}

/** 兼容旧名字：手动"时间搜索"= 设为绝对窗口 */
export function setTrendHistorySearch(widgetId: string, from: number, to: number): void {
  setTrendHistoryWindow(widgetId, from, to)
}

/**
 * 切回预设区间。
 * 跟随开着 → 继续跟随（区间随时间滚动）；没开（默认）→ 取新预设的一次静态快照。
 */
export function setTrendHistoryPreset(widgetId: string, preset: string): void {
  const w = ensureWidget(widgetId, preset)
  w.preset = preset
  w.custom = null
  w.customRange = null
  w.autoFrozen = false
  w.dirty = true
  emitLoaded()
  scheduleFlush()
}

/** 前后翻页：按当前窗口跨度整体平移（自动变成绝对窗口） */
export function shiftTrendHistoryWindow(widgetId: string, direction: -1 | 1): void {
  const w = ensureWidget(widgetId)
  const win = effectiveTrendWindow(w)
  const span = Math.max(1000, win.to - win.from)
  setTrendHistoryWindow(widgetId, win.from + direction * span, win.to + direction * span)
}

/** 以某点为基准缩放窗口（figure>1 放大时间范围 = 看更长） */
export function zoomTrendHistoryWindow(widgetId: string, factor: number, centerMs?: number): void {
  const w = ensureWidget(widgetId)
  const win = effectiveTrendWindow(w)
  const span = Math.max(1000, win.to - win.from)
  const center = Number.isFinite(centerMs) ? (centerMs as number) : (win.from + win.to) / 2
  const half = Math.max(500, (span * factor) / 2)
  setTrendHistoryWindow(widgetId, Math.round(center - half), Math.round(center + half))
}

export function setTrendHistoryInterval(widgetId: string, interval: string): void {
  const w = ensureWidget(widgetId)
  const next = TREND_INTERVAL_IDS.has(interval) ? interval : 'auto'
  if (w.runtimeInterval === next) return
  w.runtimeInterval = next
  w.dirty = true
  emitLoaded()
  scheduleFlush()
}

export function trendHistoryIntervalOf(widgetId: string): string {
  const w = widgets.get(widgetId)
  return w ? effectiveInterval(w) : 'auto'
}

/** 跟随最新：开 = 回到预设相对区间并按轮询刷新；关 = 冻结当前窗口 */
export function setTrendHistoryFollow(widgetId: string, follow: boolean): void {
  const w = ensureWidget(widgetId)
  if (follow) {
    w.follow = true
    w.custom = null
    w.customRange = null
    w.autoFrozen = false
  } else {
    w.follow = false
    w.custom = effectiveTrendWindow(w)
    w.customRange = w.custom
    // 手动"冻在这里"：刷新时保持这个窗口；曲线末端也不再接实时值
    w.autoFrozen = false
    for (const curve of w.series.values()) curve.live = null
  }
  w.dirty = true
  emitLoaded()
  scheduleFlush()
}

export function trendHistoryFollowOf(widgetId: string): boolean {
  return widgets.get(widgetId)?.follow ?? false
}

/**
 * 手动刷新。
 * 没跟随（默认）时相对预设是"自动冻结"的快照：刷新 = 重新按预设取到最新的一段；
 * 自己设过的绝对窗口（自定义区间 / 缩放 / 报警跳转）则原样重查。
 */
export function refreshTrendHistory(widgetId: string, force = true): void {
  const w = widgets.get(widgetId)
  if (!w) return
  if (w.autoFrozen) {
    w.custom = null
    w.customRange = null
    w.autoFrozen = false
  }
  w.dirty = true
  if (force) w.loadedKey = ''
  scheduleFlush()
}

/** 曲线被删除 / 变量被换掉时释放缓存 */
export function releaseTrendHistory(widgetId: string, tagId: string): void {
  const w = widgets.get(widgetId)
  if (!w) return
  w.tagIds = w.tagIds.filter((id) => id !== tagId)
  w.series.delete(tagId)
  w.loadedKey = ''
  w.dirty = true
  if (!w.tagIds.length) widgets.delete(widgetId)
  else scheduleFlush()
}

/** 轮询刷新：只刷"跟随最新"的控件（冻结的窗口不动，避免读数被打断） */
export async function reloadTrendHistoryQueries(): Promise<void> {
  const jobs: Array<Promise<void>> = []
  for (const w of widgets.values()) {
    if (!w.follow || w.custom) continue
    if (!w.tagIds.length) continue
    jobs.push(loadWidget(w, true))
  }
  await Promise.all(jobs)
}

/** 导出用：某个图元当前窗口的点表（时间 + 各曲线值） */
export function trendHistoryExportRows(
  widgetId: string,
): { tagIds: string[]; times: number[]; values: Array<Array<number | null>> } | null {
  const w = widgets.get(widgetId)
  if (!w || !w.tagIds.length) return null
  const times = new Set<number>()
  for (const tagId of w.tagIds) {
    const list = trendHistoryTimes(widgetId, tagId)
    if (list) for (const t of list) times.add(t)
  }
  const sorted = [...times].sort((a, b) => a - b)
  if (!sorted.length) return null
  const values = w.tagIds.map((tagId) => {
    const list = trendHistorySeries(widgetId, tagId)
    const tl = trendHistoryTimes(widgetId, tagId)
    if (!list || !tl) return sorted.map(() => null)
    const byTime = new Map<number, number>()
    tl.forEach((t, i) => {
      const v = list[i]
      if (typeof v === 'number') byTime.set(t, v)
    })
    return sorted.map((t) => byTime.get(t) ?? null)
  })
  return { tagIds: w.tagIds.slice(), times: sorted, values }
}