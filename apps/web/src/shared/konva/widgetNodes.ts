import Konva from 'konva'
import {
  curveSamples,
  curveTimes,
  liveSeriesOf,
  liveTrendTimes,
} from '@/shared/runtime/trendSeries'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import {
  trendHistoryQualities,
  trendHistorySeries,
  trendHistoryTimes,
  trendHistoryTimesForFirstQuery,
} from '@/shared/runtime/trendHistoryQuery'
import {
  renderTrendChart,
  trendHoverOf,
  trendZoomOf,
  type TrendChartSpec,
  type TrendChartSeries,
} from '@/shared/konva/trendChart'
import {
  formatLegendValue,
  trendLegendLayout,
  type TrendLegendLayout,
} from '@/shared/konva/trendLegendLayout'
import {
  parseListItems,
  parseSeries,
  resolveTrendRange,
  trendCurveColor,
  trendCurves,
  type TrendCurve,
  type Widget2D,
} from '@web-scada/core'
import { HISTORY_FILTER_HEIGHT, HISTORY_PAGER_HEIGHT, alarmHistoryWindow, historyRowCapacity, historySampleMatches } from '@/shared/runtime/alarmHistoryQuery'
import { trendHistoryRangeText, trendHistoryWindowOf } from '@/shared/runtime/trendHistoryQuery'
import { trendHistoryCursorOf, trendHistoryCursorReadout } from '@/shared/runtime/trendHistoryCursor'
import { alarmLimitsOf, ensureAlarmLimits } from '@/shared/runtime/trendAlarmLimits'
import { ensureTrendAlarmBands, trendAlarmBandsOf } from '@/shared/runtime/trendAlarmEvents'

function num(style: Record<string, unknown>, key: string, fallback: number) {
  const v = style[key]
  return typeof v === 'number' ? v : fallback
}

function str(style: Record<string, unknown>, key: string, fallback: string) {
  const v = style[key]
  return typeof v === 'string' ? v : fallback
}

/** 根据 Widget2D 创建对应 Konva 节点（含 Group 包装，统一 transform） */
export function createWidgetNode(widget: Widget2D): Konva.Group {
  const group = new Konva.Group({
    id: widget.id,
    name: 'widget',
    x: widget.transform.x,
    y: widget.transform.y,
    rotation: widget.transform.rotation,
    scaleX: widget.transform.scaleX,
    scaleY: widget.transform.scaleY,
    draggable: !widget.locked,
    visible: widget.visible !== false,
  })
  group.setAttr('widgetId', widget.id)
  group.setAttr('widgetType', widget.type)

  const shape = buildShape(widget)
  group.add(shape)
  return group
}

/**
 * 图表字号：`props.chartFontSize` 显式指定优先；否则按图元尺寸自动，
 * 保证 Runtime（页面按窗口缩放）里也读得清 —— 之前固定 11px 是"图上字都看不见"的原因。
 */
export function chartFontSize(widget: Widget2D, width: number, height: number): number {
  const explicit = Number(widget.props.chartFontSize)
  if (Number.isFinite(explicit) && explicit >= 8) return Math.min(48, Math.round(explicit))
  const auto = Math.round(Math.min(width, height) / 10)
  return Math.min(22, Math.max(14, auto))
}

/** 被点掉（隐藏）的曲线 tagId */
/**
 * 运行端本地的曲线显隐覆盖（图元 id → 被点掉的 tagId）。
 *
 * 为什么必须有它：运行端画的是"解析后的图元副本"（Published 工程只读、副本每帧重建），
 * 光靠写回工程 / Pinia 会出现"点了没反应"。这里先把结果记在本地覆盖里，
 * 渲染时优先读它 —— 设计端、运行端、3D 面板行为完全一致，点一下立刻生效。
 */
const hiddenCurveOverride = new Map<string, Set<string>>()

/** 被点掉的曲线 tagId：工程里配的 + 运行端手动点的（后者优先） */
function hiddenCurveIds(widget: Widget2D): Set<string> {
  const override = hiddenCurveOverride.get(widget.id)
  if (override) return new Set(override)
  const raw = widget.props.hiddenCurves
  return new Set(
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [],
  )
}

/** 点图例切换某条曲线显隐：本地覆盖立即生效 + 顺手写回工程（设计端能存进工程 JSON） */
function toggleCurveHidden(widget: Widget2D, tagId: string, source?: Konva.Node): void {
  const next = hiddenCurveIds(widget)
  if (next.has(tagId)) next.delete(tagId)
  else next.add(tagId)
  hiddenCurveOverride.set(widget.id, next)
  redrawWidgetShape(widget, source)
  try {
    useProjectStore().updateWidget(widget.id, {
      props: { ...widget.props, hiddenCurves: [...next] },
    })
  } catch {
    // 运行端工程只读 / 没有 Pinia：忽略即可，本地覆盖已经生效
  }
}

/** 外部（原生叠层的图例）改曲线显隐：本地覆盖立即生效 + 顺手写回工程 */
export function setHiddenCurves(widget: Widget2D, hidden: string[]): void {
  hiddenCurveOverride.set(widget.id, new Set(hidden))
  try {
    useProjectStore().updateWidget(widget.id, {
      props: { ...widget.props, hiddenCurves: hidden },
    })
  } catch {
    /* 运行端工程只读：本地覆盖已经生效 */
  }
}

/**
 * 图表内容（位图 / 图例 / 导出按钮）是否由 Konva 画。
 * 原生活控件接管时把它们藏起来，只留图元底板，避免"两层叠着画"。
 */
export function setTrendChartRendered(group: Konva.Group, rendered: boolean): void {
  const shape = group.findOne('.shape') as Konva.Group | null
  if (!shape) return
  for (const name of ['.trend-chart', '.shape-legend', '.shape-export']) {
    shape.findOne(name)?.visible(rendered)
  }
}
/** 立刻按当前（含本地覆盖）状态重画图形层，别等下一次数据刷新 */
function redrawWidgetShape(widget: Widget2D, source?: Konva.Node): void {
  try {
    // 先拿到图元所在的 Group（重画会把 source 自己删掉，所以要提前拿）
    const group = source?.findAncestor?.('.widget', true) as Konva.Group | undefined
    if (!group) return
    group.findOne('.shape')?.destroy()
    group.add(buildShape(widget))
    group.getLayer()?.batchDraw()
  } catch (err) {
    console.warn('[widgetNodes] 重画趋势图失败', err)
  }
}

let legendProbe: Konva.Text | null = null

/** 图例上"按下的那一下"记在这里（见 trendLegendNode 里的说明） */
let pendingLegendTap: { widgetId: string; tagId: string; x: number; y: number } | null = null

/** 指针事件的屏幕坐标（鼠标 / 触摸都能取到） */
function legendEvtPoint(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  const evt = e.evt as MouseEvent | undefined
  if (evt && typeof evt.clientX === 'number') return { x: evt.clientX, y: evt.clientY }
  const touch = (e.evt as TouchEvent | undefined)?.changedTouches?.[0]
  if (touch && typeof touch.clientX === 'number') return { x: touch.clientX, y: touch.clientY }
  return null
}

/** 量文字宽度（Konva 自带测量上下文，不必挂到 stage 上） */
function measureLegendText(text: string, fontSize: number): number {
  if (!legendProbe) legendProbe = new Konva.Text({ text: '', fontSize })
  legendProbe.fontSize(fontSize)
  legendProbe.text(text)
  return legendProbe.getTextWidth()
}


/** 图例里显示哪个数：运行时缓冲（实时）/ 历史查询结果优先，其次曲线自带的 series */
function legendValueOf(widget: Widget2D, isHistory: boolean) {
  return (curve: TrendCurve): number | null => {
    // 历史趋势有游标时，图例显示**游标处**的值（否则看不出读数对应哪一点）
    if (isHistory && trendHistoryCursorOf(widget.id) != null) {
      const row = trendHistoryCursorReadout(widget.id, [curve.tagId])?.rows[0]
      if (row) return row.value
    }
    const list = isHistory
      ? trendHistorySeries(widget.id, curve.tagId) ?? curve.series
      : curveSamples(widget.id, curve.tagId) ?? curve.series
    if (!list || !list.length) return null
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }
}

/**
 * Konva 版图例：色块 + 变量名 + 当前值，点一下切换显隐（隐藏的置灰）。
 * 布局由 trendLegendLayout 算好：每条曲线都有名字（放不下换行，不再静默丢弃）。
 */
function trendLegendNode(
  widget: Widget2D,
  layout: TrendLegendLayout,
  top: number,
  style: Record<string, unknown>,
  fontSize: number,
): Konva.Group {
  const g = new Konva.Group({ name: 'shape-legend' })
  const textColor = str(style, 'textColor', '#94a3b8')
  const textTop = Math.round((layout.rowHeight - fontSize) / 2) - 2
  for (const entry of layout.entries) {
    const item = new Konva.Group({
      x: entry.x,
      y: top + entry.row * layout.rowHeight,
      listening: true,
    })
    // 整行都是热区：点色块、点变量名、点数值、点这行空白都能切换。
    // 以前只有"色块 + 文字"本身能点到，又细又窄，很难点中 —— 这才是"不好用"的主因。
    item.add(
      new Konva.Rect({
        width: Math.max(fontSize + 9 + entry.labelW + entry.valueW, layout.rowHeight),
        height: layout.rowHeight,
        fill: 'rgba(0,0,0,0.001)',
      }),
    )
    item.add(
      new Konva.Rect({
        width: fontSize,
        height: Math.max(3, Math.round(fontSize / 4)),
        y: textTop + Math.round(fontSize / 2) - 2,
        fill: entry.color,
        opacity: entry.hidden ? 0.28 : 1,
      }),
    )
    item.add(
      new Konva.Text({
        x: fontSize + 5,
        y: textTop - 2,
        text: entry.label,
        fontSize,
        fill: textColor,
        opacity: entry.hidden ? 0.45 : 1,
        // 被点掉的曲线：名字上加删除线（比"变灰"更明显，一眼看出是哪条）
        textDecoration: entry.hidden ? 'line-through' : undefined,
      }),
    )
    const valueText = new Konva.Text({
      x: fontSize + 5 + entry.labelW + 4,
      y: textTop - 2,
      text: entry.value,
      fontSize: Math.max(9, fontSize - 1),
      fill: textColor,
      opacity: entry.hidden ? 0.3 : 0.65,
      listening: false,
    })
    valueText.name('legend-value')
    valueText.setAttr('legendIndex', entry.index)
    item.add(valueText)
    // 用「按下 → 抬起」自己判定点击，而不是用 click：
    // 运行端每秒都会重建图元节点，Konva 的 click 要求按下/抬起命中同一个节点对象，
    // 重建一穿插 click 就丢了（"点了没反应"的另一个原因）。这里把意图记在模块级变量上，
    // 抬起到哪个（新）节点都认，只要还是同一条曲线。
    item.on('mousedown touchstart', (e) => {
      e.cancelBubble = true
      pendingLegendTap = {
        widgetId: widget.id,
        tagId: entry.curve.tagId,
        x: legendEvtPoint(e)?.x ?? 0,
        y: legendEvtPoint(e)?.y ?? 0,
      }
    })
    item.on('mouseup touchend', (e) => {
      e.cancelBubble = true
      const pending = pendingLegendTap
      pendingLegendTap = null
      if (!pending || pending.widgetId !== widget.id || pending.tagId !== entry.curve.tagId) return
      const point = legendEvtPoint(e)
      if (point && Math.abs(point.x - pending.x) + Math.abs(point.y - pending.y) > 8) return
      toggleCurveHidden(widget, entry.curve.tagId, item)
    })
    item.on('mouseenter', () => {
      const stage = item.getStage()
      if (stage) stage.container().style.cursor = 'pointer'
    })
    item.on('mouseleave', () => {
      const stage = item.getStage()
      if (stage) stage.container().style.cursor = ''
    })
    g.add(item)
  }
  if (layout.overflow) {
    g.add(
      new Konva.Text({
        x: layout.overflow.x,
        y: top + layout.overflow.row * layout.rowHeight + textTop,
        text: layout.overflow.text,
        fontSize,
        fill: textColor,
        opacity: 0.6,
      }),
    )
  }
  return g
}
/**
 * 时间轴范围 = 各曲线时间范围的**并集**（以最新数据为准）。
 * 不再"裁剪到交集"：交集会被刚加入 / 停更的那条曲线压塌成几秒，
 * 表现为轴只剩两三秒、各线长短差别被放大。
 */
function alignSeriesTimeWindow(series: TrendChartSeries[]): { min?: number; max?: number } {
  const timed = series.filter(
    (item) => item.times && item.times.length > 1 && item.times.length === item.points.length,
  )
  if (!timed.length) return {}
  let min = Infinity
  let max = -Infinity
  for (const item of timed) {
    const times = item.times as number[]
    min = Math.min(min, times[0] as number)
    max = Math.max(max, times[times.length - 1] as number)
  }
  return Number.isFinite(min) && max > min ? { min, max } : {}
}

/**
 * 趋势图元 → ECharts 规格。
 * 数据来源与手绘路径一致：多曲线走 props.curves + 运行时缓冲 / 历史查询缓存，
 * 单曲线走实时缓冲或（历史趋势）查询结果，都没有则用 props.series 的示例数据。
 * 被图例点掉的曲线不进图表（但仍在图例里显示为置灰）。
 *
 * **图片渲染与原生叠层共用这一份组装**，两边不会漂移。
 */
export function buildTrendSpec(opts: {
  widget: Widget2D
  curves: TrendCurve[]
  hidden: Set<string>
  fallbackSeries: number[]
  isHistory: boolean
  title: string
  rangeText: string
  width: number
  height: number
  /** 图表字号（由调用方按整个图元尺寸算好，避免图例占高后又被算小） */
  fontSize: number
  style: Record<string, unknown>
  /** 画的只是 props.series 的示例占位（没有绑定任何变量）→ 标题栏标注"示例数据" */
  demoData?: boolean
  /** 顶部给 HTML 工具栏留的高度（CSS px，仅历史趋势 + 原生路径） */
  chromeTop?: number
  /** 底部给 HTML 点表留的高度（CSS px） */
  chromeBottom?: number
  /** 超采样倍数（图片路径用；原生叠层传 1） */
  scale?: number
  /** 原生模式：用 ECharts 自带的图例/dataZoom/toolbox */
  native?: boolean
}): TrendChartSpec {
  const {
    widget,
    curves,
    hidden,
    fallbackSeries,
    isHistory,
    title,
    rangeText,
    width,
    height,
    fontSize,
    style,
    demoData,
    scale,
    native,
  } = opts
  const rangeLabel = [rangeText, demoData ? '示例数据' : ''].filter(Boolean).join(' · ')
  const legacyTagId = curves[0]?.tagId ?? ''
  const legacyHistorySeries = isHistory
    ? curves.length
      ? trendHistorySeries(widget.id, legacyTagId) ?? fallbackSeries
      : fallbackSeries
    : fallbackSeries
  const legacyHistoryTimes = isHistory
    ? curves.length
      ? trendHistoryTimes(widget.id, legacyTagId)
      : trendHistoryTimesForFirstQuery(widget.id)
    : liveTrendTimes(widget.id)

  // 原生控件：被点掉的曲线仍留在 series 里，靠图例 selected=false 置灰，才能再点回来。
  // 位图路径：不画它们，Konva 图例自己负责置灰。
  const plotted = native ? curves : curves.filter((curve) => !hidden.has(curve.tagId))
  const legendOff = native
    ? curves.filter((curve) => hidden.has(curve.tagId)).map((curve) => curve.label || curve.tagId)
    : undefined
  // 注意：配了曲线（curves 非空）就不许再回退 props.series 的示例数据 ——
  // 即使全部被图例点掉，也只画空轴；把占位数据混进来会让人以为那条线是别的变量。
  const series: TrendChartSeries[] = curves.length
    ? plotted.map((curve, i) => ({
        name: curve.label || curve.tagId,
        // 颜色按"在完整曲线列表里的序号"取：切换显隐后颜色不会跳
        color: curve.color || trendCurveColor(Math.max(0, curves.findIndex((c) => c.tagId === curve.tagId)) || i),
        points: (
          (isHistory
            ? trendHistorySeries(widget.id, curve.tagId) ?? curve.series
            : curveSamples(widget.id, curve.tagId) ?? curve.series) ?? []
        ).slice(),
        times: isHistory ? trendHistoryTimes(widget.id, curve.tagId) : curveTimes(widget.id, curve.tagId),
        step: seriesStepOf(curve.tagId),
        // 每曲线显示格式（属性面板配的"单位 / 小数位"）
        unit: curve.unit,
        decimals: curve.decimals,
        // 坏质量（Bad/Offline）区间标红：只有历史查询带质量
        qualities: isHistory ? trendHistoryQualities(widget.id, curve.tagId) : undefined,
      }))
    : [
        {
          name: title,
          color: str(style, 'lineColor', '#38bdf8'),
          points: legacyHistorySeries.slice(),
          times: legacyHistoryTimes,
          step: seriesStepOf(legacyTagId),
        },
      ]

  // 时间轴范围 = 各曲线时间范围的并集（最新数据为准）；缩放区间交给图表自己应用
  // （图表里要按同一份数据画底部滑块把手，两边用同一份 base 窗口才不会错位）
  const window = alignSeriesTimeWindow(series)
  const zoom = trendZoomOf(widget.id)

  // 单曲线自动用图元量程；多曲线默认自动缩放，
  // 但在属性里手动填了 min/max 就当“锁定量程”用（趋势不会跳来跳去）
  const single = series.length === 1
  const manual = Number.isFinite(Number(widget.props.min)) || Number.isFinite(Number(widget.props.max))
  const useManual = single || manual
  const min = useManual ? Number(widget.props.min) : Number.NaN
  const max = useManual ? Number(widget.props.max) : Number.NaN
  const spec: TrendChartSpec = {
    width,
    height,
    title,
    rangeLabel: rangeLabel || undefined,
    chromeTop: opts.chromeTop,
    chromeBottom: opts.chromeBottom,
    // 报警限值线：各曲线变量上配置的 HH/H/L/LL 阈值（同一个纵轴，合并成一组线）
    limits: historyLimitsOf(curves),
    alarmBands: isHistory ? historyAlarmBandsOf(widget, curves) : undefined,
    // 游标：历史趋势落的竖线（实时趋势不画）
    cursor: isHistory ? trendHistoryCursorOf(widget.id) ?? undefined : undefined,
    // 历史趋势才需要底部滑块与框选缩放，且只有原生叠层能真正拖得动
    slider: isHistory && native === true,
    selectZoom: isHistory && native === true,
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    stacked: widget.props.chartStack === true,
    timeMin: window.min,
    timeMax: window.max,
    zoom: zoom ?? undefined,
    scale,
    native,
    legendOff,
    series,
    theme: {
      background: str(style, 'fill', '#0b1220'),
      textColor: str(style, 'textColor', '#94a3b8'),
      gridColor: str(style, 'gridColor', '#1e293b'),
      fontSize,
    },
  }

  return spec
}
/**
 * 原生叠层（HTML 活控件）用：按图元当前数据组装规格。
 * 尺寸用**屏幕尺寸**、scale=1（不再超采样），字号按页面缩放一起放大，跟页面其它图元一致。
 */
export function buildTrendLiveSpec(
  widget: Widget2D,
  opts: { width: number; height: number; fontSize: number; chromeTop?: number; chromeBottom?: number },
): TrendChartSpec {
  const isHistory = widget.type === 'trendHistory'
  const livePoints = liveSeriesOf(widget.id) ?? []
  return buildTrendSpec({
    widget,
    curves: trendCurves(widget.props).filter((curve) => Boolean(curve.tagId)),
    hidden: hiddenCurveIds(widget),
    fallbackSeries: livePoints.length ? livePoints : parseSeries(widget.props.series),
    isHistory,
    title: String(widget.props.title ?? (isHistory ? '历史趋势' : '实时趋势')),
    rangeText: isHistory ? trendHistoryRangeText(widget.id, String(widget.props.range ?? '-1h')) : '',
    width: opts.width,
    height: opts.height,
    fontSize: opts.fontSize,
    style: widget.style,
    demoData: isDemoTrendData(widget, livePoints.length),
    chromeTop: opts.chromeTop,
    chromeBottom: opts.chromeBottom,
    scale: 1,
    native: true,
  })
}

/** 坏质量点数量：只用来做位图缓存的 key（质量变了要重画） */
function badQualityCount(series: { qualities?: Array<string | null> }): number {
  const q = series.qualities
  if (!q || !q.length) return 0
  let n = 0
  for (const item of q) {
    const text = String(item ?? '').toLowerCase()
    if (text === 'bad' || text === 'offline' || text === 'uncertain' || text === 'stale') n += 1
  }
  return n
}

/**
 * 图片路径：把规格渲染成一张位图（缓存 key = 尺寸 + 数据末值 + 配置）。
 */
function trendChartCanvas(opts: Parameters<typeof buildTrendSpec>[0]): HTMLCanvasElement | null {
  const spec = buildTrendSpec(opts)
  const key = [
    opts.widget.id,
    `${Math.round(spec.width)}x${Math.round(spec.height)}`,
    spec.series
      .map(
        (item) =>
          `${item.name}:${item.points.length}:${item.points[item.points.length - 1] ?? ''}:${item.color}:${item.unit ?? ''}:${item.decimals ?? ''}:${badQualityCount(item)}`,
      )
      .join('|'),
    `min=${spec.min ?? 'auto'},max=${spec.max ?? 'auto'},f=${spec.theme.fontSize},stack=${spec.stacked ? 1 : 0}`,
    spec.zoom ? `z=${spec.zoom.start.toFixed(4)}-${spec.zoom.end.toFixed(4)}` : 'z=full',
  ].join('#')
  return renderTrendChart(key, spec, trendHoverOf(opts.widget.id) ?? null)
}
/** 历史趋势的报警区间（与"历史报警"控件同一份事件源，按窗口缓存 30s） */
function historyAlarmBandsOf(widget: Widget2D, curves: TrendCurve[]): Array<{ from: number; to: number }> | undefined {
  const tagIds = curves.map((curve) => curve.tagId).filter(Boolean)
  if (!tagIds.length) return undefined
  const win = trendHistoryWindowOf(widget.id)
  if (!win) return undefined
  ensureTrendAlarmBands(widget.id, tagIds, win.from, win.to)
  const bands = trendAlarmBandsOf(widget.id)
  return bands.length
    ? bands.map((band: { from: number; to: number }) => ({ from: band.from, to: band.to }))
    : undefined
}

/** 开关量 / 字符串量 → 阶梯画（拿不到元数据就当数值处理） */
function seriesStepOf(tagId: string): boolean {
  try {
    const meta = useTagStore().metas.find((item) => item.tagId === tagId)
    return meta?.dataType === 'bool' || meta?.dataType === 'string'
  } catch {
    return false
  }
}

/** 历史趋势的报警限值线（按变量拉一次配置，60s 缓存） */
function historyLimitsOf(curves: TrendCurve[]): Array<{ value: number; label: string }> {
  ensureAlarmLimits()
  const out: Array<{ value: number; label: string }> = []
  const seen = new Set<string>()
  for (const curve of curves) {
    if (!curve.tagId) continue
    for (const limit of alarmLimitsOf(curve.tagId)) {
      const key = `${limit.value}|${limit.code}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ value: limit.value, label: `${curve.label || curve.tagId} ${limit.code}` })
    }
  }
  return out
}

/**
 * 按图元自身配置渲染一张 ECharts 位图（含悬停读数与缩放窗口）。
 * 渲染路径与"图元交互重绘"（悬停 / 拖拽缩放）都走这个函数，保证两边一致。
 */
export function buildTrendChartImage(widget: Widget2D): HTMLCanvasElement | null {
  if (widget.type !== 'trend' && widget.type !== 'trendHistory') return null
  const width = widget.transform.width
  const height = widget.transform.height
  const curves = trendCurves(widget.props).filter((curve) => Boolean(curve.tagId))
  const isHistory = widget.type === 'trendHistory'
  const livePoints = liveSeriesOf(widget.id) ?? []
  const chartFont = chartFontSize(widget, width, height)
  const legendFont = Math.max(10, Math.round(chartFont * 0.7))
  // 图例占几行由排版算出来：绘图区高度随之让出来（图例里带当前值，宽度会变）
  const legendLayout = trendLegendLayout({
    curves,
    hidden: hiddenCurveIds(widget),
    width,
    height,
    fontSize: legendFont,
    colorOf: trendCurveColor,
    measure: measureLegendText,
    valueOf: legendValueOf(widget, isHistory),
  })
  return trendChartCanvas({
    widget,
    curves,
    hidden: hiddenCurveIds(widget),
    fallbackSeries: liveSeriesOf(widget.id) ?? parseSeries(widget.props.series),
    isHistory,
    title: String(widget.props.title ?? (isHistory ? '历史趋势' : '实时趋势')),
    rangeText: isHistory ? trendHistoryRangeText(widget.id, String(widget.props.range ?? '-1h')) : '',
    width,
    height: Math.max(20, height - legendLayout.height),
    fontSize: chartFont,
    style: widget.style,
    demoData: isDemoTrendData(widget, livePoints.length),
  })
}

/** 把画布存成 PNG 下载 */
export function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, 'image/png')
}

/**
 * 趋势图元右上角"导出图片"按钮的矩形（**图元局部坐标**）。
 * 绘制（Konva）与命中判定（交互层）共用这一份，两边不会错位。
 */
export function trendExportRect(widget: Widget2D): {
  x: number
  y: number
  width: number
  height: number
} {
  const { width, height } = widget.transform
  const font = chartFontSize(widget, width, height)
  const w = Math.max(46, Math.round(font * 2.3))
  const h = Math.max(18, Math.round(font * 1.05))
  return { x: Math.max(6, width - 6 - w), y: 5, width: w, height: h }
}

/**
 * 导出趋势图元为 PNG（连带图例，所见即所得）。
 * 优先用 Konva 把整个图元栅格化；拿不到节点时退回图表画布本身。
 */
export function exportTrendWidgetImage(widget: Widget2D, nodeHint?: Konva.Node): void {
  try {
    const group =
      ((nodeHint?.findAncestor?.('.widget', true) ?? null) as Konva.Group | null) ??
      ((Konva.stages ?? [])
        .map((stage) => stage.findOne('#' + widget.id))
        .find((node): node is Konva.Node => Boolean(node)) as Konva.Group | undefined)
    let canvas: HTMLCanvasElement | null = null
    if (group) {
      try {
        canvas = group.toCanvas({ pixelRatio: 2 })
      } catch (err) {
        console.warn('[trendChart] 图元栅格化失败，退回图表画布', err)
      }
    }
    if (!canvas) canvas = buildTrendChartImage(widget)
    if (!canvas) return
    const title = String(widget.props.title ?? '趋势').replace(/[\\/:*?"<>|]+/g, '_')
    // 文件名用**本地时间**（toISOString 是 UTC，会差 8 小时）
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    downloadCanvas(canvas, `${title}-${stamp}.png`)
  } catch (err) {
    console.warn('[trendChart] 导出图片失败', err)
  }
}

/** 图元右上角的"导出图片"按钮（Konva 节点：和图例一样能点，设计端/运行端都一样） */
function trendExportNode(widget: Widget2D, style: Record<string, unknown>): Konva.Group {
  const rect = trendExportRect(widget)
  const textColor = str(style, 'textColor', '#94a3b8')
  const g = new Konva.Group({ name: 'shape-export', x: rect.x, y: rect.y, listening: true })
  // 底板负责命中（Konva 的 Group 只能靠子节点被命中）；图标/文字不参与命中
  g.add(
    new Konva.Rect({
      width: rect.width,
      height: rect.height,
      cornerRadius: 3,
      fill: 'rgba(148,163,184,0.10)',
      stroke: str(style, 'gridColor', '#132033'),
      strokeWidth: 1,
      listening: true,
    }),
  )
  const cx = rect.width - 12
  const midY = rect.height / 2
  g.add(
    new Konva.Line({
      points: [cx, midY - 7, cx, midY + 2],
      stroke: textColor,
      strokeWidth: 1.4,
      listening: false,
    }),
  )
  g.add(
    new Konva.Line({
      points: [cx - 3.5, midY - 1, cx, midY + 3, cx + 3.5, midY - 1],
      stroke: textColor,
      strokeWidth: 1.4,
      lineJoin: 'round',
      listening: false,
    }),
  )
  g.add(
    new Konva.Line({
      points: [cx - 5, midY + 6, cx + 5, midY + 6],
      stroke: textColor,
      strokeWidth: 1.4,
      lineCap: 'round',
      listening: false,
    }),
  )
  g.add(
    new Konva.Text({
      x: 8,
      y: Math.round((rect.height - 13) / 2),
      text: '导出',
      fontSize: 13,
      fill: textColor,
      opacity: 0.85,
      listening: false,
    }),
  )
  g.on('mouseenter', () => {
    const stage = g.getStage()
    if (stage) stage.container().style.cursor = 'pointer'
  })
  g.on('mouseleave', () => {
    const stage = g.getStage()
    if (stage) stage.container().style.cursor = ''
  })
  // 按下/抬起都拦住：别把图元拖走、也别让图表交互跟着动
  g.on('mousedown touchstart', (e) => {
    e.cancelBubble = true
  })
  g.on('mouseup touchend', (e) => {
    e.cancelBubble = true
  })
  g.on('click tap', (e) => {
    e.cancelBubble = true
    exportTrendWidgetImage(widget, g)
  })
  return g
}
/**
 * 趋势图元的"结构指纹"：只有它变了才需要重建节点。
 * 数据变化（新采样 / 游标 / 缩放）只换图表那一帧图像，不重建整棵节点 ——
 * 每 tick 重建既浪费 CPU，也会让 Konva 的点击判定（按下/抬起同一节点）容易丢。
 */
function trendShapeKey(widget: Widget2D): string {
  const { width, height } = widget.transform
  const style = widget.style
  return [
    widget.type,
    `${Math.round(width)}x${Math.round(height)}`,
    trendCurves(widget.props)
      .map(
        (curve) =>
          `${curve.tagId}|${curve.label ?? ''}|${curve.color ?? ''}|${curve.unit ?? ''}|${curve.decimals ?? ''}`,
      )
      .join(','),
    [...hiddenCurveIds(widget)].sort().join(','),
    String(widget.props.title ?? ''),
    widget.props.chartStack ? 'stack' : '',
    String(widget.props.chartFontSize ?? ''),
    String(widget.props.min ?? ''),
    String(widget.props.max ?? ''),
    String(widget.props.range ?? ''),
    [
      style.fill,
      style.stroke,
      style.gridColor,
      style.textColor,
      style.lineColor,
      style.cornerRadius,
      style.fontSize,
      style.opacity,
    ].join('|'),
  ].join('#')
}

/** 趋势图元原地刷新：换图表图像 + 更新图例上的当前值；结构变了返回 false 交给调用方重建 */
function refreshTrendShape(shape: Konva.Group, widget: Widget2D): boolean {
  const image = shape.findOne('.trend-chart') as Konva.Image | null
  if (!image) return false
  const canvas = buildTrendChartImage(widget)
  if (!canvas) return false
  let dirty = false
  if (image.image() !== canvas) {
    image.image(canvas)
    dirty = true
  }
  const legend = shape.findOne('.shape-legend') as Konva.Group | null
  if (legend) {
    const curves = trendCurves(widget.props).filter((curve) => Boolean(curve.tagId))
    const values = legendValueOf(widget, widget.type === 'trendHistory')
    legend.find('.legend-value').forEach((node) => {
      const text = node as Konva.Text
      const index = Number(text.getAttr('legendIndex') ?? -1)
      const curve = curves[index]
      if (!curve) return
      const next = formatLegendValue(values(curve), { unit: curve.unit, decimals: curve.decimals })
      if (text.text() !== next) {
        text.text(next)
        dirty = true
      }
    })
  }
  if (dirty) shape.getLayer()?.batchDraw()
  return true
}
/**
 * 图元有没有"可以点的曲线图例"（趋势图元 + 至少一条真正绑定的曲线）。
 *
 * 运行端默认只给"有事件 / 有交互绑定"的图元开命中测试，其它图元整棵子树都不参与命中，
 * 于是图例点不动 —— 运行端必须用它来放行趋势图元的命中测试（设计端/运行端行为保持一致）。
 */
export function widgetHasCurveLegend(widget: Widget2D): boolean {
  if (widget.type !== 'trend' && widget.type !== 'trendHistory') return false
  return trendCurves(widget.props).some((curve) => Boolean(curve.tagId))
}

/**
 * 这个趋势图元画的到底是不是"我绑的变量"？
 * - 配了曲线（props.curves 有 tagId）→ 是
 * - 有实时缓冲 → 是
 * - 有动画连接 / 属性绑定提供实时值 → 是
 * - 以上都没有，只有 props.series（新建图元自带的示例数据）→ 不是，图上要标"示例数据"
 */
function isDemoTrendData(widget: Widget2D, liveLen: number): boolean {
  if (widget.type !== 'trend' && widget.type !== 'trendHistory') return false
  if (trendCurves(widget.props).some((curve) => Boolean(curve.tagId))) return false
  if (liveLen > 0) return false
  const bound =
    (widget.animationLinks ?? []).some(
      (link) => link.enabled !== false && link.type === 'valueOut' && Boolean(link.tagId),
    ) || (widget.bindings ?? []).some((binding) => binding.prop === 'value' && Boolean(binding.tagId))
  if (bound) return false
  return parseSeries(widget.props.series).length > 0
}

function buildShape(widget: Widget2D): Konva.Shape | Konva.Group {
  const { width, height } = widget.transform
  const style = widget.style
  const opacity = num(style, 'opacity', 1)

  switch (widget.type) {
    case 'circle': {
      return new Konva.Ellipse({
        name: 'shape',
        x: width / 2,
        y: height / 2,
        radiusX: Math.max(width / 2, 1),
        radiusY: Math.max(height / 2, 1),
        fill: str(style, 'fill', '#22c55e'),
        stroke: str(style, 'stroke', '#86efac'),
        strokeWidth: num(style, 'strokeWidth', 2),
        opacity,
      })
    }
    case 'line': {
      return new Konva.Line({
        name: 'shape',
        points: [0, height / 2, width, height / 2],
        stroke: str(style, 'stroke', '#f8fafc'),
        strokeWidth: num(style, 'strokeWidth', 3),
        lineCap: 'round',
        opacity,
        hitStrokeWidth: 16,
      })
    }
    case 'pipe':
    case 'polyline':
    case 'polygon': {
      const raw = widget.props.points
      const pts = Array.isArray(raw)
        ? (raw as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : widget.type === 'pipe'
          ? [0, height / 2, width, height / 2]
          : [0, 0, width, height / 2, width, height]
      const closed = widget.type === 'polygon'
      const isPipe = widget.type === 'pipe'
      return new Konva.Line({
        name: 'shape',
        points: pts.length >= 4 ? pts : [0, 0, Math.max(width, 4), Math.max(height, 4)],
        closed,
        fill: closed ? str(style, 'fill', '#3d8bfd') : undefined,
        stroke: str(style, 'stroke', isPipe ? '#94a3b8' : closed ? '#93c5fd' : '#f8fafc'),
        strokeWidth: num(style, 'strokeWidth', isPipe ? 8 : closed ? 2 : 3),
        lineJoin: 'round',
        lineCap: 'round',
        opacity,
        hitStrokeWidth: closed ? undefined : 16,
      })
    }
    case 'text': {
      return new Konva.Text({
        name: 'shape',
        width,
        height,
        text: String(widget.props.text ?? '文本'),
        fill: str(style, 'fill', '#e8eaed'),
        fontSize: num(style, 'fontSize', 20),
        align: str(style, 'align', 'left') as 'left' | 'center' | 'right',
        verticalAlign: 'middle',
        opacity,
      })
    }
    case 'button': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#2563eb'),
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: String(widget.props.text ?? '按钮'),
          fill: str(style, 'textColor', '#ffffff'),
          fontSize: num(style, 'fontSize', 14),
          align: 'center',
          verticalAlign: 'middle',
          listening: false,
        }),
      )
      return g
    }
    case 'image': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: '#111827',
          stroke: str(style, 'stroke', '#3d4454'),
          strokeWidth: num(style, 'strokeWidth', 1),
          opacity,
        }),
      )
      const src = String(widget.props.src || '')
      if (src) {
        const imageObj = new window.Image()
        imageObj.onload = () => {
          const existing = g.findOne('.img')
          existing?.destroy()
          g.add(
            new Konva.Image({
              name: 'img',
              image: imageObj,
              width,
              height,
              opacity,
              listening: false,
            }),
          )
          g.getLayer()?.batchDraw()
        }
        imageObj.src = src
      } else {
        g.add(
          new Konva.Text({
            width,
            height,
            text: '无图片',
            align: 'center',
            verticalAlign: 'middle',
            fill: '#64748b',
            fontSize: 12,
            listening: false,
          }),
        )
      }
      return g
    }
    case 'scene3d': {
      const g = new Konva.Group({ name: 'shape' })
      const page3dId = String(widget.props.page3dId || '')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0b1220'),
          stroke: str(style, 'stroke', '#3d8bfd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 4),
          dash: [8, 5],
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: page3dId ? `三维画面\n${page3dId.slice(-8)}` : '三维画面\n（未选择页面）',
          align: 'center',
          verticalAlign: 'middle',
          fill: str(style, 'textColor', '#93c5fd'),
          fontSize: num(style, 'fontSize', 13),
          lineHeight: 1.4,
          listening: false,
        }),
      )
      return g
    }
    case 'valve': {
      const g = new Konva.Group({ name: 'shape' })
      const body = str(style, 'fill', '#64748b')
      const stroke = str(style, 'stroke', '#cbd5e1')
      const accent = str(style, 'accent', '#38bdf8')
      g.add(
        new Konva.Line({
          points: [0, height / 2, width, height / 2],
          stroke,
          strokeWidth: 6,
          lineCap: 'round',
          listening: false,
        }),
      )
      g.add(
        new Konva.RegularPolygon({
          x: width / 2,
          y: height / 2,
          sides: 4,
          radius: Math.min(width, height) * 0.42,
          fill: body,
          stroke,
          strokeWidth: 2,
          opacity,
        }),
      )
      if (widget.props.open !== false) {
        g.add(
          new Konva.Circle({
            x: width / 2,
            y: height / 2,
            radius: 4,
            fill: accent,
            listening: false,
          }),
        )
      }
      return g
    }
    case 'pump': {
      const g = new Konva.Group({ name: 'shape' })
      const running = Boolean(widget.props.running)
      g.add(
        new Konva.Ellipse({
          x: width / 2,
          y: height / 2,
          radiusX: width / 2,
          radiusY: height / 2,
          fill: str(style, 'fill', '#0ea5e9'),
          stroke: str(style, 'stroke', '#7dd3fc'),
          strokeWidth: num(style, 'strokeWidth', 2),
          opacity,
        }),
      )
      g.add(
        new Konva.RegularPolygon({
          x: width / 2,
          y: height / 2,
          sides: 3,
          radius: Math.min(width, height) * 0.28,
          rotation: running ? 90 : 0,
          fill: '#e0f2fe',
          listening: false,
        }),
      )
      return g
    }
    case 'lamp': {
      const on = widget.props.on !== false
      const fill = on ? str(style, 'fill', '#22c55e') : '#334155'
      return new Konva.Ellipse({
        name: 'shape',
        x: width / 2,
        y: height / 2,
        radiusX: width / 2,
        radiusY: height / 2,
        fill,
        stroke: str(style, 'stroke', '#14532d'),
        strokeWidth: num(style, 'strokeWidth', 2),
        shadowColor: on ? fill : undefined,
        shadowBlur: on ? 18 : 0,
        opacity,
      })
    }
    case 'tank': {
      const g = new Konva.Group({ name: 'shape' })
      const level = Math.min(100, Math.max(0, Number(widget.props.level ?? 60)))
      const liquidH = (height - 8) * (level / 100)
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#1e293b'),
          stroke: str(style, 'stroke', '#94a3b8'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: 10,
          opacity,
        }),
      )
      g.add(
        new Konva.Rect({
          x: 4,
          y: height - 4 - liquidH,
          width: width - 8,
          height: liquidH,
          fill: str(style, 'liquid', '#38bdf8'),
          cornerRadius: 6,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: `${level}%`,
          align: 'center',
          verticalAlign: 'middle',
          fill: '#e2e8f0',
          fontSize: 14,
          listening: false,
        }),
      )
      return g
    }
    case 'value': {
      const g = new Konva.Group({ name: 'shape' })
      const decimals = Number(widget.props.decimals ?? 1)
      const raw = widget.props.value
      const numVal = typeof raw === 'number' ? raw : Number(raw)
      const display = Number.isFinite(numVal)
        ? numVal.toFixed(Math.max(0, Math.min(6, decimals)))
        : String(raw ?? '--')
      const unit = String(widget.props.unit ?? '')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0f172a'),
          stroke: str(style, 'stroke', '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 8),
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          x: 10,
          y: 8,
          width: width - 20,
          text: String(widget.props.label ?? ''),
          fill: str(style, 'labelColor', '#94a3b8'),
          fontSize: 12,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          x: 10,
          y: height / 2 - 4,
          width: width - 20,
          text: unit ? `${display} ${unit}` : display,
          fill: str(style, 'textColor', '#38bdf8'),
          fontSize: num(style, 'fontSize', 22),
          fontStyle: 'bold',
          listening: false,
        }),
      )
      return g
    }
    case 'switch': {
      const g = new Konva.Group({ name: 'shape' })
      const on = widget.props.on === true || widget.props.on === 'true'
      const trackH = Math.min(height * 0.55, 28)
      const trackY = (height - trackH) / 2
      const pad = 4
      const knobR = trackH / 2 - 3
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: 'transparent',
          opacity,
        }),
      )
      g.add(
        new Konva.Rect({
          x: 0,
          y: trackY,
          width,
          height: trackH,
          fill: on ? str(style, 'fill', '#22c55e') : str(style, 'offFill', '#475569'),
          stroke: str(style, 'stroke', '#94a3b8'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: trackH / 2,
        }),
      )
      g.add(
        new Konva.Circle({
          x: on ? width - pad - knobR : pad + knobR,
          y: height / 2,
          radius: knobR,
          fill: '#f8fafc',
          listening: false,
        }),
      )
      const label = String(widget.props.label ?? '')
      if (label) {
        g.add(
          new Konva.Text({
            y: trackY - 16,
            width,
            text: label,
            fill: str(style, 'textColor', '#e2e8f0'),
            fontSize: num(style, 'fontSize', 12),
            align: 'center',
            listening: false,
          }),
        )
      }
      return g
    }
    case 'list':
    case 'alarm':
    case 'alarmHistory': {
      const g = new Konva.Group({ name: 'shape' })
      let rows = parseListItems(widget.props.items)
      const isHistory = widget.type === 'alarmHistory'
      if (isHistory && !Array.isArray(widget.props.alarmRowStatus)) {
        rows = rows.filter((cols) => historySampleMatches(cols, widget.id))
      }
      const rowH = Math.max(18, Number(widget.props.rowHeight ?? 28))
      const isAlarm = widget.type === 'alarm' || isHistory
      const title = String(
        widget.props.title ?? (widget.type === 'alarm' ? '实时报警' : isHistory ? '历史报警' : ''),
      )
      let y = 0
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', isHistory ? '#0c121b' : isAlarm ? '#140f0f' : '#0f172a'),
          stroke: str(style, 'stroke', isHistory ? '#1e3a5f' : isAlarm ? '#7f1d1d' : '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      if (title) {
        g.add(
          new Konva.Text({
            x: 8,
            y: 6,
            width: width - 16,
            text: title,
            fill: str(style, 'headerColor', isHistory ? '#93c5fd' : isAlarm ? '#fca5a5' : '#94a3b8'),
            fontSize: num(style, 'fontSize', 12),
            fontStyle: 'bold',
            listening: false,
          }),
        )
        y = 26
      } else {
        y = 6
      }
      if (isHistory) {
        g.add(
          new Konva.Rect({
            x: 4,
            y,
            width: Math.max(8, width - 8),
            height: HISTORY_FILTER_HEIGHT,
            fill: '#0b1220',
            stroke: '#1e293b',
            strokeWidth: 1,
            cornerRadius: 3,
            listening: false,
          }),
        )
        y += HISTORY_FILTER_HEIGHT + 4
      }
      const rowLimit = isHistory ? height - HISTORY_PAGER_HEIGHT - 4 : height
      let pageStart = 0
      if (isHistory) {
        const historyPage = alarmHistoryWindow(widget.id, rows.length, historyRowCapacity(widget))
        pageStart = historyPage.start
        rows = rows.slice(historyPage.start, historyPage.start + historyPage.size)
      }
      rows.forEach((cols, i) => {
        if (y + rowH > rowLimit) return
        const src = pageStart + i
        const ids = Array.isArray(widget.props.alarmRowIds) ? widget.props.alarmRowIds : []
        const alarmId = ids[src] == null ? '' : String(ids[src])
        // 历史报警行的"事件时刻"（运行端写入 props）；有它这一行就可点（反查历史趋势）
        const rowTimes = Array.isArray(widget.props.alarmRowTimes) ? widget.props.alarmRowTimes : []
        const rowAtRaw = Number(rowTimes[src])
        const rowAt = Number.isFinite(rowAtRaw) ? rowAtRaw : null
        const rowTags = Array.isArray(widget.props.alarmRowTags) ? widget.props.alarmRowTags : []
        const rowTag = rowTags[src] == null ? '' : String(rowTags[src])
        const statusList = Array.isArray(widget.props.alarmRowStatus) ? widget.props.alarmRowStatus : null
        const levelList = Array.isArray(widget.props.alarmRowLevel) ? widget.props.alarmRowLevel : null
        const status =
          statusList && statusList[src] != null
            ? String(statusList[src]).trim()
            : cols.length >= 4
              ? String(cols[2] ?? '').trim()
              : ''
        const unacked = !isHistory && (status === '未确认' || status === '已恢复')
        if (src % 2 === 1 || alarmId || rowAt != null) {
          const rowRect = new Konva.Rect({
            x: 1,
            y,
            width: width - 2,
            height: rowH,
            fill:
              i % 2 === 1
                ? str(style, 'rowAlt', isHistory ? '#111827' : isAlarm ? '#1c1212' : '#111827')
                : 'rgba(0,0,0,0.001)',
            listening: Boolean(alarmId) || rowAt != null,
            name: alarmId ? 'alarm-hit' : rowAt != null ? 'history-hit' : undefined,
          })
          if (alarmId) rowRect.setAttr('alarmId', alarmId)
          if (rowAt != null) rowRect.setAttr('alarmAt', rowAt)
          if (rowAt != null && rowTag) rowRect.setAttr('alarmTag', rowTag)
          g.add(rowRect)
        }
        const level =
          levelList && levelList[src] != null ? String(levelList[src]).trim() : String(cols[1] ?? '').trim()
        let rowColor = str(style, 'textColor', isHistory ? '#e2e8f0' : isAlarm ? '#fecaca' : '#e2e8f0')
        if (isAlarm) {
          if (status === '已恢复' || (isHistory && status === '恢复')) rowColor = '#cbd5e1'
          else if (level.includes('故障') || level.toLowerCase() === 'error') rowColor = '#f87171'
          else if (level.includes('告警') || level.includes('报警')) rowColor = '#fb923c'
          else if (level.includes('提示')) rowColor = '#fbbf24'
        }
        const line = cols.join('    ')
        const fontSize = num(style, 'fontSize', 12)
        const textParent = isAlarm
          ? new Konva.Group({
              listening: false,
              clipX: 6,
              clipY: y,
              clipWidth: Math.max(0, width - 12),
              clipHeight: rowH,
            })
          : g
        if (isAlarm) g.add(textParent)
        textParent.add(
          new Konva.Text({
            x: 8,
            y: y + (rowH - fontSize) / 2,
            width: isAlarm ? undefined : Math.max(8, width - 16),
            text: line,
            fill: rowColor,
            fontSize,
            wrap: isAlarm ? 'none' : 'word',
            listening: false,
            name: unacked ? 'alarm-blink' : undefined,
          }),
        )
        y += rowH
      })
      if (isHistory) {
        g.add(
          new Konva.Rect({
            x: 4,
            y: height - 4 - HISTORY_PAGER_HEIGHT,
            width: Math.max(8, width - 8),
            height: HISTORY_PAGER_HEIGHT,
            fill: '#0b1220',
            stroke: '#1e293b',
            strokeWidth: 1,
            cornerRadius: 3,
            listening: false,
          }),
        )
      }
      return g
    }
    case 'chart':
    case 'trend':
    case 'trendHistory': {
      const g = new Konva.Group({ name: 'shape' })
      // 记住结构指纹：下次同步结构没变就只换图像（见 refreshTrendShape）
      g.setAttr('trendKey', trendShapeKey(widget))
      // 实时缓冲优先（运行时缓存），没有实时数据再回退到 props.series 的示例/静态数据
      const series = liveSeriesOf(widget.id) ?? parseSeries(widget.props.series)
      const chartType = String(widget.props.chartType ?? 'line')
      const pad = { t: 28, r: 12, b: 16, l: 12 }
      const plotW = Math.max(10, width - pad.l - pad.r)
      // 多曲线：props.curves 非空时走多曲线渲染，每条曲线自己配色、自己按数据缩放；
      // 为空时完全沿用旧的单序列渲染（旧工程 + 示例数据外观不变）。
      const isHistoryWidget = widget.type === 'trendHistory'
      const curves =
        widget.type === 'chart'
          ? []
          : trendCurves(widget.props).filter((curve) => Boolean(curve.tagId))
      const chartFont = chartFontSize(widget, width, height)
      const legendFont = Math.max(10, Math.round(chartFont * 0.7))
      // 图例排版：几条曲线占几行由字体和宽度决定，绘图区高度随之让出来
      const legendLayout = trendLegendLayout({
        curves,
        hidden: hiddenCurveIds(widget),
        width,
        height,
        fontSize: legendFont,
        colorOf: trendCurveColor,
        measure: measureLegendText,
        valueOf: legendValueOf(widget, isHistoryWidget),
      })
      const legendH = legendLayout.height
      const plotH = Math.max(10, height - pad.t - pad.b - legendH)
      let min = Number(widget.props.min)
      let max = Number(widget.props.max)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = series.length ? Math.min(...series) : 0
        max = series.length ? Math.max(...series) : 1
      }
      if (max <= min) max = min + 1
      const isHistory = isHistoryWidget
      const isTrend = widget.type === 'trend' || isHistory
      const title = String(widget.props.title ?? (isHistory ? '历史趋势' : isTrend ? '实时趋势' : '趋势'))
      const rangeText = isHistory ? trendHistoryRangeText(widget.id, String(widget.props.range ?? '-1h')) : ''
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', isTrend ? '#0b1220' : '#0f172a'),
          stroke: str(style, 'stroke', isHistory ? '#3f2e12' : isTrend ? '#1e3a5f' : '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      // 趋势图元优先交给 ECharts（离屏 canvas → 图像：设计端 / Runtime / 3D 面板同一套渲染）；
      // 渲染失败或没有数据时继续往下走内置手绘（旧表现完全保留）。
      if (isTrend) {
        const chartHeight = Math.max(20, height - legendH)
        const canvas = buildTrendChartImage(widget)
        if (canvas) {
          g.add(
            new Konva.Image({
              name: 'trend-chart',
              image: canvas,
              x: 0,
              y: 0,
              width,
              height: chartHeight,
              listening: false,
            }),
          )
          // 右上角"导出图片"按钮（Konva 画：离屏位图里的按钮点不到）
          if (widget.type === 'trend' || widget.type === 'trendHistory') {
            g.add(trendExportNode(widget, style))
          }
          // 图例由 Konva 画：可点击切换显隐（ECharts 自带图例在离屏位图里，点不到）
          if (legendLayout.entries.length || legendLayout.overflow) {
            g.add(
              trendLegendNode(widget, legendLayout, height - legendLayout.height, style, legendFont),
            )
          }
          return g
        }
      }
      g.add(
        new Konva.Text({
          x: 10,
          y: 6,
          width: Math.max(20, width - (rangeText ? 96 : 20)),
          text: title,
          fill: str(style, 'textColor', '#94a3b8'),
          fontSize: num(style, 'fontSize', 11),
          listening: false,
        }),
      )
      if (rangeText) {
        g.add(
          new Konva.Text({
            x: width - 92,
            y: 6,
            width: 82,
            align: 'right',
            text: rangeText,
            fill: str(style, 'lineColor', '#f59e0b'),
            fontSize: num(style, 'fontSize', 11),
            listening: false,
          }),
        )
      }
      for (let i = 0; i < 4; i++) {
        const gy = pad.t + (plotH * i) / 3
        g.add(
          new Konva.Line({
            points: [pad.l, gy, pad.l + plotW, gy],
            stroke: str(style, 'gridColor', '#1e293b'),
            strokeWidth: 1,
            listening: false,
          }),
        )
      }
      if (curves.length) {
        // 图例：与上面 ECharts 路径共用同一份排版（换行 + 当前值 + 点击切换显隐）
        if (legendLayout.entries.length || legendLayout.overflow) {
          g.add(
            trendLegendNode(widget, legendLayout, height - legendLayout.height, style, legendFont),
          )
        }
        g.add(trendExportNode(widget, style))
        // 每条曲线独立量程（pad:true 上下留边），x 按各自点数铺满绘图区
        curves.forEach((curve, i) => {
          // 回退路径只画有值的点（实时缓冲里可能有 null 缺口）
          const list = (curveSamples(widget.id, curve.tagId) ?? curve.series ?? []).filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v),
          )
          if (!list.length) return
          const color = curve.color || trendCurveColor(i)
          const range = resolveTrendRange(list, { min: curve.min, max: curve.max }, { pad: true })
          const span = range.max - range.min || 1
          const pts: number[] = []
          list.forEach((v, idx) => {
            const x = pad.l + (list.length === 1 ? plotW / 2 : (plotW * idx) / (list.length - 1))
            const t = Math.min(1, Math.max(0, (v - range.min) / span))
            pts.push(x, pad.t + plotH - plotH * t)
          })
          g.add(
            new Konva.Line({
              points: pts,
              stroke: color,
              strokeWidth: 2,
              lineJoin: 'round',
              lineCap: 'round',
              tension: 0.2,
              listening: false,
            }),
          )
          if (list.length <= 60) {
            for (let k = 0; k < pts.length; k += 2) {
              g.add(
                new Konva.Circle({
                  x: pts[k] as number,
                  y: pts[k + 1] as number,
                  radius: 1.8,
                  fill: color,
                  listening: false,
                }),
              )
            }
          }
        })
        return g
      }
      if (series.length) {
        if (chartType === 'bar') {
          const bw = plotW / series.length
          series.forEach((v, i) => {
            const t = (v - min) / (max - min)
            const bh = Math.max(1, plotH * t)
            g.add(
              new Konva.Rect({
                x: pad.l + i * bw + bw * 0.15,
                y: pad.t + plotH - bh,
                width: bw * 0.7,
                height: bh,
                fill: str(style, 'barColor', '#3d8bfd'),
                listening: false,
              }),
            )
          })
        } else {
          const pts: number[] = []
          series.forEach((v, i) => {
            const x = pad.l + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1))
            const t = (v - min) / (max - min)
            const y = pad.t + plotH - plotH * t
            pts.push(x, y)
          })
          g.add(
            new Konva.Line({
              points: pts,
              stroke: str(style, 'lineColor', '#38bdf8'),
              strokeWidth: 2,
              lineJoin: 'round',
              lineCap: 'round',
              tension: 0.2,
              listening: false,
            }),
          )
          for (let i = 0; i < pts.length; i += 2) {
            g.add(
              new Konva.Circle({
                x: pts[i],
                y: pts[i + 1],
                radius: 2.5,
                fill: str(style, 'lineColor', '#38bdf8'),
                listening: false,
              }),
            )
          }
        }
      }
      return g
    }
    case 'gauge': {
      const g = new Konva.Group({ name: 'shape' })
      const minV = Number(widget.props.min ?? 0)
      const maxV = Number(widget.props.max ?? 100)
      const value = Number(widget.props.value ?? 0)
      const span = maxV - minV || 1
      const ratio = Math.min(1, Math.max(0, (value - minV) / span))
      const cx = width / 2
      const cy = height * 0.62
      const r = Math.min(width, height) * 0.38
      const start = Math.PI
      const needle = start + Math.PI * ratio
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0f172a'),
          stroke: str(style, 'stroke', '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: 8,
          opacity,
        }),
      )
      g.add(
        new Konva.Arc({
          x: cx,
          y: cy,
          innerRadius: r - 10,
          outerRadius: r,
          angle: 180,
          rotation: 180,
          fill: str(style, 'trackColor', '#1e293b'),
          listening: false,
        }),
      )
      g.add(
        new Konva.Arc({
          x: cx,
          y: cy,
          innerRadius: r - 10,
          outerRadius: r,
          angle: 180 * ratio,
          rotation: 180,
          fill: str(style, 'valueColor', '#38bdf8'),
          listening: false,
        }),
      )
      g.add(
        new Konva.Line({
          points: [cx, cy, cx + Math.cos(needle) * (r - 14), cy + Math.sin(needle) * (r - 14)],
          stroke: '#f8fafc',
          strokeWidth: 2,
          lineCap: 'round',
          listening: false,
        }),
      )
      g.add(
        new Konva.Circle({
          x: cx,
          y: cy,
          radius: 4,
          fill: '#f8fafc',
          listening: false,
        }),
      )
      const unit = String(widget.props.unit ?? '')
      g.add(
        new Konva.Text({
          y: 8,
          width,
          text: String(widget.props.label ?? ''),
          align: 'center',
          fill: str(style, 'textColor', '#e2e8f0'),
          fontSize: 12,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          y: cy + 8,
          width,
          text: unit ? `${value}${unit}` : String(value),
          align: 'center',
          fill: str(style, 'valueColor', '#38bdf8'),
          fontSize: num(style, 'fontSize', 18),
          fontStyle: 'bold',
          listening: false,
        }),
      )
      return g
    }
    case 'group': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: 'rgba(61,139,253,0.06)',
          stroke: str(style, 'stroke', '#3d8bfd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          dash: [6, 4],
          opacity,
        }),
      )
      for (const child of widget.children ?? []) {
        const childNode = createWidgetNode(child)
        childNode.draggable(false)
        childNode.listening(false)
        g.add(childNode)
      }
      return g
    }
    case 'rect':
    case 'roundRect':
    default: {
      const fillRatio = Number(widget.props.fillRatio)
      const hasFill = Number.isFinite(fillRatio) && fillRatio >= 0
      const defaultRadius = widget.type === 'roundRect' ? 20 : 4
      if (!hasFill) {
        return new Konva.Rect({
          name: 'shape',
          width,
          height,
          fill: str(style, 'fill', '#3d8bfd'),
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: num(style, 'cornerRadius', defaultRadius),
          opacity,
        })
      }
      const g = new Konva.Group({ name: 'shape' })
      const orient = String(widget.props.fillOrient ?? 'v')
      const dir = String(widget.props.fillDirection ?? 'start')
      const pct = Math.min(100, Math.max(0, fillRatio)) / 100
      const fillColor = str(style, 'fill', '#3d8bfd')
      const emptyColor = str(style, 'emptyFill', '#1e293b')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: emptyColor,
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: num(style, 'cornerRadius', defaultRadius),
          opacity,
        }),
      )
      let fx = 0
      let fy = 0
      let fw = width
      let fh = height
      if (orient === 'h') {
        fw = width * pct
        if (dir === 'end') fx = width - fw
      } else {
        fh = height * pct
        if (dir === 'start') fy = height - fh
      }
      g.add(
        new Konva.Rect({
          x: fx,
          y: fy,
          width: Math.max(0, fw),
          height: Math.max(0, fh),
          fill: fillColor,
          opacity,
          listening: false,
        }),
      )
      return g
    }
  }
}

/** 用最新 Widget 数据刷新已有节点外观与尺寸（保持选中） */
export function syncWidgetNode(group: Konva.Group, widget: Widget2D) {
  group.position({ x: widget.transform.x, y: widget.transform.y })
  group.rotation(widget.transform.rotation)
  group.scale({ x: widget.transform.scaleX, y: widget.transform.scaleY })
  group.draggable(!widget.locked)
  group.visible(widget.visible !== false)

  const shape = group.findOne('.shape') as Konva.Group | null
  // 趋势图元：结构没变就原地换图（每 tick 重建整棵节点纯属浪费，也影响点击/游标手感）
  if (
    shape &&
    (widget.type === 'trend' || widget.type === 'trendHistory') &&
    shape.getAttr('trendKey') === trendShapeKey(widget) &&
    refreshTrendShape(shape, widget)
  ) {
    return
  }
  shape?.destroy()
  group.add(buildShape(widget))
}

/** 从 Konva Group 读回 transform（Transformer 后调用） */
export function readTransformFromNode(group: Konva.Group): Widget2D['transform'] {
  const type = String(group.getAttr('widgetType') || 'rect')
  const scaleX = group.scaleX()
  const scaleY = group.scaleY()

  let width = 0
  let height = 0
  const shape = group.findOne('.shape')

  if ((type === 'circle' || type === 'lamp') && shape instanceof Konva.Ellipse) {
    width = Math.max(2, shape.radiusX() * 2 * scaleX)
    height = Math.max(2, shape.radiusY() * 2 * scaleY)
  } else if ((type === 'line') && shape instanceof Konva.Line) {
    const pts = shape.points()
    width = Math.max(4, Math.abs(pts[2] - pts[0]) * scaleX)
    height = Math.max(0, Math.abs(pts[3] - pts[1]) * scaleY)
  } else if (
    (type === 'polyline' || type === 'polygon' || type === 'pipe') &&
    shape instanceof Konva.Line
  ) {
    const pts = shape.points()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i])
      minY = Math.min(minY, pts[i + 1])
      maxX = Math.max(maxX, pts[i])
      maxY = Math.max(maxY, pts[i + 1])
    }
    width = Math.max(4, (maxX - minX) * scaleX)
    height = Math.max(4, (maxY - minY) * scaleY)
  } else if (shape instanceof Konva.Text || shape instanceof Konva.Rect) {
    width = Math.max(4, shape.width() * scaleX)
    height = Math.max(4, shape.height() * scaleY)
  } else if (shape instanceof Konva.Group) {
    const box = shape.getClientRect({ skipTransform: true })
    width = Math.max(4, box.width * scaleX)
    height = Math.max(4, box.height * scaleY)
  } else {
    width = Math.max(4, 40 * scaleX)
    height = Math.max(4, 40 * scaleY)
  }

  group.scale({ x: 1, y: 1 })

  return {
    x: group.x(),
    y: group.y(),
    width,
    height,
    rotation: group.rotation(),
    scaleX: 1,
    scaleY: 1,
  }
}
