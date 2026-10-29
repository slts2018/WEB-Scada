<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BUILTIN_WIDGETS,
  isDrawToolType,
  type BuiltinWidgetType,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { ElMessage } from 'element-plus'
import EchartThumb from './EchartThumb.vue'
import { ECHART_DND, ECHART_FOLDERS, ECHART_PRESETS, type EchartPreset } from '@/shared/echart/catalog'
import {
  MATERIAL_CATALOG,
  MATERIAL_CATEGORY_ORDER,
  MATERIAL_DND,
  materialSrc,
  type MaterialItem,
} from '@/shared/library/materials'

const DND_TYPE = 'application/x-scada-widget'

const project = useProjectStore()
const fileInput = ref<HTMLInputElement | null>(null)
const query = ref('')

const widgetRails = [
  {
    id: 'control',
    label: '控件',
    folders: [
      { id: 'control-display', name: '显示', types: ['value', 'gauge'] as BuiltinWidgetType[] },
      { id: 'control-operate', name: '操作', types: ['switch'] as BuiltinWidgetType[] },
    ],
  },
  {
    id: 'device',
    label: '设备',
    folders: [
      { id: 'device-process', name: '工艺设备', types: ['valve', 'pump', 'lamp', 'tank', 'pipe'] as BuiltinWidgetType[] },
    ],
  },
  {
    id: 'chart',
    label: '图表',
    folders: [
      { id: 'chart-trend', name: '趋势', types: ['trendHistory', 'trend'] as BuiltinWidgetType[] },
      { id: 'chart-alarm', name: '报警', types: ['alarmHistory', 'alarm'] as BuiltinWidgetType[] },
      { id: 'chart-stat', name: '统计', types: ['pie', 'bar'] as BuiltinWidgetType[] },
    ],
  },
  {
    id: 'media',
    label: '素材',
    folders: [{ id: 'media-all', name: '画面', types: ['image', 'scene3d'] as BuiltinWidgetType[] }],
  },
  {
    id: 'shape',
    label: '图形',
    folders: [
      { id: 'shape-basic', name: '基本图形', types: ['rect', 'roundRect', 'circle'] as BuiltinWidgetType[] },
      { id: 'shape-line', name: '线条', types: ['line', 'polyline', 'polygon'] as BuiltinWidgetType[] },
      { id: 'shape-text', name: '文字', types: ['text', 'button'] as BuiltinWidgetType[] },
    ],
  },
] as const

const rails = [
  { id: 'template', label: '模板' },
  ...widgetRails.map((item) => ({ id: item.id, label: item.label })),
  { id: 'symbol', label: '组件' },
] as const

type RailId = (typeof rails)[number]['id']

const active = ref<RailId>('shape')
const openIds = ref<string[]>(['shape-basic'])

const byType = new Map(BUILTIN_WIDGETS.map((item) => [item.type, item]))

function matches(text: string, q: string) {
  return text.toLowerCase().includes(q)
}

const visibleFolders = computed(() => {
  const rail = widgetRails.find((item) => item.id === active.value)
  if (!rail) return []
  const q = query.value.trim().toLowerCase()
  return rail.folders
    .map((folder) => {
      const items = folder.types
        .map((type) => byType.get(type))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const folderHit = q && matches(folder.name, q)
      const matched = q ? items.filter((item) => folderHit || matches(item.label, q) || matches(item.description, q)) : items
      return {
        ...folder,
        items: matched,
        open: q ? matched.length > 0 : openIds.value.includes(folder.id),
      }
    })
    .filter((folder) => !q || folder.items.length > 0)
})

const templates = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (project.document.pageTemplates ?? []).filter((item) => !q || matches(item.name, q))
})

const symbols = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (project.document.symbols ?? []).filter((item) => !q || matches(item.name, q))
})

const echartFolders = computed(() => {
  if (active.value !== 'chart') return []
  const q = query.value.trim().toLowerCase()
  return ECHART_FOLDERS.map((folder) => {
    const id = `echart:${folder}`
    const items = ECHART_PRESETS.filter((item) => item.folder === folder)
    const folderHit = Boolean(q) && matches(folder, q)
    const matched = q ? items.filter((item) => folderHit || matches(item.label, q)) : items
    return {
      id,
      name: folder,
      items: matched,
      open: q ? matched.length > 0 : openIds.value.includes(id),
    }
  }).filter((folder) => !q || folder.items.length > 0)
})

const materialFolders = computed(() => {
  if (active.value !== 'media') return []
  const q = query.value.trim().toLowerCase()
  const groups = new Map<string, MaterialItem[]>()
  for (const item of MATERIAL_CATALOG) {
    const folderHit = Boolean(q) && matches(item.category, q)
    if (q && !folderHit && !matches(item.name, q)) continue
    const list = groups.get(item.category)
    if (list) list.push(item)
    else groups.set(item.category, [item])
  }
  const names = [...groups.keys()].sort((a, b) => {
    const ai = MATERIAL_CATEGORY_ORDER.indexOf(a)
    const bi = MATERIAL_CATEGORY_ORDER.indexOf(b)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  return names.map((category) => {
    const id = `mat:${category}`
    const items = groups.get(category) ?? []
    return {
      id,
      name: category,
      items,
      open: q ? items.length > 0 : openIds.value.includes(id),
    }
  })
})

function selectRail(id: RailId) {
  active.value = id
  const rail = widgetRails.find((item) => item.id === id)
  if (rail && !rail.folders.some((folder) => openIds.value.includes(folder.id))) {
    openIds.value = [rail.folders[0].id]
  }
}

function toggleFolder(id: string) {
  openIds.value = openIds.value.includes(id) ? openIds.value.filter((item) => item !== id) : [...openIds.value, id]
}

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

function addMaterial(item: MaterialItem) {
  if (!project.activePage2d) {
    ElMessage.warning('请先选择 2D 页面')
    return
  }
  const widget = project.addLibraryImage({
    name: item.name,
    src: materialSrc(item.file),
    width: item.w,
    height: item.h,
  })
  if (!widget) ElMessage.warning('当前图层已锁定，请切换图层')
}

function onMaterialDrag(e: DragEvent, item: MaterialItem) {
  e.dataTransfer?.setData(MATERIAL_DND, item.id)
  e.dataTransfer?.setData(DND_TYPE, 'image')
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

function addEchart(item: EchartPreset) {
  if (!project.activePage2d) {
    ElMessage.warning('请先选择 2D 页面')
    return
  }
  const widget = project.addWidget('echart', undefined, { name: item.label, props: { variant: item.id } })
  if (!widget) ElMessage.warning('当前图层已锁定，请切换图层')
}

function onEchartDrag(e: DragEvent, item: EchartPreset) {
  e.dataTransfer?.setData(ECHART_DND, item.id)
  e.dataTransfer?.setData(DND_TYPE, 'echart')
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

function onDragStart(e: DragEvent, type: BuiltinWidgetType) {
  if (type === 'image' || isDrawToolType(type)) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData(DND_TYPE, type)
  e.dataTransfer!.effectAllowed = 'copy'
}

function useTemplate(id: string) {
  const page = project.createPageFromTemplate(id)
  if (!page) {
    ElMessage.warning('模板不存在')
    return
  }
  ElMessage.success(`已按模板新建页面「${page.name}」`)
}

function useSymbol(id: string) {
  if (!project.activePage2d) {
    ElMessage.warning('请先选择 2D 页面')
    return
  }
  const widget = project.placeSymbol(id)
  if (!widget) ElMessage.warning('当前图层已锁定，请切换图层')
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

    <nav class="rail" aria-label="控件分类">
      <button
        v-for="rail in rails"
        :key="rail.id"
        type="button"
        class="rail-btn"
        :class="{ active: active === rail.id }"
        @click="selectRail(rail.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <template v-if="rail.id === 'template'">
            <rect x="4" y="3" width="12" height="16" rx="1.5" />
            <path d="M8 7h6M8 11h6M8 15h4" />
            <path d="M14 14h6v7h-6z" />
          </template>
          <template v-else-if="rail.id === 'shape'">
            <rect x="4" y="4" width="7" height="7" rx="1" />
            <rect x="13" y="4" width="7" height="7" rx="1" />
            <rect x="4" y="13" width="7" height="7" rx="1" />
            <circle cx="16.5" cy="16.5" r="3.2" />
          </template>
          <template v-else-if="rail.id === 'control'">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M7 12h4M14 10v4" />
          </template>
          <template v-else-if="rail.id === 'chart'">
            <path d="M4 19V5M4 19h16" />
            <path d="M8 15v-4M12 15V8M16 15v-6" />
          </template>
          <template v-else-if="rail.id === 'device'">
            <path d="M12 3l7 4v6c0 4.2-3 6.8-7 8-4-1.2-7-3.8-7-8V7l7-4z" />
          </template>
          <template v-else-if="rail.id === 'symbol'">
            <path d="M8 4h4v4H8zM4 12h4v4H4zM12 12h8v4h-8zM8 16l2 4h4l2-4" />
          </template>
          <template v-else>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.4" />
            <path d="M4 16l4.5-4 3 2.5L15 11l5 5" />
          </template>
        </svg>
        <span>{{ rail.label }}</span>
      </button>
    </nav>

    <div class="main">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
        </svg>
        <input v-model="query" type="search" placeholder="搜索" />
      </label>

      <div v-if="active === 'template'" class="list">
        <div v-if="templates.length" class="mat-grid">
          <button
            v-for="item in templates"
            :key="item.id"
            type="button"
            class="mat-card"
            :title="item.pageType === '3d' ? '三维页面模板' : '二维页面模板'"
            @click="useTemplate(item.id)"
          >
            <span class="preview doc" />
            <span class="name">{{ item.name }}</span>
          </button>
        </div>
        <p v-else class="empty">{{ query ? '没有匹配的模板' : '还没有模板。在页面树里把页面存成模板。' }}</p>
      </div>

      <div v-else-if="active === 'symbol'" class="list">
        <div v-if="symbols.length" class="mat-grid">
          <button
            v-for="item in symbols"
            :key="item.id"
            type="button"
            class="mat-card"
            title="放到当前页面"
            @click="useSymbol(item.id)"
          >
            <span class="preview symbol" />
            <span class="name">{{ item.name }}</span>
          </button>
        </div>
        <p v-else class="empty">{{ query ? '没有匹配的组件' : '还没有组件。选中图元后用工具栏「存为符号」。' }}</p>
      </div>

      <div v-else class="list">
        <template v-for="folder in visibleFolders" :key="folder.id">
          <button type="button" class="folder" :class="{ open: folder.open }" @click="toggleFolder(folder.id)">
            <span class="chevron" />
            <span class="name">{{ folder.name }}</span>
          </button>
          <div v-if="folder.open" class="mat-grid">
            <button
              v-for="item in folder.items"
              :key="item.type"
              type="button"
              class="mat-card"
              :class="{ 'active-tool': project.drawTool === item.type }"
              :draggable="item.type !== 'image' && !isDrawToolType(item.type)"
              :title="item.description"
              @click="add(item.type)"
              @dragstart="onDragStart($event, item.type)"
            >
              <span class="preview"><span class="icon" :data-type="item.type" /></span>
              <span class="name">{{ item.label }}</span>
            </button>
          </div>
        </template>
        <template v-if="active === 'chart'">
          <template v-for="folder in echartFolders" :key="folder.id">
            <button type="button" class="folder" :class="{ open: folder.open }" @click="toggleFolder(folder.id)">
              <span class="chevron" />
              <span class="name">{{ folder.name }}</span>
              <span class="count">{{ folder.items.length }}</span>
            </button>
            <div v-if="folder.open" class="mat-grid">
              <button
                v-for="item in folder.items"
                :key="item.id"
                type="button"
                class="mat-card"
                draggable="true"
                :title="item.label"
                @click="addEchart(item)"
                @dragstart="onEchartDrag($event, item)"
              >
                <EchartThumb :variant="item.id" />
                <span class="name">{{ item.label }}</span>
              </button>
            </div>
          </template>
        </template>
        <template v-if="active === 'media'">
          <template v-for="folder in materialFolders" :key="folder.id">
            <button type="button" class="folder" :class="{ open: folder.open }" @click="toggleFolder(folder.id)">
              <span class="chevron" />
              <span class="name">{{ folder.name }}</span>
              <span class="count">{{ folder.items.length }}</span>
            </button>
            <div v-if="folder.open" class="mat-grid">
              <button
                v-for="item in folder.items"
                :key="item.id"
                type="button"
                class="mat-card"
                draggable="true"
                :title="item.name"
                @click="addMaterial(item)"
                @dragstart="onMaterialDrag($event, item)"
              >
                <img class="thumb" :src="materialSrc(item.file)" alt="" loading="lazy" />
                <span class="name">{{ item.name }}</span>
              </button>
            </div>
          </template>
        </template>
        <p v-if="!visibleFolders.length && !materialFolders.length && !echartFolders.length" class="empty">没有匹配的控件</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette {
  display: flex;
  height: 100%;
  min-height: 0;
  margin: -8px;
  width: calc(100% + 16px);
  background: #12151c;
}

.hidden {
  display: none;
}

.rail {
  order: 2;
  width: 58px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-left: 1px solid var(--scada-border);
  background: #0e1116;
  overflow: auto;
}

.rail-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 100%;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: #8b95a7;
  font-size: 11px;
  cursor: pointer;
}

.rail-btn svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.rail-btn:hover {
  color: #d5dbe6;
}

.rail-btn.active {
  color: #3d8bfd;
  background: rgba(61, 139, 253, 0.12);
  box-shadow: inset -2px 0 0 #3d8bfd;
}

.main {
  order: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px;
  padding: 0 8px;
  height: 30px;
  border: 1px solid #2a3140;
  border-radius: 4px;
  background: #0e1116;
  color: #8b95a7;
}

.search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--scada-text);
  font-size: 12px;
}

.search input::-webkit-search-cancel-button {
  appearance: none;
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 6px 8px;
}

.folder {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #c5cedb;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.folder:hover,
.folder.open {
  background: rgba(61, 139, 253, 0.16);
  color: #7eb6ff;
}

.chevron {
  width: 0;
  height: 0;
  flex-shrink: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transition: transform 0.15s ease;
}

.folder.open .chevron {
  transform: rotate(90deg);
}

.chevron.leaf {
  border: none;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.7;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: #8b95a7;
}

.mat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 6px;
  padding: 4px 6px 10px;
}

.mat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 4px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #c5cedb;
  cursor: grab;
}

.mat-card:hover,
.mat-card.active-tool {
  border-color: #3d8bfd;
  background: rgba(61, 139, 253, 0.08);
}

.preview {
  width: 100%;
  height: 84px;
  display: grid;
  place-items: center;
}

.preview .icon {
  margin: 0;
  transform: scale(2.2);
}

.preview.doc,
.preview.symbol {
  width: 72%;
  height: 64px;
  border-radius: 4px;
  border: 1px solid #334155;
  background: linear-gradient(180deg, #1e293b, #0f172a);
}

.preview.symbol {
  border-color: #3d8bfd;
}

.mat-card:active {
  cursor: grabbing;
}

.mat-card .thumb {
  width: 100%;
  height: 84px;
  object-fit: contain;
}

.mat-card .name {
  width: 100%;
  font-size: 12px;
  text-align: center;
}

.empty {
  margin: 16px 10px;
  font-size: 12px;
  color: var(--scada-muted);
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
  background: transparent;
  box-shadow: inset 0 -2px 0 #22d3ee, inset 6px -10px 0 -2px #22d3ee,
    inset 14px -5px 0 -2px #22d3ee, inset 22px -12px 0 -2px #22d3ee;
}

.icon[data-type='trendHistory'] {
  background: transparent;
  box-shadow: inset 0 -2px 0 #f59e0b, inset 6px -8px 0 -2px #f59e0b,
    inset 14px -12px 0 -2px #f59e0b, inset 22px -4px 0 -2px #f59e0b;
}

.icon[data-type='alarm'] {
  background: transparent;
  border: 1px solid #991b1b;
}

.icon[data-type='alarmHistory'] {
  background: transparent;
  border: 1px solid #334155;
}

.icon[data-type='gauge'] {
  border-radius: 50% 50% 4px 4px;
  background: conic-gradient(from 180deg, #38bdf8 0 40%, #1e293b 40% 100%);
  width: 22px;
  height: 14px;
}

.icon[data-type='pie'] {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: conic-gradient(#22d3ee 0 40%, #f59e0b 40% 65%, #a78bfa 65% 85%, #34d399 85% 100%);
}

.icon[data-type='bar'] {
  background: transparent;
  box-shadow:
    inset 2px -12px 0 -1px #22d3ee,
    inset 10px -8px 0 -1px #f59e0b,
    inset 18px -14px 0 -1px #a78bfa;
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

.preview .icon {
  margin: 0;
  transform: scale(2.2);
}

.preview .icon[data-type='valve'] {
  transform: scale(2.2) rotate(45deg);
}
</style>
