import type {
  AnimationLink,
  AnimationLinkColor,
  AnimationLinkEnable,
  AnimationLinkFlow,
  AnimationLinkHide,
  AnimationLinkInput,
  AnimationLinkRange,
  AnimationLinkTextOut,
  AnimationLinkType,
  NumericAnimationRule,
  PropBinding,
  StateAnimationRule,
  TagValue,
  TrendCurve,
  Widget2D,
} from '@web-scada/core'
import { formatBoolText, parseSeries, trendCurves, trendCurveTagIds } from '@web-scada/core'
import { clonePlain } from '@/shared/utils/clonePlain'
import { useTagStore } from '@/stores/tag'
import { formatActiveAlarmItems, formatAlarmHistoryItems } from '@/shared/runtime/alarmText'
import { alarmHistoryEvents, alarmHistoryQuery, requestAlarmHistory } from '@/shared/runtime/alarmHistoryQuery'
import { requestTrendHistory, trendHistorySeries } from '@/shared/runtime/trendHistoryQuery'
import { pushCurveSample, pushLiveSeries, retainCurveTimeWindow } from '@/shared/runtime/trendSeries'

export interface ResolvedVisual {
  widget: Widget2D
  blink: boolean
  quality: TagValue['quality'] | 'Good'
}

function asNumber(v: TagValue['value']): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const spanIn = inMax - inMin || 1
  const t = Math.min(1, Math.max(0, (value - inMin) / spanIn))
  return outMin + t * (outMax - outMin)
}

function matchColorRange(
  value: TagValue['value'],
  range: AnimationLinkColor['ranges'][number],
): boolean {
  if (range.equals !== undefined) return value === range.equals
  const num = asNumber(value)
  if (num === null) return false
  if (range.min !== undefined && num < range.min) return false
  if (range.max !== undefined && num > range.max) return false
  return range.min !== undefined || range.max !== undefined
}

function boolLabels(tagId: string) {
  return useTagStore().metas.find((item) => item.tagId === tagId)
}

function formatValue(
  v: TagValue['value'],
  format?: string,
  labels?: { onText?: string; offText?: string },
): string {
  if (v === null || v === undefined) return '--'
  if (format === 'bool' || (typeof v === 'boolean' && !format?.startsWith('fixed:'))) {
    const text = formatBoolText(
      v,
      labels,
      format === 'bool' ? { on: 'ON', off: 'OFF' } : { on: 'true', off: 'false' },
    )
    if (text != null) return text
    if (format === 'bool') return v ? 'ON' : 'OFF'
  }
  if (format?.startsWith('fixed:')) {
    const digits = Number(format.split(':')[1] || 1)
    const n = asNumber(v)
    return n === null ? String(v) : n.toFixed(digits)
  }
  return String(v)
}

function applyValueToWidget(
  widget: Widget2D,
  v: TagValue['value'],
  format?: string,
  labels?: { onText?: string; offText?: string },
): void {
  if (widget.type === 'tank') {
    const n = asNumber(v)
    if (n !== null) widget.props = { ...widget.props, level: Math.min(100, Math.max(0, n)) }
  } else if (widget.type === 'lamp' || widget.type === 'switch') {
    widget.props = { ...widget.props, on: Boolean(v) }
  } else if (widget.type === 'pump') {
    widget.props = { ...widget.props, running: Boolean(v) }
  } else if (widget.type === 'valve') {
    widget.props = { ...widget.props, open: Boolean(v) }
  } else if (widget.type === 'gauge' || widget.type === 'value') {
    const n = asNumber(v)
    if (n !== null) widget.props = { ...widget.props, value: n }
    else widget.props = { ...widget.props, value: v }
  } else if (widget.type === 'trendHistory') {
    return
  } else if (widget.type === 'chart' || widget.type === 'trend') {
    const text =
      typeof v === 'string' ? v : Array.isArray(v) ? (v as number[]).join(',') : String(v)
    if (widget.type === 'trend') {
      const n = asNumber(v)
      if (n !== null) {
        const prev = parseSeries(widget.props.series)
        const maxPoints = Math.max(5, Number(widget.props.maxPoints) || 40)
        const next = [...prev, n].slice(-maxPoints)
        widget.props = { ...widget.props, series: next.join(',') }
        return
      }
    }
    widget.props = { ...widget.props, series: text }
  } else if (widget.type === 'list' || widget.type === 'alarm') {
    widget.props = { ...widget.props, items: String(v ?? '') }
  } else {
    widget.props = { ...widget.props, text: formatValue(v, format, labels) }
  }
}

function applyFillPercent(
  widget: Widget2D,
  percent: number,
  orient: 'h' | 'v',
  direction: 'start' | 'end' = 'start',
): void {
  const p = Math.min(100, Math.max(0, percent))
  if (widget.type === 'tank') {
    widget.props = { ...widget.props, level: p }
    return
  }
  widget.props = {
    ...widget.props,
    fillRatio: p,
    fillOrient: orient,
    fillDirection: direction,
  }
}

function liveAlarmItems(columns: unknown): {
  text: string
  ids: string[]
  statuses: string[]
  levels: string[]
} | null {
  try {
    const tags = useTagStore()
    if (tags.mode !== 'live') return null
    return formatActiveAlarmItems(tags.activeAlarms, columns, tags.metas)
  } catch {
    return null
  }
}

function boundTrendTagId(widget: Widget2D): string | null {
  for (const link of widget.animationLinks ?? []) {
    if (link.enabled !== false && link.type === 'valueOut' && link.tagId) return link.tagId
  }
  for (const binding of widget.bindings ?? []) {
    if (binding.prop === 'value' && binding.tagId) return binding.tagId
  }
  return null
}

/**
 * 实时趋势是否已由 props.curves 接管。
 * 接管后值由 feedTrendCurves() 统一按"新采样"入队，不再走旧的单序列路径
 * （否则同一采样会既进 curves 又进 props.series，出现重复点）。
 */
function trendCurvesTakeOver(widget: Widget2D): boolean {
  return widget.type === 'trend' && trendCurveTagIds(widget.props).length > 0
}

/**
 * 曲线"鲜活"判定阀值：超过这么久没有新采样（值很久没变）就按"现在"记点 ——
 * 既保活让线不断，又不会把几小时前的老时间戳写进缓冲把时间轴拉成十几小时。
 */
const TREND_KEEP_ALIVE_MS = 3000

/** 每条曲线各自的"最后一次入队的采样时间戳"（key = 图元 id | 变量 id） */
const trendIngestStamp = new Map<string, number>()

/** 实时趋势多曲线：每条曲线按自己的采样时间戳入队（同一次求值重复跑不会重复进点） */
function feedTrendCurves(
  widget: Widget2D,
  getTag: (tagId: string) => TagValue | undefined,
): void {
  const curves = trendCurves(widget.props)
  if (!curves.length) return
  const maxPoints = Math.max(5, Number(widget.props.maxPoints) || 40)
  if (!curves.some((curve) => curve.tagId)) return
  // 每条曲线按自己的采样时间戳入队，不把慢变量补成台阶。
  // 点数上限不能按曲线各自截断：刷新快的变量会先把旧点丢掉，时间轴又被慢变量拉长，
  // 快变量就只剩右半段。先按硬上限留住，最后再用同一段时间窗裁齐。
  let newest = 0
  for (const curve of curves) {
    if (!curve.tagId) continue
    const stamp = getTag(curve.tagId)?.timestamp ?? 0
    if (stamp > newest) newest = stamp
  }
  for (const curve of curves) {
    if (!curve.tagId) continue
    const tag = getTag(curve.tagId)
    if (!tag || !(tag.timestamp > 0)) continue
    const key = `${widget.id}|${curve.tagId}`
    const last = trendIngestStamp.get(key) ?? 0
    // ① 时间戳刚更新、而且离"现在"不远 → 用它自己的时间戳记点（斜线/台阶都来自这里）
    const fresh = tag.timestamp !== last
    const lagging = newest > 0 && newest - tag.timestamp >= TREND_KEEP_ALIVE_MS
    // ② 时间戳停在很久以前（几分钟没变过的常量、模拟关闭的变量）→ 按"现在"补点：
    //    既保活让线不断，又不会把老时间戳塞进缓冲（否则时间轴会被拉成十几小时，实时数据全挤成一根竖线）
    const keepAlive = newest > 0 && newest - last >= TREND_KEEP_ALIVE_MS
    if (!(fresh && !lagging) && !keepAlive) continue
    const at = fresh && !lagging ? tag.timestamp : newest
    trendIngestStamp.set(key, at)
    // 质量坏了/离线 = 真缺口（画断线）
    const value = tag.quality === 'Bad' || tag.quality === 'Offline' ? null : asNumber(tag.value)
    // 先按硬上限留点；下面再用各曲线共用的时间窗裁，不能在这里按 maxPoints 把快变量裁短
    pushCurveSample(widget.id, curve.tagId, value, 5000, at)
  }
  retainCurveTimeWindow(
    widget.id,
    curves.map((curve) => curve.tagId).filter((id) => Boolean(id)),
    maxPoints,
  )
}

/**
 * 旧路径（单曲线）的实时采样：同样进运行时缓冲，理由见 trendSeries.ts。
 * 返回 true = 已由趋势路径接管（调用方不再走通用的 applyValueToWidget）。
 */
function applyTrendLiveSample(widget: Widget2D, tag: TagValue): boolean {
  if (widget.type !== 'trend') return false
  const n = asNumber(tag.value)
  const key = `${widget.id}|__live__`
  if (trendIngestStamp.get(key) === tag.timestamp) return true
  trendIngestStamp.set(key, tag.timestamp)
  if (n === null) return true
  pushLiveSeries(widget.id, n, Math.max(5, Number(widget.props.maxPoints) || 40))
  return true
}

/** 历史趋势的旧路径：单曲线（props.series） */
function liveTrendHistory(widget: Widget2D): number[] | null {
  try {
    const tags = useTagStore()
    if (tags.mode !== 'live') return null
    const tagId = boundTrendTagId(widget)
    if (!tagId) return null
    const start = String(widget.props.range ?? '-1h')
    const limit = Math.max(10, Math.min(2000, Number(widget.props.maxPoints) || 240))
    requestTrendHistory(widget.id, tagId, start, limit)
    return trendHistorySeries(widget.id, tagId) ?? null
  } catch {
    return null
  }
}

/** 历史趋势的多曲线路径：每条曲线各自查一次，写回 curves[i].series */
function liveTrendHistoryCurves(widget: Widget2D, curves: TrendCurve[]): TrendCurve[] | null {
  try {
    const tags = useTagStore()
    if (tags.mode !== 'live') return null
    const start = String(widget.props.range ?? '-1h')
    const limit = Math.max(10, Math.min(2000, Number(widget.props.maxPoints) || 240))
    let loaded = false
    const next = curves.map((curve) => {
      requestTrendHistory(widget.id, curve.tagId, start, limit)
      const series = trendHistorySeries(widget.id, curve.tagId)
      if (!series) return curve
      loaded = true
      return { ...curve, series }
    })
    return loaded ? next : null
  } catch {
    return null
  }
}

function liveAlarmHistory(widgetId: string, columns: unknown) {
  try {
    const tags = useTagStore()
    if (tags.mode !== 'live') return null
    requestAlarmHistory(widgetId)
    return formatAlarmHistoryItems(
      alarmHistoryEvents(widgetId),
      columns,
      tags.metas,
      alarmHistoryQuery(widgetId),
    )
  } catch {
    return null
  }
}

/** 执行单条动画连接（相对设计态 source 做位移） */
function applyAnimationLink(
  widget: Widget2D,
  source: Widget2D,
  link: AnimationLink,
  tag: TagValue | undefined,
  flags: { blink: boolean },
): void {
  if (!link.enabled || !tag) return
  if (tag.quality === 'Bad' || tag.quality === 'Offline') return

  switch (link.type) {
    case 'hide': {
      const show = link.trueShow ? Boolean(tag.value) : !Boolean(tag.value)
      widget.visible = show
      break
    }
    case 'colorFill':
    case 'colorStroke':
    case 'colorFill2': {
      for (const range of link.ranges) {
        if (!matchColorRange(tag.value, range)) continue
        if (link.type === 'colorFill') {
          widget.style = { ...widget.style, fill: range.color }
        } else if (link.type === 'colorStroke') {
          widget.style = { ...widget.style, stroke: range.color }
        } else {
          widget.style = { ...widget.style, fill2: range.color, accent: range.color }
        }
        if (range.blink) flags.blink = true
        break
      }
      break
    }
    case 'moveH':
    case 'moveV':
    case 'moveZ':
    case 'height':
    case 'width':
    case 'scaleZ':
    case 'rotX':
    case 'rotY':
    case 'rotZ':
    case 'fillH':
    case 'fillV':
    case 'dragH':
    case 'dragV':
    case 'dragZ': {
      // 拖拽类不在这里驱动位置（由运行端拖拽写值）；2D 仅处理平面移动/尺寸/填充
      if (link.type === 'dragH' || link.type === 'dragV' || link.type === 'dragZ') break
      if (
        link.type === 'moveZ' ||
        link.type === 'scaleZ' ||
        link.type === 'rotX' ||
        link.type === 'rotY' ||
        link.type === 'rotZ'
      ) {
        break
      }
      const n = asNumber(tag.value)
      if (n === null) break
      const out = mapRange(n, link.inMin, link.inMax, link.outMin, link.outMax)
      if (link.type === 'moveH') {
        widget.transform = { ...widget.transform, x: source.transform.x + out }
      } else if (link.type === 'moveV') {
        widget.transform = { ...widget.transform, y: source.transform.y + out }
      } else if (link.type === 'width') {
        widget.transform = { ...widget.transform, width: Math.max(1, out) }
      } else if (link.type === 'height') {
        widget.transform = { ...widget.transform, height: Math.max(1, out) }
      } else if (link.type === 'fillH') {
        applyFillPercent(widget, out, 'h', link.direction ?? 'start')
      } else if (link.type === 'fillV') {
        applyFillPercent(widget, out, 'v', link.direction ?? 'start')
      }
      break
    }
    case 'valueOut': {
      if (trendCurvesTakeOver(widget)) break
      if (applyTrendLiveSample(widget, tag)) break
      applyValueToWidget(widget, tag.value, link.format ?? 'fixed:1', boolLabels(tag.tagId))
      break
    }
    case 'textOut': {
      widget.props = { ...widget.props, text: formatValue(tag.value, link.format, boolLabels(tag.tagId)) }
      break
    }
    case 'valueIn':
    case 'digitalIn':
    case 'textIn':
      // 交互类：运行端点击处理
      break
    case 'enable': {
      const on = Boolean(tag.value)
      const enabled = link.trueEnable ? on : !on
      widget.props = { ...widget.props, _runtimeEnabled: enabled }
      if (!enabled) {
        widget.style = {
          ...widget.style,
          opacity: Math.min(Number(widget.style.opacity ?? 1), 0.45),
        }
      }
      break
    }
  }
}

function applyPropBinding(
  widget: Widget2D,
  binding: PropBinding,
  tag: TagValue | undefined,
): void {
  if (!tag || tag.quality === 'Bad' || tag.quality === 'Offline') return
  const v = tag.value
  switch (binding.prop) {
    case 'text':
      widget.props = { ...widget.props, text: formatValue(v, binding.format, boolLabels(tag.tagId)) }
      break
    case 'value':
      if (trendCurvesTakeOver(widget)) break
      if (applyTrendLiveSample(widget, tag)) break
      applyValueToWidget(widget, v, binding.format)
      break
    case 'fill':
    case 'color':
      if (typeof v === 'string') widget.style = { ...widget.style, fill: v }
      else if (typeof v === 'boolean')
        widget.style = { ...widget.style, fill: v ? '#22c55e' : '#334155' }
      break
    case 'stroke':
      if (typeof v === 'string') widget.style = { ...widget.style, stroke: v }
      break
    case 'visible':
      widget.visible = Boolean(v)
      break
    case 'opacity': {
      const n = asNumber(v)
      if (n !== null) widget.style = { ...widget.style, opacity: Math.min(1, Math.max(0, n)) }
      break
    }
    case 'x':
    case 'y':
    case 'rotation':
    case 'scaleX':
    case 'scaleY': {
      const n = asNumber(v)
      if (n !== null) widget.transform = { ...widget.transform, [binding.prop]: n }
      break
    }
  }
}

function matchStateRange(
  value: TagValue['value'],
  range: StateAnimationRule['ranges'][number],
): boolean {
  if (range.equals !== undefined) return value === range.equals
  const num = asNumber(value)
  if (num === null) return false
  if (range.min !== undefined && typeof range.min === 'number' && num < range.min) return false
  if (range.max !== undefined && typeof range.max === 'number' && num > range.max) return false
  if (range.min === undefined && range.max === undefined && range.equals === undefined) return true
  return range.min !== undefined || range.max !== undefined
}

function applyStateAnimation(
  widget: Widget2D,
  rule: StateAnimationRule,
  tag: TagValue | undefined,
  flags: { blink: boolean },
): void {
  if (!tag) return
  for (const range of rule.ranges) {
    if (!matchStateRange(tag.value, range)) continue
    const apply = range.apply
    if (rule.target === 'blink' || apply.blink) {
      flags.blink = Boolean(apply.blink ?? true)
    }
    if (rule.target === 'visible' || apply.visible !== undefined) {
      widget.visible = Boolean(apply.visible ?? widget.visible)
    }
    if (rule.target === 'fill' || apply.fill !== undefined) {
      widget.style = { ...widget.style, fill: apply.fill ?? widget.style.fill }
    }
    if (apply.stroke !== undefined) {
      widget.style = { ...widget.style, stroke: apply.stroke }
    }
    if (apply.opacity !== undefined) {
      widget.style = { ...widget.style, opacity: apply.opacity }
    }
    if (apply.on !== undefined) widget.props = { ...widget.props, on: apply.on }
    if (apply.running !== undefined) widget.props = { ...widget.props, running: apply.running }
    if (apply.open !== undefined) widget.props = { ...widget.props, open: apply.open }
    if (apply.text !== undefined) widget.props = { ...widget.props, text: apply.text }
    break
  }
}

function applyNumericAnimation(
  widget: Widget2D,
  source: Widget2D,
  rule: NumericAnimationRule,
  tag: TagValue | undefined,
): void {
  if (!tag) return
  const n = asNumber(tag.value)
  if (n === null) return
  const out = mapRange(n, rule.inMin, rule.inMax, rule.outMin, rule.outMax)
  if (rule.target === 'fillRatio') {
    applyFillPercent(widget, out, 'v', 'start')
    return
  }
  if (rule.target === 'x') {
    widget.transform = { ...widget.transform, x: source.transform.x + out }
    return
  }
  if (rule.target === 'y') {
    widget.transform = { ...widget.transform, y: source.transform.y + out }
    return
  }
  widget.transform = { ...widget.transform, [rule.target]: out }
}

/** 根据当前 Tag 值解析图元运行态外观 */
export function resolveWidgetVisual(
  source: Widget2D,
  getTag: (tagId: string) => TagValue | undefined,
): ResolvedVisual {
  const widget = clonePlain(source)
  const flags = { blink: false }
  let quality: ResolvedVisual['quality'] = 'Good'

  const links = widget.animationLinks ?? []
  // 优先级：显隐 → 颜色 → 位移尺寸填充 → 文本；同属性后写覆盖前写
  const order: AnimationLinkType[] = [
    'enable',
    'hide',
    'colorFill',
    'colorStroke',
    'colorFill2',
    'moveH',
    'moveV',
    'moveZ',
    'width',
    'height',
    'scaleZ',
    'rotX',
    'rotY',
    'rotZ',
    'fillH',
    'fillV',
    'valueOut',
    'textOut',
    'valueIn',
    'digitalIn',
    'textIn',
    'dragH',
    'dragV',
    'dragZ',
  ]
  const sorted = [...links].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  )

  for (const link of sorted) {
    const tag = getTag(link.tagId)
    if (tag && (tag.quality === 'Bad' || tag.quality === 'Offline' || tag.quality === 'Uncertain')) {
      quality = tag.quality
    }
    applyAnimationLink(widget, source, link, tag, flags)
  }

  // 兼容旧属性绑定 / 旧动画
  for (const binding of widget.bindings ?? []) {
    const tag = getTag(binding.tagId)
    if (tag && (tag.quality === 'Bad' || tag.quality === 'Offline' || tag.quality === 'Uncertain')) {
      quality = tag.quality
    }
    applyPropBinding(widget, binding, tag)
  }

  for (const rule of widget.animations ?? []) {
    const tag = getTag(rule.tagId)
    if (tag && (tag.quality === 'Bad' || tag.quality === 'Offline')) quality = tag.quality
    if (rule.kind === 'state') applyStateAnimation(widget, rule, tag, flags)
    else applyNumericAnimation(widget, source, rule, tag)
  }

  if (quality === 'Bad' || quality === 'Offline') {
    widget.style = {
      ...widget.style,
      opacity: Math.min(Number(widget.style.opacity ?? 1), 0.45),
      stroke: '#ef4444',
      strokeWidth: Math.max(Number(widget.style.strokeWidth ?? 1), 2),
    }
  }

  if (widget.type === 'alarm') {
    const live = liveAlarmItems(widget.props.columns)
    if (live != null) {
      widget.props = {
        ...widget.props,
        items: live.text,
        alarmRowIds: live.ids,
        alarmRowStatus: live.statuses,
        alarmRowLevel: live.levels,
      }
    }
  }

  if (widget.type === 'alarmHistory') {
    const live = liveAlarmHistory(widget.id, widget.props.columns)
    if (live != null) {
      widget.props = {
        ...widget.props,
        items: live.text,
        alarmRowStatus: live.statuses,
        alarmRowLevel: live.levels,
      }
    }
  }

  if (widget.type === 'trend') {
    feedTrendCurves(widget, getTag)
  }

  if (widget.type === 'trendHistory') {
    const curves = trendCurves(widget.props)
    if (curves.length) {
      const next = liveTrendHistoryCurves(widget, curves)
      if (next) widget.props = { ...widget.props, curves: next }
    } else {
      const series = liveTrendHistory(widget)
      if (series != null) {
        widget.props = { ...widget.props, series: series.join(',') }
      }
    }
  }

  return { widget, blink: flags.blink, quality }
}

/** 收集页面上所有绑定/动画用到的 TagId */
export function collectPageTagIds(page: { layers: Array<{ widgets: Widget2D[] }> }): string[] {
  const ids = new Set<string>()
  const collect = (w: Widget2D) => {
    // 趋势图元的多曲线变量存在 props.curves 里（不在 bindings/animationLinks 中），必须一起订阅，
    // 否则 WS 不会推这些变量，曲线会一直是空的且不报错。
    for (const tagId of trendCurveTagIds(w.props)) ids.add(tagId)
    for (const b of w.bindings ?? []) ids.add(b.tagId)
    for (const a of w.animations ?? []) ids.add(a.tagId)
    for (const link of w.animationLinks ?? []) ids.add(link.tagId)
    for (const e of w.events ?? []) {
      for (const action of e.actions) {
        if (action.type === 'writeTag') ids.add(action.tagId)
      }
    }
    for (const child of w.children ?? []) collect(child)
  }
  for (const layer of page.layers) {
    for (const w of layer.widgets) collect(w)
  }
  return [...ids]
}

export function createBinding(
  prop: PropBinding['prop'],
  tagId: string,
  format?: string,
): PropBinding {
  return {
    id: `bind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    prop,
    tagId,
    format,
  }
}

export function createStateAnimation(
  partial: Omit<StateAnimationRule, 'id' | 'kind'> & { kind?: 'state' },
): StateAnimationRule {
  return {
    id: `anim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'state',
    ...partial,
  }
}

export function createNumericAnimation(
  partial: Omit<NumericAnimationRule, 'id' | 'kind'> & { kind?: 'numeric' },
): NumericAnimationRule {
  return {
    id: `anim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'numeric',
    ...partial,
  }
}

function newLinkId() {
  return `alink_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/** 创建默认动画连接（每种类型一份默认参数，对齐 Flight 表单习惯） */
export function createAnimationLink(
  type: AnimationLinkType,
  tagId: string,
): AnimationLink {
  const base = { id: newLinkId(), enabled: false, tagId }
  switch (type) {
    case 'hide':
      return { ...base, type, trueShow: true } satisfies AnimationLinkHide
    case 'colorFill':
      return {
        ...base,
        type,
        ranges: [
          { equals: true, color: '#22c55e', blink: false },
          { equals: false, color: '#334155', blink: true },
        ],
      } satisfies AnimationLinkColor
    case 'colorFill2':
      return {
        ...base,
        type,
        ranges: [
          { equals: true, color: '#38bdf8', blink: false },
          { equals: false, color: '#1e293b', blink: false },
        ],
      } satisfies AnimationLinkColor
    case 'colorStroke':
      return {
        ...base,
        type,
        ranges: [
          { equals: true, color: '#86efac', blink: false },
          { equals: false, color: '#64748b', blink: false },
        ],
      } satisfies AnimationLinkColor
    case 'moveH':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 100,
      } satisfies AnimationLinkRange
    case 'moveV':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: -80,
      } satisfies AnimationLinkRange
    case 'moveZ':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 1,
      } satisfies AnimationLinkRange
    case 'dragH':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 120,
      } satisfies AnimationLinkRange
    case 'dragV':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: -100,
      } satisfies AnimationLinkRange
    case 'dragZ':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: -2,
        outMax: 2,
      } satisfies AnimationLinkRange
    case 'width':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 40,
        outMax: 200,
      } satisfies AnimationLinkRange
    case 'height':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 40,
        outMax: 160,
      } satisfies AnimationLinkRange
    case 'scaleZ':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0.2,
        outMax: 2,
      } satisfies AnimationLinkRange
    case 'rotX':
    case 'rotY':
    case 'rotZ':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 360,
      } satisfies AnimationLinkRange
    case 'fillH':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 100,
        direction: 'start',
      } satisfies AnimationLinkRange
    case 'fillV':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 100,
        direction: 'start',
      } satisfies AnimationLinkRange
    case 'valueOut':
      return { ...base, type, format: 'fixed:1' } satisfies AnimationLinkTextOut
    case 'textOut':
      return { ...base, type, format: undefined } satisfies AnimationLinkTextOut
    case 'valueIn':
      return { ...base, type, confirm: true } satisfies AnimationLinkInput
    case 'digitalIn':
      return { ...base, type, confirm: true, digitalMode: 'toggle' } satisfies AnimationLinkInput
    case 'textIn':
      return { ...base, type, confirm: true } satisfies AnimationLinkInput
    case 'enable':
      return { ...base, type, trueEnable: true } satisfies AnimationLinkEnable
    case 'flow':
      return {
        ...base,
        type,
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 1,
        speed: 0.4,
        style: 'skin',
        axis: 'auto',
      } satisfies AnimationLinkFlow
  }
}

export function widgetHasInteractiveLinks(widget: Widget2D): boolean {
  return (widget.animationLinks ?? []).some(
    (l) =>
      l.enabled &&
      (l.type === 'valueIn' ||
        l.type === 'digitalIn' ||
        l.type === 'textIn' ||
        l.type === 'dragH' ||
        l.type === 'dragV' ||
        l.type === 'dragZ'),
  )
}

export function isWidgetRuntimeEnabled(widget: Widget2D): boolean {
  return widget.props._runtimeEnabled !== false
}

/** 像素偏移 → Tag 值（拖拽写值） */
export function mapDragOffsetToTag(
  offset: number,
  link: { inMin: number; inMax: number; outMin: number; outMax: number },
): number {
  const spanOut = link.outMax - link.outMin || 1
  const t = Math.min(1, Math.max(0, (offset - link.outMin) / spanOut))
  return link.inMin + t * (link.inMax - link.inMin)
}
