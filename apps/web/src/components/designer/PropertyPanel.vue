<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  TREND_MAX_CURVES,
  trendCurveColor,
  trendCurves,
  CHART_SLICE_MAX,
  BAR_WIDTH_DEFAULT,
  BAR_WIDTH_MIN,
  BAR_WIDTH_MAX,
  barWidthOf,
  chartSlices,
  type ChartSlice,
  type Page3D,
  type TrendCurve,
} from '@web-scada/core'
import {
  ALARM_FIELDS,
  ALARM_HISTORY_FIELDS,
  alarmFieldsOf,
  alarmHistoryFieldsOf,
  type AlarmFieldId,
  type AlarmHistoryFieldId,
} from '@/shared/runtime/alarmText'
import HelpTip from '@/components/designer/HelpTip.vue'
import { TREND_INTERVALS, TREND_RANGES, releaseTrendHistory } from '@/shared/runtime/trendHistoryQuery'
import { clearCurveSamples } from '@/shared/runtime/trendSeries'
import { exportTrendWidgetImage, measureTextFrame } from '@/shared/konva/widgetNodes'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { findEchartPreset } from '@/shared/echart/catalog'
import {
  blankEchartItem,
  defaultEchartItems,
  echartAxisFont,
  ECHART_AXIS_FONT_DEFAULT,
  ECHART_AXIS_FONT_MAX,
  ECHART_AXIS_FONT_MIN,
  echartContentHint,
  echartContentKind,
  echartItemMax,
  echartItems,
  type EchartItem,
} from '@/shared/echart/content'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'
import { ElMessage } from 'element-plus'
import WidgetBindingPanel from '@/components/designer/WidgetBindingPanel.vue'

const project = useProjectStore()
const tags = useTagStore()
const fileInput = ref<HTMLInputElement | null>(null)
/** 与三维属性一致：默认全部折叠，点标题再展开 */
const propCollapse = ref<string[]>([])
/** 「4·内容」用弹出框编辑（侧栏太窄，曲线/列表等表单在弹窗里配） */
const contentDialogOpen = ref(false)

const widget = computed(() => project.selectedWidget)
const multiCount = computed(() => project.selectedWidgetIds.length)
const pages3d = computed(() => project.document.pages.filter((p): p is Page3D => p.type === '3d'))

watch(
  () => widget.value?.id,
  () => {
    contentDialogOpen.value = false
  },
)

const contentSummary = computed(() => {
  const current = widget.value
  if (!current) return ''
  if (current.type === 'trend' || current.type === 'trendHistory') {
    const n = trendCurves(current.props).filter((c) => c.tagId).length
    return n ? `已配置 ${n} 条曲线` : '未添加曲线变量'
  }
  if (current.type === 'pie' || current.type === 'bar') {
    const n = chartSlices(current.props).length
    return n ? `已配置 ${n} 项` : '未添加数据'
  }
  if (current.type === 'echart') {
    const items = echartItems(current.props)
    if (!items) return '示例数据，打开后可绑定变量'
    const n = items.filter((item) => item.tagId || item.xTagId).length
    return n ? `已绑定 ${n} 个变量` : `已配置 ${items.length} 项`
  }
  if (current.type === 'chart') return String(current.props.title || '图表')
  if (current.type === 'alarm' || current.type === 'alarmHistory' || current.type === 'list') {
    return String(current.props.title || '列表 / 报警')
  }
  if (current.props.text !== undefined) {
    const text = String(current.props.text || '').trim()
    return text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : '空文本'
  }
  if (current.props.label) return String(current.props.label)
  if (current.type === 'image') return '图片资源'
  if (current.type === 'scene3d') return '三维页面嵌入'
  return '点击打开内容配置'
})

function updateTransform(key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    transform: { ...widget.value.transform, [key]: value },
  })
}

function updateStyle(key: string, value: string | number) {
  if (!widget.value) return
  if (key === 'fontSize' && widget.value.type === 'text') {
    const next = Math.max(1, Number(value) || 1)
    const frame = measureTextFrame(String(widget.value.props.text ?? ''), next)
    project.updateWidget(widget.value.id, {
      style: { ...widget.value.style, fontSize: next },
      transform: {
        ...widget.value.transform,
        width: frame.width,
        height: frame.height,
      },
    })
    return
  }
  project.updateWidget(widget.value.id, {
    style: { ...widget.value.style, [key]: value },
  })
}

function updateProp(key: string, value: string | number | boolean | string[]) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: { ...widget.value.props, [key]: value },
  })
}

/**
 * 趋势图元的多曲线变量（props.curves）。
 * 列表非空时优先于旧的 valueOut / prop=value 单值绑定；为空时完全沿用旧行为。
 */
const trendCurveList = computed(() => trendCurves(widget.value?.props))

function writeTrendCurves(next: TrendCurve[]) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: {
      ...widget.value.props,
      curves: next.map((curve) => ({
        tagId: curve.tagId,
        ...(curve.label ? { label: curve.label } : {}),
        ...(curve.color ? { color: curve.color } : {}),
        ...(curve.series && curve.series.length ? { series: curve.series } : {}),
        ...(typeof curve.min === 'number' ? { min: curve.min } : {}),
        ...(typeof curve.max === 'number' ? { max: curve.max } : {}),
      })),
    },
  })
}

function addTrendCurve() {
  const list = trendCurveList.value
  if (!widget.value) return
  if (list.length >= TREND_MAX_CURVES) {
    ElMessage.warning(`最多 ${TREND_MAX_CURVES} 条曲线`)
    return
  }
  // 只加一行"空变量"，由你自己选 —— 不再自动挑一个变量塞进来（否则会静默改掉图元绑定的变量）
  writeTrendCurves([...list, { tagId: '', color: trendCurveColor(list.length) }])
}

/** 已在曲线列表里的变量（批量选择时置灰） */
const trendCurveTagIds = computed(() => new Set(trendCurveList.value.map((curve) => curve.tagId)))
const trendAddSelection = ref<string[]>([])

/**
 * 批量添加变量：一次勾选好几个变量直接变曲线（这是历史/实时趋势最常用的入口）。
 * 去重 + 上限都在这里控制，避免写进去一个重复的变量。
 */
function addTrendCurves(tagIds: string[]) {
  if (!widget.value || !tagIds.length) return
  const list = trendCurveList.value.slice()
  const used = new Set(list.map((curve) => curve.tagId))
  let added = 0
  let skipped = 0
  for (const tagId of tagIds) {
    if (!tagId || used.has(tagId) || list.length >= TREND_MAX_CURVES) {
      skipped += 1
      continue
    }
    used.add(tagId)
    list.push({ tagId, color: trendCurveColor(list.length) })
    added += 1
  }
  trendAddSelection.value = []
  if (!added) {
    ElMessage.warning(
      list.length >= TREND_MAX_CURVES ? `最多 ${TREND_MAX_CURVES} 条曲线` : '这些变量已经在曲线列表里',
    )
    return
  }
  writeTrendCurves(list)
  if (skipped) ElMessage.info(`已添加 ${added} 条；${skipped} 条未加入（重复或超出 ${TREND_MAX_CURVES} 条上限）`)
}

function setTrendCurve(tagId: string, patch: Partial<TrendCurve>) {
  writeTrendCurves(
    trendCurveList.value.map((curve) => (curve.tagId === tagId ? { ...curve, ...patch } : curve)),
  )
}

function setTrendCurveTag(prevTagId: string, nextTagId: string) {
  if (!nextTagId || nextTagId === prevTagId) return
  if (trendCurveList.value.some((curve) => curve.tagId === nextTagId)) {
    ElMessage.warning('该变量已经在曲线列表里')
    return
  }
  if (widget.value) {
    releaseTrendHistory(widget.value.id, prevTagId)
    clearCurveSamples(widget.value.id, prevTagId)
  }
  writeTrendCurves(
    trendCurveList.value.map((curve) =>
      curve.tagId === prevTagId ? { ...curve, tagId: nextTagId, series: undefined } : curve,
    ),
  )
}

/** 设计端把当前趋势图元导出成 PNG（等价于运行端右上角那个"导出"按钮） */
function exportTrendPng() {
  const current = widget.value
  if (!current) return
  exportTrendWidgetImage(current)
}

function removeTrendCurve(tagId: string) {
  if (widget.value) {
    releaseTrendHistory(widget.value.id, tagId)
    clearCurveSamples(widget.value.id, tagId)
  }
  writeTrendCurves(trendCurveList.value.filter((curve) => curve.tagId !== tagId))
}

const sliceList = computed(() => chartSlices(widget.value?.props))

function writeSlices(next: ChartSlice[]) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: {
      ...widget.value.props,
      slices: next.slice(0, CHART_SLICE_MAX).map((slice) => ({
        label: slice.label,
        value: Number.isFinite(slice.value) ? slice.value : 0,
        ...(slice.color ? { color: slice.color } : {}),
        ...(slice.tagId ? { tagId: slice.tagId } : {}),
      })),
    },
  })
}

function addSlice() {
  const list = sliceList.value
  if (list.length >= CHART_SLICE_MAX) {
    ElMessage.warning(`最多 ${CHART_SLICE_MAX} 项`)
    return
  }
  writeSlices([...list, { label: '', value: 0, color: trendCurveColor(list.length) }])
}

function patchSlice(index: number, patch: Partial<ChartSlice>) {
  writeSlices(sliceList.value.map((slice, i) => (i === index ? { ...slice, ...patch } : slice)))
}

/** 默认示例名（一、项1）。选了变量后用变量名换掉，手改过的图例名保留。 */
function isPlaceholderSliceLabel(label: string): boolean {
  return !label.trim() || /^(项\d+|[一二三四五六七八])$/.test(label.trim())
}

function setSliceTag(index: number, tagId: string) {
  const slice = sliceList.value[index]
  if (!slice) return
  if (!tagId) {
    patchSlice(index, { tagId: undefined })
    return
  }
  const prev = slice.tagId ? tags.list.find((item) => item.meta.tagId === slice.tagId) : undefined
  const next = tags.list.find((item) => item.meta.tagId === tagId)
  const n = Number(next?.value?.value)
  const keepLabel = !isPlaceholderSliceLabel(slice.label) && slice.label !== prev?.meta.name
  patchSlice(index, {
    tagId,
    label: keepLabel ? slice.label : (next?.meta.name ?? slice.label),
    value: Number.isFinite(n) ? n : 0,
  })
}

function removeSlice(index: number) {
  writeSlices(sliceList.value.filter((_, i) => i !== index))
}

const echartVariant = computed(() => String(widget.value?.props.variant || 'line-basic'))
const echartKind = computed(() => echartContentKind(echartVariant.value))
const echartHasAxis = computed(() =>
  echartKind.value === 'category' || echartKind.value === 'multi' || echartKind.value === 'scatter' || echartKind.value === 'heatmap',
)
const echartRows = computed(() => {
  const saved = echartItems(widget.value?.props)
  if (saved) return saved
  if (echartKind.value === 'category' || echartKind.value === 'multi') return [blankEchartItem(echartKind.value, 0)]
  return defaultEchartItems(echartVariant.value)
})

function cleanEchartItem(item: EchartItem): EchartItem {
  const next: EchartItem = { label: item.label, value: Number.isFinite(item.value) ? item.value : 0 }
  const namedByTag = echartKind.value === 'category' || echartKind.value === 'multi'
  if (item.series && !namedByTag) next.series = item.series
  if (item.color) next.color = item.color
  if (item.tagId) next.tagId = item.tagId
  if (item.xTagId) next.xTagId = item.xTagId
  if (item.x !== undefined) next.x = item.x
  return next
}

function writeEchartItems(items: EchartItem[]) {
  if (!widget.value) return
  const max = echartItemMax(echartKind.value)
  project.updateWidget(widget.value.id, {
    props: {
      ...widget.value.props,
      items: items.slice(0, max).map(cleanEchartItem),
    },
  })
}

function patchEchartItem(index: number, patch: Partial<EchartItem>) {
  writeEchartItems(echartRows.value.map((item, i) => (i === index ? { ...item, ...patch } : item)))
}

function isPlaceholderEchartLabel(label: string): boolean {
  return !label.trim() || /^(当前值|项\d+|点\d+)$/.test(label.trim())
}

function setEchartTag(index: number, tagId: string, key: 'tagId' | 'xTagId') {
  const item = echartRows.value[index]
  if (!item) return
  if (!tagId) {
    const patch: Partial<EchartItem> = key === 'tagId' ? { tagId: undefined } : { xTagId: undefined }
    if (key === 'tagId' && (echartKind.value === 'category' || echartKind.value === 'multi')) patch.label = ''
    patchEchartItem(index, patch)
    return
  }
  const prevId = key === 'tagId' ? item.tagId : item.xTagId
  const prev = prevId ? tags.list.find((row) => row.meta.tagId === prevId) : undefined
  const next = tags.list.find((row) => row.meta.tagId === tagId)
  const n = Number(next?.value?.value)
  const fillLabel = key === 'tagId' && (echartKind.value === 'pie' || echartKind.value === 'gauge' || echartKind.value === 'category' || echartKind.value === 'multi')
  const namedByTag = echartKind.value === 'category' || echartKind.value === 'multi'
  const keepLabel = !namedByTag && !isPlaceholderEchartLabel(item.label) && item.label !== prev?.meta.name
  const patch: Partial<EchartItem> = key === 'tagId' ? { tagId } : { xTagId: tagId }
  if (Number.isFinite(n)) {
    if (key === 'tagId') patch.value = n
    else patch.x = n
  }
  if (fillLabel) patch.label = keepLabel ? item.label : (next?.meta.name ?? item.label)
  patchEchartItem(index, patch)
}

function addEchartItem() {
  const list = echartRows.value
  const max = echartItemMax(echartKind.value)
  if (list.length >= max) {
    ElMessage.warning(`最多 ${max} 项`)
    return
  }
  const item = blankEchartItem(echartKind.value, list.length)
  if (echartKind.value === 'pie' || echartKind.value === 'category' || echartKind.value === 'multi' || echartKind.value === 'graph') {
    item.color = trendCurveColor(list.length)
  }
  writeEchartItems([...list, item])
}

function removeEchartItem(index: number) {
  writeEchartItems(echartRows.value.filter((_, i) => i !== index))
}

function seedEchartItems(): EchartItem[] {
  if (!widget.value) return []
  return (echartItems(widget.value.props) ?? echartRows.value).map(cleanEchartItem)
}

function writeEchartTitle(title: string) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: { ...widget.value.props, items: seedEchartItems(), title },
  })
}

function writeGaugeRange(key: 'min' | 'max', value: number) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: { ...widget.value.props, items: seedEchartItems(), [key]: value },
  })
}

const alarmColumns = computed(() => alarmFieldsOf(widget.value?.props.columns))
const historyColumns = computed(() => alarmHistoryFieldsOf(widget.value?.props.columns))

const CONTENT_TYPES = new Set([
  'text',
  'button',
  'value',
  'switch',
  'list',
  'alarm',
  'alarmHistory',
  'chart',
  'trend',
  'trendHistory',
  'gauge',
  'pie',
  'bar',
  'tank',
  'lamp',
  'pump',
  'valve',
  'image',
  'scene3d',
  'echart',
])

const hasAppearance = computed(() => {
  const current = widget.value
  if (!current) return false
  return (
    current.style.fill !== undefined ||
    current.style.stroke !== undefined ||
    current.type === 'rect' ||
    current.type === 'roundRect'
  )
})

const hasContent = computed(() => {
  const current = widget.value
  if (!current) return false
  return CONTENT_TYPES.has(current.type) || current.props.text !== undefined
})

const sectionTitle = computed(() => {
  const names = ['basic', 'transform']
  if (hasAppearance.value) names.push('look')
  if (hasContent.value) names.push('content')
  names.push('anim')
  const labels: Record<string, string> = {
    basic: '基础',
    transform: '变换',
    look: '外观',
    content: '内容',
    anim: '动画连接',
  }
  const titled: Record<string, string> = {}
  names.forEach((name, index) => {
    titled[name] = `${index + 1} · ${labels[name]}`
  })
  return titled
})

function toggleAlarmColumn(id: AlarmFieldId, on: boolean) {
  const next = ALARM_FIELDS.map((field) => field.id).filter((fieldId) =>
    fieldId === id ? on : alarmColumns.value.includes(fieldId),
  )
  if (!next.length) return
  updateProp('columns', next)
}

function toggleHistoryColumn(id: AlarmHistoryFieldId, on: boolean) {
  const next = ALARM_HISTORY_FIELDS.map((field) => field.id).filter((fieldId) =>
    fieldId === id ? on : historyColumns.value.includes(fieldId),
  )
  if (!next.length) return
  updateProp('columns', next)
}

function updateName(name: string) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, { name })
}

function updateFlag(key: 'visible' | 'locked', value: boolean) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, { [key]: value })
}

function onNumber(key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number | undefined) {
  updateTransform(key, Number(value) || 0)
}

function remove() {
  if (multiCount.value > 1) {
    project.removeWidgets(project.selectedWidgetIds)
    return
  }
  if (!widget.value) return
  project.removeWidget(widget.value.id)
}

async function replaceImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !widget.value) return
  try {
    const resource = await project.addImageResource(file)
    project.updateWidget(widget.value.id, {
      name: resource.name,
      props: { resourceId: resource.id, src: project.getResourceUrl(resource.id) },
    })
    ElMessage.success('图片已更换')
  } catch {
    ElMessage.error('读取失败')
  }
}
</script>

<template>
  <div class="props">
    <div class="panel-title">属性</div>
    <div v-if="multiCount === 0" class="empty">选中画布上的图元</div>
    <div v-else-if="multiCount > 1" class="form">
      <div class="multi">已选中 {{ multiCount }} 个图元</div>
      <p class="hint">可用顶栏对齐/分布，或下方批量操作</p>
      <div class="batch-row">
        <el-button size="small" @click="project.setSelectedFlags('locked', true)">锁定</el-button>
        <el-button size="small" @click="project.setSelectedFlags('locked', false)">解锁</el-button>
        <el-button size="small" @click="project.setSelectedFlags('visible', true)">显示</el-button>
        <el-button size="small" @click="project.setSelectedFlags('visible', false)">隐藏</el-button>
      </div>
      <div class="batch-row">
        <el-button size="small" @click="project.duplicateWidgets(project.selectedWidgetIds)">
          复制副本
        </el-button>
        <el-button size="small" @click="project.groupSelected()">组合</el-button>
        <el-button size="small" type="danger" plain @click="remove">删除选中</el-button>
      </div>
    </div>
    <div v-else-if="widget" class="single">
      <p class="hint">按分类编辑当前图元</p>
      <el-collapse v-model="propCollapse" class="prop-collapse">
        <el-collapse-item :title="sectionTitle.basic" name="basic">
      <label>
        <span>名称</span>
        <el-input size="small" :model-value="widget.name" @update:model-value="updateName" />
      </label>
      <label>
        <span>类型</span>
        <el-input size="small" :model-value="widget.type" disabled />
      </label>
      <div class="flags">
        <el-checkbox
          :model-value="widget.visible !== false"
          @update:model-value="(v: boolean | string | number) => updateFlag('visible', Boolean(v))"
        >
          可见
        </el-checkbox>
        <el-checkbox
          :model-value="Boolean(widget.locked)"
          @update:model-value="(v: boolean | string | number) => updateFlag('locked', Boolean(v))"
        >
          锁定
        </el-checkbox>
      </div>
        </el-collapse-item>

        <el-collapse-item :title="sectionTitle.transform" name="transform">
      <div class="row">
        <label>
          <span>X</span>
          <el-input-number
            size="small"
            controls-position="right"
            :model-value="Math.round(widget.transform.x)"
            @update:model-value="(v: number | undefined) => onNumber('x', v)"
          />
        </label>
        <label>
          <span>Y</span>
          <el-input-number
            size="small"
            controls-position="right"
            :model-value="Math.round(widget.transform.y)"
            @update:model-value="(v: number | undefined) => onNumber('y', v)"
          />
        </label>
      </div>

      <div class="row">
        <label>
          <span>宽</span>
          <el-input-number
            size="small"
            controls-position="right"
            :min="1"
            :model-value="Math.round(widget.transform.width)"
            @update:model-value="(v: number | undefined) => onNumber('width', v)"
          />
        </label>
        <label>
          <span>高</span>
          <el-input-number
            size="small"
            controls-position="right"
            :min="0"
            :model-value="Math.round(widget.transform.height)"
            @update:model-value="(v: number | undefined) => onNumber('height', v)"
          />
        </label>
      </div>

      <label>
        <span>旋转</span>
        <el-input-number
          size="small"
          controls-position="right"
          :model-value="Math.round(widget.transform.rotation)"
          @update:model-value="(v: number | undefined) => onNumber('rotation', v)"
        />
      </label>

      <p v-if="widget.type === 'polyline' || widget.type === 'polygon' || widget.type === 'pipe'" class="hint">
        选中后拖动白色顶点可改折点
      </p>
        </el-collapse-item>

        <el-collapse-item v-if="hasAppearance" :title="sectionTitle.look" name="look">
      <label v-if="widget.type === 'text'">
        <span>文字颜色</span>
        <el-color-picker
          size="small"
          :model-value="String(widget.style.fill ?? '#e8eaed')"
          @update:model-value="(v: string | null) => v && updateStyle('fill', v)"
        />
      </label>
      <label v-if="widget.type === 'text'">
        <span>字号</span>
        <el-input-number
          size="small"
          controls-position="right"
          :min="1"
          :max="200"
          :model-value="Number(widget.style.fontSize ?? 20)"
          @update:model-value="(v: number | undefined) => updateStyle('fontSize', Math.max(1, Number(v) || 1))"
        />
      </label>

      <label v-if="widget.type !== 'text' && widget.style.fill !== undefined">
        <span>填充</span>
        <el-color-picker
          size="small"
          :model-value="String(widget.style.fill)"
          @update:model-value="(v: string | null) => v && updateStyle('fill', v)"
        />
      </label>

      <label v-if="widget.style.stroke !== undefined">
        <span>描边</span>
        <el-color-picker
          size="small"
          :model-value="String(widget.style.stroke)"
          @update:model-value="(v: string | null) => v && updateStyle('stroke', v)"
        />
      </label>

      <label v-if="widget.type === 'rect' || widget.type === 'roundRect'">
        <span>圆角</span>
        <el-input-number
          size="small"
          controls-position="right"
          :min="0"
          :max="200"
          :model-value="Number(widget.style.cornerRadius ?? 0)"
          @update:model-value="(v: number | undefined) => updateStyle('cornerRadius', Number(v) || 0)"
        />
      </label>
        </el-collapse-item>

        <el-collapse-item v-if="hasContent" :title="sectionTitle.content" name="content">
          <div class="content-summary">
            <el-button type="primary" size="small" style="width: 100%" @click="contentDialogOpen = true">
              内容配置…
            </el-button>
            <p class="hint">{{ contentSummary }}</p>
          </div>
        </el-collapse-item>

        <el-collapse-item :title="sectionTitle.anim" name="anim">
          <WidgetBindingPanel />
        </el-collapse-item>
      </el-collapse>

      <el-button size="small" type="danger" plain @click="remove">删除图元</el-button>

      <el-dialog
        v-model="contentDialogOpen"
        title="内容配置"
        width="640px"
        align-center
        destroy-on-close
        :close-on-click-modal="false"
      >
        <el-form
          v-if="widget"
          class="content-form"
          label-width="80px"
          label-position="right"
          size="small"
          @submit.prevent
        >
          <el-form-item
            v-if="widget.props.text !== undefined && widget.type !== 'list'"
            label="文本"
          >
            <el-input
              class="w-title"
              :model-value="String(widget.props.text)"
              @update:model-value="(v: string) => updateProp('text', v)"
            />
          </el-form-item>

          <template v-if="widget.type === 'value'">
            <el-form-item label="标签">
              <el-input
                class="w-text"
                :model-value="String(widget.props.label ?? '')"
                @update:model-value="(v: string) => updateProp('label', v)"
              />
            </el-form-item>
            <el-form-item label="数值">
              <el-input-number
                class="w-num"
                controls-position="right"
                :model-value="Number(widget.props.value ?? 0)"
                @update:model-value="(v: number | undefined) => updateProp('value', Number(v) || 0)"
              />
            </el-form-item>
            <el-form-item label="单位">
              <el-input
                class="w-unit"
                :model-value="String(widget.props.unit ?? '')"
                @update:model-value="(v: string) => updateProp('unit', v)"
              />
            </el-form-item>
          </template>

          <template v-if="widget.type === 'switch'">
            <el-form-item label="标签">
              <el-input
                class="w-text"
                :model-value="String(widget.props.label ?? '')"
                @update:model-value="(v: string) => updateProp('label', v)"
              />
            </el-form-item>
            <el-form-item label="状态">
              <el-checkbox
                :model-value="widget.props.on === true"
                @update:model-value="(v: boolean | string | number) => updateProp('on', Boolean(v))"
              >
                开启
              </el-checkbox>
            </el-form-item>
          </template>

          <template v-if="widget.type === 'list' || widget.type === 'alarm' || widget.type === 'alarmHistory'">
            <el-form-item label="标题">
              <el-input
                class="w-title"
                :model-value="String(widget.props.title ?? '')"
                @update:model-value="(v: string) => updateProp('title', v)"
              />
            </el-form-item>
            <el-form-item label="字号">
              <el-input-number
                class="w-num"
                :min="8"
                :max="72"
                controls-position="right"
                :model-value="Number(widget.style.fontSize ?? 12)"
                @update:model-value="(v: number | undefined) => updateStyle('fontSize', Number(v) || 12)"
              />
            </el-form-item>
            <el-form-item v-if="widget.type === 'alarm'" label="显示字段">
              <div class="inline-row">
                <el-checkbox
                  v-for="field in ALARM_FIELDS"
                  :key="field.id"
                  :model-value="alarmColumns.includes(field.id)"
                  @update:model-value="(v: boolean | string | number) => toggleAlarmColumn(field.id, Boolean(v))"
                >
                  {{ field.label }}
                </el-checkbox>
              </div>
            </el-form-item>
            <el-form-item v-if="widget.type === 'alarmHistory'" label="显示字段">
              <div class="inline-row">
                <el-checkbox
                  v-for="field in ALARM_HISTORY_FIELDS"
                  :key="field.id"
                  :model-value="historyColumns.includes(field.id)"
                  @update:model-value="(v: boolean | string | number) => toggleHistoryColumn(field.id, Boolean(v))"
                >
                  {{ field.label }}
                </el-checkbox>
              </div>
            </el-form-item>
            <el-form-item label="行数据">
              <el-input
                class="w-area"
                type="textarea"
                :rows="5"
                :placeholder="
                  widget.type === 'alarm'
                    ? '未连接时的示例。实时报警按上面的字段显示'
                    : widget.type === 'alarmHistory'
                      ? '未连接时的示例。历史报警按上面的字段显示最近一段时间的事件'
                      : '每行一项，列用 Tab 或 | 分隔'
                "
                :model-value="String(widget.props.items ?? '')"
                @update:model-value="(v: string) => updateProp('items', v)"
              />
            </el-form-item>
          </template>

          <template v-if="widget.type === 'chart' || widget.type === 'trend' || widget.type === 'trendHistory'">
            <section v-if="widget.type === 'trend' || widget.type === 'trendHistory'" class="config-block">
              <div class="section-title">
                曲线变量（最多 {{ TREND_MAX_CURVES }} 条）
                <HelpTip content="最多 8 条。每条选变量、颜色和图例名。没加变量时显示示例数据。历史曲线绑上变量后按时间范围读历史，不是实时值。" />
              </div>
              <div class="curve-list">
                <div v-for="(curve, i) in trendCurveList" :key="curve.tagId || `empty${i}`" class="curve-block">
                  <div class="curve-row">
                    <el-select
                      class="w-tag"
                      filterable
                      placeholder="选择变量"
                      :model-value="curve.tagId"
                      @update:model-value="(v: string) => setTrendCurveTag(curve.tagId, v)"
                    >
                      <el-option
                        v-for="item in tags.list"
                        :key="item.meta.tagId"
                        :label="formatTagOptionLabel(item.meta)"
                        :value="item.meta.tagId"
                      />
                    </el-select>
                    <el-color-picker
                      :model-value="curve.color || trendCurveColor(i)"
                      @update:model-value="(v: string | null) => setTrendCurve(curve.tagId, { color: v || trendCurveColor(i) })"
                    />
                    <el-input
                      class="w-legend"
                      placeholder="图例名"
                      :model-value="curve.label ?? ''"
                      @update:model-value="(v: string) => setTrendCurve(curve.tagId, { label: v })"
                    />
                    <el-button text type="danger" @click="removeTrendCurve(curve.tagId)">删除</el-button>
                  </div>
                </div>
                <div class="curve-actions">
                  <el-select
                    v-model="trendAddSelection"
                    class="w-add"
                    multiple
                    filterable
                    collapse-tags
                    collapse-tags-tooltip
                    placeholder="批量添加变量"
                    :disabled="trendCurveList.length >= TREND_MAX_CURVES"
                    @change="(v: string[]) => addTrendCurves(v)"
                  >
                    <el-option
                      v-for="item in tags.list"
                      :key="item.meta.tagId"
                      :label="formatTagOptionLabel(item.meta)"
                      :value="item.meta.tagId"
                      :disabled="trendCurveTagIds.has(item.meta.tagId)"
                    />
                  </el-select>
                  <el-button :disabled="trendCurveList.length >= TREND_MAX_CURVES" @click="addTrendCurve">
                    加一行
                  </el-button>
                  <el-button @click="exportTrendPng">导出图片</el-button>
                </div>
              </div>
              <p class="form-hint curve-hint">
                {{
                  trendCurveList.length
                    ? '每条曲线按自身数据自动缩放；可点图例、滚轮缩放、悬停读数。'
                    : '未添加变量时显示示例数据；添加后由动画连接 / 属性绑定提供实时值。'
                }}
              </p>
            </section>

            <section class="config-block">
            <div class="section-title">
              图表
              <HelpTip
                :content="
                  widget.type === 'trendHistory'
                    ? '图上的字号和标题，以及默认查询时间、采样方式和点数。'
                    : '图上的字号、标题和保留点数。'
                "
              />
            </div>
            <el-form-item v-if="widget.type === 'trend' || widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                图表字号
                <HelpTip content="留空按图元短边自动算，大约 14～22px。填写后刻度和图例用这个字号。" />
              </template>
              <el-input-number
                class="w-num"
                placeholder="自动"
                :max="48"
                controls-position="right"
                :model-value="Number(widget.props.chartFontSize) || undefined"
                @update:model-value="(v: number | undefined) => updateProp('chartFontSize', v == null ? undefined as never : Number(v))"
              />
            </el-form-item>
            <p v-if="widget.type === 'trend' || widget.type === 'trendHistory'" class="form-hint">
              留空 = 自动（图元短边 ÷ 10，14~22px）
            </p>

            <el-form-item v-if="widget.type === 'trend' || widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                堆叠
                <HelpTip content="把几条曲线的值加在一起画。液位、压力这种各看各的量不要勾。" />
              </template>
              <el-checkbox
                :model-value="widget.props.chartStack === true"
                @update:model-value="(v: boolean | string | number) => updateProp('chartStack', Boolean(v))"
              >
                堆叠显示（分量求和才勾选）
              </el-checkbox>
            </el-form-item>

            <el-form-item label-width="108px">
              <template #label>
                标题
                <HelpTip content="画在曲线图左上角的文字。" />
              </template>
              <el-input
                class="w-title"
                :model-value="String(widget.props.title ?? '')"
                @update:model-value="(v: string) => updateProp('title', v)"
              />
            </el-form-item>

            <el-form-item v-if="widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                时间范围
                <HelpTip content="打开后默认查的时间段。运行端工具栏改过的只在当次有效，不写回工程。" />
              </template>
              <el-select
                class="w-select"
                :model-value="String(widget.props.range ?? '-1h')"
                @update:model-value="(v: string) => updateProp('range', v)"
              >
                <el-option v-for="item in TREND_RANGES" :key="item.id" :label="item.label" :value="item.id" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                采样间隔
                <HelpTip content="这段历史怎么取样。自动按跨度和点数算窗口；原始点按真实记录取。选固定间隔时点数不再参与。运行端可临时改，不写回工程。" />
              </template>
              <el-select
                class="w-select"
                :model-value="String(widget.props.historyInterval ?? 'auto')"
                @update:model-value="(v: string) => updateProp('historyInterval', v)"
              >
                <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
              </el-select>
            </el-form-item>
            <p v-if="widget.type === 'trendHistory'" class="form-hint">默认间隔；运行端工具栏可临时改，不写回工程。</p>

            <el-form-item v-if="widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                工具栏
                <HelpTip content="显示图内工具栏：运行端图上能否看到时间和间隔。允许改时间区间：工具栏上能不能改查询时间。" />
              </template>
              <div class="inline-row">
                <el-checkbox
                  :model-value="widget.props.showToolbar !== false"
                  @update:model-value="(v: boolean | string | number) => updateProp('showToolbar', Boolean(v))"
                >
                  显示图内工具栏
                </el-checkbox>
                <el-checkbox
                  :model-value="widget.props.allowTimeEdit !== false"
                  @update:model-value="(v: boolean | string | number) => updateProp('allowTimeEdit', Boolean(v))"
                >
                  允许改时间区间
                </el-checkbox>
              </div>
            </el-form-item>

            <el-form-item v-if="widget.type === 'chart'" label="类型">
              <el-select
                class="w-select"
                :model-value="String(widget.props.chartType ?? 'line')"
                @update:model-value="(v: string) => updateProp('chartType', v)"
              >
                <el-option label="折线" value="line" />
                <el-option label="柱状" value="bar" />
              </el-select>
            </el-form-item>

            <el-form-item v-if="widget.type === 'chart'" label="序列">
              <el-input
                class="w-area"
                type="textarea"
                :rows="3"
                placeholder="逗号分隔，如 12,18,22"
                :model-value="String(widget.props.series ?? '')"
                @update:model-value="(v: string) => updateProp('series', v)"
              />
            </el-form-item>

            <el-form-item v-if="widget.type === 'chart'" label="量程">
              <div class="inline-row">
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :model-value="Number(widget.props.min ?? 0)"
                  @update:model-value="(v: number | undefined) => updateProp('min', Number(v) || 0)"
                />
                <span>~</span>
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :model-value="Number(widget.props.max ?? 100)"
                  @update:model-value="(v: number | undefined) => updateProp('max', Number(v) || 0)"
                />
              </div>
            </el-form-item>

            <el-form-item v-if="widget.type === 'trend' || widget.type === 'trendHistory'" label-width="108px">
              <template #label>
                点数
                <HelpTip
                  :content="
                    widget.type === 'trendHistory'
                      ? '间隔为自动时决定分桶粗细；为原始点时最多取这么多个点。选了固定间隔后不再参与查询。'
                      : '画面上保留最近多少个点。默认 40。'
                  "
                />
              </template>
              <el-input-number
                class="w-num"
                controls-position="right"
                :min="widget.type === 'trendHistory' ? 10 : 5"
                :max="widget.type === 'trendHistory' ? 2000 : 500"
                :model-value="Number(widget.props.maxPoints ?? (widget.type === 'trendHistory' ? 240 : 40))"
                @update:model-value="(v: number | undefined) => updateProp('maxPoints', Math.max(5, Number(v) || 40))"
              />
            </el-form-item>
            </section>
          </template>

          <template v-if="widget.type === 'echart'">
            <section class="config-block">
              <div class="section-title">
                {{ findEchartPreset(echartVariant)?.label ?? '图表' }}
                <HelpTip :content="echartContentHint(echartKind, echartVariant)" />
              </div>
              <el-form-item v-if="echartKind !== 'gauge'" label="标题">
                <el-input
                  class="w-title"
                  :model-value="String(widget.props.title ?? '')"
                  @update:model-value="(v: string) => writeEchartTitle(v)"
                />
              </el-form-item>
              <el-form-item v-if="echartHasAxis" label="轴字号">
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :min="ECHART_AXIS_FONT_MIN"
                  :max="ECHART_AXIS_FONT_MAX"
                  :model-value="echartAxisFont(widget.props)"
                  @update:model-value="
                    (v: number | undefined) =>
                      updateProp(
                        'axisFontSize',
                        Math.max(ECHART_AXIS_FONT_MIN, Math.min(ECHART_AXIS_FONT_MAX, Math.round(Number(v) || ECHART_AXIS_FONT_DEFAULT))),
                      )
                  "
                />
              </el-form-item>
              <template v-if="echartKind === 'gauge'">
                <el-form-item label="变量">
                  <el-select
                    class="w-tag"
                    filterable
                    clearable
                    placeholder="选择变量"
                    :model-value="echartRows[0]?.tagId || ''"
                    @update:model-value="(v: string) => setEchartTag(0, v, 'tagId')"
                  >
                    <el-option
                      v-for="item in tags.list"
                      :key="item.meta.tagId"
                      :label="formatTagOptionLabel(item.meta)"
                      :value="item.meta.tagId"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="量程">
                  <div class="inline-row">
                    <el-input-number
                      class="w-num"
                      controls-position="right"
                      :model-value="Number(widget.props.min ?? 0)"
                      @update:model-value="(v: number | undefined) => writeGaugeRange('min', Number(v) || 0)"
                    />
                    <span>~</span>
                    <el-input-number
                      class="w-num"
                      controls-position="right"
                      :model-value="Number(widget.props.max ?? 100)"
                      @update:model-value="(v: number | undefined) => writeGaugeRange('max', Number(v) || 0)"
                    />
                  </div>
                </el-form-item>
              </template>
              <div v-else class="curve-list">
                <div v-for="(row, i) in echartRows" :key="i" class="curve-block">
                  <div class="curve-row">
                    <el-input
                      v-if="echartKind === 'radar'"
                      class="w-legend"
                      placeholder="系列"
                      :model-value="row.series || ''"
                      @update:model-value="(v: string) => patchEchartItem(i, { series: v })"
                    />
                    <el-input
                      v-if="echartKind === 'sankey'"
                      class="w-legend"
                      placeholder="来源"
                      :model-value="row.label"
                      @update:model-value="(v: string) => patchEchartItem(i, { label: v })"
                    />
                    <el-input
                      v-else-if="echartKind !== 'pie' && echartKind !== 'category' && echartKind !== 'multi'"
                      class="w-legend"
                      :placeholder="echartKind === 'calendar' ? '日期' : echartKind === 'heatmap' ? '行' : echartKind === 'graph' ? '节点' : echartKind === 'map' || echartKind === 'flow' ? '地区' : echartKind === 'radar' ? '指标' : echartKind === 'scatter' ? '名称' : '类目'"
                      :model-value="row.label"
                      @update:model-value="(v: string) => patchEchartItem(i, { label: v })"
                    />
                    <el-input
                      v-if="echartKind === 'sankey' || echartKind === 'heatmap'"
                      class="w-legend"
                      :placeholder="echartKind === 'sankey' ? '去向' : '列'"
                      :model-value="row.series || ''"
                      @update:model-value="(v: string) => patchEchartItem(i, { series: v })"
                    />
                    <el-select
                      v-if="echartKind === 'scatter'"
                      class="w-tag"
                      filterable
                      clearable
                      placeholder="X 变量"
                      :model-value="row.xTagId || ''"
                      @update:model-value="(v: string) => setEchartTag(i, v, 'xTagId')"
                    >
                      <el-option
                        v-for="item in tags.list"
                        :key="item.meta.tagId"
                        :label="formatTagOptionLabel(item.meta)"
                        :value="item.meta.tagId"
                      />
                    </el-select>
                    <el-select
                      class="w-tag"
                      filterable
                      clearable
                      :placeholder="echartKind === 'scatter' ? 'Y 变量' : '选择变量'"
                      :model-value="row.tagId || ''"
                      @update:model-value="(v: string) => setEchartTag(i, v, 'tagId')"
                    >
                      <el-option
                        v-for="item in tags.list"
                        :key="'y' + item.meta.tagId"
                        :label="formatTagOptionLabel(item.meta)"
                        :value="item.meta.tagId"
                      />
                    </el-select>
                    <el-color-picker
                      v-if="echartKind === 'pie' || echartKind === 'category' || echartKind === 'multi' || echartKind === 'graph'"
                      :model-value="row.color || trendCurveColor(i)"
                      @update:model-value="(v: string | null) => patchEchartItem(i, { color: v || trendCurveColor(i) })"
                    />
                    <el-input
                      v-if="echartKind === 'pie'"
                      class="w-legend"
                      placeholder="图例名"
                      :model-value="row.label"
                      @update:model-value="(v: string) => patchEchartItem(i, { label: v })"
                    />
                    <el-button text type="danger" @click="removeEchartItem(i)">删除</el-button>
                  </div>
                </div>
                <div class="curve-actions">
                  <el-button :disabled="echartRows.length >= echartItemMax(echartKind)" @click="addEchartItem">加一项</el-button>
                </div>
              </div>
            </section>
          </template>

          <template v-if="widget.type === 'pie' || widget.type === 'bar'">
            <section class="config-block">
              <div class="section-title">
                {{ widget.type === 'pie' ? '扇区' : '柱子' }}（最多 {{ CHART_SLICE_MAX }} 项）
                <HelpTip content="每项选一个变量。图例名默认用变量名，可以改。运行和实时预览用变量当前值，小数位跟变量走。负数不占扇区，柱高也按 0 画。" />
              </div>
              <div class="curve-list">
                <div v-for="(slice, i) in sliceList" :key="i" class="curve-block">
                  <div class="curve-row">
                    <el-select
                      class="w-tag"
                      filterable
                      clearable
                      placeholder="选择变量"
                      :model-value="slice.tagId || ''"
                      @update:model-value="(v: string) => setSliceTag(i, v)"
                    >
                      <el-option
                        v-for="item in tags.list"
                        :key="item.meta.tagId"
                        :label="formatTagOptionLabel(item.meta)"
                        :value="item.meta.tagId"
                      />
                    </el-select>
                    <el-color-picker
                      :model-value="slice.color || trendCurveColor(i)"
                      @update:model-value="(v: string | null) => patchSlice(i, { color: v || trendCurveColor(i) })"
                    />
                    <el-input
                      class="w-legend"
                      placeholder="图例名"
                      :model-value="slice.label"
                      @update:model-value="(v: string) => patchSlice(i, { label: v })"
                    />
                    <el-button text type="danger" @click="removeSlice(i)">删除</el-button>
                  </div>
                </div>
                <div class="curve-actions">
                  <el-button :disabled="sliceList.length >= CHART_SLICE_MAX" @click="addSlice">加一项</el-button>
                </div>
              </div>
            </section>
            <section class="config-block">
              <div class="section-title">图表</div>
              <el-form-item label="标题">
                <el-input
                  class="w-title"
                  :model-value="String(widget.props.title ?? '')"
                  @update:model-value="(v: string) => updateProp('title', v)"
                />
              </el-form-item>
              <el-form-item v-if="widget.type === 'bar'" label-width="108px">
                <template #label>
                  柱宽
                  <HelpTip content="每根柱的宽度，单位像素。图元太窄时会自动收窄，避免柱子叠在一起。" />
                </template>
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :min="BAR_WIDTH_MIN"
                  :max="BAR_WIDTH_MAX"
                  :model-value="barWidthOf(widget.props)"
                  @update:model-value="
                    (v: number | undefined) =>
                      updateProp(
                        'barWidth',
                        Math.max(BAR_WIDTH_MIN, Math.min(BAR_WIDTH_MAX, Math.round(Number(v) || BAR_WIDTH_DEFAULT))),
                      )
                  "
                />
              </el-form-item>
            </section>
          </template>

          <template v-if="widget.type === 'gauge'">
            <el-form-item label="标签">
              <el-input
                class="w-text"
                :model-value="String(widget.props.label ?? '')"
                @update:model-value="(v: string) => updateProp('label', v)"
              />
            </el-form-item>
            <el-form-item label="数值">
              <el-slider
                class="w-slider"
                :model-value="Number(widget.props.value ?? 0)"
                :min="Number(widget.props.min ?? 0)"
                :max="Number(widget.props.max ?? 100)"
                @update:model-value="(v: number) => updateProp('value', v)"
              />
            </el-form-item>
            <el-form-item label="单位">
              <el-input
                class="w-unit"
                :model-value="String(widget.props.unit ?? '')"
                @update:model-value="(v: string) => updateProp('unit', v)"
              />
            </el-form-item>
            <el-form-item label="量程">
              <div class="inline-row">
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :model-value="Number(widget.props.min ?? 0)"
                  @update:model-value="(v: number | undefined) => updateProp('min', Number(v) || 0)"
                />
                <span>~</span>
                <el-input-number
                  class="w-num"
                  controls-position="right"
                  :model-value="Number(widget.props.max ?? 100)"
                  @update:model-value="(v: number | undefined) => updateProp('max', Number(v) || 0)"
                />
              </div>
            </el-form-item>
          </template>

          <el-form-item v-if="widget.type === 'tank'" label="液位 %">
            <el-slider
              class="w-slider"
              :model-value="Number(widget.props.level ?? 60)"
              :min="0"
              :max="100"
              @update:model-value="(v: number) => updateProp('level', v)"
            />
          </el-form-item>

          <el-form-item v-if="widget.type === 'lamp'" label="状态">
            <el-checkbox
              :model-value="widget.props.on !== false"
              @update:model-value="(v: boolean | string | number) => updateProp('on', Boolean(v))"
            >
              点亮
            </el-checkbox>
          </el-form-item>

          <el-form-item v-if="widget.type === 'pump'" label="状态">
            <el-checkbox
              :model-value="Boolean(widget.props.running)"
              @update:model-value="(v: boolean | string | number) => updateProp('running', Boolean(v))"
            >
              运行
            </el-checkbox>
          </el-form-item>

          <el-form-item v-if="widget.type === 'valve'" label="状态">
            <el-checkbox
              :model-value="widget.props.open !== false"
              @update:model-value="(v: boolean | string | number) => updateProp('open', Boolean(v))"
            >
              开启
            </el-checkbox>
          </el-form-item>

          <el-form-item v-if="widget.type === 'image'" label="图片">
            <input
              ref="fileInput"
              type="file"
              accept="image/*,.svg"
              class="hidden"
              @change="replaceImage"
            />
            <el-button @click="fileInput?.click()">更换图片</el-button>
          </el-form-item>

          <template v-if="widget.type === 'scene3d'">
            <el-form-item label="三维页面">
              <el-select
                class="w-title"
                :model-value="String(widget.props.page3dId || '')"
                clearable
                filterable
                placeholder="选择已制作的 3D 页面"
                @update:model-value="(v: string | null | undefined) => updateProp('page3dId', v || '')"
              >
                <el-option
                  v-for="p in pages3d"
                  :key="p.id"
                  :label="p.name"
                  :value="p.id"
                />
              </el-select>
            </el-form-item>
            <p v-if="!pages3d.length" class="form-hint">工程中尚无三维页面，请先新建 3D 页</p>
            <el-form-item label="交互">
              <el-checkbox
                :model-value="widget.props.interactive !== false"
                @update:model-value="(v: boolean | string | number) => updateProp('interactive', Boolean(v))"
              >
                运行时可交互
              </el-checkbox>
            </el-form-item>
          </template>
        </el-form>
        <template #footer>
          <el-button type="primary" @click="contentDialogOpen = false">确定</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped>
.panel-title {
  margin: 8px 0;
  font-size: 12px;
  color: var(--scada-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.empty,
.hint {
  color: var(--scada-muted);
  font-size: 13px;
}

.multi {
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form label,
.prop-collapse label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--scada-muted);
}

.curve-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.curve-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 26px 80px 40px;
  gap: 6px;
  align-items: center;
}

.curve-row :deep(.el-select),
.curve-row :deep(.el-input) {
  width: 100%;
}

/* 变量行 + 它自己的"显示格式"行成一块 */
.curve-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 2px;
}

.curve-row .curve-name {
  overflow: hidden;
  color: var(--scada-muted, #8b93a7);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.curve-list .curve-row:nth-child(even) {
  /* 变量行与格式行成对出现，这里不额外加间距 */
}

.curve-add {
  width: 100%;
}

label.top :deep(.el-textarea__inner) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.flags,
.image-actions,
.batch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.field-label {
  width: 100%;
  font-size: 12px;
  color: var(--scada-muted);
}

.hidden {
  display: none;
}

.form :deep(.el-input-number),
.prop-collapse :deep(.el-input-number) {
  width: 100%;
}

.tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.tabs :deep(.el-tabs__item) {
  font-size: 12px;
  padding: 0 10px;
  height: 32px;
}

.prop-collapse {
  border: none;
  --el-collapse-header-height: 36px;
}

.prop-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  color: var(--scada-text);
  font-size: 12px;
  font-weight: 600;
  border-bottom-color: var(--scada-border);
  letter-spacing: 0.02em;
}

.prop-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom-color: var(--scada-border);
}

.prop-collapse :deep(.el-collapse-item__content) {
  padding: 8px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.single > .el-button {
  margin-top: 10px;
}

.content-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.content-form {
  max-height: min(72vh, 680px);
  overflow: auto;
  padding: 4px 8px 8px 0;
}

.content-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.content-form :deep(.el-form-item__label) {
  align-items: center;
  color: var(--scada-muted);
  white-space: nowrap;
}

.content-form :deep(.w-text) {
  width: 240px;
}

.content-form :deep(.w-title) {
  width: 280px;
}

.content-form :deep(.w-num) {
  width: 120px;
}

.content-form :deep(.w-select) {
  width: 160px;
}

.content-form :deep(.w-tag) {
  width: 220px;
}

.content-form :deep(.w-legend) {
  width: 100px;
}

.content-form :deep(.w-unit) {
  width: 72px;
}

.content-form :deep(.w-dec) {
  width: 96px;
}

.content-form :deep(.w-add) {
  width: 280px;
}

.content-form :deep(.w-area) {
  width: 100%;
  max-width: 480px;
}

.content-form :deep(.w-slider) {
  width: 240px;
}

.content-form .form-hint {
  margin: -4px 0 10px 80px;
  font-size: 12px;
  color: var(--scada-muted);
  line-height: 1.45;
}

.content-form .inline-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
}

.content-form .curve-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.content-form .curve-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.content-form .curve-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.content-form .curve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.content-form .config-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.content-form .config-block .form-hint {
  margin: 0;
}

.content-form .config-block :deep(.el-form-item) {
  margin-bottom: 0;
}

.content-form .section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--scada-text);
}
</style>
