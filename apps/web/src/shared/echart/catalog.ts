export type EchartFamily =
  | 'line'
  | 'area'
  | 'bar'
  | 'hbar'
  | 'pie'
  | 'scatter'
  | 'radar'
  | 'graph'
  | 'sankey'
  | 'gauge'
  | 'map'
  | 'heatmap'

export interface EchartPreset {
  id: string
  folder: string
  label: string
  family: EchartFamily
}

export const ECHART_DND = 'application/x-scada-echart'

export const ECHART_FOLDERS = [
  '折线图',
  '面积图',
  '柱状图',
  '条形图',
  '饼环图',
  '散点图',
  '雷达图',
  '关系图',
  '桑基图',
  '仪表盘',
  '地图',
  '热力图',
] as const

export const ECHART_PRESETS: EchartPreset[] = [
  { id: 'line-basic', folder: '折线图', label: '基础折线图', family: 'line' },
  { id: 'line-multi', folder: '折线图', label: '多折线图', family: 'line' },
  { id: 'line-trend', folder: '折线图', label: '折线趋势图', family: 'line' },
  { id: 'line-smooth', folder: '折线图', label: '基础曲线图', family: 'line' },
  { id: 'line-smooth-multi', folder: '折线图', label: '多曲线图', family: 'line' },
  { id: 'line-smooth-trend', folder: '折线图', label: '曲线趋势图', family: 'line' },
  { id: 'line-gradient', folder: '折线图', label: '渐变单曲线', family: 'line' },
  { id: 'line-step', folder: '折线图', label: '阶梯折线图', family: 'line' },
  { id: 'line-dual', folder: '折线图', label: '双Y轴折线', family: 'line' },
  { id: 'area-basic', folder: '面积图', label: '基础面积图', family: 'area' },
  { id: 'area-stack', folder: '面积图', label: '堆叠面积图', family: 'area' },
  { id: 'bar-basic', folder: '柱状图', label: '基础柱状图', family: 'bar' },
  { id: 'bar-group', folder: '柱状图', label: '分组柱状图', family: 'bar' },
  { id: 'bar-stack', folder: '柱状图', label: '堆叠柱状图', family: 'bar' },
  { id: 'bar-gradient', folder: '柱状图', label: '渐变柱状图', family: 'bar' },
  { id: 'hbar-basic', folder: '条形图', label: '基础条形图', family: 'hbar' },
  { id: 'hbar-group', folder: '条形图', label: '分组条形图', family: 'hbar' },
  { id: 'hbar-stack', folder: '条形图', label: '堆叠条形图', family: 'hbar' },
  { id: 'hbar-negative', folder: '条形图', label: '正负条形图', family: 'hbar' },
  { id: 'pie', folder: '饼环图', label: '饼图', family: 'pie' },
  { id: 'donut', folder: '饼环图', label: '环图', family: 'pie' },
  { id: 'donut-round', folder: '饼环图', label: '圆角环图', family: 'pie' },
  { id: 'rose', folder: '饼环图', label: '玫瑰图', family: 'pie' },
  { id: 'scatter', folder: '散点图', label: '散点图', family: 'scatter' },
  { id: 'effect-scatter', folder: '散点图', label: '涟漪散点图', family: 'scatter' },
  { id: 'radar', folder: '雷达图', label: '雷达图', family: 'radar' },
  { id: 'radar-circle', folder: '雷达图', label: '圆形雷达图', family: 'radar' },
  { id: 'graph-force', folder: '关系图', label: '力引导布局', family: 'graph' },
  { id: 'graph-knowledge', folder: '关系图', label: '知识图谱', family: 'graph' },
  { id: 'sankey', folder: '桑基图', label: '桑基图', family: 'sankey' },
  { id: 'sankey-custom', folder: '桑基图', label: '自定义桑基', family: 'sankey' },
  { id: 'gauge', folder: '仪表盘', label: '基础仪表盘', family: 'gauge' },
  { id: 'gauge-disk', folder: '仪表盘', label: '圆盘仪表盘', family: 'gauge' },
  { id: 'gauge-progress', folder: '仪表盘', label: '进度仪表盘', family: 'gauge' },
  { id: 'gauge-tech1', folder: '仪表盘', label: '蓝色科技1', family: 'gauge' },
  { id: 'gauge-tech2', folder: '仪表盘', label: '蓝色科技2', family: 'gauge' },
  { id: 'gauge-tech3', folder: '仪表盘', label: '蓝色科技3', family: 'gauge' },
  { id: 'map-china', folder: '地图', label: '中国地图', family: 'map' },
  { id: 'map-hubei', folder: '地图', label: '湖北地图', family: 'map' },
  { id: 'map-flow', folder: '地图', label: '地图流量', family: 'map' },
  { id: 'heatmap-cartesian', folder: '热力图', label: '笛卡尔热力图', family: 'heatmap' },
  { id: 'heatmap', folder: '热力图', label: '热力图', family: 'heatmap' },
]

const byId = new Map(ECHART_PRESETS.map((item) => [item.id, item]))

export function findEchartPreset(id: string): EchartPreset | undefined {
  return byId.get(id)
}

export function isMapPreset(id: string): boolean {
  return byId.get(id)?.family === 'map'
}
