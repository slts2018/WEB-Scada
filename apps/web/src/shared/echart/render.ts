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
import { applyEchartBound, echartSignature, type EchartBound } from './content'
import { geoReady } from './geo'
import { buildEchartOption, buildEchartThumbOption } from './options'

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

function ensureHost() {
  if (host) return host
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
  document.body.appendChild(host)
  return host
}

function flushNow() {
  const zr = chart?.getZr?.() as { refreshImmediately?: () => void; flush?: () => void } | undefined
  zr?.refreshImmediately?.()
  zr?.flush?.()
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

function snapshot(): HTMLCanvasElement | null {
  const src = host?.querySelector('canvas')
  if (!src) return null
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
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
): HTMLCanvasElement | null {
  const w = Math.max(40, Math.round(width / 8) * 8)
  const h = Math.max(40, Math.round(height / 8) * 8)
  const waiting = isMapPreset(variant) && !geoReady()
  const dataKey = !thumb && bound ? echartSignature(bound) : ''
  const key = `${thumb ? 'thumb:' : ''}${variant}@${w}x${h}|${dataKey}|ax${thumb ? 0 : axisFont}`
  const live = Boolean(bound?.lines?.some((line) => (line?.length ?? 0) > 1))
  const hit = waiting || live ? undefined : cache.get(key)
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
    chart.setOption(option, true)
    flushNow()
    const image = snapshot()
    if (image && !waiting && !live) cache.set(key, image)
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
  cache.clear()
}
