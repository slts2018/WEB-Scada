/** 图表内容项。没选变量时用 value / x 画；选了变量后运行时换成当前值。 */
import { chartWidgetTitle } from '@/shared/runtime/chartWidgetTitle'
import { applySharedBarGeometry } from './options'
export interface EchartItem {
  label: string
  series?: string
  tagId?: string
  value: number
  color?: string
  x?: number
  xTagId?: string
}

export interface EchartBound {
  items: EchartItem[]
  min?: number
  max?: number
  title?: string
  /** 折线/面积：每个变量自己的采样，和 items 对齐。没有时用当前值画一条平线。 */
  lines?: Array<Array<number | null> | null>
  /** 采样时间，和最长那条线对齐（兼容旧调用）。 */
  lineTimes?: number[]
  /** 每条曲线自己的采样时间，和 lines 对齐；有则按时间轴定位每个点。 */
  lineTimeSeries?: Array<number[] | null>
  /** 绑定折线/面积的横轴窗口。有绑定变量时必须走时间轴，不能再落到周一到周日的示例轴。 */
  timeRange?: { min: number; max: number }
  /** 图例点掉的项（tagId 或标签名），只影响显示，不写回运行端工程。 */
  hidden?: string[]
}

export type EchartContentKind =
  | 'gauge'
  | 'pie'
  | 'category'
  | 'multi'
  | 'scatter'
  | 'radar'
  | 'graph'
  | 'sankey'
  | 'map'
  | 'flow'
  | 'heatmap'
  | 'calendar'

const MULTI = new Set([
  'line-multi',
  'line-smooth-multi',
  'line-dual',
  'area-stack',
  'bar-group',
  'bar-stack',
  'hbar-group',
  'hbar-stack',
])

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const A = [120, 132, 101, 134, 90, 230, 210]
const B = [220, 182, 191, 234, 290, 330, 310]
const C = [150, 232, 201, 154, 190, 330, 410]

const CHINA: Array<[string, number]> = [
  ['北京市', 820],
  ['天津市', 420],
  ['河北省', 610],
  ['山西省', 380],
  ['内蒙古自治区', 260],
  ['辽宁省', 540],
  ['吉林省', 310],
  ['黑龙江省', 290],
  ['上海市', 910],
  ['江苏省', 880],
  ['浙江省', 860],
  ['安徽省', 470],
  ['福建省', 520],
  ['江西省', 360],
  ['山东省', 740],
  ['河南省', 690],
  ['湖北省', 640],
  ['湖南省', 580],
  ['广东省', 980],
  ['广西壮族自治区', 410],
  ['海南省', 180],
  ['重庆市', 450],
  ['四川省', 620],
  ['贵州省', 280],
  ['云南省', 340],
  ['西藏自治区', 90],
  ['陕西省', 430],
  ['甘肃省', 210],
  ['青海省', 120],
  ['宁夏回族自治区', 140],
  ['新疆维吾尔自治区', 200],
  ['台湾省', 160],
  ['香港特别行政区', 300],
  ['澳门特别行政区', 80],
]

const HUBEI: Array<[string, number]> = [
  ['武汉市', 920],
  ['黄石市', 280],
  ['十堰市', 240],
  ['宜昌市', 460],
  ['襄阳市', 520],
  ['鄂州市', 210],
  ['荆门市', 260],
  ['孝感市', 300],
  ['荆州市', 410],
  ['黄冈市', 340],
  ['咸宁市', 220],
  ['随州市', 180],
  ['恩施土家族苗族自治州', 200],
]

const FLOW_CITIES = [
  ['北京', 116.4, 39.9],
  ['上海', 121.47, 31.23],
  ['广州', 113.26, 23.13],
  ['武汉', 114.31, 30.59],
] as const

export const ECHART_AXIS_FONT_DEFAULT = 16
export const ECHART_AXIS_FONT_MIN = 8
export const ECHART_AXIS_FONT_MAX = 72

/** 横轴、纵轴刻度文字的字号。没填时用默认值。 */
export function echartAxisFont(props: Record<string, unknown> | undefined | null): number {
  const n = Number(props?.axisFontSize)
  if (!Number.isFinite(n)) return ECHART_AXIS_FONT_DEFAULT
  return Math.max(ECHART_AXIS_FONT_MIN, Math.min(ECHART_AXIS_FONT_MAX, Math.round(n)))
}

export function echartContentKind(variant: string): EchartContentKind {
  if (variant.startsWith('gauge')) return 'gauge'
  if (variant === 'pie' || variant === 'donut' || variant === 'donut-round' || variant === 'rose') return 'pie'
  if (variant === 'scatter' || variant === 'effect-scatter') return 'scatter'
  if (variant === 'radar' || variant === 'radar-circle') return 'radar'
  if (variant.startsWith('graph')) return 'graph'
  if (variant.startsWith('sankey')) return 'sankey'
  if (variant === 'map-flow') return 'flow'
  if (variant.startsWith('map')) return 'map'
  if (variant === 'heatmap') return 'calendar'
  if (variant === 'heatmap-cartesian') return 'heatmap'
  if (MULTI.has(variant)) return 'multi'
  return 'category'
}

export function echartItemMax(kind: EchartContentKind): number {
  if (kind === 'map') return 40
  if (kind === 'calendar') return 31
  if (kind === 'gauge') return 1
  if (kind === 'multi' || kind === 'radar') return 24
  return 16
}

export function echartContentHint(kind: EchartContentKind, variant = ''): string {
  switch (kind) {
    case 'gauge':
      return '绑定一个变量。运行和实时预览用它的当前值，量程决定表盘两端。'
    case 'pie':
      return '每项选一个变量。图例名默认用变量名，可以改。负数不占扇区。'
    case 'category':
    case 'multi':
      if (variant.startsWith('line') || variant.startsWith('area')) {
        return '每一行一个变量，各自一条曲线。图例用变量名，颜色用来区分曲线。实时预览和运行时按采样往右画。'
      }
      return '每一行选一个变量。横轴用变量名，颜色用来区分各项。'
    case 'scatter':
      return '每个点分别绑定 X、Y 两个变量。没选的那一轴仍用原来的示例数。'
    case 'radar':
      return '每一行是一个指标。系列名相同的行画成一条雷达。'
    case 'graph':
      return '每个节点绑一个变量，数值越大点越大。连线仍按节点名对接，改名后对不上的线会消失。'
    case 'sankey':
      return '每一行是一条流量。变量是流量大小，来源和去向是节点名。'
    case 'map':
      return '地区名要和地图上的名称一致，例如「湖北省」「武汉市」。变量是该地区的值。'
    case 'flow':
      return '这四个城市可以绑变量，数值决定闪点大小。飞线仍是示例路线。'
    case 'heatmap':
      return '每一格是「行 + 列」。变量是这格的数值。'
    case 'calendar':
      return '日期写成 2026-01-01。变量是这一天的数值。'
    default:
      return '每一项可以绑定一个变量。'
  }
}

function points(labels: string[], values: number[], series?: string, color?: string): EchartItem[] {
  return labels.map((label, i) => ({
    label,
    value: values[i] ?? 0,
    ...(series ? { series } : {}),
    ...(color ? { color } : {}),
  }))
}

export function defaultEchartItems(variant: string): EchartItem[] {
  const kind = echartContentKind(variant)
  if (kind === 'gauge') {
    const value = variant === 'gauge-disk' ? 72 : variant === 'gauge-progress' ? 48 : variant === 'gauge-tech2' ? 54 : variant === 'gauge-tech3' ? 81 : variant === 'gauge-tech1' ? 68 : 62
    return [{ label: '当前值', value }]
  }
  if (kind === 'pie') {
    return [
      { label: '搜索', value: 1048, color: '#3d8bfd' },
      { label: '直接', value: 735, color: '#22d3ee' },
      { label: '邮件', value: 580, color: '#f59e0b' },
      { label: '联盟', value: 484, color: '#a78bfa' },
      { label: '视频', value: 300, color: '#34d399' },
    ]
  }
  if (kind === 'scatter') {
    const pairs = variant === 'effect-scatter'
      ? [[12, 18], [24, 32], [38, 16], [50, 40], [66, 26]]
      : [[10, 8], [16, 20], [28, 30], [44, 36], [60, 40], [70, 28]]
    return pairs.map(([x, value], i) => ({ label: `点${i + 1}`, value, x }))
  }
  if (kind === 'radar') {
    const names = ['销售', '管理', '技术', '客服', '研发', '市场']
    const budget = [80, 70, 90, 60, 75, 85]
    const actual = [60, 85, 70, 80, 65, 72]
    return [...points(names, budget, '预算'), ...points(names, actual, '实际')]
  }
  if (kind === 'graph') {
    return variant === 'graph-knowledge'
      ? [
          { label: '电力', value: 36 },
          { label: '变压器', value: 22 },
          { label: '开关柜', value: 22 },
          { label: '负荷', value: 30 },
          { label: '车间', value: 20 },
          { label: '线路', value: 18 },
        ]
      : [
          { label: '中心', value: 42 },
          { label: '工艺', value: 28 },
          { label: '设备', value: 28 },
          { label: '能源', value: 24 },
          { label: '报警', value: 22 },
          { label: '环境', value: 20 },
        ]
  }
  if (kind === 'sankey') {
    return [
      { label: '进线', series: '变压器', value: 80 },
      { label: '变压器', series: '照明', value: 18 },
      { label: '变压器', series: '动力', value: 36 },
      { label: '变压器', series: '空调', value: 20 },
      { label: '变压器', series: '损耗', value: 6 },
    ]
  }
  if (kind === 'map') {
    const rows = variant === 'map-hubei' ? HUBEI : CHINA
    return rows.map(([label, value]) => ({ label, value }))
  }
  if (kind === 'flow') {
    return FLOW_CITIES.map(([label, x, lat]) => ({ label, value: 60, x, series: String(lat) }))
  }
  if (kind === 'heatmap') {
    const hours = ['0', '4', '8', '12']
    const items: EchartItem[] = []
    for (const day of DAYS.slice(0, 4)) {
      hours.forEach((hour, x) => {
        items.push({ label: day, series: hour, value: 20 + ((x * 7 + items.length) % 60) })
      })
    }
    return items
  }
  if (kind === 'calendar') {
    return Array.from({ length: 14 }, (_, i) => ({
      label: `2026-01-${String(i + 1).padStart(2, '0')}`,
      value: Math.round((Math.sin(i / 3) + 1) * 40),
    }))
  }
  if (kind === 'multi') {
    if (variant === 'line-dual') {
      return [...points(DAYS, A, '蒸发', '#3d8bfd'), ...points(DAYS, B.map((n) => Math.round(n / 8)), '降水', '#22d3ee')]
    }
    if (variant === 'bar-group' || variant === 'hbar-group') {
      return [...points(DAYS, A, '蒸发', '#3d8bfd'), ...points(DAYS, B, '降水', '#22d3ee')]
    }
    if (variant === 'hbar-stack') {
      return [...points(DAYS, A, '直接', '#3d8bfd'), ...points(DAYS, C.map((n) => Math.round(n / 3)), '邮件', '#22d3ee')]
    }
    return [
      ...points(DAYS, A, '邮件', '#3d8bfd'),
      ...points(DAYS, B, '联盟', '#22d3ee'),
      ...points(DAYS, C, '视频', '#f59e0b'),
    ]
  }
  return points(DAYS, A, undefined, '#3d8bfd')
}

export function blankEchartItem(kind: EchartContentKind, index: number): EchartItem {
  if (kind === 'radar') return { label: `指标${index + 1}`, series: '系列1', value: 0 }
  if (kind === 'multi' || kind === 'category') return { label: '', value: 0 }
  if (kind === 'sankey') return { label: '', series: '', value: 0 }
  if (kind === 'heatmap') return { label: '周一', series: '0', value: 0 }
  if (kind === 'calendar') return { label: '2026-01-01', value: 0 }
  if (kind === 'scatter') return { label: `点${index + 1}`, value: 0, x: 0 }
  if (kind === 'graph') return { label: `节点${index + 1}`, value: 24 }
  if (kind === 'flow') return { label: '', value: 40, x: 116.4, series: '39.9' }
  return { label: '', value: 0 }
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** props.items 还没写过时返回 null，画面继续用示例数据。 */
export function echartItems(props: Record<string, unknown> | undefined | null): EchartItem[] | null {
  if (!props || !Array.isArray(props.items)) return null
  const out: EchartItem[] = []
  for (const raw of props.items) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const label = typeof rec.label === 'string' ? rec.label : ''
    const series = typeof rec.series === 'string' ? rec.series : ''
    const tagId = typeof rec.tagId === 'string' ? rec.tagId.trim() : ''
    const xTagId = typeof rec.xTagId === 'string' ? rec.xTagId.trim() : ''
    const color = typeof rec.color === 'string' && rec.color.trim() ? rec.color : ''
    const item: EchartItem = { label, value: num(rec.value) }
    if (series) item.series = series
    if (tagId) item.tagId = tagId
    if (xTagId) item.xTagId = xTagId
    if (color) item.color = color
    if (rec.x !== undefined && rec.x !== '') item.x = num(rec.x)
    out.push(item)
  }
  return out
}

export function echartBoundOf(props: Record<string, unknown> | undefined | null): EchartBound | null {
  const items = echartItems(props)
  if (!items) return null
  const min = Number(props?.min)
  const max = Number(props?.max)
  const title = chartWidgetTitle({ title: props?.title, fallback: '' })
  return {
    items,
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
    ...(title ? { title } : {}),
  }
}

export function echartTagIds(props: Record<string, unknown> | undefined | null): string[] {
  const items = echartItems(props)
  if (!items) return []
  const ids: string[] = []
  for (const item of items) {
    if (item.tagId) ids.push(item.tagId)
    if (item.xTagId) ids.push(item.xTagId)
  }
  return ids
}

/** 图例切换用的稳定键：优先变量 id，其次名称。 */
export function echartLegendKey(item: { tagId?: string; label: string }, index: number): string {
  return item.tagId || item.label.trim() || `#${index}`
}

/** 折线/面积/柱/条/饼等：位图上的 ECharts 图例点不到，要用 Konva 叠层图例。 */
export function echartLegendToggleable(variant: string): boolean {
  const v = String(variant || "")
  return (
    v.startsWith("line") ||
    v.startsWith("area") ||
    v.startsWith("bar") ||
    v.startsWith("hbar") ||
    v === "pie" ||
    v === "donut" ||
    v === "donut-round" ||
    v === "rose"
  )
}

function visibleEchartItems(bound: EchartBound): typeof bound.items {
  const hidden = new Set(bound.hidden ?? [])
  if (!hidden.size) return bound.items
  return bound.items.filter((item, index) => !hidden.has(echartLegendKey(item, index)))
}

export function echartSignature(bound: EchartBound | null): string {
  if (!bound) return ''
  const body = bound.items
    .map((item) => `${item.series ?? ''},${item.label},${item.value},${item.x ?? ''},${item.color ?? ''}`)
    .join(';')
  const hist = bound.lines
    ?.map((line) => (line && line.length ? `${line.length}:${line[line.length - 1] ?? 'x'}` : '-'))
    .join('/')
  const tick = bound.lineTimes?.length
    ? `${bound.lineTimes.length}:${bound.lineTimes[bound.lineTimes.length - 1]}`
    : ''
  const ticks = bound.lineTimeSeries
    ?.map((times) => (times && times.length ? `${times.length}:${times[times.length - 1]}` : '-'))
    .join('/')
  const range = bound.timeRange ? `${bound.timeRange.min}:${bound.timeRange.max}` : ''
  const hidden = (bound.hidden ?? []).join(',')
  return `${bound.title ?? ''}|${bound.min ?? ''}|${bound.max ?? ''}|${body}|${hist ?? ''}|${tick}|${ticks ?? ''}|${range}|h:${hidden}`
}

function unique(values: string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (!out.includes(value)) out.push(value)
  }
  return out
}

function seriesOf(option: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(option.series) ? (option.series as Array<Record<string, unknown>>) : []
}

function paintPoint(item: EchartItem, fallback: number): number | { value: number; itemStyle: { color: string } } {
  if (!item.color) return fallback
  return { value: fallback, itemStyle: { color: item.color } }
}

function axisData(option: Record<string, unknown>, key: 'xAxis' | 'yAxis', data: string[]) {
  const axis = option[key]
  if (Array.isArray(axis)) {
    const first = axis[0]
    if (first && typeof first === 'object') option[key] = [{ ...(first as object), data }, ...axis.slice(1)]
    return
  }
  if (axis && typeof axis === 'object') option[key] = { ...(axis as object), data }
}

const CURVE_COLORS = ['#3d8bfd', '#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6']

function fadeColor(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : color
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    if ([r, g, b].every((n) => Number.isFinite(n))) return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}

function padClock(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 时间轴刻度：短窗口带毫秒，避免同一秒的刻度挤成同一个 HH:mm:ss。 */
function timeAxisLabel(ms: number, spanMs: number): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const hms = `${padClock(date.getHours())}:${padClock(date.getMinutes())}:${padClock(date.getSeconds())}`
  if (spanMs > 0 && spanMs <= 8_000) return `${hms}.${padClock(date.getMilliseconds(), 3)}`
  if (spanMs >= 24 * 3600_000) {
    return `${padClock(date.getMonth() + 1)}-${padClock(date.getDate())} ${padClock(date.getHours())}:${padClock(date.getMinutes())}`
  }
  return hms
}

/** 与 trendSeries.CURVE_GAP_BREAK_MS 对齐：配对后若两点间隔超过 1s 再插 null，避免缓冲漏断时画出穿窗斜线。 */
const PAIRED_GAP_BREAK_MS = 1000

function breakPairedTimeGaps(points: Array<[number, number | null]>): Array<[number, number | null]> {
  if (points.length < 2) return points
  const out: Array<[number, number | null]> = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1]
    const curr = points[i]
    if (prev && curr && prev[1] != null && curr[1] != null && curr[0] - prev[0] > PAIRED_GAP_BREAK_MS) {
      out.push([prev[0] + 1, null])
    }
    out.push(curr)
  }
  return out
}

function pairTimeData(
  values: Array<number | null>,
  times: number[],
): Array<[number, number | null]> {
  const out: Array<[number, number | null]> = []
  if (times.length === values.length) {
    for (let i = 0; i < values.length; i += 1) out.push([times[i] ?? 0, values[i] ?? null])
    return breakPairedTimeGaps(out)
  }
  if (values.length > times.length) {
    const offset = values.length - times.length
    for (let i = 0; i < times.length; i += 1) out.push([times[i] ?? 0, values[i + offset] ?? null])
    return breakPairedTimeGaps(out)
  }
  const offset = times.length - values.length
  for (let i = 0; i < values.length; i += 1) out.push([times[i + offset] ?? 0, values[i] ?? null])
  return breakPairedTimeGaps(out)
}

function setTimeXAxis(option: Record<string, unknown>, min: number, max: number) {
  const span = Math.max(0, max - min)
  const axisLabel = {
    hideOverlap: true,
    formatter: (value: number) => timeAxisLabel(Number(value), span),
  }
  const patch: Record<string, unknown> = {
    type: 'time',
    min,
    max: max <= min ? min + 1 : max,
    boundaryGap: false,
    splitNumber: span > 0 && span <= 8_000 ? 6 : 5,
    axisTick: { show: false },
    splitLine: { show: false },
  }
  const merge = (raw: unknown) => {
    const prev = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
    delete prev.data
    const prevLabel = prev.axisLabel && typeof prev.axisLabel === 'object' ? (prev.axisLabel as Record<string, unknown>) : {}
    return { ...prev, ...patch, axisLabel: { ...prevLabel, ...axisLabel } }
  }
  const axis = option.xAxis
  if (Array.isArray(axis)) {
    option.xAxis = [merge(axis[0]), ...axis.slice(1)]
    return
  }
  option.xAxis = merge(axis)
}

/** 折线、面积：一个变量一条曲线。还没有采样时用当前值拉一条平线，避免三个点被连成一条。 */
/** 折线/面积纵轴上下各留一点边，避免 0 和 100 贴死绘图区。只改显示，不改图元上保存的量程。 */
const CURVE_Y_PAD = "5%"

function padCurveYAxis(option: Record<string, unknown>): void {
  const patch = (raw: unknown): Record<string, unknown> => {
    const prev =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : { type: "value" }
    if (prev.type && prev.type !== "value") return prev
    return { ...prev, boundaryGap: [CURVE_Y_PAD, CURVE_Y_PAD] }
  }
  const axis = option.yAxis
  option.yAxis = Array.isArray(axis) ? axis.map(patch) : patch(axis)
}

function applyBoundCurves(
  variant: string,
  option: Record<string, unknown>,
  bound: EchartBound,
  series: Array<Record<string, unknown>>,
) {
  const rows = bound.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.tagId || item.label.trim())
  const tagged = rows.filter(({ item }) => Boolean(item.tagId))
  const use = (tagged.length ? tagged : rows).length
    ? (tagged.length ? tagged : rows)
    : bound.items.map((item, index) => ({ item, index }))
  const packs = use.map(({ item, index }) => {
    const hist = bound.lines?.[index]
    const ownTimes = bound.lineTimeSeries?.[index]
    const fallbackTimes = bound.lineTimes
    const times =
      ownTimes && ownTimes.length >= 1 ? ownTimes : fallbackTimes && fallbackTimes.length >= 1 ? fallbackTimes : null
    if (hist && hist.filter((value) => value != null).length >= 1 && times && times.length >= 1) {
      return { item, index, values: hist, times }
    }
    let latest: number | null = null
    if (hist) {
      for (let i = hist.length - 1; i >= 0; i -= 1) {
        if (hist[i] != null) {
          latest = hist[i]
          break
        }
      }
    }
    if (item.tagId) {
      const value = latest ?? (Number.isFinite(item.value) ? item.value : null)
      // 不要用墙钟补一个右端点：否则时间轴被拉到 now，左侧只剩进页那几秒数据。
      if (times && times.length) {
        return { item, index, values: value == null ? [] : [value], times: [times[times.length - 1]] }
      }
      return { item, index, values: value == null ? [] : [value], times: null as number[] | null }
    }
    return { item, index, values: [latest ?? item.value, latest ?? item.value], times: null as number[] | null }
  })

  const timed = packs.filter((pack) => pack.times && pack.times.length >= 1)
  const useTime = timed.length > 0 || Boolean(bound.timeRange) || bound.items.some((item) => item.tagId)
  if (useTime) {
    const finiteTimes: number[] = []
    for (const pack of timed) {
      const values = pack.values
      const times = pack.times ?? []
      const offsetT = times.length > values.length ? times.length - values.length : 0
      const offsetV = values.length > times.length ? values.length - times.length : 0
      const n = Math.min(values.length, times.length)
      for (let i = 0; i < n; i += 1) {
        const value = values[i + offsetV]
        const at = times[i + offsetT]
        if (value == null || !Number.isFinite(value) || !Number.isFinite(at)) continue
        finiteTimes.push(at)
      }
    }
    finiteTimes.sort((a, b) => a - b)
    // 丢掉远离开数据簇的孤立右端点（墙钟/保活），否则 max 被拉去 now、曲线只占左几秒。
    while (
      finiteTimes.length >= 2 &&
      (finiteTimes[finiteTimes.length - 1] ?? 0) - (finiteTimes[finiteTimes.length - 2] ?? 0) > 2000
    ) {
      finiteTimes.pop()
    }
    const dataMax = finiteTimes.length ? (finiteTimes[finiteTimes.length - 1] ?? NaN) : NaN
    let span = 5000
    if (bound.timeRange && bound.timeRange.max > bound.timeRange.min) {
      const raw = bound.timeRange.max - bound.timeRange.min
      // 只用进页窗口那么宽；被个别超前时间戳拉宽的 timeRange 一律丢掉。
      if (raw >= 1000 && raw <= 8000) span = raw
    }
    // 没有有限值采样时不要用 Date.now() 铺一个 4s 空轴（那正是「有刻度没曲线」的来源）。
    const rangeMax = bound.timeRange && bound.timeRange.max > bound.timeRange.min ? bound.timeRange.max : NaN
    const maxSource = Number.isFinite(dataMax) ? dataMax : rangeMax
    if (Number.isFinite(maxSource)) {
      let max = maxSource
      let min = max - span
      if (max <= min) max = min + 1
      setTimeXAxis(option, min, max)
    }
  } else {
    const axis = option.xAxis
    if (axis && typeof axis === 'object' && !Array.isArray(axis)) {
      option.xAxis = { ...(axis as object), boundaryGap: false }
    }
  }

  const categoryLen = Math.max(2, ...packs.map((pack) => pack.values.length))
  const hidden = new Set(bound.hidden ?? [])
  // 位图上的 ECharts 图例收不到点击；改由 Konva 叠层图例切换显隐。
  option.legend = { show: false }
  option.series = packs.filter(({ item, index }) => !hidden.has(echartLegendKey(item, index))).map(({ item, index, values, times }) => {
    const template = series[Math.min(index, series.length - 1)] ?? series[0] ?? {}
    const color = item.color || CURVE_COLORS[index % CURVE_COLORS.length]
    const prevLine = template.lineStyle && typeof template.lineStyle === 'object' ? template.lineStyle : {}
    const prevItem = template.itemStyle && typeof template.itemStyle === 'object' ? template.itemStyle : {}
    const data =
      useTime && times && times.length >= 1
        ? pairTimeData(values, times)
        : values.length >= categoryLen
          ? values
          : [...Array<number | null>(categoryLen - values.length).fill(null), ...values]
    const filled = useTime
      ? (data as Array<[number, number | null]>).filter((point) => point[1] != null).length
      : (data as Array<number | null>).filter((value) => value != null).length
    const next: Record<string, unknown> = {
      ...template,
      name: item.label.trim() || `曲线${index + 1}`,
      data,
      lineStyle: { ...prevLine, color, width: Number((prevLine as { width?: number }).width) || 2 },
      itemStyle: { ...prevItem, color },
      showSymbol: filled <= 8,
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: false,
    }
    delete next.markPoint
    delete next.markLine
    if (template.areaStyle) next.areaStyle = { color: fadeColor(color, 0.28) }
    if (variant === 'line-dual') next.yAxisIndex = index === 1 ? 1 : 0
    else delete next.yAxisIndex
    return next
  })
  padCurveYAxis(option)
}

/** 按当前数据重设色标两端，避免示例量程或个别极大值把整张热力涂成一种颜色。 */
function applyVisualMapRange(option: Record<string, unknown>, values: number[]) {
  const nums = values.filter((value) => Number.isFinite(value))
  if (!nums.length) return
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.05)
    min = min > 0 ? Math.max(0, min - pad) : min - pad
    max = max + pad
  }
  const patch = (vm: unknown): unknown => {
    if (Array.isArray(vm)) return vm.map(patch)
    if (!vm || typeof vm !== 'object') return { min, max }
    return { ...vm, min, max }
  }
  option.visualMap = patch(option.visualMap)
}

function dateKeyOf(label: string): string | null {
  const text = String(label || '').trim()
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  if (!m) return null
  const t = Date.parse(`${m[1]}T00:00:00`)
  return Number.isFinite(t) ? m[1] : null
}

function calendarRangeFromDates(dates: string[]): string | [string, string] | null {
  if (!dates.length) return null
  const ordered = [...dates].sort()
  return ordered[0] === ordered[ordered.length - 1] ? ordered[0] : [ordered[0], ordered[ordered.length - 1]]
}

/** 按数据日期收缩日历范围，并把格子拉到绘图区，短区间扩成整月以免只剩两三格巨块。 */
export function fitEchartCalendar(option: Record<string, unknown>, width: number, height: number): void {
  const cal = option.calendar
  if (!cal || typeof cal !== 'object' || Array.isArray(cal)) return
  const prev = cal as Record<string, unknown>
  const series = option.series
  const first = (Array.isArray(series) ? series[0] : series) as { data?: unknown } | undefined
  const dates: string[] = []
  if (Array.isArray(first?.data)) {
    for (const row of first.data) {
      const label = Array.isArray(row) ? String(row[0] ?? '') : ''
      const key = dateKeyOf(label)
      if (key) dates.push(key)
    }
  }
  const fitted = calendarRangeFromDates(dates)
  let from = Date.parse('2026-01-01T00:00:00')
  let to = Date.parse('2026-12-31T00:00:00')
  let range: unknown = fitted ?? prev.range ?? '2026'
  if (fitted) {
    const start = Array.isArray(fitted) ? fitted[0] : fitted
    const end = Array.isArray(fitted) ? fitted[1] : fitted
    from = Date.parse(`${start}T00:00:00`)
    to = Date.parse(`${end}T00:00:00`)
  } else if (typeof range === 'string' && /^\d{4}$/.test(range)) {
    from = Date.parse(`${range}-01-01T00:00:00`)
    to = Date.parse(`${range}-12-31T00:00:00`)
  } else if (Array.isArray(range) && range.length >= 2) {
    from = Date.parse(String(range[0]))
    to = Date.parse(String(range[1]))
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    from = Date.parse('2026-01-01T00:00:00')
    to = Date.parse('2026-12-31T00:00:00')
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const days = Math.round((to - from) / 86400000) + 1
  if (days <= 45) {
    const a = new Date(from)
    const b = new Date(to)
    const startMonth = `${a.getFullYear()}-${pad(a.getMonth() + 1)}`
    const endMonth = `${b.getFullYear()}-${pad(b.getMonth() + 1)}`
    range = startMonth === endMonth ? startMonth : [startMonth, endMonth]
  }
  const top = 48
  const left = 72
  const right = 24
  const bottom = 72
  const prevYear = prev.yearLabel && typeof prev.yearLabel === 'object' ? (prev.yearLabel as Record<string, unknown>) : {}
  const prevDay = prev.dayLabel && typeof prev.dayLabel === 'object' ? (prev.dayLabel as Record<string, unknown>) : {}
  const prevMonth = prev.monthLabel && typeof prev.monthLabel === 'object' ? (prev.monthLabel as Record<string, unknown>) : {}
  // ECharts 默认 cellSize 是 20。只 delete 会回落到 20px，大图上仍是顶上一细条。
  // 同时给出 left/top + 宽高，并把 cellSize 设为 auto，格子按绘图区铺满。
  const innerW = Math.max(8, width - left - right)
  const innerH = Math.max(8, height - top - bottom)
  const next: Record<string, unknown> = {
    ...prev,
    top,
    left,
    width: innerW,
    height: innerH,
    range,
    cellSize: ['auto', 'auto'],
    yearLabel: { ...prevYear, show: days > 45, margin: 8 },
    dayLabel: { ...prevDay, show: true, nameMap: 'ZH' },
    monthLabel: { ...prevMonth, show: true },
  }
  delete next.right
  delete next.bottom
  option.calendar = next
}

function applyCalendarBoundRange(option: Record<string, unknown>, labels: string[]): void {
  const cal = option.calendar
  if (!cal || typeof cal !== 'object' || Array.isArray(cal)) return
  const dates = labels.map(dateKeyOf).filter((key): key is string => Boolean(key))
  const range = calendarRangeFromDates(dates)
  if (!range) return
  option.calendar = { ...(cal as Record<string, unknown>), range }
}


/** 把内容配置写进已经建好的 ECharts option。items 为空数组时清空数据。 */
export function applyEchartBound(variant: string, option: Record<string, unknown>, bound: EchartBound) {
  const kind = echartContentKind(variant)
  const items = bound.items
  const series = seriesOf(option)
  const first = series[0]
  // 运行页顶栏已经有画面名，图内不再画标题，避免和 Y 轴顶刻度、叠层图例挤在左上角。
  option.title = { show: false }
  if (echartLegendToggleable(variant) && option.grid && typeof option.grid === 'object' && !Array.isArray(option.grid)) {
    // 叠层图例改到底部居中：containLabel 下 bottom 是图+轴标签下方的空带，留给图例，避免和时间轴、Y 轴重叠。
    option.grid = { ...(option.grid as object), top: 20, bottom: 80 }
  }
  if (!first) return

  if (kind === 'gauge') {
    const prev = Array.isArray(first.data) ? first.data[0] : null
    const base = prev && typeof prev === 'object' ? { ...(prev as object) } : {}
    first.data = [{ ...base, value: items[0]?.value ?? 0 }]
    if (bound.min !== undefined) first.min = bound.min
    if (bound.max !== undefined) first.max = bound.max
    return
  }

  if (kind === 'pie') {
    // 位图图例点不到，隐藏 ECharts 自带图例，由 Konva 叠层负责点选。
    option.legend = { show: false }
    // 图例在底部后，饼图不必再往下偏（模板 center 原为 56%）。
    first.center = ['50%', '50%']
    const visible = visibleEchartItems(bound)
    first.data = visible.map((item) => ({
      name: item.label || '项',
      value: Math.max(0, item.value),
      ...(item.color ? { itemStyle: { color: item.color } } : {}),
    }))
    return
  }

  if (kind === 'scatter') {
    first.data = items.map((item) => [item.x ?? 0, item.value])
    return
  }

  if (kind === 'radar') {
    const labels = unique(items.map((item) => item.label || '指标'))
    const groups = unique(items.map((item) => item.series || '系列'))
    const max = Math.max(100, ...items.map((item) => Math.abs(item.value)))
    if (option.radar && typeof option.radar === 'object') {
      option.radar = {
        ...(option.radar as object),
        indicator: labels.map((name) => ({ name, max })),
      }
    }
    first.data = groups.map((name) => ({
      name,
      value: labels.map((label) => items.find((item) => (item.series || '系列') === name && item.label === label)?.value ?? 0),
    }))
    return
  }

  if (kind === 'graph') {
    const prevLinks = Array.isArray(first.links) ? (first.links as Array<Record<string, unknown>>) : []
    first.data = items.map((item) => ({
      name: item.label || '节点',
      value: item.value,
      symbolSize: Math.max(14, Math.min(56, Math.abs(item.value) || 14)),
      ...(item.color ? { itemStyle: { color: item.color } } : {}),
    }))
    const names = new Set(items.map((item) => item.label))
    first.links = prevLinks.filter((link) => names.has(String(link.source)) && names.has(String(link.target)))
    return
  }

  if (kind === 'sankey') {
    const names = unique(items.flatMap((item) => [item.label, item.series || ''].filter(Boolean)))
    first.data = names.map((name) => ({ name }))
    first.links = items
      .filter((item) => item.label && item.series)
      .map((item) => ({ source: item.label, target: item.series, value: Math.max(0, item.value) }))
    return
  }

  if (kind === 'map') {
    first.data = items.map((item) => ({ name: item.label, value: item.value }))
    return
  }

  if (kind === 'flow') {
    const scatter = series.find((item) => item.type === 'effectScatter')
    if (scatter) {
      scatter.data = items
        .filter((item) => Number.isFinite(item.x) && item.series)
        .map((item) => ({ name: item.label, value: [item.x, Number(item.series), item.value] }))
      scatter.symbolSize = (raw: unknown) => {
        const value = Array.isArray(raw) ? Number(raw[2]) : Number(raw)
        return Math.max(8, Math.min(28, (Number.isFinite(value) ? value : 40) / 5))
      }
    }
    return
  }

  if (kind === 'heatmap') {
    const cols = unique(items.map((item) => item.series || ''))
    const rows = unique(items.map((item) => item.label))
    axisData(option, 'xAxis', cols)
    axisData(option, 'yAxis', rows)
    const taggedVals = items.filter((item) => item.tagId).map((item) => item.value)
    first.data = items.map((item) => [
      Math.max(0, cols.indexOf(item.series || '')),
      Math.max(0, rows.indexOf(item.label)),
      Number.isFinite(item.value) ? item.value : '-',
    ])
    applyVisualMapRange(option, taggedVals.length ? taggedVals : items.map((item) => item.value))
    return
  }

  if (kind === 'calendar') {
    const taggedVals = items.filter((item) => item.tagId).map((item) => item.value)
    first.data = items.map((item) => [item.label, Number.isFinite(item.value) ? item.value : '-'])
    applyVisualMapRange(option, taggedVals.length ? taggedVals : items.map((item) => item.value))
    applyCalendarBoundRange(option, items.map((item) => item.label))
    return
  }

  const horizontal = variant.startsWith('hbar')
  if ((kind === 'category' || kind === 'multi') && (variant.startsWith('line') || variant.startsWith('area'))) {
    applyBoundCurves(variant, option, bound, series)
    return
  }
  if (kind === 'category' || kind === 'multi') {
    const hidden = new Set(bound.hidden ?? [])
    const labels = items.map((item) => item.label || '项')
    axisData(option, horizontal ? 'yAxis' : 'xAxis', labels)
    option.series = [first]
    option.legend = { show: false }
    const colored = variant === 'hbar-negative'
    first.name = ''
    first.data = items.map((item, index) => {
      // 隐藏项留空槽，不删类目，避免剩下的柱子被拉宽。
      if (hidden.has(echartLegendKey(item, index))) return null
      if (colored) {
        return { value: item.value, itemStyle: { color: item.value >= 0 ? item.color || '#3d8bfd' : '#f472b6' } }
      }
      return paintPoint(item, item.value)
    })
    const lineColor = items.find((item) => item.color)?.color
    if (lineColor && first.type === 'line') {
      first.lineStyle = { ...((first.lineStyle as object) ?? {}), color: lineColor }
      first.itemStyle = { ...((first.itemStyle as object) ?? {}), color: lineColor }
    }
    if (first.type === 'bar' || variant.startsWith('bar') || variant.startsWith('hbar')) {
      applySharedBarGeometry(option)
    }
  }
}
