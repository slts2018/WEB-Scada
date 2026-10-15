/**
 * 趋势图例排版（纯函数，不依赖 Konva / DOM）。
 *
 * 为什么单独拆一块：图例以前是"一行放不下就直接 return"——
 * 画了 4 条曲线却只显示 3 个名字，用户看到一条没有名字的线，
 * 会以为"这条不是我绑的变量"。这里保证：
 *  ① 每条曲线都有图例项（自动换行，最多几行按图元高度算）；
 *  ② 每条后面带**当前值**（没有采样显示 "—"），哪条线 = 哪个变量 = 现在多少，一眼对上；
 *  ③ 实在放不下也只是把末尾几条折叠成 "+N"，不再静默丢弃。
 *
 * 文本宽度由调用方注入（真实渲染走 Konva 的度量，单测里给个假函数即可）。
 */
import { formatTrendValue, type TrendValueFormat } from '@web-scada/core'

export interface TrendLegendCurve {
  tagId: string
  /** 图例名；空则用 tagId */
  label?: string
  color?: string
  /** 显示单位（留空 = 不显示） */
  unit?: string
  /** 显示小数位（留空 = 按量级自适应） */
  decimals?: number
}

export interface TrendLegendEntry {
  curve: TrendLegendCurve
  index: number
  row: number
  x: number
  color: string
  hidden: boolean
  label: string
  labelW: number
  value: string
  valueW: number
}

export interface TrendLegendLayout {
  entries: TrendLegendEntry[]
  rowHeight: number
  /** 图例整体高度（0 = 没有图例） */
  height: number
  /** 放不下的条数（右端补 "+N"） */
  overflow: { text: string; row: number; x: number } | null
}

/** 图例里的当前值：按曲线配置的小数位/单位显示；没有采样显示 "—" */
export function formatLegendValue(v: number | null | undefined, format?: TrendValueFormat): string {
  return formatTrendValue(v, format)
}

/** 图例最多几行：别把绘图区挤没（最多 4 行，且不超过图元高度的 42%） */
export function maxTrendLegendRows(height: number, rowHeight: number, cap = 4): number {
  return Math.max(1, Math.min(cap, Math.floor((height * 0.42) / Math.max(1, rowHeight))))
}

export function trendLegendLayout(opts: {
  curves: TrendLegendCurve[]
  hidden: Set<string>
  width: number
  height: number
  fontSize: number
  /** 曲线颜色（默认按序号取色板，由调用方注入） */
  colorOf: (index: number) => string
  /** 量文字宽度 */
  measure: (text: string, fontSize: number) => number
  /** 曲线当前值（图例里显示） */
  valueOf?: (curve: TrendLegendCurve, index: number) => number | null | undefined
  /** 覆盖最多行数（默认按高度算） */
  maxRows?: number
}): TrendLegendLayout {
  const { curves, hidden, width, height, fontSize } = opts
  const rowHeight = fontSize + 6
  const limitRows = Math.max(
    1,
    Math.ceil(opts.maxRows ?? maxTrendLegendRows(height, rowHeight)),
  )
  // 值那一列定宽：数字位数变化不会让图例重新换行（否则每秒重排一次，看着抖）
  // 有单位时再宽一点，否则 "58.0 %" 会被裁掉
  const hasUnit = curves.some((curve) => Boolean(curve.unit && curve.unit.trim()))
  const valueW = Math.round(fontSize * (hasUnit ? 5.4 : 3.1))
  const gutter = Math.round(fontSize * 0.8)
  const usable = Math.max(fontSize * 6, width - 16)
  const entries: TrendLegendEntry[] = []
  let row = 0
  let x = 0
  let overflow: TrendLegendLayout['overflow'] = null

  curves.forEach((curve, index) => {
    const label = curve.label || curve.tagId
    const labelW = opts.measure(label, fontSize)
    const entryW = fontSize + 5 + labelW + 4 + valueW
    if (x > 0 && x + entryW > usable) {
      row += 1
      x = 0
    }
    if (row >= limitRows) {
      const prev = entries[entries.length - 1]
      if (!prev) return
      const nextX = prev.x + fontSize + 5 + prev.labelW + 4 + prev.valueW + gutter
      overflow = {
        text: `+${curves.length - entries.length}`,
        row: prev.row,
        x: Math.max(8, Math.min(usable - fontSize * 2, nextX)),
      }
      return
    }
    entries.push({
      curve,
      index,
      row,
      x: 8 + x,
      color: curve.color || opts.colorOf(index),
      hidden: hidden.has(curve.tagId),
      label,
      labelW,
      value: formatLegendValue(
        typeof opts.valueOf === 'function' ? opts.valueOf(curve, index) : undefined,
        { unit: curve.unit, decimals: curve.decimals },
      ),
      valueW,
    })
    x += entryW + gutter
  })

  const rows = entries.length ? Math.max(...entries.map((entry) => entry.row)) + 1 : 0
  // +6：最下面一行别贴着图元下边框
  return { entries, rowHeight, height: rows ? rows * rowHeight + 6 : 0, overflow }
}