/**
 * 趋势图元的实时滚动缓冲。
 *
 * 为什么不写进 props：`resolveWidgetVisual()` 一开始就把图元 clone 了一份
 * （`const widget = clonePlain(source)`），在里面写的 props 只活这一次求值 ——
 * 下一帧又从原对象拷一份空的回来，曲线永远只有 1 个点。
 * 所以实时采样放在这里的运行时缓存里（按 图元 / 图元+变量 分桶），
 * 渲染层直接读缓存，也不污染工程 JSON（设计端"只读预览"本来就不该写回工程）。
 *
 * 每条采样同时记时间戳：趋势图要用**时间轴**画（按点数均分会在数据有断点时骗人）。
 *
 * 历史趋势不用这个缓存：它的数据来自 trendHistoryQuery 的查询结果。
 */

interface SampleBuffer {
  /** 采样时间（epoch ms） */
  t: number[]
  /** 采样值（null = 该 tick 没有可用值：留缺口，但时间轴仍然对齐） */
  v: Array<number | null>
}

/** 单曲线（图元自带的 valueOut / prop=value 绑定）：widgetId → 缓冲 */
const liveSeries = new Map<string, SampleBuffer>()

/** 多曲线（props.curves）：`widgetId|tagId` → 缓冲 */
const curveSeries = new Map<string, SampleBuffer>()

const MAX_KEEP = 5000

function clampCap(maxPoints: unknown): number {
  const n = Math.trunc(Number(maxPoints))
  return Math.max(5, Math.min(MAX_KEEP, Number.isFinite(n) && n > 0 ? n : 40))
}

function push(
  map: Map<string, SampleBuffer>,
  key: string,
  value: number | null,
  cap: number,
  at: number,
): void {
  let buf = map.get(key)
  if (!buf) {
    buf = { t: [], v: [] }
    map.set(key, buf)
  }
  buf.t.push(Number.isFinite(at) ? at : Date.now())
  buf.v.push(value)
  if (buf.v.length > cap) {
    const drop = buf.v.length - cap
    buf.v.splice(0, drop)
    buf.t.splice(0, drop)
  }
}

/** 单曲线实时趋势：塞一个采样点（at 缺省用当前时间） */
export function pushLiveSeries(
  widgetId: string,
  value: number,
  maxPoints?: number,
  at?: number,
): void {
  push(liveSeries, widgetId, value, clampCap(maxPoints), at ?? Date.now())
}

/** 单曲线实时缓冲（没有数据时返回 undefined，调用方回退到 props.series 示例数据） */
export function liveSeriesOf(widgetId: string): number[] | undefined {
  const buf = liveSeries.get(widgetId)
  return buf && buf.v.length ? (buf.v as number[]) : undefined
}

/** 单曲线实时缓冲的时间戳（画时间轴用） */
export function liveTrendTimes(widgetId: string): number[] | undefined {
  const buf = liveSeries.get(widgetId)
  return buf && buf.t.length ? buf.t : undefined
}

/**
 * 多条曲线共用一个时间窗，避免「点数一样、刷新不一样」把快变量的左半段裁掉。
 *
 * 时间窗 = 最慢那条曲线「最近 maxPoints 个点」所占的时长。
 * 刷新快的变量在这段时间里可以留下多于 maxPoints 的点，这样各条线的起点对齐，
 * 时间轴不会被慢变量拉长后，快变量只剩右边一截。
 */
export function retainCurveTimeWindow(widgetId: string, tagIds: string[], maxPoints?: number): void {
  const cap = clampCap(maxPoints)
  let end = -Infinity
  let span = 0
  for (const tagId of tagIds) {
    const buf = curveSeries.get(`${widgetId}|${tagId}`)
    if (!buf || buf.t.length === 0) continue
    end = Math.max(end, buf.t[buf.t.length - 1] ?? end)
    if (buf.t.length < 2) continue
    const from = buf.t[Math.max(0, buf.t.length - cap)] ?? buf.t[0]
    const dur = (buf.t[buf.t.length - 1] ?? 0) - (from ?? 0)
    if (dur > span) span = dur
  }
  if (!Number.isFinite(end) || span <= 0) return
  const start = end - span
  for (const tagId of tagIds) {
    const buf = curveSeries.get(`${widgetId}|${tagId}`)
    if (!buf) continue
    let drop = 0
    while (drop < buf.t.length - 1 && (buf.t[drop] ?? 0) < start) drop += 1
    if (buf.t.length - drop > MAX_KEEP) drop = buf.t.length - MAX_KEEP
    if (drop > 0) {
      buf.t.splice(0, drop)
      buf.v.splice(0, drop)
    }
  }
}

/** 多曲线实时趋势：塞某个变量的采样点 */
export function pushCurveSample(
  widgetId: string,
  tagId: string,
  value: number | null,
  maxPoints?: number,
  at?: number,
): void {
  push(curveSeries, `${widgetId}|${tagId}`, value, clampCap(maxPoints), at ?? Date.now())
}

export function curveSamples(widgetId: string, tagId: string): Array<number | null> | undefined {
  const buf = curveSeries.get(`${widgetId}|${tagId}`)
  return buf && buf.v.length ? buf.v : undefined
}

/** 多曲线实时缓冲的时间戳（画时间轴用） */
export function curveTimes(widgetId: string, tagId: string): number[] | undefined {
  const buf = curveSeries.get(`${widgetId}|${tagId}`)
  return buf && buf.t.length ? buf.t : undefined
}

/** 变量被删掉 / 换掉时清理，避免缓存越积越多 */
export function clearCurveSamples(widgetId: string, tagId: string): void {
  curveSeries.delete(`${widgetId}|${tagId}`)
}

export function clearLiveSeries(widgetId: string): void {
  liveSeries.delete(widgetId)
}