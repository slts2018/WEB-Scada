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
  | 'alarm'
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
  { type: 'trend', label: '趋势', description: '实时趋势曲线（工业）', group: 'industrial' },
  { type: 'alarm', label: '报警', description: '报警列表控件', group: 'industrial' },
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
    name: '趋势',
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
  alarm: {
    name: '报警',
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
      items:
        '10:21:03\t告警\t液位偏高\n10:18:44\t故障\t1#泵通讯中断\n10:12:01\t提示\t阀门开度超限',
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

/** 解析列表行（支持 Tab / | 分列） */
export function parseListItems(input: unknown): string[][] {
  const text = String(input ?? '')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|\s*\|\s*/).map((c) => c.trim()))
}
