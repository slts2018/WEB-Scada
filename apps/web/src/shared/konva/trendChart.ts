/**
 * 趋势图元的 ECharts 规格与离屏位图渲染。
 *
 * 实时趋势 / 历史趋势的正路是原生控件（`trendChartLive` 叠在图元矩形上）。
 * 这里的离屏位图只留给转角图元、带点击事件的图元：那两种 DOM 叠层会挡操作。
 */
import { init, use, type ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { formatTrendValue } from '@web-scada/core'

use([
  LineChart,
  AxisPointerComponent,
  // 底部时间滑块 + 右上角导出按钮都是 graphic 画的
  GraphicComponent,
  GridComponent,
  LegendComponent,
  // 报警限值线（markLine）与报警区间（markArea）
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

export interface TrendChartSeries {
  name: string
  color: string
  /** 采样值；null = 该时刻没数据（ECharts 会断开线） */
  points: Array<number | null>
  /** 有则用时间轴（历史趋势），没有则按采样序号（实时趋势） */
  times?: number[]
  /** 开关量 / 枚举量：用阶梯画（否则会被误看成斜线变化） */
  step?: boolean
  /** 该时刻的质量（历史趋势）；Bad/Offline 区间在图上标红 */
  qualities?: Array<string | null>
  /** 显示单位（图例 / 悬停读数 / 游标读数 / 点表）；留空 = 不显示 */
  unit?: string
  /** 显示小数位；留空 = 按量级自适应 */
  decimals?: number
}

export interface TrendChartSpec {
  width: number
  height: number
  title?: string
  rangeLabel?: string
  /** 顶部要给 HTML 工具栏留出的高度（图表 CSS 像素；0/缺省 = 不留） */
  chromeTop?: number
  /** 底部要给 HTML 点表留出的高度（图表 CSS 像素） */
  chromeBottom?: number
  /** 底部数据区域缩放滑块（仅历史趋势 + 原生叠层） */
  slider?: boolean
  /**
   * 临时把图内图例 / 底部滑块让给点表（点表开着时用）：
   * 表头就是"变量 + 颜色"的图例、表里就是精确读数，没必要再占两条版面，
   * 让出来的高度正好给曲线和表。
   */
  hideLegend?: boolean
  hideSlider?: boolean
  /** 工具箱里的“框选放大” */
  selectZoom?: boolean
  /** 游标时间（epoch ms）；画一条竖线 + 时间标签 */
  cursor?: number
  /** 报警限值线（按量程直接画水平虚线） */
  limits?: Array<{ value: number; label: string }>
  /** 报警区间（触发~恢复）：淡红底色 */
  alarmBands?: Array<{ from: number; to: number }>
  /** 坏质量（Bad/Offline/Uncertain）区间的标记色；默认红 */
  badQualityColor?: string
  /** 单曲线的固定量程；多曲线传 undefined = 每条曲线按自身数据自动缩放 */
  min?: number
  max?: number
  series: TrendChartSeries[]
  theme: {
    /** 画布底色（透明则跟随图元背景） */
    background: string
    textColor: string
    gridColor: string
    fontSize: number
  }
  /**
   * 堆叠折线（ECharts "Stacked Line Chart"）：各曲线累加画在一起，Y 轴按累加值缩放。
   * 只适合"分量求和"（能耗构成 / 班次产量 / 计数），工程值（液位/压力/温度）不要开。
   */
  stacked?: boolean
  /** 时间轴的显式窗口（ms）；给定时时间轴按它对齐，避免各曲线窗口不同导致挤在一边 */
  timeMin?: number
  timeMax?: number
  /** 超采样倍数（默认 2：设计端放大时不糊） */
  scale?: number
  /**
   * 原生模式：图表挂成**活控件**（HTML 叠层）而不是离屏位图 ——
   * 用 ECharts 自带的图例 / dataZoom 滑块 / toolbox 保存图片（鼠标直接能操作），
   * 也不再需要我们自己画滑块与导出按钮。
   */
  native?: boolean
  /**
   * 原生图例里置灰的曲线名（仍留在 series 里，才能再点回来）。
   * 位图路径不画这些线，图例由 Konva 另画。
   */
  legendOff?: string[]
  /**
   * 时间窗缩放（相对"整段数据窗口"的 0~1 区间）。
   * 底部时间滑块按它画把手，x 轴窗口也按它裁 —— 拖动由交互层算好写回这里。
   */
  zoom?: { start: number; end: number }

}

/**
 * 图表内部排版（CSS 像素）—— 图表绘制与指针交互共用一份，避免两边各算一套导致对不上。
 */
export interface TrendChartLayout {
  fontSize: number
  titleFont: number
  tickFont: number
  grid: { left: number; right: number; top: number; bottom: number; width: number; height: number }
  /** 底部滑块占的高度（0 = 没有） */
  sliderHeight: number
  /** 图例要不要用"单行可滚动"（曲线多、图例本来要占好几行时） */
  legendScroll: boolean
}


/** 按字号和可用宽度估 ECharts 图例会占几行（它自己会换行，得先留出空间） */
function estimateLegendRows(spec: TrendChartSpec, font: number, usableWidth: number): number {
  const widths = spec.series.map((item) => item.name.length * font * 0.62 + font * 3.2)
  if (!widths.length) return 0
  let rows = 1
  let x = 0
  for (const w of widths) {
    if (x > 0 && x + w > usableWidth) {
      rows += 1
      x = 0
    }
    x += w
  }
  return rows
}

export function trendChartLayout(spec: TrendChartSpec): TrendChartLayout {
  // 注意：图表实例的 CSS 尺寸是 图元尺寸 × scale（超采样，默认 2 倍）。
  // 所以这里所有数字都算在**图表 CSS 空间**里，否则字号/留白在图表里会"看着减半"。
  const S = spec.scale && spec.scale > 0 ? spec.scale : 2
  const width = Math.max(20, spec.width) * S
  const height = Math.max(20, spec.height) * S
  const F = Math.max(10, Math.round(spec.theme.fontSize)) * S
  // 图内文字跟 Konva 图例一个量级（图例用的是 0.7×字号），标题略大一点
  const tickFont = Math.max(9 * S, Math.round(F * 0.7))
  const titleFont = Math.max(tickFont, Math.round(F * 0.8))
  const hasHeader = Boolean(spec.title || spec.rangeLabel)
  const titleTop = hasHeader ? titleFont + 6 * S : 6 * S
  // 再让出半个刻度字高：y 轴第一个刻度是"顶格居中"的，不然会压到标题上
  // 原生模式还要给 ECharts 自带图例留出**实际行数**（它会自动换行）
  const legendRowHeight = Math.round(tickFont * 1.5)
  // 图例行数：多到两行以上就改用"可滚动图例"（单行 + 左右箭头）——
  // 否则 8 条曲线的大字号图例会占掉图元小半高，绘图区被压成一条缝（曲线看着就"没了"）。
  const legendRowsWanted = spec.native && !spec.hideLegend ? estimateLegendRows(spec, tickFont, width - 16 * S) : 0
  const legendScroll = legendRowsWanted > 2
  const legendRows = legendScroll ? 1 : legendRowsWanted
  // 顶部还要给 HTML 工具栏（区间/跟随/导出）让位
  const chromeTop = Math.max(0, Math.round(Number(spec.chromeTop) || 0))
  const top = titleTop + Math.round(tickFont * 0.65) + legendRows * legendRowHeight + chromeTop
  const left = Math.max(30 * S, Math.round(F * 2.4))
  // 右侧留出半个时间标签的宽度，否则最后一个刻度会被裁掉
  const right = Math.max(12 * S, Math.round(F * 2))
  // 横轴刻度要够放：不然最左边的 y 轴刻度会和时间标签叠在一起
  const axisH = Math.max(18 * S, Math.round(F * 1.7))
  // 底部默认只留横轴刻度（绘图区高度全给曲线）；
  // 历史趋势另外给底部滑块留一条（spec.slider），否则滑块会压掉时间轴
  const sliderHeight = spec.slider && !spec.hideSlider ? Math.max(22 * S, Math.round(F * 1.6)) : 0
  const chromeBottom = Math.max(0, Math.round(Number(spec.chromeBottom) || 0))
  const bottom = axisH + sliderHeight + chromeBottom

  return {
    fontSize: F,
    titleFont,
    tickFont,
    sliderHeight,
    legendScroll,
    grid: {
      left,
      right,
      top,
      bottom,
      width: Math.max(10 * S, width - left - right),
      height: Math.max(10 * S, height - top - bottom),
    },
  }
}
/** 悬停/拖动要用到的排版：跟着画布一起带出去（拿到同一份数字） */
export function trendChartLayoutOf(canvas: HTMLCanvasElement): TrendChartLayout | undefined {
  return (canvas as TrendChartCanvas).__layout
}

/** 把 zoom 作用到时间窗上（0~1 → 实际时间区间） */
export function applyTrendZoom(
  min: number | undefined,
  max: number | undefined,
  zoom: { start: number; end: number } | undefined,
): { min: number | undefined; max: number | undefined } {
  if (min == null || max == null || !zoom || max <= min) return { min, max }
  const span = max - min
  const lo = min + span * zoom.start
  return { min: lo, max: lo + span * (zoom.end - zoom.start) }
}

/**
 * 悬停读数位置（chart 像素坐标）。
 * 留着它：后续每次数据刷新重绘都会带上 tooltip，否则每秒一次的数据刷新会把提示擦掉。
 */
const hoverByChart = new Map<string, { x: number; y: number }>()

/** 时间窗缩放（相对"整段数据窗口"的 0~1 区间）；双击还原 */
const zoomByChart = new Map<string, { start: number; end: number }>()

export function setTrendHover(widgetId: string, pos: { x: number; y: number } | null): void {
  if (pos) hoverByChart.set(widgetId, pos)
  else hoverByChart.delete(widgetId)
}

/** 当前悬停读数位置（按图元 id） */
export function trendHoverOf(widgetId: string): { x: number; y: number } | undefined {
  return hoverByChart.get(widgetId)
}

export function trendZoomOf(key: string): { start: number; end: number } | undefined {
  return zoomByChart.get(key)
}

export function setTrendZoom(key: string, zoom: { start: number; end: number } | null): void {
  if (zoom) zoomByChart.set(key, clampTrendZoom(zoom.start, zoom.end))
  else zoomByChart.delete(key)
}

/** 夹取缩放窗口：跨度不小于 minSpan，且整体保持在 0~1 内 */
export function clampTrendZoom(
  start: number,
  end: number,
  minSpan = 0.04,
): { start: number; end: number } {
  let s = Math.min(1, Math.max(0, Number.isFinite(start) ? start : 0))
  let e = Math.min(1, Math.max(0, Number.isFinite(end) ? end : 1))
  if (e < s) {
    const swap = s
    s = e
    e = swap
  }
  if (e - s < minSpan) {
    const mid = (s + e) / 2
    s = Math.max(0, Math.min(1 - minSpan, mid - minSpan / 2))
    e = s + minSpan
  }
  return { start: s, end: e }
}

let host: HTMLDivElement | null = null
let chart: ECharts | null = null
let hostWidth = 0
let hostHeight = 0

function ensureHost(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  if (!host) {
    host = document.createElement('div')
    // 不能用 display:none（ECharts 量不到尺寸），挪到屏幕外即可
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none;'
    document.body.appendChild(host)
  }
  return host
}

/**
 * 时间轴刻度格式（同一条轴上格式必须统一：ECharts 默认整分时收成 HH:mm，
 * 会跟旁边的 HH:mm:ss 对不齐）。
 *
 * - 窗口在同一天内：`时:分:秒`（短跨度看秒才有意义）
 * - 窗口跨天 / 跨度 ≥24h：`月-日 时:分` —— 只写 `16:50` 分不清是哪一天的 16:50；
 *   跨天但跨度不到 1 小时（跨零点的短窗口）仍带秒，免得刻度全挤成一个值。
 */
function formatAxisClock(value: number, withDate = false, withSeconds = true): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = withSeconds
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withDate ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time
}

/**
 * 坏质量段（Bad / Offline / Uncertain）的红色覆盖序列。
 *
 * 为什么用"再画一条线"而不是改主线的颜色：ECharts 一条 line 序列只有一个 lineStyle，
 * 想让"某几段变红"就得把这段单独画出来。这里保留坏段两端各一个点，
 * 让红线与曲线颜色线在缺口两侧接得上，不会看着断成两截。
 */
const QUALITY_SERIES_PREFIX = '__quality__'

function isBadQuality(q: string | null | undefined): boolean {
  const text = String(q ?? '').toLowerCase()
  return text === 'bad' || text === 'offline' || text === 'uncertain' || text === 'stale'
}

export function qualityOverlayPoints(s: TrendChartSeries): Array<number | null> {
  const q = s.qualities
  if (!q || !q.length) return []
  const n = s.points.length
  const out: Array<number | null> = new Array(n).fill(null)
  let touched = false
  for (let i = 0; i < n; i++) {
    if (!isBadQuality(q[i])) {
      touched = false
      continue
    }
    out[i] = s.points[i] ?? null
    // 缺口两侧各补一个点，让红线接进曲线色
    if (!touched && i > 0 && out[i - 1] == null) out[i - 1] = s.points[i - 1] ?? null
    touched = true
    if (i + 1 < n && !isBadQuality(q[i + 1])) out[i + 1] = s.points[i + 1] ?? null
  }
  return out.some((v) => v != null) ? out : []
}

/** 分类轴的类目：按最长曲线取 0..n-1（堆叠/多曲线时要显式给，保证各曲线按序号对齐） */
function categoryAxisData(spec: TrendChartSpec): string[] {
  const maxLen = spec.series.reduce((acc, item) => Math.max(acc, item.points.length), 0)
  return Array.from({ length: Math.max(2, maxLen) }, (_, i) => String(i))
}

export function buildTrendChartOption(spec: TrendChartSpec): Record<string, unknown> {
  const { theme } = spec
  const useTime = spec.series.some((s) => Array.isArray(s.times) && s.times.length > 0)
  const axisColor = theme.textColor
  const splitLine = { lineStyle: { color: theme.gridColor } }
  // 排版统一由 trendChartLayout 算：图表绘制与指针交互共用一份，避免两边各算一套对不上
  const layout = trendChartLayout(spec)
  const F = layout.fontSize
  const tickFont = layout.tickFont
  // 时间窗 = 整段窗口 + 当前缩放区间
  const window = applyTrendZoom(spec.timeMin, spec.timeMax, spec.zoom)
  // 轴刻度要不要带日期：跨天（或跨度 ≥24h）就带 —— 只写"16:50"分不清是哪一天的 16:50
  const axisSpan = window.min != null && window.max != null ? window.max - window.min : 0
  const axisCrossesDay =
    window.min != null &&
    window.max != null &&
    new Date(window.min).toDateString() !== new Date(window.max).toDateString()
  const axisWithDate = axisCrossesDay || axisSpan >= 24 * 3600_000
  const axisWithSeconds = !axisWithDate || axisSpan < 3600_000
  // 游标时间 → 图内像素 x（时间轴是线性映射；超出可见窗口不画）
  const cursorAt = typeof spec.cursor === 'number' && Number.isFinite(spec.cursor) ? spec.cursor : null
  const cursorX = (() => {
    if (cursorAt == null) return null
    const lo = window.min
    const hi = window.max
    if (lo == null || hi == null || hi <= lo) return null
    const frac = (cursorAt - lo) / (hi - lo)
    if (frac < 0 || frac > 1) return null
    return layout.grid.left + frac * layout.grid.width
  })()
  // 游标时间标签：轴带日期时（跨天窗口）也带日期，免得看不出是哪一天
  const cursorLabel = (() => {
    if (cursorAt == null) return ''
    const d = new Date(cursorAt)
    const p2 = (n: number) => String(n).padStart(2, '0')
    const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
    return axisWithDate ? `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${clock}` : clock
  })()

  const titles: Record<string, unknown>[] = []
  if (spec.title) {
    titles.push({
      text: spec.title,
      left: 8,
      top: 4,
      textStyle: { color: axisColor, fontSize: layout.titleFont, fontWeight: 'normal' },
    })
  }
  if (spec.rangeLabel) {
    titles.push({
      text: spec.rangeLabel,
      // 右上角有"导出图片"按钮时给它让位
      right: 8,
      top: 4,
      textStyle: { color: theme.textColor, fontSize: layout.titleFont, fontWeight: 'normal' },
    })
  }

  return {
    animation: false,
    backgroundColor: 'transparent',
    title: titles.length ? titles : undefined,
    // 图片模式：图例由 Konva 另画（离屏位图里的图例点不到）
    // 原生模式：用 ECharts 自带图例（能点、能框选），放在标题下面一行
    legend: spec.native
      ? {
          show: !spec.hideLegend,
          top: layout.titleFont + Math.round(tickFont * 0.25),
          left: 8,
          right: 8,
          // 一屏放不下时用可滚动图例（单行 + 左右箭头），排版也按一行算
          type: spec.native && layout.legendScroll ? 'scroll' : 'plain',
          itemGap: Math.round(tickFont * 0.9),
          itemWidth: Math.round(tickFont * 1.1),
          itemHeight: Math.round(tickFont * 0.5),
          textStyle: { color: axisColor, fontSize: tickFont },
          inactiveColor: 'rgba(148,163,184,0.35)',
          // 只列真实曲线：坏质量段的红色覆盖序列不进图例
          data: spec.series.map((item) => item.name),
          // 每次 setOption 都写上，避免下一帧把点掉的曲线弹回来
          selected: Object.fromEntries(
            spec.series.map((item) => [item.name, !(spec.legendOff ?? []).includes(item.name)]),
          ),
        }
      : { show: false },
    // 悬停读数：renderMode 必须是 richText —— HTML 提示框挂在隐藏容器里，离屏位图看不到
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: 'rgba(15,17,21,0.92)',
      borderColor: theme.gridColor,
      borderWidth: 1,
      padding: Math.round(tickFont * 0.45),
      // 自己排版：默认 formatter 的"变量名列宽"是按它自己的字号量的，
      // 和我们的字号对不上时会出现"名字和数值叠在一起"。
      formatter: (params: unknown) => {
        const list = Array.isArray(params)
          ? (params as Array<Record<string, unknown>>)
          : [params as Record<string, unknown>]
        if (!list.length) return ''
        const head = String(list[0]?.axisValueLabel ?? list[0]?.name ?? '')
        const rows = list
          // 坏质量覆盖序列只是"标红"，不进读数
          .filter((item) => !String(item.seriesName ?? '').startsWith(QUALITY_SERIES_PREFIX))
          .map((item) => {
            const raw = item.value
            const num = Array.isArray(raw) ? raw[raw.length - 1] : raw
            // 取值/单位/小数位按该曲线自己的显示格式（与图例、游标读数、点表一致）
            const si = Number(item.seriesIndex)
            const meta = Number.isInteger(si) ? spec.series[si] : undefined
            const text = formatTrendValue(
              typeof num === 'number' && Number.isFinite(num) ? num : null,
              { unit: meta?.unit, decimals: meta?.decimals },
            )
            // 变量名补空格对齐（rich 的 width 不总是被尊重，补空格最稳）
            const name = String(item.seriesName ?? '')
            const padded = name.length < 14 ? name.padEnd(14) : name
            return `${(item.marker as string) ?? ''}{name|${padded}}{value|${text}}`
          })
        if (!rows.length) return `{head|${head}}`
        return `{head|${head}}\n${rows.join('\n')}`
      },
      textStyle: {
        color: theme.textColor,
        fontSize: tickFont,
        lineHeight: Math.round(tickFont * 1.35),
        rich: {
          head: {
            color: theme.textColor,
            fontSize: tickFont,
            padding: [0, 0, Math.round(tickFont * 0.3), 0],
          },
          name: {
            color: theme.textColor,
            fontSize: tickFont,
            // 变量名列固定宽度：多行之间对齐（够放下十几字符的变量名）
            width: Math.round(tickFont * 7.4),
          },
          value: {
            color: '#e2e8f0',
            fontSize: tickFont,
            fontWeight: 'bold',
            align: 'right',
            width: Math.round(tickFont * 3.6),
          },
        },
      },
      axisPointer: {
        type: 'line',
        lineStyle: { color: theme.textColor, width: 1, type: 'dashed' },
      },
    },

    // 原生模式：dataZoom（滚轮 + 底部滑块）与 toolbox（保存图片）都是 ECharts 自带，鼠标直接可用
    dataZoom: spec.native
      ? [
          // 绘图区内：滚轮缩放 + 拖拽平移（实时趋势从头到尾只有这一条）
          { type: 'inside', xAxisIndex: 0, filterMode: 'none', minValueSpan: 3000 },
          // 历史趋势再加底部滑块：拖两端缩放、拖中间平移（现场查数据最常用）
          ...(spec.slider
            ? [
                {
                  type: 'slider',
                  xAxisIndex: 0,
                  filterMode: 'none',
                  show: !spec.hideSlider,
                  bottom: 2,
                  height: Math.max(12, Math.round(layout.sliderHeight - 8)),
                  borderColor: axisColor,
                  textStyle: { color: axisColor, fontSize: tickFont },
                  fillerColor: 'rgba(61,139,253,0.16)',
                  handleStyle: { color: axisColor },
                  moveHandleSize: 4,
                  brushSelect: false,
                },
              ]
            : []),
        ]
      : undefined,
    toolbox: spec.native
      ? {
          right: 6,
          top: 2,
          itemSize: Math.round(tickFont * 0.95),
          iconStyle: { borderColor: axisColor, borderWidth: 1.4 },
          emphasis: { iconStyle: { borderColor: '#e2e8f0' } },
          feature: {
            // 白底：截图直接贴报告/打印，不会在白纸上变成一块黑
            saveAsImage: { title: '导出图片', name: '', pixelRatio: 2, backgroundColor: theme.background },
            // 历史趋势：框选放大（选中一段直接缩放）
            ...(spec.selectZoom
              ? {
                  dataZoom: {
                    yAxisIndex: 'none',
                    title: { zoom: '框选放大', back: '取消框选' },
                  },
                }
              : {}),
          },
        }
      : undefined,
    // 游标：竖线落在当前可见窗口的对应位置（窗口 = 数据范围 + 显示缩放）
    graphic: cursorX == null ? undefined : [
      {
        type: 'line',
        silent: true,
        z: 100,
        shape: {
          x1: cursorX,
          y1: layout.grid.top,
          x2: cursorX,
          y2: layout.grid.top + layout.grid.height,
        },
        style: { stroke: '#f8fafc', lineWidth: 1, lineDash: [4, 3], opacity: 0.7 },
      },
      {
        type: 'text',
        silent: true,
        z: 101,
        left: Math.min(cursorX + 4, layout.grid.left + layout.grid.width - tickFont * 5),
        top: layout.grid.top,
        style: { text: cursorLabel, fill: '#e2e8f0', fontSize: tickFont, fontFamily: 'ui-monospace, monospace' },
      },
    ],
    grid: {
      left: layout.grid.left,
      right: layout.grid.right,
      top: layout.grid.top,
      bottom: layout.grid.bottom,
      containLabel: false,
    },
    // 不做 tooltip：离屏渲染拿不到指针事件（要用 ECharts 原生提示需转发 Konva 指针坐标）
    xAxis: useTime
      ? {
          type: 'time',
          min: window.min,
          max: window.max,
          // 时间轴刻度别太密（窄图元下标签会挤在一起）
          splitNumber: 4,
          axisLine: { lineStyle: { color: theme.gridColor } },
          axisTick: { show: false },
          axisLabel: {
            color: axisColor,
            fontSize: tickFont,
            hideOverlap: true,
            margin: Math.round(tickFont * 0.4),
            formatter: (value: number) => formatAxisClock(value, axisWithDate, axisWithSeconds),
          },
          splitLine: { show: false },
        }
      : {
          type: 'category',
          boundaryGap: false,
          data: categoryAxisData(spec),
          axisLine: { lineStyle: { color: theme.gridColor } },
          axisTick: { show: false },
          axisLabel: { color: axisColor, fontSize: tickFont, hideOverlap: true, margin: Math.round(tickFont * 0.4) },
          splitLine: { show: false },
        },
    yAxis: {
      type: 'value',
      // 堆叠后单条曲线的量程没有意义，交给 ECharts 按累加值自动缩放
      min: spec.stacked ? undefined : spec.min,
      max: spec.stacked ? undefined : spec.max,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisColor, fontSize: tickFont, margin: 4 },
      splitLine,
    },
    series: [
      ...spec.series.map((s, si) => ({
      type: 'line',
      // 限值线只挂在第一条曲线上（同一个纵轴，挂多少条就画多少遍）
      ...(si === 0 && spec.limits?.length
        ? {
            markLine: {
              silent: true,
              symbol: 'none',
              animation: false,
              lineStyle: { type: 'dashed', width: 1, color: '#f87171', opacity: 0.85 },
              label: {
                color: '#fca5a5',
                fontSize: tickFont,
                formatter: (p: { name?: string; value?: number }) => `${p.name ?? ''} ${p.value ?? ''}`,
              },
              data: spec.limits.map((item) => ({ yAxis: item.value, name: item.label })),
            },
            ...(spec.alarmBands?.length
              ? {
                  markArea: {
                    silent: true,
                    animation: false,
                    itemStyle: { color: 'rgba(248,113,113,0.10)' },
                    data: spec.alarmBands.map((band) => [{ xAxis: band.from }, { xAxis: band.to }]),
                  },
                }
              : {}),
          }
        : {}),
      name: s.name,
      showSymbol: false,
      // 开关量用阶梯：不做平滑，不然 0/1 会被描成斜线
      ...(s.step ? { step: 'end' as const } : { smooth: 0.15 }),
      // 堆叠折线：同组 stack 名 → ECharts 逐条累加（官方 Stacked Line 示例的做法）
      // 注意：不要再加 sampling——LTTB 降采样与 stack / 时间轴组合时会出现"空图"且不报错
      ...(spec.stacked ? { stack: 'total' } : {}),
      lineStyle: { width: Math.max(2, Math.round(F / 7)), color: s.color },
      itemStyle: { color: s.color },
      data:
        useTime && s.times
          ? s.points.map((v, i) => [s.times?.[i] ?? i, v])
          : s.points,
      })),
      // 坏质量段标红：叠一条只画坏段的线，压在曲线色之上（不进图例、不进读数）
      ...(spec.stacked
        ? []
        : spec.series
            .map((s, si) => {
              const overlay = qualityOverlayPoints(s)
              if (!overlay.length) return null
              return {
                type: 'line' as const,
                name: `${QUALITY_SERIES_PREFIX}${si}`,
                silent: true,
                animation: false,
                legendHoverLink: false,
                showSymbol: false,
                tooltip: { show: false },
                ...(s.step ? { step: 'end' as const } : {}),
                z: 4,
                lineStyle: {
                  width: Math.max(3, Math.round(F / 5)),
                  color: spec.badQualityColor ?? '#ef4444',
                  opacity: 0.9,
                },
                itemStyle: { color: spec.badQualityColor ?? '#ef4444' },
                data:
                  useTime && s.times
                    ? overlay.map((v, i) => [s.times?.[i] ?? i, v])
                    : overlay,
              }
            })
            .filter((item): item is NonNullable<typeof item> => item != null)),
    ],
  }
}

/**
 * 立刻把 zrender 待画的帧刷到画布上。
 * 不刷的话 `dispatchAction('showTip')` 只是排了一帧，下面拷到的还是没有游标的旧画面。
 */
function flushNow(): void {
  try {
    const zr = chart?.getZr?.() as { refreshImmediately?: () => void; flush?: () => void } | undefined
    if (!zr) return
    zr.refreshImmediately?.()
    zr.flush?.()
  } catch (err) {
    console.warn('[trendChart] 立即刷新画布失败', err)
  }
}

/** 渲染一次（失败返回 null，调用方回退内置手绘）；hover 给定则在 canvas 里画上悬停读数 */
function renderOnce(
  spec: TrendChartSpec,
  hover?: { x: number; y: number } | null,
): HTMLCanvasElement | null {
  const el = ensureHost()
  if (!el) return null
  const scale = spec.scale && spec.scale > 0 ? spec.scale : 2
  const w = Math.max(20, Math.round(spec.width * scale))
  const h = Math.max(20, Math.round(spec.height * scale))
  if (!chart) chart = init(el, undefined, { renderer: 'canvas' })
  if (hostWidth !== w || hostHeight !== h) {
    chart.resize({ width: w, height: h })
    hostWidth = w
    hostHeight = h
  }
  chart.setOption(buildTrendChartOption(spec), true)
  // 悬停读数/坐标轴指示线（richText 会画进 canvas）
  // 注意：dispatchAction 触发的绘制排在下一帧（zrender 用 rAF 冲刷），
  // 这里必须同步刷一次再拷画布，否则拷到的是"上一帧"——
  // 悬停游标/读数永远不出现（运行端点了鼠标也看不到读数就是这个问题）。
  if (hover) {
    chart.dispatchAction({ type: 'showTip', x: hover.x, y: hover.y })
    flushNow()
  } else {
    chart.dispatchAction({ type: 'hideTip' })
    flushNow()
  }
  const src = el.querySelector('canvas')
  if (!src) return null
  // 拷贝一份：隐藏容器里的 canvas 会被下一次渲染覆盖
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(src, 0, 0)
  // 记下 ECharts 实例的 CSS 尺寸：画布像素是它的 devicePixelRatio 倍，
  // 悬停读数必须用 CSS 像素坐标（用画布像素会落到绘图区外 → 游标不出来）。
  ;(out as TrendChartCanvas).__chartCssWidth = w
  ;(out as TrendChartCanvas).__chartCssHeight = h
  ;(out as TrendChartCanvas).__layout = trendChartLayout(spec)
  return out
}

/** 图表画布 + ECharts CSS 尺寸（渲染时记在画布上，供悬停游标换算坐标） */
export interface TrendChartCanvas extends HTMLCanvasElement {
  __chartCssWidth?: number
  __chartCssHeight?: number
  __layout?: TrendChartLayout
}

/** 画布对应的 ECharts CSS 尺寸（拿不到就退回画布像素） */
export function trendChartCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rec = canvas as TrendChartCanvas
  return {
    width: rec.__chartCssWidth ?? canvas.width,
    height: rec.__chartCssHeight ?? canvas.height,
  }
}

const cache = new Map<string, HTMLCanvasElement>()

/**
 * 带缓存渲染：key 相同（图元 + 尺寸 + 数据形状/末值 + 配色）就不重画。
 * 渲染函数会被每次 Tag 通知、每次拖拽/缩放调用，缓存是必需的。
 */
export function renderTrendChart(
  key: string,
  spec: TrendChartSpec,
  hover?: { x: number; y: number } | null,
): HTMLCanvasElement | null {
  // 有悬停读数时不走缓存（每帧都要带 tooltip），也不把带 tooltip 的帧写进缓存
  if (!hover) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  let out: HTMLCanvasElement | null = null
  try {
    out = renderOnce(spec, hover ?? null)
  } catch (err) {
    console.warn('[trendChart] ECharts 渲染失败，回退内置绘制', err)
    out = null
  }
  if (out) {
    if (!hover) {
      // 简单上限，避免图元很多时缓存无限增长
      if (cache.size > 60) cache.clear()
      cache.set(key, out)
    }
    return out
  }
  cache.delete(key)
  return null
}