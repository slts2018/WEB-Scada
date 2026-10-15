<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  TREND_MAX_CURVES,
  trendCurveColor,
  trendCurves,
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
import { TREND_INTERVALS, TREND_RANGES, releaseTrendHistory } from '@/shared/runtime/trendHistoryQuery'
import { clearCurveSamples } from '@/shared/runtime/trendSeries'
import { exportTrendWidgetImage } from '@/shared/konva/widgetNodes'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'
import { ElMessage } from 'element-plus'
import WidgetBindingPanel from '@/components/designer/WidgetBindingPanel.vue'

const project = useProjectStore()
const tags = useTagStore()
const fileInput = ref<HTMLInputElement | null>(null)
/** 与三维属性一致：默认全部折叠，点标题再展开 */
const propCollapse = ref<string[]>([])

const widget = computed(() => project.selectedWidget)
const multiCount = computed(() => project.selectedWidgetIds.length)
const pages3d = computed(() => project.document.pages.filter((p): p is Page3D => p.type === '3d'))

function updateTransform(key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    transform: { ...widget.value.transform, [key]: value },
  })
}

function updateStyle(key: string, value: string | number) {
  if (!widget.value) return
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
  'tank',
  'lamp',
  'pump',
  'valve',
  'image',
  'scene3d',
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
      <label v-if="widget.style.fill !== undefined">
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
      <label v-if="widget.props.text !== undefined && widget.type !== 'list'">
        <span>文本</span>
        <el-input
          size="small"
          :model-value="String(widget.props.text)"
          @update:model-value="(v: string) => updateProp('text', v)"
        />
      </label>

      <template v-if="widget.type === 'value'">
        <label>
          <span>标签</span>
          <el-input
            size="small"
            :model-value="String(widget.props.label ?? '')"
            @update:model-value="(v: string) => updateProp('label', v)"
          />
        </label>
        <label>
          <span>数值</span>
          <el-input-number
            size="small"
            controls-position="right"
            :model-value="Number(widget.props.value ?? 0)"
            @update:model-value="(v: number | undefined) => updateProp('value', Number(v) || 0)"
          />
        </label>
        <label>
          <span>单位</span>
          <el-input
            size="small"
            :model-value="String(widget.props.unit ?? '')"
            @update:model-value="(v: string) => updateProp('unit', v)"
          />
        </label>
        <label>
          <span>小数位</span>
          <el-input-number
            size="small"
            :min="0"
            :max="6"
            controls-position="right"
            :model-value="Number(widget.props.decimals ?? 1)"
            @update:model-value="(v: number | undefined) => updateProp('decimals', Number(v) || 0)"
          />
        </label>
      </template>

      <template v-if="widget.type === 'switch'">
        <label>
          <span>标签</span>
          <el-input
            size="small"
            :model-value="String(widget.props.label ?? '')"
            @update:model-value="(v: string) => updateProp('label', v)"
          />
        </label>
        <div class="flags">
          <el-checkbox
            :model-value="widget.props.on === true"
            @update:model-value="(v: boolean | string | number) => updateProp('on', Boolean(v))"
          >
            开启
          </el-checkbox>
        </div>
      </template>

      <template v-if="widget.type === 'list' || widget.type === 'alarm' || widget.type === 'alarmHistory'">
        <label>
          <span>标题</span>
          <el-input
            size="small"
            :model-value="String(widget.props.title ?? '')"
            @update:model-value="(v: string) => updateProp('title', v)"
          />
        </label>
        <label>
          <span>字号</span>
          <el-input-number
            size="small"
            :min="8"
            :max="72"
            controls-position="right"
            :model-value="Number(widget.style.fontSize ?? 12)"
            @update:model-value="(v: number | undefined) => updateStyle('fontSize', Number(v) || 12)"
          />
        </label>
        <div v-if="widget.type === 'alarm'" class="flags">
          <span class="field-label">显示字段</span>
          <el-checkbox
            v-for="field in ALARM_FIELDS"
            :key="field.id"
            :model-value="alarmColumns.includes(field.id)"
            @update:model-value="(v: boolean | string | number) => toggleAlarmColumn(field.id, Boolean(v))"
          >
            {{ field.label }}
          </el-checkbox>
        </div>
        <div v-if="widget.type === 'alarmHistory'" class="flags">
          <span class="field-label">显示字段</span>
          <el-checkbox
            v-for="field in ALARM_HISTORY_FIELDS"
            :key="field.id"
            :model-value="historyColumns.includes(field.id)"
            @update:model-value="(v: boolean | string | number) => toggleHistoryColumn(field.id, Boolean(v))"
          >
            {{ field.label }}
          </el-checkbox>
        </div>
        <label class="top">
          <span>行数据</span>
          <el-input
            type="textarea"
            :rows="5"
            size="small"
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
        </label>
      </template>

      <template v-if="widget.type === 'chart' || widget.type === 'trend' || widget.type === 'trendHistory'">
        <label v-if="widget.type === 'trend' || widget.type === 'trendHistory'" class="top">
          <span>曲线变量（最多 {{ TREND_MAX_CURVES }} 条）</span>
          <div class="curve-list">
            <div v-for="(curve, i) in trendCurveList" :key="curve.tagId" class="curve-row">
              <el-select
                size="small"
                filterable
                placeholder="选择变量"
                :model-value="curve.tagId"
                @update:model-value="(v: string) => setTrendCurveTag(curve.tagId, v)"
              >
                <el-option
                  v-for="item in tags.list"
                  :key="item.meta.tagId"
                  :label="formatTagOptionLabel(item.meta, item.value?.quality)"
                  :value="item.meta.tagId"
                />
              </el-select>
              <el-color-picker
                size="small"
                :model-value="curve.color || trendCurveColor(i)"
                @update:model-value="(v: string | null) => setTrendCurve(curve.tagId, { color: v || trendCurveColor(i) })"
              />
              <el-input
                size="small"
                placeholder="图例名"
                :model-value="curve.label ?? ''"
                @update:model-value="(v: string) => setTrendCurve(curve.tagId, { label: v })"
              />
              <el-button size="small" text type="danger" @click="removeTrendCurve(curve.tagId)">
                删除
              </el-button>
            </div>
            <el-select
              v-model="trendAddSelection"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              size="small"
              class="curve-add"
              placeholder="批量添加变量（可搜索 / 多选）"
              :disabled="trendCurveList.length >= TREND_MAX_CURVES"
              @change="(v: string[]) => addTrendCurves(v)"
            >
              <el-option
                v-for="item in tags.list"
                :key="item.meta.tagId"
                :label="formatTagOptionLabel(item.meta, item.value?.quality)"
                :value="item.meta.tagId"
                :disabled="trendCurveTagIds.has(item.meta.tagId)"
              />
            </el-select>
            <el-button
              size="small"
              :disabled="trendCurveList.length >= TREND_MAX_CURVES"
              @click="addTrendCurve"
            >
              加一行空变量
            </el-button>
            <el-button size="small" @click="exportTrendPng">导出图片</el-button>
          </div>
        </label>
        <p v-if="widget.type === 'trend' || widget.type === 'trendHistory'" class="hint">
          {{
            trendCurveList.length
              ? '每条曲线按自身数据自动缩放。图元直接用 ECharts：实时预览和运行时可点图例、滚轮缩放、悬停读数、导出图片。'
              : '未添加变量时显示下面的示例数据；添加变量后由动画连接 / 属性绑定提供实时值。'
          }}
        </p>
        <label v-if="widget.type === 'trend' || widget.type === 'trendHistory'">
          <span>图表字号</span>
          <el-input-number
            size="small"
            placeholder="自动（随图元大小）"
            :max="48"
            controls-position="right"
            :model-value="Number(widget.props.chartFontSize) || undefined"
            @update:model-value="(v: number | undefined) => updateProp('chartFontSize', v == null ? undefined as never : Number(v))"
          />
        </label>
        <p v-if="widget.type === 'trend' || widget.type === 'trendHistory'" class="hint">
          留空 = 自动（图元短边 ÷ 10，14~22px）；坐标轴、图例、标题都按这个字号排。
        </p>
        <el-checkbox
          v-if="widget.type === 'trend' || widget.type === 'trendHistory'"
          :model-value="widget.props.chartStack === true"
          @update:model-value="(v: boolean | string | number) => updateProp('chartStack', Boolean(v))"
        >
          堆叠显示（Stacked Line：各曲线累加）
        </el-checkbox>
        <p
          v-if="(widget.type === 'trend' || widget.type === 'trendHistory') && widget.props.chartStack === true"
          class="hint"
        >
          堆叠会把各曲线**累加**成一条总量线：只适合分量求和（能耗构成 / 班次产量 / 计数）；
          液位、压力、温度这类工程值请保持"叠加"（取消勾选）。
        </p>
        <label>
          <span>标题</span>
          <el-input
            size="small"
            :model-value="String(widget.props.title ?? '')"
            @update:model-value="(v: string) => updateProp('title', v)"
          />
        </label>
        <label v-if="widget.type === 'trendHistory'">
          <span>时间范围</span>
          <el-select
            size="small"
            :model-value="String(widget.props.range ?? '-1h')"
            @update:model-value="(v: string) => updateProp('range', v)"
          >
            <el-option v-for="item in TREND_RANGES" :key="item.id" :label="item.label" :value="item.id" />
          </el-select>
        </label>
        <label v-if="widget.type === 'trendHistory'">
          <span>采样间隔</span>
          <el-select
            size="small"
            :model-value="String(widget.props.historyInterval ?? 'auto')"
            @update:model-value="(v: string) => updateProp('historyInterval', v)"
          >
            <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
          </el-select>
        </label>
        <p v-if="widget.type === 'trendHistory'" class="hint">
          该间隔是默认值；运行端工具栏可以临时改（不写回工程）。
        </p>
        <el-checkbox
          v-if="widget.type === 'trendHistory'"
          :model-value="widget.props.showToolbar !== false"
          @update:model-value="(v: boolean | string | number) => updateProp('showToolbar', Boolean(v))"
        >
          显示图内工具栏（区间 / 缩放 / 跟随 / 导出）
        </el-checkbox>
        <el-checkbox
          v-if="widget.type === 'trendHistory'"
          :model-value="widget.props.allowTimeEdit !== false"
          @update:model-value="(v: boolean | string | number) => updateProp('allowTimeEdit', Boolean(v))"
        >
          允许运行端改时间区间（取消 = 发布端只能看，能刷新/导出）
        </el-checkbox>
        <label v-if="widget.type !== 'trendHistory'">
          <span>类型</span>
          <el-select
            size="small"
            :model-value="String(widget.props.chartType ?? 'line')"
            @update:model-value="(v: string) => updateProp('chartType', v)"
          >
            <el-option label="折线" value="line" />
            <el-option label="柱状" value="bar" />
          </el-select>
        </label>
        <label class="top">
          <span>序列</span>
          <el-input
            type="textarea"
            :rows="3"
            size="small"
            :placeholder="
              widget.type === 'trendHistory'
                ? '未连接时的示例。绑定变量后按时间范围读取历史'
                : '逗号分隔，如 12,18,22'
            "
            :model-value="String(widget.props.series ?? '')"
            @update:model-value="(v: string) => updateProp('series', v)"
          />
        </label>
        <div v-if="!trendCurveList.length" class="row">
          <label>
            <span>最小</span>
            <el-input-number
              size="small"
              controls-position="right"
              :model-value="Number(widget.props.min ?? 0)"
              @update:model-value="(v: number | undefined) => updateProp('min', Number(v) || 0)"
            />
          </label>
          <label>
            <span>最大</span>
            <el-input-number
              size="small"
              controls-position="right"
              :model-value="Number(widget.props.max ?? 100)"
              @update:model-value="(v: number | undefined) => updateProp('max', Number(v) || 0)"
            />
          </label>
        </div>
        <label v-if="widget.type === 'trend' || widget.type === 'trendHistory'">
          <span>点数</span>
          <el-input-number
            size="small"
            controls-position="right"
            :min="widget.type === 'trendHistory' ? 10 : 5"
            :max="widget.type === 'trendHistory' ? 2000 : 500"
            :model-value="Number(widget.props.maxPoints ?? (widget.type === 'trendHistory' ? 240 : 40))"
            @update:model-value="(v: number | undefined) => updateProp('maxPoints', Math.max(5, Number(v) || 40))"
          />
        </label>
        <p v-if="widget.type === 'trendHistory'" class="hint">
          用动画连接把变量接到数值输出。运行和实时预览会按时间范围读取该变量的历史曲线。
        </p>
      </template>

      <template v-if="widget.type === 'gauge'">
        <label>
          <span>标签</span>
          <el-input
            size="small"
            :model-value="String(widget.props.label ?? '')"
            @update:model-value="(v: string) => updateProp('label', v)"
          />
        </label>
        <label>
          <span>数值</span>
          <el-slider
            :model-value="Number(widget.props.value ?? 0)"
            :min="Number(widget.props.min ?? 0)"
            :max="Number(widget.props.max ?? 100)"
            @update:model-value="(v: number) => updateProp('value', v)"
          />
        </label>
        <label>
          <span>单位</span>
          <el-input
            size="small"
            :model-value="String(widget.props.unit ?? '')"
            @update:model-value="(v: string) => updateProp('unit', v)"
          />
        </label>
        <div class="row">
          <label>
            <span>最小</span>
            <el-input-number
              size="small"
              controls-position="right"
              :model-value="Number(widget.props.min ?? 0)"
              @update:model-value="(v: number | undefined) => updateProp('min', Number(v) || 0)"
            />
          </label>
          <label>
            <span>最大</span>
            <el-input-number
              size="small"
              controls-position="right"
              :model-value="Number(widget.props.max ?? 100)"
              @update:model-value="(v: number | undefined) => updateProp('max', Number(v) || 0)"
            />
          </label>
        </div>
      </template>

      <label v-if="widget.type === 'tank'">
        <span>液位 %</span>
        <el-slider
          :model-value="Number(widget.props.level ?? 60)"
          :min="0"
          :max="100"
          @update:model-value="(v: number) => updateProp('level', v)"
        />
      </label>

      <div v-if="widget.type === 'lamp'" class="flags">
        <el-checkbox
          :model-value="widget.props.on !== false"
          @update:model-value="(v: boolean | string | number) => updateProp('on', Boolean(v))"
        >
          点亮
        </el-checkbox>
      </div>

      <div v-if="widget.type === 'pump'" class="flags">
        <el-checkbox
          :model-value="Boolean(widget.props.running)"
          @update:model-value="(v: boolean | string | number) => updateProp('running', Boolean(v))"
        >
          运行
        </el-checkbox>
      </div>

      <div v-if="widget.type === 'valve'" class="flags">
        <el-checkbox
          :model-value="widget.props.open !== false"
          @update:model-value="(v: boolean | string | number) => updateProp('open', Boolean(v))"
        >
          开启
        </el-checkbox>
      </div>

      <div v-if="widget.type === 'image'" class="image-actions">
        <input
          ref="fileInput"
          type="file"
          accept="image/*,.svg"
          class="hidden"
          @change="replaceImage"
        />
        <el-button size="small" @click="fileInput?.click()">更换图片</el-button>
      </div>

      <template v-if="widget.type === 'scene3d'">
        <label>
          三维页面
          <el-select
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
        </label>
        <p v-if="!pages3d.length" class="hint">工程中尚无三维页面，请先新建 3D 页</p>
        <div class="flags">
          <el-checkbox
            :model-value="widget.props.interactive !== false"
            @update:model-value="(v: boolean | string | number) => updateProp('interactive', Boolean(v))"
          >
            运行时可交互
          </el-checkbox>
        </div>
      </template>

        </el-collapse-item>

        <el-collapse-item :title="sectionTitle.anim" name="anim">
          <WidgetBindingPanel />
        </el-collapse-item>
      </el-collapse>

      <el-button size="small" type="danger" plain @click="remove">删除图元</el-button>
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

:deep(.el-input-number) {
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
</style>
