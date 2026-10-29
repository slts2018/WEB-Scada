import { isMapPreset } from './catalog'
import { geoReady } from './geo'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const A = [120, 132, 101, 134, 90, 230, 210]
const B = [220, 182, 191, 234, 290, 330, 310]
const C = [150, 232, 201, 154, 190, 330, 410]
const COLORS = ['#3d8bfd', '#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6']

const text = '#cbd5e1'
const muted = '#94a3b8'
const split = '#1e293b'
const line = '#334155'

function fade(color: string, alpha: number) {
  const hex = color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function axis() {
  return {
    axisLine: { lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: muted },
    splitLine: { lineStyle: { color: split } },
  }
}

function base() {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: text },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
    legend: { top: 4, textStyle: { color: muted } },
    grid: { left: 42, right: 18, top: 36, bottom: 28 },
    color: COLORS,
  }
}

function cats() {
  return { type: 'category' as const, data: DAYS, ...axis(), splitLine: { show: false } }
}

function vals() {
  return { type: 'value' as const, ...axis() }
}

function lineSeries(data: number[], extra: Record<string, unknown> = {}) {
  return { type: 'line' as const, data, symbol: 'circle', symbolSize: 6, ...extra }
}

function areaFill(color: string) {
  return {
    color: {
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: fade(color, 0.45) },
        { offset: 1, color: fade(color, 0.02) },
      ],
    },
  }
}

function pieData() {
  return [
    { name: '搜索', value: 1048 },
    { name: '直接', value: 735 },
    { name: '邮件', value: 580 },
    { name: '联盟', value: 484 },
    { name: '视频', value: 300 },
  ]
}

function pieOption(extra: Record<string, unknown>) {
  return {
    ...base(),
    tooltip: { trigger: 'item', backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
    series: [
      {
        type: 'pie',
        radius: '62%',
        center: ['50%', '56%'],
        data: pieData(),
        label: { color: muted },
        ...extra,
      },
    ],
  }
}

const CHINA: Array<readonly [string, number]> = [
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

const HUBEI: Array<readonly [string, number]> = [
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

function mapOption(map: string, rows: ReadonlyArray<readonly [string, number]>) {
  if (!geoReady()) return loadingOption('加载地图…')
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
    visualMap: {
      min: 0,
      max: 1000,
      left: 8,
      bottom: 8,
      text: ['高', '低'],
      textStyle: { color: muted },
      inRange: { color: ['#0b1f3a', '#3d8bfd', '#22d3ee'] },
      calculable: false,
    },
    series: [
      {
        type: 'map',
        map,
        roam: false,
        label: { show: false, color: muted },
        itemStyle: { areaColor: '#0b1f3a', borderColor: '#245084' },
        emphasis: { label: { show: true, color: '#fff' }, itemStyle: { areaColor: '#1d4ed8' } },
        data: rows.map(([name, value]) => ({ name, value })),
      },
    ],
  }
}

function loadingOption(title: string) {
  return {
    backgroundColor: 'transparent',
    title: { text: title, left: 'center', top: 'middle', textStyle: { color: muted, fontSize: 14, fontWeight: 'normal' } },
  }
}

function gaugeBase(value: number, color: string, extra: Record<string, unknown>) {
  return {
    backgroundColor: 'transparent',
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 100,
        progress: { show: false },
        axisLine: { lineStyle: { width: 12, color: [[1, '#1e293b']] } },
        pointer: { itemStyle: { color } },
        axisTick: { distance: -12, lineStyle: { color: muted } },
        splitLine: { distance: -14, lineStyle: { color } },
        axisLabel: { color: muted, distance: 16 },
        detail: { valueAnimation: false, formatter: '{value}', color, fontSize: 22, offsetCenter: [0, '70%'] },
        data: [{ value }],
        ...extra,
      },
    ],
  }
}

export function buildEchartOption(variant: string): Record<string, unknown> {
  switch (variant) {
    case 'line-basic':
      return { ...base(), xAxis: cats(), yAxis: vals(), series: [lineSeries(A, { name: '访问' })] }
    case 'line-multi':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [lineSeries(A, { name: '邮件' }), lineSeries(B, { name: '联盟' }), lineSeries(C, { name: '视频' })],
      }
    case 'line-trend':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          lineSeries(A, {
            name: '趋势',
            markPoint: { data: [{ type: 'max', name: '最大' }, { type: 'min', name: '最小' }] },
            markLine: { data: [{ type: 'average', name: '平均' }] },
          }),
        ],
      }
    case 'line-smooth':
      return { ...base(), xAxis: cats(), yAxis: vals(), series: [lineSeries(A, { name: '曲线', smooth: true })] }
    case 'line-smooth-multi':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          lineSeries(A, { name: '邮件', smooth: true }),
          lineSeries(B, { name: '联盟', smooth: true }),
          lineSeries(C, { name: '视频', smooth: true }),
        ],
      }
    case 'line-smooth-trend':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          lineSeries(B, {
            name: '曲线趋势',
            smooth: true,
            markPoint: { data: [{ type: 'max' }, { type: 'min' }] },
            markLine: { data: [{ type: 'average' }] },
          }),
        ],
      }
    case 'line-gradient':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [lineSeries(A, { name: '渐变', smooth: true, areaStyle: areaFill(COLORS[0]), lineStyle: { width: 2 } })],
      }
    case 'line-step':
      return { ...base(), xAxis: cats(), yAxis: vals(), series: [lineSeries(A, { name: '阶梯', step: 'middle' })] }
    case 'line-dual':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: [vals(), { ...vals(), splitLine: { show: false } }],
        series: [
          lineSeries(A, { name: '蒸发', yAxisIndex: 0 }),
          lineSeries(B.map((n) => Math.round(n / 8)), { name: '降水', yAxisIndex: 1, smooth: true }),
        ],
      }
    case 'area-basic':
      return { ...base(), xAxis: cats(), yAxis: vals(), series: [lineSeries(A, { name: '面积', areaStyle: areaFill(COLORS[0]) })] }
    case 'area-stack':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          lineSeries(A, { name: '邮件', stack: 'tot', areaStyle: {} }),
          lineSeries(B, { name: '联盟', stack: 'tot', areaStyle: {} }),
          lineSeries(C, { name: '视频', stack: 'tot', areaStyle: {} }),
        ],
      }
    case 'bar-basic':
      return { ...base(), xAxis: cats(), yAxis: vals(), series: [{ type: 'bar', name: '销量', data: A, barWidth: 18 }] }
    case 'bar-group':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          { type: 'bar', name: '蒸发', data: A },
          { type: 'bar', name: '降水', data: B },
        ],
      }
    case 'bar-stack':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          { type: 'bar', name: '直接', stack: 'tot', data: A },
          { type: 'bar', name: '邮件', stack: 'tot', data: B },
          { type: 'bar', name: '联盟', stack: 'tot', data: C.map((n) => Math.round(n / 2)) },
        ],
      }
    case 'bar-gradient':
      return {
        ...base(),
        xAxis: cats(),
        yAxis: vals(),
        series: [
          {
            type: 'bar',
            name: '渐变',
            data: A,
            barWidth: 18,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: '#22d3ee' },
                  { offset: 1, color: '#1d4ed8' },
                ],
              },
            },
          },
        ],
      }
    case 'hbar-basic':
      return { ...base(), xAxis: vals(), yAxis: cats(), series: [{ type: 'bar', name: '销量', data: A, barWidth: 12 }] }
    case 'hbar-group':
      return {
        ...base(),
        xAxis: vals(),
        yAxis: cats(),
        series: [
          { type: 'bar', name: '2011', data: A },
          { type: 'bar', name: '2012', data: B },
        ],
      }
    case 'hbar-stack':
      return {
        ...base(),
        xAxis: vals(),
        yAxis: cats(),
        series: [
          { type: 'bar', name: '直接', stack: 'tot', data: A },
          { type: 'bar', name: '邮件', stack: 'tot', data: C.map((n) => Math.round(n / 3)) },
        ],
      }
    case 'hbar-negative':
      return {
        ...base(),
        xAxis: vals(),
        yAxis: cats(),
        series: [
          {
            type: 'bar',
            name: '收支',
            data: [120, -80, 90, -40, 160, -20, 70].map((value) => ({
              value,
              itemStyle: { color: value >= 0 ? COLORS[0] : '#f472b6' },
            })),
          },
        ],
      }
    case 'pie':
      return pieOption({})
    case 'donut':
      return pieOption({ radius: ['42%', '68%'] })
    case 'donut-round':
      return pieOption({
        radius: ['42%', '68%'],
        itemStyle: { borderRadius: 8, borderColor: '#0b1220', borderWidth: 2 },
      })
    case 'rose':
      return pieOption({ roseType: 'area', radius: ['18%', '68%'] })
    case 'scatter':
      return {
        ...base(),
        tooltip: { trigger: 'item', backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
        xAxis: vals(),
        yAxis: vals(),
        series: [
          {
            type: 'scatter',
            data: [
              [10, 8],
              [16, 20],
              [22, 14],
              [28, 30],
              [36, 18],
              [44, 36],
              [52, 22],
              [60, 40],
              [70, 28],
            ],
            symbolSize: 12,
          },
        ],
      }
    case 'effect-scatter':
      return {
        ...base(),
        tooltip: { trigger: 'item', backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
        xAxis: vals(),
        yAxis: vals(),
        series: [
          {
            type: 'effectScatter',
            data: [
              [12, 18],
              [24, 32],
              [38, 16],
              [50, 40],
              [66, 26],
            ],
            symbolSize: 16,
            rippleEffect: { scale: 4, brushType: 'stroke' },
          },
        ],
      }
    case 'radar':
    case 'radar-circle':
      return {
        backgroundColor: 'transparent',
        color: COLORS,
        legend: { top: 4, textStyle: { color: muted }, data: ['预算', '实际'] },
        radar: {
          shape: variant === 'radar-circle' ? 'circle' : 'polygon',
          center: ['50%', '58%'],
          radius: '62%',
          axisName: { color: muted },
          splitLine: { lineStyle: { color: line } },
          splitArea: { areaStyle: { color: ['rgba(15,23,42,0.2)', 'rgba(30,41,59,0.35)'] } },
          axisLine: { lineStyle: { color: line } },
          indicator: [
            { name: '销售', max: 100 },
            { name: '管理', max: 100 },
            { name: '技术', max: 100 },
            { name: '客服', max: 100 },
            { name: '研发', max: 100 },
            { name: '市场', max: 100 },
          ],
        },
        series: [
          {
            type: 'radar',
            data: [
              { name: '预算', value: [80, 70, 90, 60, 75, 85] },
              { name: '实际', value: [60, 85, 70, 80, 65, 72] },
            ],
          },
        ],
      }
    case 'graph-force':
      return {
        backgroundColor: 'transparent',
        tooltip: {},
        series: [
          {
            type: 'graph',
            layout: 'force',
            roam: true,
            label: { show: true, color: text },
            force: { repulsion: 160, edgeLength: 70 },
            lineStyle: { color: '#64748b', curveness: 0.1 },
            data: [
              { name: '中心', symbolSize: 42, itemStyle: { color: COLORS[0] } },
              { name: '工艺', symbolSize: 28, itemStyle: { color: COLORS[1] } },
              { name: '设备', symbolSize: 28, itemStyle: { color: COLORS[2] } },
              { name: '能源', symbolSize: 24, itemStyle: { color: COLORS[3] } },
              { name: '报警', symbolSize: 22, itemStyle: { color: COLORS[5] } },
              { name: '环境', symbolSize: 20, itemStyle: { color: COLORS[4] } },
            ],
            links: [
              { source: '中心', target: '工艺' },
              { source: '中心', target: '设备' },
              { source: '中心', target: '能源' },
              { source: '设备', target: '报警' },
              { source: '工艺', target: '环境' },
              { source: '能源', target: '设备' },
            ],
          },
        ],
      }
    case 'graph-knowledge':
      return {
        backgroundColor: 'transparent',
        legend: { top: 4, textStyle: { color: muted }, data: ['概念', '实体'] },
        series: [
          {
            type: 'graph',
            layout: 'force',
            roam: true,
            categories: [{ name: '概念' }, { name: '实体' }],
            label: { show: true, color: text, fontSize: 11 },
            force: { repulsion: 180 },
            lineStyle: { color: '#64748b' },
            data: [
              { name: '电力', category: 0, symbolSize: 36 },
              { name: '变压器', category: 1, symbolSize: 22 },
              { name: '开关柜', category: 1, symbolSize: 22 },
              { name: '负荷', category: 0, symbolSize: 30 },
              { name: '车间', category: 1, symbolSize: 20 },
              { name: '线路', category: 1, symbolSize: 18 },
            ],
            links: [
              { source: '电力', target: '变压器' },
              { source: '电力', target: '开关柜' },
              { source: '变压器', target: '负荷' },
              { source: '负荷', target: '车间' },
              { source: '开关柜', target: '线路' },
              { source: '线路', target: '车间' },
            ],
          },
        ],
      }
    case 'sankey':
    case 'sankey-custom':
      return {
        backgroundColor: 'transparent',
        series: [
          {
            type: 'sankey',
            left: 72,
            right: 72,
            top: 16,
            bottom: 12,
            nodeWidth: 14,
            nodeAlign: variant === 'sankey-custom' ? 'right' : 'left',
            label: { color: text },
            lineStyle: { color: 'gradient', curveness: 0.5 },
            data: [
              { name: '进线', depth: 0 },
              { name: '变压器', depth: 1 },
              { name: '照明', depth: 2 },
              { name: '动力', depth: 2 },
              { name: '空调', depth: 2 },
              { name: '损耗', depth: 2 },
            ],
            links: [
              { source: '进线', target: '变压器', value: 80 },
              { source: '变压器', target: '照明', value: 18 },
              { source: '变压器', target: '动力', value: 36 },
              { source: '变压器', target: '空调', value: 20 },
              { source: '变压器', target: '损耗', value: 6 },
            ],
          },
        ],
      }
    case 'gauge':
      return gaugeBase(62, COLORS[0], {})
    case 'gauge-disk':
      return gaugeBase(72, COLORS[1], {
        startAngle: 90,
        endAngle: -270,
        progress: { show: true, width: 14, itemStyle: { color: COLORS[1] } },
        axisLine: { lineStyle: { width: 14, color: [[1, '#1e293b']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { valueAnimation: false, formatter: '{value}%', color: COLORS[1], fontSize: 26, offsetCenter: [0, 0] },
      })
    case 'gauge-progress':
      return gaugeBase(48, COLORS[2], {
        progress: { show: true, roundCap: true, width: 14, itemStyle: { color: COLORS[2] } },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, '#1e293b']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
      })
    case 'gauge-tech1':
      return gaugeBase(68, '#38bdf8', {
        progress: { show: true, width: 10, itemStyle: { color: '#38bdf8' } },
        axisLine: { lineStyle: { width: 10, color: [[0.68, '#38bdf8'], [1, '#0f2744']] } },
        anchor: { show: true, size: 12, itemStyle: { color: '#38bdf8' } },
      })
    case 'gauge-tech2':
      return gaugeBase(54, '#22d3ee', {
        startAngle: 200,
        endAngle: -20,
        progress: { show: true, width: 16, itemStyle: { color: '#22d3ee' } },
        axisLine: { lineStyle: { width: 16, color: [[1, '#134e4a']] } },
        pointer: { length: '62%', itemStyle: { color: '#ecfeff' } },
      })
    case 'gauge-tech3':
      return gaugeBase(81, '#a78bfa', {
        progress: { show: true, width: 8, itemStyle: { color: '#a78bfa' } },
        axisLine: { lineStyle: { width: 8, color: [[0.3, '#22d3ee'], [0.7, '#3d8bfd'], [1, '#a78bfa']] } },
        splitNumber: 8,
        detail: { valueAnimation: false, formatter: '{value}', color: '#e9d5ff', fontSize: 24, offsetCenter: [0, '68%'] },
      })
    case 'map-china':
      return mapOption('china', CHINA)
    case 'map-hubei':
      return mapOption('hubei', HUBEI)
    case 'map-flow':
      if (!geoReady()) return loadingOption('加载地图…')
      return {
        backgroundColor: 'transparent',
        geo: {
          map: 'china',
          roam: false,
          itemStyle: { areaColor: '#0b1f3a', borderColor: '#245084' },
          emphasis: { itemStyle: { areaColor: '#132743' }, label: { show: false } },
        },
        series: [
          {
            type: 'lines',
            coordinateSystem: 'geo',
            zlevel: 2,
            effect: { show: true, period: 4, trailLength: 0.25, symbol: 'arrow', symbolSize: 6 },
            lineStyle: { color: '#22d3ee', width: 1, curveness: 0.25, opacity: 0.7 },
            data: [
              { coords: [[116.4, 39.9], [121.47, 31.23]] },
              { coords: [[116.4, 39.9], [113.26, 23.13]] },
              { coords: [[114.31, 30.59], [104.06, 30.67]] },
              { coords: [[121.47, 31.23], [120.15, 30.28]] },
            ],
          },
          {
            type: 'effectScatter',
            coordinateSystem: 'geo',
            zlevel: 3,
            rippleEffect: { scale: 4, brushType: 'stroke' },
            symbolSize: 10,
            itemStyle: { color: '#f59e0b' },
            data: [
              [116.4, 39.9],
              [121.47, 31.23],
              [113.26, 23.13],
              [114.31, 30.59],
            ],
          },
        ],
      }
    case 'heatmap-cartesian': {
      const hours = ['0', '4', '8', '12', '16', '20']
      const data: number[][] = []
      for (let y = 0; y < DAYS.length; y++) {
        for (let x = 0; x < hours.length; x++) data.push([x, y, Math.round(20 + ((x * 7 + y * 13) % 80))])
      }
      return {
        backgroundColor: 'transparent',
        tooltip: { position: 'top', backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
        grid: { left: 48, right: 16, top: 16, bottom: 46 },
        xAxis: { type: 'category', data: hours, ...axis(), splitLine: { show: false } },
        yAxis: { type: 'category', data: DAYS, ...axis(), splitLine: { show: false } },
        visualMap: {
          min: 0,
          max: 100,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          textStyle: { color: muted },
          inRange: { color: ['#0b1f3a', '#3d8bfd', '#f59e0b'] },
        },
        series: [{ type: 'heatmap', data, label: { show: false } }],
      }
    }
    case 'heatmap': {
      const data: Array<[string, number]> = []
      const start = new Date('2026-01-01T00:00:00')
      for (let i = 0; i < 365; i++) {
        const day = new Date(start.getTime() + i * 86400000)
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
        data.push([key, Math.round((Math.sin(i / 18) + 1) * 40 + (i % 7) * 4)])
      }
      return {
        backgroundColor: 'transparent',
        tooltip: { backgroundColor: '#0f172a', borderColor: line, textStyle: { color: text } },
        visualMap: {
          min: 0,
          max: 100,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          textStyle: { color: muted },
          inRange: { color: ['#0f2744', '#164e63', '#22d3ee', '#f59e0b'] },
        },
        calendar: {
          top: 28,
          left: 28,
          right: 12,
          cellSize: ['auto', 13],
          range: '2026',
          itemStyle: { borderWidth: 1, borderColor: '#0b1220', color: '#0f172a' },
          splitLine: { lineStyle: { color: line } },
          dayLabel: { color: muted, nameMap: 'ZH' },
          monthLabel: { color: muted },
          yearLabel: { color: text },
        },
        series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
      }
    }
    default:
      return isMapPreset(variant) ? loadingOption('未知地图') : { ...base(), xAxis: cats(), yAxis: vals(), series: [lineSeries(A, { name: '示例' })] }
  }
}

function quietAxis(axis: unknown): unknown {
  if (Array.isArray(axis)) return axis.map(quietAxis)
  if (!axis || typeof axis !== 'object') return axis
  return {
    ...(axis as Record<string, unknown>),
    axisLabel: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
  }
}

function thumbSeries(series: unknown): unknown {
  if (!Array.isArray(series)) return series
  return series.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const item = raw as Record<string, unknown>
    const type = item.type
    if (type === 'line') {
      const prev = (item.lineStyle as Record<string, unknown> | undefined) ?? {}
      const next: Record<string, unknown> = {
        ...item,
        symbol: 'none',
        lineStyle: { ...prev, width: 3 },
      }
      if (item.markPoint) next.markPoint = { ...(item.markPoint as object), label: { show: false }, symbolSize: 16 }
      if (item.markLine) next.markLine = { ...(item.markLine as object), label: { show: false }, symbol: 'none' }
      return next
    }
    if (type === 'pie') return { ...item, label: { show: false }, labelLine: { show: false } }
    if (type === 'gauge') {
      return {
        ...item,
        detail: { show: false },
        title: { show: false },
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      }
    }
    if (type === 'graph' || type === 'sankey') return { ...item, label: { show: false } }
    if (type === 'bar') return { ...item, barWidth: item.barWidth ?? 10 }
    return item
  })
}

/** 控件库缩略图：去掉坐标、图例和文字，只留图形本身，方便按样式区分。 */
export function buildEchartThumbOption(variant: string): Record<string, unknown> {
  const option = buildEchartOption(variant)
  const next: Record<string, unknown> = {
    ...option,
    animation: false,
    legend: { show: false },
    tooltip: { show: false },
    title: { show: false },
  }
  if (option.grid) next.grid = { left: 4, right: 4, top: 6, bottom: 4 }
  if (option.xAxis) next.xAxis = quietAxis(option.xAxis)
  if (option.yAxis) next.yAxis = quietAxis(option.yAxis)
  if (option.visualMap) {
    const vm = option.visualMap
    next.visualMap = Array.isArray(vm)
      ? vm.map((item) => (item && typeof item === 'object' ? { ...item, show: false } : item))
      : { ...(vm as object), show: false }
  }
  if (option.radar && typeof option.radar === 'object') {
    next.radar = { ...(option.radar as object), axisName: { show: false }, radius: '78%' }
  }
  if (option.calendar && typeof option.calendar === 'object') {
    next.calendar = {
      ...(option.calendar as object),
      top: 2,
      left: 2,
      right: 2,
      bottom: 2,
      dayLabel: { show: false },
      monthLabel: { show: false },
      yearLabel: { show: false },
    }
  }
  if (option.series) next.series = thumbSeries(option.series)
  return next
}
