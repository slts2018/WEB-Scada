<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Object3DNode, Page2D, Page3D, Widget2D } from '@web-scada/core'
import { useProjectStore } from '@/stores/project'

const props = withDefaults(
  defineProps<{
    readonly?: boolean
  }>(),
  { readonly: false },
)

const project = useProjectStore()
const expandedGroups = ref<Set<string>>(new Set())
const expanded3d = ref<Set<string>>(new Set())
const dragFromIndex = ref<number | null>(null)
const dropHintIndex = ref<number | null>(null)
const drag3dId = ref<string | null>(null)
const drop3dHintId = ref<string | null>(null)

/** 对象树自上而下 = 画面由前到后（数组末尾在最上） */
const widgetsTopFirst = computed(() => {
  const page = project.activePage
  if (!page || page.type !== '2d') return [] as Widget2D[]
  return [...(page as Page2D).layers.flatMap((l) => l.widgets)].reverse()
})

const objects3d = computed(() => {
  const page = project.activePage
  if (!page || page.type !== '3d') return [] as Object3DNode[]
  return (page as Page3D).objects
})

const is3d = computed(() => project.activePage?.type === '3d')

type Flat3dRow = { obj: Object3DNode; depth: number }

const flat3dRows = computed((): Flat3dRow[] => {
  const rows: Flat3dRow[] = []
  const walk = (list: Object3DNode[], depth: number) => {
    for (const obj of list) {
      rows.push({ obj, depth })
      if (obj.children?.length && expanded3d.value.has(obj.id)) {
        walk(obj.children, depth + 1)
      }
    }
  }
  walk(objects3d.value, 0)
  return rows
})

function selectWidget(widget: Widget2D, e: MouseEvent) {
  if (props.readonly) return
  project.selectWidget(widget.id, { additive: e.ctrlKey || e.metaKey || e.shiftKey })
}

function selectObject(id: string, e: MouseEvent) {
  if (props.readonly) return
  const additive = e.ctrlKey || e.metaKey || e.shiftKey
  if (additive) {
    project.selectObject3d(id, { additive: true })
    return
  }
  // 单一路径：store 命令 → Canvas3DBoard.watch(cameraFocus3dCmd) → focusObject
  // 不再额外 emit，避免与 watch 双通道抢挂手柄
  project.focusCameraOnObject3d(id)
}

function toggleExpand(id: string, e: MouseEvent) {
  e.stopPropagation()
  const next = new Set(expandedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedGroups.value = next
}

function toggleExpand3d(id: string, e: MouseEvent) {
  e.stopPropagation()
  const next = new Set(expanded3d.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded3d.value = next
}

function toggleFlag(widget: Widget2D, key: 'visible' | 'locked', e: MouseEvent) {
  e.stopPropagation()
  if (props.readonly) return
  const current = key === 'visible' ? widget.visible !== false : Boolean(widget.locked)
  project.updateWidget(widget.id, { [key]: !current })
}

function toggleFlag3d(obj: Object3DNode, key: 'visible' | 'locked', e: MouseEvent) {
  e.stopPropagation()
  if (props.readonly) return
  const current = key === 'visible' ? obj.visible !== false : Boolean(obj.locked)
  project.updateObject3d(obj.id, { [key]: !current })
}

function modelIndexOf(widgetId: string): number {
  const layer = project.findLayerOfWidget(widgetId)
  if (!layer) return -1
  return layer.widgets.findIndex((w) => w.id === widgetId)
}

function onDragStart(widget: Widget2D, e: DragEvent) {
  if (props.readonly) {
    e.preventDefault()
    return
  }
  const layer = project.findLayerOfWidget(widget.id)
  if (layer?.locked) {
    e.preventDefault()
    return
  }
  dragFromIndex.value = modelIndexOf(widget.id)
  e.dataTransfer?.setData('text/plain', widget.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(widget: Widget2D, e: DragEvent) {
  if (props.readonly || dragFromIndex.value == null) return
  e.preventDefault()
  dropHintIndex.value = modelIndexOf(widget.id)
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(widget: Widget2D, e: DragEvent) {
  e.preventDefault()
  if (props.readonly) return
  const fromId = e.dataTransfer?.getData('text/plain')
  dragFromIndex.value = null
  dropHintIndex.value = null
  if (!fromId || fromId === widget.id) return
  const fromLayer = project.findLayerOfWidget(fromId)
  const toLayer = project.findLayerOfWidget(widget.id)
  if (!fromLayer || !toLayer || fromLayer.id !== toLayer.id || fromLayer.locked) return
  const from = fromLayer.widgets.findIndex((w) => w.id === fromId)
  const to = toLayer.widgets.findIndex((w) => w.id === widget.id)
  if (from >= 0 && to >= 0) {
    project.selectWidget(fromId)
    project.moveWidgetIndex(from, to)
  }
}

function onDragEnd() {
  dragFromIndex.value = null
  dropHintIndex.value = null
}

function onDragStart3d(obj: Object3DNode, e: DragEvent) {
  if (props.readonly) {
    e.preventDefault()
    return
  }
  drag3dId.value = obj.id
  e.dataTransfer?.setData('text/plain', obj.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver3d(obj: Object3DNode, e: DragEvent) {
  if (props.readonly || !drag3dId.value) return
  e.preventDefault()
  drop3dHintId.value = obj.id
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop3d(obj: Object3DNode, e: DragEvent) {
  e.preventDefault()
  if (props.readonly) return
  const fromId = e.dataTransfer?.getData('text/plain') || drag3dId.value
  drag3dId.value = null
  drop3dHintId.value = null
  if (!fromId || fromId === obj.id) return
  project.reparentObject3d(fromId, obj.id)
  const next = new Set(expanded3d.value)
  next.add(obj.id)
  expanded3d.value = next
}

function onDragEnd3d() {
  drag3dId.value = null
  drop3dHintId.value = null
}

function unparentSelected() {
  const id = project.selectedObject3dId
  if (!id) return
  project.reparentObject3d(id, null)
}

function groupSelected3d() {
  if (project.selectedObject3dIds.length < 2) {
    ElMessage.warning('请先多选至少 2 个对象')
    return
  }
  const g = project.groupSelectedObject3ds()
  if (!g) ElMessage.warning('只能组合同一层级下的对象')
  else ElMessage.success(`已组合为「${g.name}」`)
}

function ungroupSelected3d() {
  const ids = project.ungroupSelectedObject3ds()
  if (!ids.length) ElMessage.warning('请先选中已组合的对象')
  else ElMessage.success(`已解组（${ids.length} 个对象）`)
}

function isHidden(w: Widget2D) {
  return w.visible === false
}

function isHidden3d(o: Object3DNode) {
  return o.visible === false
}
</script>

<template>
  <div class="obj-explorer">
    <template v-if="is3d">
      <div v-if="!readonly" class="toolbar">
        <button
          type="button"
          :disabled="project.selectedObject3dIds.length < 2"
          title="将同级多选组成组"
          @click="groupSelected3d"
        >
          组合
        </button>
        <button
          type="button"
          :disabled="!project.selectedObjects3d.some((o) => o.children?.length)"
          title="解散选中组"
          @click="ungroupSelected3d"
        >
          解组
        </button>
        <button type="button" :disabled="!project.selectedObject3dId" title="移到场景根" @click="unparentSelected">
          出组
        </button>
      </div>
      <div v-if="!objects3d.length" class="empty">当前场景无对象</div>
      <ul v-else class="list">
        <li
          v-for="{ obj: o, depth } in flat3dRows"
          :key="o.id"
          :class="{
            active: project.selectedObject3dIds.includes(o.id),
            readonly,
            hidden: isHidden3d(o),
            locked: o.locked,
            'drop-target': drop3dHintId === o.id,
          }"
          :style="{ paddingLeft: `${6 + depth * 12}px` }"
          :draggable="!readonly"
          @click="selectObject(o.id, $event)"
          @dragstart="onDragStart3d(o, $event)"
          @dragover="onDragOver3d(o, $event)"
          @drop="onDrop3d(o, $event)"
          @dragend="onDragEnd3d"
        >
          <button
            v-if="o.children?.length"
            type="button"
            class="expand"
            :title="expanded3d.has(o.id) ? '收起' : '展开'"
            @click="toggleExpand3d(o.id, $event)"
          >
            {{ expanded3d.has(o.id) ? '▾' : '▸' }}
          </button>
          <span v-else class="expand-spacer" />
          <span class="type">{{ o.children?.length ? 'group' : o.primitive || 'model' }}</span>
          <span class="name" :title="o.name || o.id">{{ o.name || o.id }}</span>
          <button
            v-if="!readonly"
            type="button"
            class="icon-btn"
            :class="{ off: isHidden3d(o) }"
            :title="isHidden3d(o) ? '显示' : '隐藏'"
            @click="toggleFlag3d(o, 'visible', $event)"
          >
            {{ isHidden3d(o) ? '隐藏' : '显' }}
          </button>
          <button
            v-if="!readonly"
            type="button"
            class="icon-btn"
            :class="{ on: o.locked }"
            :title="o.locked ? '解锁' : '锁定'"
            @click="toggleFlag3d(o, 'locked', $event)"
          >
            {{ o.locked ? '锁' : '开' }}
          </button>
        </li>
      </ul>
      <p v-if="!readonly && objects3d.length" class="hint">Shift 多选 · 拖到对象上可嵌套</p>
    </template>
    <template v-else>
      <div v-if="!widgetsTopFirst.length" class="empty">当前页无图元</div>
      <ul v-else class="list">
        <template v-for="w in widgetsTopFirst" :key="w.id">
          <li
            :class="{
              active: project.selectedWidgetIds.includes(w.id),
              readonly,
              hidden: isHidden(w),
              locked: w.locked,
              'drop-target': dropHintIndex === modelIndexOf(w.id),
            }"
            :draggable="!readonly"
            @click="selectWidget(w, $event)"
            @dragstart="onDragStart(w, $event)"
            @dragover="onDragOver(w, $event)"
            @drop="onDrop(w, $event)"
            @dragend="onDragEnd"
          >
            <button
              v-if="w.type === 'group' && w.children?.length"
              type="button"
              class="expand"
              :title="expandedGroups.has(w.id) ? '收起' : '展开'"
              @click="toggleExpand(w.id, $event)"
            >
              {{ expandedGroups.has(w.id) ? '▾' : '▸' }}
            </button>
            <span v-else class="expand-spacer" />
            <span class="type">{{ w.type }}</span>
            <span class="name" :title="w.name || w.id">{{ w.name || w.id }}</span>
            <button
              v-if="!readonly"
              type="button"
              class="icon-btn"
              :class="{ off: isHidden(w) }"
              :title="isHidden(w) ? '显示' : '隐藏'"
              @click="toggleFlag(w, 'visible', $event)"
            >
              {{ isHidden(w) ? '隐藏' : '显' }}
            </button>
            <button
              v-if="!readonly"
              type="button"
              class="icon-btn"
              :class="{ on: w.locked }"
              :title="w.locked ? '解锁' : '锁定'"
              @click="toggleFlag(w, 'locked', $event)"
            >
              {{ w.locked ? '锁' : '开' }}
            </button>
          </li>
          <li
            v-for="child in expandedGroups.has(w.id) ? w.children ?? [] : []"
            :key="child.id"
            class="child"
            :class="{ readonly: true, hidden: isHidden(child) }"
          >
            <span class="expand-spacer" />
            <span class="type">{{ child.type }}</span>
            <span class="name">{{ child.name || child.id }}</span>
          </li>
        </template>
      </ul>
      <p v-if="!readonly && widgetsTopFirst.length" class="hint">拖拽行可调整前后层级</p>
    </template>
  </div>
</template>

<style scoped>
.obj-explorer {
  min-height: 40px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.toolbar button {
  border: 1px solid #2a3140;
  background: #1a1e27;
  color: var(--scada-muted);
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) {
  border-color: #3d8bfd;
  color: var(--scada-text);
}

.toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
  padding: 8px 0;
}

.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--scada-muted);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.list li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  border: 1px solid transparent;
}

.list li.readonly {
  cursor: default;
}

.list li.child {
  padding-left: 18px;
  opacity: 0.75;
  cursor: default;
}

.list li:hover,
.list li.active {
  background: rgba(61, 139, 253, 0.14);
}

.list li.drop-target {
  border-color: #3d8bfd;
}

.list li.hidden .name {
  text-decoration: line-through;
  opacity: 0.55;
}

.list li.locked .name {
  color: #fbbf24;
}

.expand,
.expand-spacer {
  width: 14px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--scada-muted);
  padding: 0;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}

.expand-spacer {
  display: inline-block;
}

.type {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #2a3140;
  color: var(--scada-muted);
  text-transform: uppercase;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-btn {
  flex-shrink: 0;
  border: 1px solid #2a3140;
  background: #1a1e27;
  color: var(--scada-muted);
  border-radius: 3px;
  font-size: 10px;
  padding: 1px 4px;
  cursor: pointer;
  line-height: 1.4;
}

.icon-btn:hover {
  border-color: #3d8bfd;
  color: var(--scada-text);
}

.icon-btn.off {
  color: #f87171;
  border-color: #7f1d1d;
}

.icon-btn.on {
  color: #fbbf24;
  border-color: #92400e;
}
</style>
