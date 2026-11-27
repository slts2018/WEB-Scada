import { init, use, type ECharts } from 'echarts/core'
import {
  BarChart,
  EffectScatterChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  LinesChart,
  MapChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
} from 'echarts/charts'
import {
  CalendarComponent,
  GeoComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { isMapPreset } from './catalog'
import { applyEchartBound, echartContentKind, echartSignature, fitEchartCalendar, type EchartBound } from './content'
import { geoReady } from './geo'
import { applySharedBarGeometry, buildEchartOption, buildEchartThumbOption } from './options'

use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  EffectScatterChart,
  RadarChart,
  GraphChart,
  SankeyChart,
  GaugeChart,
  HeatmapChart,
  MapChart,
  LinesChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  TitleComponent,
  VisualMapComponent,
  GeoComponent,
  RadarComponent,
  CalendarComponent,
  MarkPointComponent,
  MarkLineComponent,
  CanvasRenderer,
])

let chart: ECharts | null = null
let host: HTMLDivElement | null = null
let hostW = 0
let hostH = 0
const cache = new Map<string, HTMLCanvasElement>()
const CACHE_MAX = 16

function releaseCanvas(image: HTMLCanvasElement | null | undefined) {
  if (!image) return
  image.width = 0
  image.height = 0
}

function canvasInCache(image: HTMLCanvasElement): boolean {
  for (const item of cache.values()) if (item === image) return true
  return false
}

function evictCache() {
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value
    if (first == null) break
    releaseCanvas(cache.get(first))
    cache.delete(first)
  }
}

function ensureHost() {
  if (host) return host
  host = document.createElement('div')
  // 必须是 absolute。fixed 会被 ECharts tooltip 改回 relative，离屏盒子仍占文档高度，页面底部就能空拖。
  host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
  document.body.appendChild(host)
  return host
}

function flushNow() {
  const zr = chart?.getZr?.() as { refreshImmediately?: () => void; flush?: () => void } | undefined
  zr?.refreshImmediately?.()
  zr?.flush?.()
}


/**
 * 饼/环/玫瑰扇区文字、散点符号、桑基节点名按绘制尺寸放大。
 * 离屏画布是 2x，字号/符号也要乘 dpr，否则显示时只有设计稿一半大。
 * 柱状/条形按绘图区给出舒适柱宽；日历热力图按数据范围把格子铺满绘图区。
 */
function applyReadableMarks(variant: string, option: Record<string, unknown>, width: number, height: number, dpr: number) {
  const kind = echartContentKind(variant)
  if (kind === 'calendar' || kind === 'heatmap' || kind === 'category' || kind === 'multi') {
    const pxW = Math.max(1, width * Math.max(1, dpr))
    const pxH = Math.max(1, height * Math.max(1, dpr))
    if (kind === 'calendar') fitEchartCalendar(option, pxW, pxH)
    const horizontal = variant.startsWith('hbar')
    applySharedBarGeometry(option, horizontal ? pxH : pxW)
    return
  }
  if (kind !== 'pie' && kind !== 'scatter' && kind !== 'sankey') return
  const factor = Math.max(1, Math.min(width, height) / 280)
  const font = Math.round(Math.min(36, Math.max(12, 12 * factor)) * dpr)
  const series = option.series
  const items = Array.isArray(series) ? series : series ? [series] : []
  option.series = items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const rec = item as Record<string, unknown>
    const type = String(rec.type || '')
    if (kind === 'pie' || type === 'pie') {
      const label = rec.label && typeof rec.label === 'object' ? { ...(rec.label as object) } : {}
      const labelLine = rec.labelLine && typeof rec.labelLine === 'object' ? { ...(rec.labelLine as object) } : {}
      return {
        ...rec,
        label: { ...label, fontSize: font },
        labelLine: {
          ...labelLine,
          length: Math.round(Math.max(8, 10 * factor) * dpr),
          length2: Math.round(Math.max(8, 12 * factor) * dpr),
        },
      }
    }
    if (kind === 'scatter' || type === 'scatter' || type === 'effectScatter') {
      const base = Number(rec.symbolSize)
      const size = Number.isFinite(base) && base > 0 ? base : 12
      return { ...rec, symbolSize: Math.round(Math.min(48, Math.max(10, size * factor)) * dpr) }
    }
    if (kind === 'sankey' || type === 'sankey') {
      const label = rec.label && typeof rec.label === 'object' ? { ...(rec.label as object) } : {}
      // left/right 默认是逻辑像素 72，离屏画布是 2x，字号放大后右侧节点名会被裁切。
      const side = Math.max(72 * dpr, Math.ceil(font * 3.2))
      return {
        ...rec,
        label: { ...label, fontSize: font },
        left: Math.max(Number(rec.left) || 0, side),
        right: Math.max(Number(rec.right) || 0, side),
        top: Math.max(Number(rec.top) || 0, Math.round(font * 1.2)),
        bottom: Math.max(Number(rec.bottom) || 0, Math.round(font * 0.8)),
      }
    }
    return rec
  })
}

function applyAxisFont(option: Record<string, unknown>, fontSize: number) {
  const paint = (axis: unknown): unknown => {
    if (Array.isArray(axis)) return axis.map(paint)
    if (!axis || typeof axis !== 'object') return axis
    const rec = axis as Record<string, unknown>
    const label = rec.axisLabel && typeof rec.axisLabel === 'object' ? (rec.axisLabel as Record<string, unknown>) : {}
    if (label.show === false) return rec
    return { ...rec, axisLabel: { ...label, fontSize } }
  }
  if (option.xAxis) option.xAxis = paint(option.xAxis)
  if (option.yAxis) option.yAxis = paint(option.yAxis)
  const legend = option.legend
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    const rec = legend as Record<string, unknown>
    if (rec.show !== false) {
      const textStyle = rec.textStyle && typeof rec.textStyle === 'object' ? (rec.textStyle as Record<string, unknown>) : {}
      option.legend = { ...rec, textStyle: { ...textStyle, fontSize } }
      const grid = option.grid
      if (grid && typeof grid === 'object' && !Array.isArray(grid)) {
        const top = Math.max(Number((grid as { top?: number }).top) || 0, fontSize + 18)
        option.grid = { ...(grid as object), top }
      }
    }
  }
}

function snapshot(recycle: HTMLCanvasElement | null = null): HTMLCanvasElement | null {
  const src = host?.querySelector('canvas')
  if (!src) return null
  const reuse = recycle && recycle !== src && !canvasInCache(recycle) ? recycle : null
  const out = reuse ?? document.createElement('canvas')
  if (out.width !== src.width) out.width = src.width
  if (out.height !== src.height) out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return out
}



/** 按变体渲染一张 ECharts 位图。同尺寸同变体走缓存。thumb 为控件库小图，只留图形。 */
export function renderEchart(
  variant: string,
  width: number,
  height: number,
  thumb = false,
  bound: EchartBound | null = null,
  axisFont = 0,
  recycle: HTMLCanvasElement | null = null,
): HTMLCanvasElement | null {
  const w = Math.max(40, Math.round(width / 8) * 8)
  const h = Math.max(40, Math.round(height / 8) * 8)
  const waiting = isMapPreset(variant) && !geoReady()
  const dataKey = !thumb && bound ? echartSignature(bound) : ''
  const key = `${thumb ? 'thumb:' : ''}${variant}@${w}x${h}|${dataKey}|ax${thumb ? 0 : axisFont}`
  // 运行端绑定数据每拍都变，不能按签名缓存位图，否则翻页会把画布堆到内存不足。
  const cacheable = thumb && !waiting && !bound
  const hit = cacheable ? cache.get(key) : undefined
  if (hit) return hit
  try {
    const el = ensureHost()
    const scale = 2
    const pw = w * scale
    const ph = h * scale
    if (!chart) chart = init(el, undefined, { renderer: 'canvas' })
    if (hostW !== pw || hostH !== ph) {
      chart.resize({ width: pw, height: ph })
      hostW = pw
      hostH = ph
    }
    const option = thumb ? buildEchartThumbOption(variant) : buildEchartOption(variant)
    if (!thumb && bound) applyEchartBound(variant, option, bound)
    if (!thumb && axisFont > 0) applyAxisFont(option, axisFont * scale)
    if (!thumb) applyReadableMarks(variant, option, w, h, scale)
    // 离屏快照必须关掉动画，否则第一帧系列还没画出来（折线/柱/饼/散点/桑基会整图空白）。
    option.animation = false
    option.animationDuration = 0
    option.animationDurationUpdate = 0
    chart.setOption(option, true)
    flushNow()
    const image = snapshot(cacheable ? null : recycle)
    if (image && cacheable) {
      cache.set(key, image)
      evictCache()
    }
    return image
  } catch (err) {
    console.warn('[echart] 渲染失败', variant, err)
    return null
  }
}

/** 控件库卡片上的样式预览。 */
export function renderEchartThumb(variant: string): HTMLCanvasElement | null {
  return renderEchart(variant, 136, 80, true)
}

export function clearEchartCache() {
  for (const image of cache.values()) releaseCanvas(image)
  cache.clear()
}
