<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Page3D } from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { ElMessage } from 'element-plus'
import WidgetBindingPanel from '@/components/designer/WidgetBindingPanel.vue'

const project = useProjectStore()
const fileInput = ref<HTMLInputElement | null>(null)
const activeTab = ref('props')

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

function updateProp(key: string, value: string | number | boolean) {
  if (!widget.value) return
  project.updateWidget(widget.value.id, {
    props: { ...widget.value.props, [key]: value },
  })
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
      <el-tabs v-model="activeTab" class="tabs">
        <el-tab-pane label="属性" name="props">
          <div class="form">
      <label>
        <span>名称</span>
        <el-input size="small" :model-value="widget.name" @update:model-value="updateName" />
      </label>
      <label>
        <span>类型</span>
        <el-input size="small" :model-value="widget.type" disabled />
      </label>

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

      <template v-if="widget.type === 'list' || widget.type === 'alarm'">
        <label>
          <span>标题</span>
          <el-input
            size="small"
            :model-value="String(widget.props.title ?? '')"
            @update:model-value="(v: string) => updateProp('title', v)"
          />
        </label>
        <label class="top">
          <span>行数据</span>
          <el-input
            type="textarea"
            :rows="5"
            size="small"
            placeholder="每行一项，列用 Tab 或 | 分隔"
            :model-value="String(widget.props.items ?? '')"
            @update:model-value="(v: string) => updateProp('items', v)"
          />
        </label>
      </template>

      <template v-if="widget.type === 'chart' || widget.type === 'trend'">
        <label>
          <span>标题</span>
          <el-input
            size="small"
            :model-value="String(widget.props.title ?? '')"
            @update:model-value="(v: string) => updateProp('title', v)"
          />
        </label>
        <label>
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
            placeholder="逗号分隔，如 12,18,22"
            :model-value="String(widget.props.series ?? '')"
            @update:model-value="(v: string) => updateProp('series', v)"
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
        <label v-if="widget.type === 'trend'">
          <span>点数</span>
          <el-input-number
            size="small"
            controls-position="right"
            :min="5"
            :max="500"
            :model-value="Number(widget.props.maxPoints ?? 40)"
            @update:model-value="(v: number | undefined) => updateProp('maxPoints', Math.max(5, Number(v) || 40))"
          />
        </label>
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

      <el-button size="small" type="danger" plain @click="remove">删除图元</el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="动画连接" name="binding">
          <WidgetBindingPanel />
        </el-tab-pane>
      </el-tabs>
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

.form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--scada-muted);
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
</style>
