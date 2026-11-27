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


/** 相邻两点间隔超过该值时插入 null，避免把缺口连成一条斜线（50ms 点若漏采 1s 也会画出穿窗斜线）。 */
export const CURVE_GAP_BREAK_MS = 1000

/** 离开页面后再回来，尾巴比这个还旧就清空重填（比断线阈值更宽，避免短暂卡顿把缓冲清掉）。 */
export const CURVE_STALE_BUFFER_MS = 6000

function lastFiniteIndex(values: Array<number | null>, from: number): number {
  for (let i = from; i >= 0; i -= 1) {
    const n = values[i]
    if (n != null && Number.isFinite(n)) return i
  }
  return -1
}

/** 只在真实时间缺口处插入 null。时间连续的 100↔0 回绕要连成线，否则会被当成掉线。 */
function spliceCurveBreaks(times: number[], values: Array<number | null>): void {
  let i = 1
  while (i < values.length) {
    const prevIdx = lastFiniteIndex(values, i - 1)
    if (prevIdx < 0 || i - prevIdx > 1) {
      i += 1
      continue
    }
    const dt = (times[i] ?? 0) - (times[prevIdx] ?? 0)
    if (dt > CURVE_GAP_BREAK_MS) {
      times.splice(i, 0, (times[prevIdx] ?? 0) + 1)
      values.splice(i, 0, null)
      i += 2
      continue
    }
    i += 1
  }
}

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
  const atMs = Number.isFinite(at) ? at : Date.now()
  if (buf.t.length) {
    const lastT = buf.t[buf.t.length - 1] ?? 0
    if (atMs - lastT > CURVE_GAP_BREAK_MS) {
      buf.t.push(lastT + 1)
      buf.v.push(null)
    }
  }
  buf.t.push(atMs)
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
    spliceCurveBreaks(buf.t, buf.v)
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

/**
 * 进页时把历史点填到实时缓冲左半段，已有的更新实时点留在尾部。
 * 返回是否写入了至少 1 个历史点。
 */
export function prependCurveHistory(
  widgetId: string,
  tagId: string,
  times: number[],
  values: Array<number | null>,
  maxPoints?: number,
): boolean {
  if (times.length < 2 || times.length !== values.length) return false
  const key = `${widgetId}|${tagId}`
  const cap = clampCap(maxPoints)
  const existing = curveSeries.get(key)
  const firstLive = existing && existing.t.length ? existing.t[0] : null
  const lastLive = existing && existing.t.length ? existing.t[existing.t.length - 1] : null
  let end = times.length
  if (firstLive != null) {
    while (end > 0 && (times[end - 1] ?? 0) >= firstLive) end -= 1
  }
  const headT = times.slice(0, end)
  const headV = values.slice(0, end)
  let startAfter = 0
  if (lastLive != null) {
    while (startAfter < times.length && (times[startAfter] ?? 0) <= lastLive) startAfter += 1
  }
  const tailT = lastLive != null ? times.slice(startAfter) : []
  const tailV = lastLive != null ? values.slice(startAfter) : []
  if (!headT.length && !tailT.length) return false

  const join = (
    leftT: number[],
    leftV: Array<number | null>,
    rightT: number[],
    rightV: Array<number | null>,
  ): { t: number[]; v: Array<number | null> } => {
    if (!leftT.length) return { t: rightT.slice(), v: rightV.slice() }
    if (!rightT.length) return { t: leftT.slice(), v: leftV.slice() }
    const gap = (rightT[0] ?? 0) - (leftT[leftT.length - 1] ?? 0)
    if (gap > CURVE_GAP_BREAK_MS) {
      return {
        t: [...leftT, (leftT[leftT.length - 1] ?? 0) + 1, ...rightT],
        v: [...leftV, null, ...rightV],
      }
    }
    return { t: leftT.concat(rightT), v: leftV.concat(rightV) }
  }

  let merged = { t: existing?.t ?? [], v: existing?.v ?? [] }
  if (headT.length) merged = join(headT, headV, merged.t, merged.v)
  if (tailT.length) merged = join(merged.t, merged.v, tailT, tailV)
  const t = merged.t
  const v = merged.v
  if (v.length > cap) {
    const drop = v.length - cap
    t.splice(0, drop)
    v.splice(0, drop)
  }
  spliceCurveBreaks(t, v)
  curveSeries.set(key, { t, v })
  return true
}

export function clearLiveSeries(widgetId: string): void {
  liveSeries.delete(widgetId)
}

export function curveSampleBufferCount(): number {
  return curveSeries.size
}

/** 运行端诊断：看实时缓冲是否还在增长、回绕是否已断开。 */
export function inspectCurveBuffer(widgetId: string, tagId: string): {
  n: number
  finite: number
  nulls: number
  lastT: number | null
  lastV: number | null
  spanMs: number
  maxGapMs: number
  rawWraps: number
} | null {
  const buf = curveSeries.get(`${widgetId}|${tagId}`)
  if (!buf || !buf.t.length) return null
  let finite = 0
  let nulls = 0
  let maxGapMs = 0
  let rawWraps = 0
  let prevFinite = -1
  for (let i = 0; i < buf.v.length; i += 1) {
    const value = buf.v[i]
    if (value == null || !Number.isFinite(value)) {
      nulls += 1
      continue
    }
    finite += 1
    if (prevFinite >= 0) {
      const dt = (buf.t[i] ?? 0) - (buf.t[prevFinite] ?? 0)
      if (dt > maxGapMs) maxGapMs = dt
      const prevVal = buf.v[prevFinite]
      if (prevVal != null && Math.abs(value - prevVal) >= 80 && i - prevFinite === 1) rawWraps += 1
    }
    prevFinite = i
  }
  const lastT = buf.t[buf.t.length - 1] ?? null
  const lastV = buf.v[buf.v.length - 1] ?? null
  const firstT = buf.t[0] ?? lastT ?? 0
  return {
    n: buf.t.length,
    finite,
    nulls,
    lastT,
    lastV: lastV == null || !Number.isFinite(lastV) ? null : lastV,
    spanMs: lastT != null ? lastT - firstT : 0,
    maxGapMs,
    rawWraps,
  }
}

if (typeof window !== "undefined") {
  ;(window as unknown as { __scadaCurveInspect?: typeof inspectCurveBuffer }).__scadaCurveInspect = inspectCurveBuffer
}
