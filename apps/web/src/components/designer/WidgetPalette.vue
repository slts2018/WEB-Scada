<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BUILTIN_WIDGETS,
  isDrawToolType,
  type BuiltinWidgetType,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { ElMessage } from 'element-plus'

const DND_TYPE = 'application/x-scada-widget'

const project = useProjectStore()
const fileInput = ref<HTMLInputElement | null>(null)
const activeTab = ref<'basic' | 'data' | 'industrial' | 'media' | 'symbol'>('basic')

const basic = computed(() => BUILTIN_WIDGETS.filter((i) => i.group === 'basic'))
const data = computed(() => BUILTIN_WIDGETS.filter((i) => i.group === 'data'))
const industrial = computed(() => BUILTIN_WIDGETS.filter((i) => i.group === 'industrial'))
const media = computed(() => BUILTIN_WIDGETS.filter((i) => i.group === 'media'))
const symbols = computed(() => project.document.symbols ?? [])

function add(type: BuiltinWidgetType) {
  if (!project.activePage2d) {
    ElMessage.warning('请先选择 2D 页面')
    return
  }
  if (type === 'image') {
    fileInput.value?.click()
    return
  }
  if (isDrawToolType(type)) {
    project.startDrawTool(type)
    const tip =
      type === 'polyline'
        ? '折线：单击加点，双击或 Enter 完成，Esc 取消'
        : type === 'polygon'
          ? '多边形：单击加点，双击或 Enter 完成，Esc 取消'
          : '管线：单击加点，双击或 Enter 完成，Esc 取消'
    ElMessage.info(tip)
    return
  }
  const w = project.addWidget(type)
  if (!w) ElMessage.warning('当前图层已锁定，请切换图层')
}

function placeSymbol(id: string) {
  if (!project.activePage2d) {
    ElMessage.warning('请先选择 2D 页面')
    return
  }
  const w = project.placeSymbol(id)
  if (!w) ElMessage.warning('放置失败（图层可能已锁定）')
  else ElMessage.success('已放置符号')
}

function removeSymbol(id: string) {
  project.removeSymbol(id)
}

function onDragStart(e: DragEvent, type: BuiltinWidgetType) {
  if (type === 'image' || isDrawToolType(type)) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData(DND_TYPE, type)
  e.dataTransfer!.effectAllowed = 'copy'
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    await project.addImageWidgetFromFile(file)
    ElMessage.success('已添加图片图元')
  } catch {
    ElMessage.error('图片读取失败')
  }
}
</script>

<template>
  <div class="palette">
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.svg"
      class="hidden"
      @change="onFileChange"
    />

    <p class="hint">拖到画布放置，或点击居中添加</p>

    <el-tabs v-model="activeTab" class="tabs" stretch>
      <el-tab-pane label="基础" name="basic">
        <div class="grid">
          <button
            v-for="item in basic"
            :key="item.type"
            type="button"
            class="item"
            :class="{ 'active-tool': project.drawTool === item.type }"
            draggable="true"
            :title="item.description"
            @click="add(item.type)"
            @dragstart="onDragStart($event, item.type)"
          >
            <span class="icon" :data-type="item.type" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </el-tab-pane>
      <el-tab-pane label="数据" name="data">
        <div class="grid">
          <button
            v-for="item in data"
            :key="item.type"
            type="button"
            class="item"
            draggable="true"
            :title="item.description"
            @click="add(item.type)"
            @dragstart="onDragStart($event, item.type)"
          >
            <span class="icon" :data-type="item.type" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </el-tab-pane>
      <el-tab-pane label="工业" name="industrial">
        <div class="grid">
          <button
            v-for="item in industrial"
            :key="item.type"
            type="button"
            class="item"
            :class="{ 'active-tool': project.drawTool === item.type }"
            draggable="true"
            :title="item.description"
            @click="add(item.type)"
            @dragstart="onDragStart($event, item.type)"
          >
            <span class="icon" :data-type="item.type" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </el-tab-pane>
      <el-tab-pane label="符号" name="symbol">
        <p class="hint">选中图元后用顶栏「存为符号」保存；此处点击放置</p>
        <div v-if="!symbols.length" class="empty">暂无符号</div>
        <div v-else class="grid">
          <div v-for="sym in symbols" :key="sym.id" class="symbol-card">
            <button type="button" class="item" :title="sym.name" @click="placeSymbol(sym.id)">
              <span class="icon symbol" />
              <span>{{ sym.name }}</span>
            </button>
            <button type="button" class="del" title="删除符号" @click="removeSymbol(sym.id)">×</button>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="资源" name="media">
        <div class="grid">
          <button
            v-for="item in media"
            :key="item.type"
            type="button"
            class="item"
            :title="item.description"
            @click="add(item.type)"
          >
            <span class="icon" :data-type="item.type" />
            <span>{{ item.label }}</span>
          </button>
        </div>
        <el-button size="small" class="full" @click="add('image')">上传图片 / SVG</el-button>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.palette {
  margin: 0;
}

.hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--scada-muted);
}

.hidden {
  display: none;
}

.tabs :deep(.el-tabs__header) {
  margin: 0 0 8px;
}

.tabs :deep(.el-tabs__item) {
  font-size: 12px;
  padding: 0 8px;
  height: 32px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  background: #12151c;
  color: var(--scada-text);
  cursor: grab;
  font-size: 12px;
}

.item:active {
  cursor: grabbing;
}

.item:hover {
  border-color: var(--scada-accent);
  background: rgba(61, 139, 253, 0.1);
}

.item.active-tool {
  border-color: var(--scada-accent);
  background: rgba(61, 139, 253, 0.18);
  box-shadow: inset 0 0 0 1px rgba(61, 139, 253, 0.35);
}

.icon {
  width: 28px;
  height: 20px;
  border-radius: 3px;
  background: #3d8bfd;
}

.icon[data-type='rect'] {
  background: #3d8bfd;
  border-radius: 2px;
}

.icon[data-type='roundRect'] {
  background: #3d8bfd;
  border-radius: 8px;
}

.icon[data-type='circle'],
.icon[data-type='lamp'],
.icon[data-type='pump'] {
  width: 20px;
  height: 20px;
  border-radius: 50%;
}

.icon[data-type='circle'] {
  background: #22c55e;
}

.icon[data-type='lamp'] {
  background: #4ade80;
  box-shadow: 0 0 8px #22c55e;
}

.icon[data-type='pump'] {
  background: #0ea5e9;
}

.icon[data-type='line'],
.icon[data-type='pipe'],
.icon[data-type='polyline'] {
  height: 3px;
  width: 28px;
  margin: 8px 0;
  border-radius: 2px;
  background: #f8fafc;
}

.icon[data-type='polyline'] {
  height: 0;
  width: 28px;
  margin: 4px 0 8px;
  border: none;
  background: transparent;
  box-shadow:
    2px 4px 0 -1px #f8fafc,
    10px 12px 0 -1px #f8fafc,
    18px 6px 0 -1px #f8fafc;
  border-top: 2px solid #f8fafc;
}

.icon[data-type='polygon'] {
  width: 0;
  height: 0;
  background: transparent;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-bottom: 20px solid #3d8bfd;
  border-radius: 0;
}

.icon[data-type='pipe'] {
  height: 6px;
  background: #94a3b8;
}

.icon[data-type='text'] {
  background: transparent;
  display: grid;
  place-content: center;
  font-weight: 700;
}

.icon[data-type='text']::after {
  content: 'T';
}

.icon[data-type='button'] {
  background: #2563eb;
  border-radius: 4px;
}

.icon[data-type='value'] {
  background: linear-gradient(180deg, #0f172a 40%, #38bdf8 40%);
  border: 1px solid #334155;
}

.icon[data-type='switch'] {
  width: 28px;
  height: 14px;
  border-radius: 8px;
  background: linear-gradient(90deg, #475569 50%, #22c55e 50%);
}

.icon[data-type='list'] {
  background: repeating-linear-gradient(
    to bottom,
    #334155 0 3px,
    transparent 3px 6px
  );
  border: 1px solid #475569;
}

.icon[data-type='chart'] {
  background: linear-gradient(135deg, #0f172a, #0f172a);
  position: relative;
  box-shadow: inset 0 -2px 0 #38bdf8, inset 4px -8px 0 -2px #38bdf8,
    inset 12px -4px 0 -2px #38bdf8, inset 20px -10px 0 -2px #38bdf8;
}

.icon[data-type='trend'] {
  background: #0b1220;
  box-shadow: inset 0 -2px 0 #22d3ee, inset 6px -10px 0 -2px #22d3ee,
    inset 14px -5px 0 -2px #22d3ee, inset 22px -12px 0 -2px #22d3ee;
}

.icon[data-type='trendHistory'] {
  background: #0b1220;
  box-shadow: inset 0 -2px 0 #f59e0b, inset 6px -8px 0 -2px #f59e0b,
    inset 14px -12px 0 -2px #f59e0b, inset 22px -4px 0 -2px #f59e0b;
}

.icon[data-type='alarm'] {
  background: linear-gradient(180deg, #7f1d1d 0 30%, #140f0f 30% 100%);
  border: 1px solid #991b1b;
}

.icon[data-type='alarmHistory'] {
  background: linear-gradient(180deg, #1e3a5f 0 30%, #0c121b 30% 100%);
  border: 1px solid #334155;
}

.icon[data-type='gauge'] {
  border-radius: 50% 50% 4px 4px;
  background: conic-gradient(from 180deg, #38bdf8 0 40%, #1e293b 40% 100%);
  width: 22px;
  height: 14px;
}

.icon[data-type='valve'] {
  background: #64748b;
  transform: rotate(45deg);
  width: 16px;
  height: 16px;
}

.icon[data-type='tank'] {
  background: linear-gradient(to top, #38bdf8 55%, #1e293b 55%);
  border-radius: 6px;
}

.icon[data-type='image'] {
  background: linear-gradient(135deg, #64748b, #334155);
}

.full {
  width: 100%;
  margin-top: 10px;
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
  padding: 8px 0;
}

.symbol-card {
  position: relative;
}

.symbol-card .del {
  position: absolute;
  top: 2px;
  right: 2px;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  color: #fca5a5;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.icon.symbol {
  background: linear-gradient(135deg, #64748b, #3d8bfd);
  border-radius: 4px;
}
</style>
