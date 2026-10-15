import type { Widget2D } from '../types/project'

export type BuiltinWidgetType =
  | 'rect'
  | 'roundRect'
  | 'circle'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'text'
  | 'button'
  | 'image'
  | 'value'
  | 'switch'
  | 'list'
  | 'chart'
  | 'trend'
  | 'trendHistory'
  | 'alarm'
  | 'alarmHistory'
  | 'gauge'
  | 'valve'
  | 'pump'
  | 'lamp'
  | 'tank'
  | 'pipe'
  | 'scene3d'
  | 'group'

/** 需画布交互绘制的工具（对齐 Flight 折线 / 多边形 / 管线） */
export type DrawToolType = 'polyline' | 'polygon' | 'pipe'

export const DRAW_TOOL_TYPES: DrawToolType[] = ['polyline', 'polygon', 'pipe']

export function isDrawToolType(type: string): type is DrawToolType {
  return type === 'polyline' || type === 'polygon' || type === 'pipe'
}

export interface WidgetPaletteItem {
  type: BuiltinWidgetType
  label: string
  description: string
  group: 'basic' | 'data' | 'industrial' | 'media'
}

export const BUILTIN_WIDGETS: WidgetPaletteItem[] = [
  { type: 'rect', label: '矩形', description: '基础矩形', group: 'basic' },
  { type: 'roundRect', label: '圆角矩形', description: '圆角矩形（对齐 Flight）', group: 'basic' },
  { type: 'circle', label: '圆形', description: '椭圆/圆', group: 'basic' },
  { type: 'line', label: '直线', description: '线段', group: 'basic' },
  { type: 'polyline', label: '折线', description: '多段折线（单击加点）', group: 'basic' },
  { type: 'polygon', label: '多边形', description: '封闭多边形（单击加点）', group: 'basic' },
  { type: 'text', label: '文本', description: '静态文本', group: 'basic' },
  { type: 'button', label: '按钮', description: '可点击按钮外观', group: 'basic' },
  { type: 'value', label: '数值', description: '过程值显示', group: 'data' },
  { type: 'switch', label: '开关', description: '开关/切换', group: 'data' },
  { type: 'list', label: '列表', description: '多行数据列表', group: 'data' },
  { type: 'chart', label: '图表', description: '折线/柱状趋势', group: 'data' },
  { type: 'trend', label: '实时趋势', description: '跟随当前值滚动的趋势曲线', group: 'industrial' },
  { type: 'trendHistory', label: '历史趋势', description: '按时间范围读取历史曲线', group: 'industrial' },
  { type: 'alarm', label: '实时报警', description: '实时报警列表', group: 'industrial' },
  { type: 'alarmHistory', label: '历史报警', description: '已发生的报警事件', group: 'industrial' },
  { type: 'gauge', label: '仪表', description: '半圆/圆形仪表盘', group: 'data' },
  { type: 'image', label: '图片', description: '图片/SVG 资源', group: 'media' },
  { type: 'scene3d', label: '三维画面', description: '嵌入已制作的三维页面', group: 'media' },
  { type: 'valve', label: '阀门', description: '工业阀门', group: 'industrial' },
  { type: 'pump', label: '泵', description: '工业泵', group: 'industrial' },
  { type: 'lamp', label: '指示灯', description: '状态指示灯', group: 'industrial' },
  { type: 'tank', label: '罐体', description: '储罐/液位', group: 'industrial' },
  { type: 'pipe', label: '管线', description: '工艺管线（单击加点）', group: 'industrial' },
]

type WidgetDefaults = {
  name: string
  transform: Widget2D['transform']
  style: Record<string, unknown>
  props: Record<string, unknown>
}

const DEFAULTS: Record<BuiltinWidgetType, WidgetDefaults> = {
  rect: {
    name: '矩形',
    transform: { x: 100, y: 100, width: 120, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#3d8bfd', stroke: '#93c5fd', strokeWidth: 2, opacity: 1, cornerRadius: 4 },
    props: {},
  },
  roundRect: {
    name: '圆角矩形',
    transform: { x: 100, y: 100, width: 140, height: 90, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#3d8bfd', stroke: '#93c5fd', strokeWidth: 2, opacity: 1, cornerRadius: 20 },
    props: {},
  },
  circle: {
    name: '圆形',
    transform: { x: 140, y: 140, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#22c55e', stroke: '#86efac', strokeWidth: 2, opacity: 1 },
    props: {},
  },
  line: {
    name: '直线',
    transform: { x: 80, y: 80, width: 160, height: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { stroke: '#f8fafc', strokeWidth: 3, opacity: 1 },
    props: {},
  },
  polyline: {
    name: '折线',
    transform: { x: 80, y: 80, width: 160, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { stroke: '#f8fafc', strokeWidth: 3, opacity: 1 },
    props: { points: [0, 0, 80, 40, 160, 0] },
  },
  polygon: {
    name: '多边形',
    transform: { x: 100, y: 80, width: 120, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#3d8bfd', stroke: '#93c5fd', strokeWidth: 2, opacity: 1 },
    props: { points: [60, 0, 120, 100, 0, 100] },
  },
  text: {
    name: '文本',
    transform: { x: 100, y: 100, width: 160, height: 36, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#e8eaed', opacity: 1, fontSize: 20, align: 'left' },
    props: { text: '文本内容' },
  },
  button: {
    name: '按钮',
    transform: { x: 100, y: 100, width: 120, height: 40, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#2563eb',
      stroke: '#93c5fd',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      fontSize: 14,
      textColor: '#ffffff',
    },
    props: { text: '按钮' },
  },
  value: {
    name: '数值',
    transform: { x: 100, y: 100, width: 160, height: 64, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0f172a',
      stroke: '#334155',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 8,
      textColor: '#38bdf8',
      labelColor: '#94a3b8',
      fontSize: 22,
    },
    props: { label: '温度', value: 36.5, unit: '℃', decimals: 1 },
  },
  switch: {
    name: '开关',
    transform: { x: 120, y: 120, width: 96, height: 44, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#22c55e',
      offFill: '#475569',
      stroke: '#94a3b8',
      strokeWidth: 1,
      opacity: 1,
      textColor: '#e2e8f0',
      fontSize: 12,
    },
    props: { on: false, label: '开关' },
  },
  list: {
    name: '列表',
    transform: { x: 80, y: 80, width: 220, height: 180, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0f172a',
      stroke: '#334155',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      textColor: '#e2e8f0',
      headerColor: '#94a3b8',
      rowAlt: '#111827',
      fontSize: 12,
    },
    props: {
      title: '设备列表',
      items: '1#泵\t运行\n2#泵\t停止\n进水阀\t开\n出水阀\t关',
      rowHeight: 28,
    },
  },
  chart: {
    name: '图表',
    transform: { x: 80, y: 80, width: 260, height: 160, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0f172a',
      stroke: '#334155',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      lineColor: '#38bdf8',
      barColor: '#3d8bfd',
      gridColor: '#1e293b',
      textColor: '#94a3b8',
      fontSize: 11,
    },
    props: {
      title: '趋势',
      chartType: 'line',
      series: '12,18,15,22,28,24,30,27,33,31',
      min: 0,
      max: 40,
    },
  },
  trend: {
    name: '实时趋势',
    transform: { x: 80, y: 80, width: 280, height: 160, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0b1220',
      stroke: '#1e3a5f',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      lineColor: '#22d3ee',
      gridColor: '#132033',
      textColor: '#94a3b8',
      fontSize: 11,
    },
    props: {
      title: '实时趋势',
      chartType: 'line',
      series: '20,21,19,22,24,23,25',
      maxPoints: 40,
      min: 0,
      max: 100,
    },
  },
  trendHistory: {
    name: '历史趋势',
    transform: { x: 80, y: 260, width: 320, height: 180, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0b1220',
      stroke: '#3f2e12',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      lineColor: '#f59e0b',
      gridColor: '#132033',
      textColor: '#94a3b8',
      fontSize: 11,
    },
    props: {
      title: '历史趋势',
      chartType: 'line',
      series: '18,22,19,25,28,24,30,27,26,31',
      range: '-1h',
      maxPoints: 240,
      min: 0,
      max: 100,
    },
  },
  alarm: {
    name: '实时报警',
    transform: { x: 80, y: 80, width: 300, height: 180, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#140f0f',
      stroke: '#7f1d1d',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      headerColor: '#fca5a5',
      textColor: '#fecaca',
      rowAlt: '#1c1212',
      fontSize: 12,
    },
    props: {
      title: '实时报警',
      rowHeight: 28,
      columns: ['date', 'time', 'level', 'status', 'alarmName', 'tagName', 'value'],
      items:
        '10:21:03\t告警\t液位偏高\n10:18:44\t故障\t1#泵通讯中断\n10:12:01\t提示\t阀门开度超限',
    },
  },
  alarmHistory: {
    name: '历史报警',
    transform: { x: 80, y: 280, width: 680, height: 248, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0c121b',
      stroke: '#1e3a5f',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 6,
      headerColor: '#93c5fd',
      textColor: '#e2e8f0',
      rowAlt: '#111827',
      fontSize: 12,
    },
    props: {
      title: '历史报警',
      rowHeight: 28,
      columns: ['date', 'time', 'event', 'level', 'alarmName', 'tagName', 'value'],
      items:
        '2026-10-13\t10:21:03\t触发\t报警\t液位偏高\t液位\t86\n2026-10-13\t10:18:44\t恢复\t故障\t泵通讯中断\t泵运行\tfalse\n2026-10-13\t10:12:01\t确认\t提示\t阀门开度超限\t阀门开度\t92',
    },
  },
  gauge: {
    name: '仪表',
    transform: { x: 100, y: 80, width: 160, height: 140, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0f172a',
      stroke: '#334155',
      strokeWidth: 1,
      opacity: 1,
      trackColor: '#1e293b',
      valueColor: '#38bdf8',
      textColor: '#e2e8f0',
      fontSize: 18,
    },
    props: { label: '压力', value: 62, min: 0, max: 100, unit: '%' },
  },
  image: {
    name: '图片',
    transform: { x: 120, y: 120, width: 160, height: 120, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { opacity: 1, stroke: '#3d4454', strokeWidth: 1 },
    props: { resourceId: '', src: '' },
  },
  scene3d: {
    name: '三维画面',
    transform: { x: 80, y: 80, width: 420, height: 280, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#0b1220',
      stroke: '#3d8bfd',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 4,
      textColor: '#93c5fd',
      fontSize: 13,
    },
    props: { page3dId: '', interactive: true },
  },
  valve: {
    name: '阀门',
    transform: { x: 120, y: 120, width: 72, height: 56, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#64748b', stroke: '#cbd5e1', strokeWidth: 2, opacity: 1, accent: '#38bdf8' },
    props: { open: true },
  },
  pump: {
    name: '泵',
    transform: { x: 120, y: 120, width: 80, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#0ea5e9', stroke: '#7dd3fc', strokeWidth: 2, opacity: 1 },
    props: { running: false },
  },
  lamp: {
    name: '指示灯',
    transform: { x: 140, y: 140, width: 48, height: 48, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: '#22c55e', stroke: '#14532d', strokeWidth: 2, opacity: 1 },
    props: { on: true },
  },
  tank: {
    name: '罐体',
    transform: { x: 120, y: 80, width: 100, height: 140, rotation: 0, scaleX: 1, scaleY: 1 },
    style: {
      fill: '#1e293b',
      stroke: '#94a3b8',
      strokeWidth: 2,
      opacity: 1,
      liquid: '#38bdf8',
    },
    props: { level: 60 },
  },
  pipe: {
    name: '管线',
    transform: { x: 80, y: 80, width: 180, height: 40, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { stroke: '#94a3b8', strokeWidth: 8, opacity: 1 },
    props: { points: [0, 20, 180, 20] },
  },
  group: {
    name: '组合',
    transform: { x: 100, y: 100, width: 120, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { stroke: '#3d8bfd', strokeWidth: 1, opacity: 1 },
    props: {},
  },
}

export function createWidget2D(
  type: BuiltinWidgetType,
  overrides?: Partial<Pick<Widget2D, 'name' | 'transform' | 'style' | 'props'>>,
): Widget2D {
  const base = DEFAULTS[type]
  const id = `w_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    type,
    name: overrides?.name ?? base.name,
    transform: { ...base.transform, ...overrides?.transform },
    style: { ...base.style, ...overrides?.style },
    props: { ...base.props, ...overrides?.props },
    visible: true,
    locked: false,
    bindings: [],
    animations: [],
    animationLinks: [],
    events: [],
  }
}

/** 解析折线/多边形点列（扁平 [x,y,...]） */
export function parsePointList(input: unknown): number[] {
  if (Array.isArray(input)) {
    return input.map((n) => Number(n)).filter((n) => Number.isFinite(n))
  }
  const text = String(input ?? '').trim()
  if (!text) return []
  return text
    .split(/[,，;\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

/**
 * 将页面坐标点列归一化为局部点 + 包围盒（对齐 Flight 折线落盘方式）
 */
export function normalizePolyPoints(absPoints: number[]): {
  points: number[]
  x: number
  y: number
  width: number
  height: number
} {
  const pts = [...absPoints]
  if (pts.length < 2) {
    return { points: [0, 0], x: 0, y: 0, width: 4, height: 4 }
  }
  let minX = pts[0]
  let minY = pts[1]
  let maxX = pts[0]
  let maxY = pts[1]
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]
    const y = pts[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const local: number[] = []
  for (let i = 0; i < pts.length; i += 2) {
    local.push(pts[i] - minX, pts[i + 1] - minY)
  }
  return {
    points: local,
    x: minX,
    y: minY,
    width: Math.max(4, maxX - minX),
    height: Math.max(4, maxY - minY),
  }
}

/** 解析图表序列字符串 */
export function parseSeries(input: unknown): number[] {
  if (Array.isArray(input)) {
    return input.map((n) => Number(n)).filter((n) => Number.isFinite(n))
  }
  const text = String(input ?? '').trim()
  if (!text) return []
  return text
    .split(/[,，\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

/**
 * 趋势图元（trend / trendHistory）的多曲线绑定。
 *
 * 数据模型（工程 JSON）：
 *   props.curves = [{ tagId, label?, color?, series?, min?, max? }]
 * - 旧工程没有 curves 字段 → 返回空数组，调用方回退到"单曲线"路径
 *   （旧的 valueOut / prop=value 绑定 + props.series），旧工程行为不变。
 * - series 是运行时缓冲（实时趋势滚动窗口 / 历史趋势查询结果），与旧 props.series 同样由运行端写入。
 */
export interface TrendCurve {
  tagId: string
  /** 图例名；留空时图例显示 tagId */
  label?: string
  /** 曲线颜色；留空时按序号从内置色板取 */
  color?: string
  /** 该曲线的数据点（运行时写入） */
  series?: number[]
  /** 该曲线单独的 Y 轴量程；留空 = 按自身数据自动缩放（多曲线默认） */
  min?: number
  max?: number
  /** 显示单位（图例 / 悬停读数 / 游标读数 / 点表 / CSV）；留空 = 不显示 */
  unit?: string
  /** 显示小数位 0~6；留空 = 按量级自适应（原来的表现） */
  decimals?: number
}

/** 每曲线显示格式：小数位 + 单位（留空时按量级自适应，与旧表现一致） */
export interface TrendValueFormat {
  unit?: string
  decimals?: number
}

/** 数值 → 显示用小数字符串；null / 非数 → "—" */
export function formatTrendNumber(value: number | null | undefined, decimals?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const digits =
    typeof decimals === 'number' && Number.isFinite(decimals)
      ? Math.min(6, Math.max(0, Math.trunc(decimals)))
      : abs >= 10000
        ? 0
        : abs >= 100
          ? 1
          : 2
  return value.toFixed(digits)
}

/** 数值 + 单位（"58.0 %"）；单位留空时就是纯数字 */
export function formatTrendValue(value: number | null | undefined, format?: TrendValueFormat): string {
  const text = formatTrendNumber(value, format?.decimals)
  const unit = typeof format?.unit === 'string' ? format.unit.trim() : ''
  if (text === '—' || !unit) return text
  return `${text} ${unit}`
}

/** 一个趋势图元最多绑定的曲线数 */
export const TREND_MAX_CURVES = 8

/** 多曲线内置配色（按曲线序号分配；单曲线仍用图元自己的 lineColor） */
export const TREND_PALETTE: readonly string[] = [
  '#22d3ee',
  '#f59e0b',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#60a5fa',
  '#fbbf24',
  '#f87171',
]

/** 真正绑定了变量的曲线 id（空行不算） */
export function trendCurveTagIds(
  props: Record<string, unknown> | undefined | null,
): string[] {
  return trendCurves(props)
    .map((curve) => curve.tagId)
    .filter((id): id is string => Boolean(id))
}

export function trendCurveColor(index: number): string {
  const list = TREND_PALETTE
  const i = ((Math.trunc(index) % list.length) + list.length) % list.length
  return list[i] as string
}

function finiteOrUndefined(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 读 props.curves（严格校验 + 去重 + 上限 8）。
 * 非法项（无 tagId / 重复 tagId / 非对象）直接跳过，不让坏数据进渲染。
 */
export function trendCurves(props: Record<string, unknown> | undefined | null): TrendCurve[] {
  const raw = props?.curves
  if (!Array.isArray(raw)) return []
  const out: TrendCurve[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const tagId = typeof rec.tagId === 'string' ? rec.tagId.trim() : ''
    // 允许"尚未选变量"的空行（面板里刚添加的那一行），按 sentinel 去重；
    // 渲染 / 订阅 / 进点都会跳过空行，不会画出东西来。
    const dedupeKey = tagId || '__empty__'
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : undefined
    const color = typeof rec.color === 'string' && rec.color ? rec.color : undefined
    const unit = typeof rec.unit === 'string' && rec.unit.trim() ? rec.unit.trim() : undefined
    const rawDecimals = Number(rec.decimals)
    const decimals =
      Number.isFinite(rawDecimals) && rec.decimals !== null && rec.decimals !== ''
        ? Math.min(6, Math.max(0, Math.trunc(rawDecimals)))
        : undefined
    const series = Array.isArray(rec.series)
      ? rec.series.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : undefined
    out.push({
      tagId,
      label,
      color,
      series,
      min: finiteOrUndefined(rec.min),
      max: finiteOrUndefined(rec.max),
      unit,
      decimals,
    })
    if (out.length >= TREND_MAX_CURVES) break
  }
  return out
}

/**
 * 曲线的 Y 轴范围。
 * - 给了合理 min/max（max>min）→ 用它（单曲线沿用图元的 min/max）
 * - 否则按数据范围；opts.pad=true（多曲线默认）时上下留 8% 边距，避免曲线贴边
 * - 常值序列退化时给固定跨度，避免 0/0
 */
export function resolveTrendRange(
  series: number[],
  span?: { min?: unknown; max?: unknown },
  opts?: { pad?: boolean },
): { min: number; max: number } {
  const lo = Number(span?.min)
  const hi = Number(span?.max)
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return { min: lo, max: hi }

  if (!series.length) return { min: 0, max: 1 }
  const dataMin = Math.min(...series)
  const dataMax = Math.max(...series)
  let min = dataMin
  let max = dataMax
  if (opts?.pad) {
    const pad = (dataMax - dataMin) * 0.08 || Math.abs(dataMax) * 0.05 || 1
    min = dataMin - pad
    max = dataMax + pad
  }
  if (!(max > min)) max = min + 1
  return { min, max }
}

/** 解析列表行（支持 Tab / | 分列） */
export function parseListItems(input: unknown): string[][] {
  const text = String(input ?? '')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|\s*\|\s*/).map((c) => c.trim()))
}
