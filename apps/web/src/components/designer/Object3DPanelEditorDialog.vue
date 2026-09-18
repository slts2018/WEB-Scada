<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Object3DPanel, Object3DPanelItem } from '@web-scada/core'
import {
  clampPanelItemRect,
  createDefaultObject3DPanel,
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
  defaultPanelFontSize,
  defaultPanelItemSize,
  MAX_PANEL_CONTENT_SIZE,
  MIN_PANEL_CONTENT_HEIGHT,
  MIN_PANEL_CONTENT_WIDTH,
  resolvePanelContentSize,
  resolvePanelItemRect,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'
import {
  applyPanelItemContentFit,
  applyPanelItemTypography,
  ensureObject3dPanelStyles,
  resolvePanelObjectFit,
} from '@/shared/three/object3dPanelUi'

const project = useProjectStore()
const tags = useTagStore()

const PALETTE_PREFIX = 'scada-panel-item:'

const obj = computed(() => project.selectedObject3d)

const dialogVisible = computed({
  get: () => project.object3dPanelEditorOpen,
  set: (v: boolean) => {
    if (v) project.openObject3dPanelEditor()
    else project.closeObject3dPanelEditor()
  },
})

const draft = ref<Object3DPanel | null>(null)
const selectedItemId = ref<string | null>(null)
const rightTab = ref<'props' | 'list'>('list')

const history = ref<string[]>([])
const historyIndex = ref(-1)
const applyingHistory = ref(false)

const previewHost = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
/** 画布相对逻辑尺寸的缩放（铺满时用） */
const viewScale = ref({ x: 1, y: 1 })
const TITLE_BAR_H = 28

let hostResizeObserver: ResizeObserver | null = null

const imageResources = computed(() =>
  project.document.resources.filter((r) => r.kind === 'image' || r.kind === 'svg'),
)

const panelW = computed(
  () => resolvePanelContentSize(draft.value?.width, draft.value?.height).width,
)
const panelH = computed(
  () => resolvePanelContentSize(draft.value?.width, draft.value?.height).height,
)

const selectedItem = computed(() => {
  if (!draft.value || !selectedItemId.value) return null
  return draft.value.items.find((it) => it.id === selectedItemId.value) ?? null
})

const selectedIndex = computed(() => {
  if (!draft.value || !selectedItemId.value) return -1
  return draft.value.items.findIndex((it) => it.id === selectedItemId.value)
})

const selectedRect = computed(() => {
  if (!selectedItem.value || selectedIndex.value < 0) return null
  return resolvePanelItemRect(selectedItem.value, selectedIndex.value)
})

const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1)

/** 当前面板尺寸对应的默认字号（未单独设置时） */
const panelBaseFontSize = computed(() => defaultPanelFontSize(panelW.value, panelH.value))

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
type DragState = {
  itemId: string
  mode: 'move' | 'resize'
  handle?: ResizeHandle
  startX: number
  startY: number
  origX: number
  origY: number
  origW: number
  origH: number
}
const dragState = ref<DragState | null>(null)

function clonePanel(panel: Object3DPanel): Object3DPanel {
  return JSON.parse(JSON.stringify(panel)) as Object3DPanel
}

function snapshotKey(panel: Object3DPanel | null): string {
  return JSON.stringify(panel)
}

function pushHistory(panel: Object3DPanel | null) {
  if (applyingHistory.value) return
  const key = snapshotKey(panel)
  if (historyIndex.value >= 0 && history.value[historyIndex.value] === key) return
  const next = history.value.slice(0, historyIndex.value + 1)
  next.push(key)
  if (next.length > 80) next.shift()
  history.value = next
  historyIndex.value = next.length - 1
}

function applySnapshot(key: string) {
  applyingHistory.value = true
  try {
    draft.value = key === 'null' ? null : (JSON.parse(key) as Object3DPanel)
    if (
      selectedItemId.value &&
      draft.value &&
      !draft.value.items.some((it) => it.id === selectedItemId.value)
    ) {
      selectedItemId.value = draft.value.items[0]?.id ?? null
    }
  } finally {
    nextTick(() => {
      applyingHistory.value = false
      renderPreview()
    })
  }
}

function undo() {
  if (!canUndo.value) return
  historyIndex.value -= 1
  applySnapshot(history.value[historyIndex.value]!)
}

function redo() {
  if (!canRedo.value) return
  historyIndex.value += 1
  applySnapshot(history.value[historyIndex.value]!)
}

function setDraft(next: Object3DPanel | null) {
  draft.value = next
  pushHistory(draft.value)
  nextTick(() => renderPreview())
}

function resetEditorState() {
  const src = obj.value?.panel
  draft.value = src ? clonePanel(src) : null
  selectedItemId.value = draft.value?.items[0]?.id ?? null
  rightTab.value = 'list'
  history.value = [snapshotKey(draft.value)]
  historyIndex.value = 0
  dragState.value = null
  nextTick(() => renderPreview())
}

watch(
  () => project.object3dPanelEditorOpen,
  (open) => {
    if (open) resetEditorState()
  },
)

watch(
  () => obj.value?.id,
  () => {
    if (project.object3dPanelEditorOpen) resetEditorState()
  },
)

function newItemId() {
  return `pi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function ensureDraft(): Object3DPanel {
  if (!draft.value) {
    setDraft({
      title: obj.value?.name || '操作面板',
      width: DEFAULT_PANEL_CONTENT_WIDTH,
      height: DEFAULT_PANEL_CONTENT_HEIGHT,
      items: [],
    })
  }
  return draft.value!
}

function nextCascadePos(panel: Object3DPanel, size: { width: number; height: number }) {
  const { width: w, height: h } = resolvePanelContentSize(panel.width, panel.height)
  const n = panel.items.length
  const x = 10 + (n % 4) * 12
  const y = 10 + n * 18
  return clampPanelItemRect({ x, y, width: size.width, height: size.height }, w, h)
}

function createItem(
  type: Object3DPanelItem['type'],
  at?: { x: number; y: number },
): Object3DPanelItem {
  const panel = ensureDraft()
  const count = panel.items.filter((it) => it.type === type).length + 1
  const size = defaultPanelItemSize(type)
  const rect = at
    ? clampPanelItemRect(
        { x: at.x - size.width / 2, y: at.y - size.height / 2, ...size },
        panelW.value,
        panelH.value,
      )
    : nextCascadePos(panel, size)

  if (type === 'button') {
    return {
      id: newItemId(),
      type: 'button',
      text: `按钮${count}`,
      tagId: tags.metas[0]?.tagId || '',
      writeValue: 1,
      confirm: true,
      ...rect,
    }
  }
  if (type === 'value') {
    return {
      id: newItemId(),
      type: 'value',
      text: `数值${count}`,
      tagId: tags.metas[0]?.tagId || '',
      ...rect,
    }
  }
  if (type === 'image') {
    return {
      id: newItemId(),
      type: 'image',
      text: `图片${count}`,
      resourceId: '',
      ...rect,
    }
  }
  return { id: newItemId(), type: 'label', text: `文本${count}`, ...rect }
}

function addItem(type: Object3DPanelItem['type'], at?: { x: number; y: number }) {
  // 面板不再提供「数值」控件（旧工程已有的仍可显示/编辑）
  if (type === 'value') return
  const panel = ensureDraft()
  const item = createItem(type, at)
  setDraft({ ...panel, items: [...panel.items, item] })
  selectedItemId.value = item.id
  rightTab.value = 'props'
}

function updateMeta(partial: Partial<Pick<Object3DPanel, 'title' | 'width' | 'height' | 'objectFit'>>) {
  const panel = ensureDraft()
  const next = { ...panel, ...partial }
  if (partial.width != null || partial.height != null) {
    const sized = resolvePanelContentSize(next.width, next.height)
    next.width = sized.width
    next.height = sized.height
  }
  setDraft(next)
}

function updateItem(partial: Partial<Object3DPanelItem>) {
  if (!draft.value || !selectedItemId.value) return
  const items = draft.value.items.map((it) => {
    if (it.id !== selectedItemId.value) return it
    const next = { ...it, ...partial }
    const idx = draft.value!.items.findIndex((x) => x.id === it.id)
    const rect = resolvePanelItemRect(next, idx)
    const clamped = clampPanelItemRect(rect, panelW.value, panelH.value)
    return { ...next, ...clamped }
  })
  setDraft({ ...draft.value, items })
}

function patchItemRect(itemId: string, rect: { x: number; y: number; width?: number; height?: number }, commit: boolean) {
  if (!draft.value) return
  const items = draft.value.items.map((it) => {
    if (it.id !== itemId) return it
    const idx = draft.value!.items.findIndex((x) => x.id === it.id)
    const base = resolvePanelItemRect(it, idx)
    const next = clampPanelItemRect(
      {
        x: rect.x,
        y: rect.y,
        width: rect.width ?? base.width,
        height: rect.height ?? base.height,
      },
      panelW.value,
      panelH.value,
    )
    return { ...it, ...next }
  })
  if (commit) {
    setDraft({ ...draft.value, items })
  } else {
    draft.value = { ...draft.value, items }
    // 平移只改位置；缩放填充仅在改大小时重算，避免选中手柄把字撑大
    syncItemDom(itemId, { applyFit: dragState.value?.mode === 'resize' })
  }
}

function removeItem(id: string) {
  if (!draft.value) return
  const items = draft.value.items.filter((it) => it.id !== id)
  setDraft({ ...draft.value, items })
  if (selectedItemId.value === id) selectedItemId.value = items[0]?.id ?? null
}

function moveSelected(dir: -1 | 1) {
  if (!draft.value || selectedIndex.value < 0) return
  const i = selectedIndex.value
  const j = i + dir
  if (j < 0 || j >= draft.value.items.length) return
  const items = [...draft.value.items]
  const tmp = items[i]!
  items[i] = items[j]!
  items[j] = tmp
  setDraft({ ...draft.value, items })
}

function selectItem(id: string) {
  selectedItemId.value = id
  rightTab.value = 'props'
  // 选中变化由 watch(selectedItemId) 触发重绘；同控件上拖动时不要重建 DOM，否则丢指针捕获
}

function parseWriteValue(raw: string): string | number | boolean {
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t)
  return raw
}

function itemTypeLabel(type: Object3DPanelItem['type']) {
  if (type === 'value') return '数值'
  if (type === 'button') return '按钮'
  if (type === 'image') return '图片'
  return '文本'
}

function itemTypeShort(type: Object3DPanelItem['type']) {
  if (type === 'value') return '值'
  if (type === 'button') return '钮'
  if (type === 'image') return '图'
  return '文'
}

function itemDisplayName(item: Object3DPanelItem, index: number) {
  return item.text?.trim() || `${itemTypeLabel(item.type)}${index + 1}`
}

function onPaletteDragStart(e: DragEvent, type: Object3DPanelItem['type']) {
  e.dataTransfer?.setData('text/plain', `${PALETTE_PREFIX}${type}`)
  e.dataTransfer!.effectAllowed = 'copy'
}

function stageLocalPoint(e: { clientX: number; clientY: number }) {
  const stage = stageEl.value
  if (!stage) return null
  const rect = stage.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((e.clientX - rect.left) / rect.width) * panelW.value,
    y: ((e.clientY - rect.top) / rect.height) * panelH.value,
  }
}

function onStageDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onStageDrop(e: DragEvent) {
  const raw = e.dataTransfer?.getData('text/plain') || ''
  if (!raw.startsWith(PALETTE_PREFIX)) return
  const type = raw.slice(PALETTE_PREFIX.length) as Object3DPanelItem['type']
  if (!['label', 'button', 'image'].includes(type)) return
  e.preventDefault()
  const pt = stageLocalPoint(e)
  if (!pt) {
    addItem(type)
    return
  }
  addItem(type, pt)
}

function syncItemDom(itemId: string, opts?: { applyFit?: boolean }) {
  if (!draft.value || !stageEl.value) return
  const idx = draft.value.items.findIndex((it) => it.id === itemId)
  const item = draft.value.items[idx]
  if (!item || idx < 0) return
  const node = stageEl.value.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`) as HTMLElement | null
  if (!node) return
  const rect = resolvePanelItemRect(item, idx)
  const prevW = parseFloat(node.style.width) || 0
  const prevH = parseFloat(node.style.height) || 0
  node.style.left = `${rect.x}px`
  node.style.top = `${rect.y}px`
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.classList.toggle('is-selected', itemId === selectedItemId.value)
  applyPanelItemTypography(node, item)
  // 纯平移时不要重算填充缩放：选中手柄会被算进尺寸，字会突然变大，松手重绘又恢复
  const sizeChanged = prevW !== rect.width || prevH !== rect.height
  if (opts?.applyFit === true || (opts?.applyFit !== false && sizeChanged)) {
    applyPanelItemContentFit(node, item, resolvePanelObjectFit(draft.value))
  }
}

function beginItemDrag(
  e: PointerEvent,
  itemId: string,
  mode: 'move' | 'resize',
  handle?: ResizeHandle,
) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  selectItem(itemId)
  if (!draft.value) return
  const idx = draft.value.items.findIndex((it) => it.id === itemId)
  const item = draft.value.items[idx]
  if (!item || idx < 0) return
  const rect = resolvePanelItemRect(item, idx)
  dragState.value = {
    itemId,
    mode,
    handle,
    startX: e.clientX,
    startY: e.clientY,
    origX: rect.x,
    origY: rect.y,
    origW: rect.width,
    origH: rect.height,
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onItemPointerDown(e: PointerEvent, itemId: string) {
  // 点在缩放手柄上时由手柄自己处理
  if ((e.target as HTMLElement | null)?.closest?.('.panel-resize-handle')) return
  beginItemDrag(e, itemId, 'move')
}

function computeResizeRect(d: DragState, dx: number, dy: number) {
  let x = d.origX
  let y = d.origY
  let width = d.origW
  let height = d.origH
  const h = d.handle
  if (!h) return { x, y, width, height }
  if (h.includes('e')) width = d.origW + dx
  if (h.includes('s')) height = d.origH + dy
  if (h.includes('w')) {
    width = d.origW - dx
    x = d.origX + dx
  }
  if (h.includes('n')) {
    height = d.origH - dy
    y = d.origY + dy
  }
  return { x, y, width, height }
}

function onItemPointerMove(e: PointerEvent) {
  const d = dragState.value
  if (!d) return
  const dx = (e.clientX - d.startX) / (viewScale.value.x || 1)
  const dy = (e.clientY - d.startY) / (viewScale.value.y || 1)
  if (d.mode === 'resize') {
    patchItemRect(d.itemId, computeResizeRect(d, dx, dy), false)
  } else {
    patchItemRect(d.itemId, { x: d.origX + dx, y: d.origY + dy }, false)
  }
}

function onItemPointerUp(e: PointerEvent) {
  const d = dragState.value
  if (!d) return
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  const dx = (e.clientX - d.startX) / (viewScale.value.x || 1)
  const dy = (e.clientY - d.startY) / (viewScale.value.y || 1)
  if (d.mode === 'resize') {
    patchItemRect(d.itemId, computeResizeRect(d, dx, dy), true)
  } else {
    patchItemRect(d.itemId, { x: d.origX + dx, y: d.origY + dy }, true)
  }
  dragState.value = null
}

function bindItemDrag(el: HTMLElement, itemId: string) {
  el.addEventListener('pointerdown', (e) => onItemPointerDown(e, itemId))
  el.addEventListener('pointermove', onItemPointerMove)
  el.addEventListener('pointerup', onItemPointerUp)
  el.addEventListener('pointercancel', onItemPointerUp)
}

function attachResizeHandles(node: HTMLElement, itemId: string) {
  const handles: ResizeHandle[] = ['nw', 'ne', 'sw', 'se']
  for (const handle of handles) {
    const grip = document.createElement('div')
    grip.className = `panel-resize-handle panel-resize-handle--${handle}`
    grip.addEventListener('pointerdown', (e) => beginItemDrag(e, itemId, 'resize', handle))
    grip.addEventListener('pointermove', onItemPointerMove)
    grip.addEventListener('pointerup', onItemPointerUp)
    grip.addEventListener('pointercancel', onItemPointerUp)
    node.appendChild(grip)
  }
}

function clearItemFontSize() {
  if (!draft.value || !selectedItemId.value) return
  const items = draft.value.items.map((it) => {
    if (it.id !== selectedItemId.value) return it
    const next = { ...it }
    delete next.fontSize
    return next
  })
  setDraft({ ...draft.value, items })
}

function clearItemColor() {
  if (!draft.value || !selectedItemId.value) return
  const items = draft.value.items.map((it) => {
    if (it.id !== selectedItemId.value) return it
    const next = { ...it }
    delete next.color
    return next
  })
  setDraft({ ...draft.value, items })
}

function renderPreview() {
  const host = previewHost.value
  if (!host) return
  host.innerHTML = ''
  stageEl.value = null
  if (!draft.value) {
    const empty = document.createElement('div')
    empty.className = 'preview-empty'
    empty.textContent = '从左侧拖入控件，或点击添加'
    host.appendChild(empty)
    return
  }
  ensureObject3dPanelStyles()
  const panel = draft.value
  const logicalW = panelW.value
  const logicalH = panelH.value
  const boxW = Math.max(1, host.clientWidth)
  const boxH = Math.max(1, host.clientHeight)
  const totalH = TITLE_BAR_H + logicalH
  const scaleX = boxW / logicalW
  const scaleY = boxH / totalH
  viewScale.value = { x: scaleX, y: scaleY }

  const shell = document.createElement('div')
  shell.className = 'scada-3d-panel scada-3d-panel--designer preview-panel'
  shell.style.width = `${logicalW}px`
  shell.style.height = `${totalH}px`
  shell.style.fontSize = `${defaultPanelFontSize(logicalW, logicalH)}px`
  shell.style.transform = `scale(${scaleX}, ${scaleY})`
  shell.style.transformOrigin = '0 0'
  shell.style.marginTop = '0'

  const titleEl = document.createElement('div')
  titleEl.className = 'scada-3d-panel__title'
  titleEl.style.height = `${TITLE_BAR_H}px`
  titleEl.textContent = panel.title?.trim() || obj.value?.name || '面板'
  shell.appendChild(titleEl)

  const stage = document.createElement('div')
  stage.className = 'scada-3d-panel__stage preview-stage'
  stage.style.width = `${logicalW}px`
  stage.style.height = `${logicalH}px`
  stage.addEventListener('dragover', onStageDragOver)
  stage.addEventListener('drop', onStageDrop)
  stage.addEventListener('pointerdown', () => {
    selectedItemId.value = null
    rightTab.value = 'props'
    nextTick(() => renderPreview())
  })
  shell.appendChild(stage)
  stageEl.value = stage

  const panelFit = resolvePanelObjectFit(panel)
  panel.items.forEach((item, index) => {
    const rect = resolvePanelItemRect(item, index)
    const selected = item.id === selectedItemId.value
    let node: HTMLElement
    if (item.type === 'label') {
      node = document.createElement('div')
      node.className = 'scada-3d-panel__item scada-3d-panel__text'
      node.textContent = item.text || '文本'
    } else if (item.type === 'value') {
      node = document.createElement('div')
      node.className = 'scada-3d-panel__item scada-3d-panel__row'
      const lab = document.createElement('span')
      lab.className = 'scada-3d-panel__label'
      lab.textContent = item.text || item.tagId || '数值'
      const val = document.createElement('span')
      val.className = 'scada-3d-panel__value'
      val.textContent = '--'
      node.append(lab, val)
    } else if (item.type === 'button') {
      node = document.createElement('div')
      node.className = 'scada-3d-panel__item'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'scada-3d-panel__btn'
      btn.textContent = item.text || '按钮'
      btn.tabIndex = -1
      node.appendChild(btn)
    } else {
      node = document.createElement('div')
      node.className = 'scada-3d-panel__item scada-3d-panel__img-wrap'
      const url = item.resourceId ? project.getResourceUrl(item.resourceId) : undefined
      if (url) {
        const img = document.createElement('img')
        img.className = 'scada-3d-panel__img'
        img.src = url
        img.alt = item.text || '图片'
        img.draggable = false
        node.appendChild(img)
      } else {
        const ph = document.createElement('div')
        ph.className = 'scada-3d-panel__img-placeholder'
        ph.textContent = item.text || '未选图片'
        node.appendChild(ph)
      }
    }
    node.dataset.itemId = item.id
    node.style.left = `${rect.x}px`
    node.style.top = `${rect.y}px`
    node.style.width = `${rect.width}px`
    node.style.height = `${rect.height}px`
    node.style.zIndex = String(index + 1)
    node.classList.toggle('is-selected', selected)
    node.style.cursor = 'move'
    applyPanelItemTypography(node, item)
    applyPanelItemContentFit(node, item, panelFit)
    bindItemDrag(node, item.id)
    if (selected) attachResizeHandles(node, item.id)
    stage.appendChild(node)
  })

  host.appendChild(shell)
}

function ensureHostResizeObserver() {
  if (hostResizeObserver || typeof ResizeObserver === 'undefined') return
  hostResizeObserver = new ResizeObserver(() => {
    if (project.object3dPanelEditorOpen && draft.value) renderPreview()
  })
  if (previewHost.value) hostResizeObserver.observe(previewHost.value)
}

watch(previewHost, (el, prev) => {
  if (prev && hostResizeObserver) hostResizeObserver.unobserve(prev)
  if (el) {
    ensureHostResizeObserver()
    hostResizeObserver?.observe(el)
    nextTick(() => renderPreview())
  }
})

watch(selectedItemId, () => nextTick(() => renderPreview()))

onBeforeUnmount(() => {
  dragState.value = null
  hostResizeObserver?.disconnect()
  hostResizeObserver = null
})

function onCancel() {
  dialogVisible.value = false
}

function onConfirm() {
  if (!obj.value) {
    dialogVisible.value = false
    return
  }
  project.updateObject3d(obj.value.id, { panel: draft.value ? clonePanel(draft.value) : undefined })
  dialogVisible.value = false
}

function enablePanel() {
  setDraft(createDefaultObject3DPanel(obj.value?.name || '操作面板'))
  selectedItemId.value = draft.value?.items[0]?.id ?? null
}

function disablePanel() {
  setDraft(null)
  selectedItemId.value = null
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="面板编辑"
    fullscreen
    append-to-body
    :close-on-click-modal="false"
    destroy-on-close
    class="panel-visual-editor-dialog"
    @closed="draft = null"
  >
    <div v-if="!obj" class="empty">
      <p>请先在 3D 场景中选中一个对象</p>
      <div class="editor-footer">
        <el-button @click="onCancel">取消</el-button>
      </div>
    </div>
    <div v-else class="editor-shell">
      <div class="editor">
      <aside class="palette">
        <div class="section-title">基础</div>
        <div class="palette-grid">
          <button
            type="button"
            class="palette-item"
            draggable="true"
            title="拖到画布，或点击添加"
            @click="addItem('label')"
            @dragstart="(e) => onPaletteDragStart(e, 'label')"
          >
            <span class="palette-icon palette-icon--text">T</span>
            <span class="palette-label">文本</span>
          </button>
          <button
            type="button"
            class="palette-item"
            draggable="true"
            title="拖到画布，或点击添加"
            @click="addItem('image')"
            @dragstart="(e) => onPaletteDragStart(e, 'image')"
          >
            <span class="palette-icon palette-icon--img" />
            <span class="palette-label">图片</span>
          </button>
          <button
            type="button"
            class="palette-item"
            draggable="true"
            title="拖到画布，或点击添加"
            @click="addItem('button')"
            @dragstart="(e) => onPaletteDragStart(e, 'button')"
          >
            <span class="palette-icon palette-icon--btn">Btn</span>
            <span class="palette-label">按钮</span>
          </button>
        </div>
        <p class="palette-hint">拖到中间画布任意位置</p>
      </aside>

      <section class="workspace">
        <div class="canvas-toolbar">
          <button type="button" class="tool-btn" :disabled="!canUndo" title="撤销" @click="undo">&#8630;</button>
          <button type="button" class="tool-btn" :disabled="!canRedo" title="重做" @click="redo">&#8631;</button>
          <span class="tool-sep" />
          <button
            type="button"
            class="tool-btn"
            :disabled="selectedIndex < 0 || selectedIndex === 0"
            title="下移一层"
            @click="moveSelected(-1)"
          >
            &#9660;
          </button>
          <button
            type="button"
            class="tool-btn"
            :disabled="!draft || selectedIndex < 0 || selectedIndex >= draft.items.length - 1"
            title="上移一层"
            @click="moveSelected(1)"
          >
            &#9650;
          </button>
        </div>
        <div class="canvas">
          <div ref="previewHost" class="preview-host" />
        </div>
      </section>

      <aside class="side">
        <div class="side-tabs">
          <button
            type="button"
            class="side-tab"
            :class="{ active: rightTab === 'props' }"
            @click="rightTab = 'props'"
          >
            属性
          </button>
          <button
            type="button"
            class="side-tab"
            :class="{ active: rightTab === 'list' }"
            @click="rightTab = 'list'"
          >
            列表
          </button>
        </div>

        <div v-if="rightTab === 'list'" class="side-body">
          <div v-if="!draft?.items.length" class="side-empty">暂无组件</div>
          <div
            v-for="(item, i) in draft?.items ?? []"
            :key="item.id"
            class="list-row"
            :class="{ active: item.id === selectedItemId }"
            @click="selectItem(item.id)"
          >
            <span class="list-badge">({{ itemTypeShort(item.type) }})</span>
            <span class="list-name">{{ itemDisplayName(item, i) }}</span>
            <button type="button" class="list-del" title="删除" @click.stop="removeItem(item.id)">×</button>
          </div>
        </div>

        <div v-else class="side-body props-body">
          <template v-if="!draft">
            <p class="side-hint">当前对象未启用面板</p>
            <el-button type="primary" size="small" @click="enablePanel">启用面板</el-button>
          </template>
          <template v-else>
            <div class="prop-block">
              <div class="prop-block-title">面板</div>
              <label class="field">
                <span>标题</span>
                <el-input
                  size="small"
                  :model-value="draft.title || ''"
                  placeholder="默认用对象名"
                  @update:model-value="(v: string) => updateMeta({ title: v })"
                />
              </label>
              <div class="field-row">
                <label class="field">
                  <span>宽</span>
                  <el-input-number
                    size="small"
                    :model-value="draft.width ?? DEFAULT_PANEL_CONTENT_WIDTH"
                    :min="MIN_PANEL_CONTENT_WIDTH"
                    :max="MAX_PANEL_CONTENT_SIZE"
                    :step="8"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateMeta({ width: Number(v) || DEFAULT_PANEL_CONTENT_WIDTH })"
                  />
                </label>
                <label class="field">
                  <span>高</span>
                  <el-input-number
                    size="small"
                    :model-value="draft.height ?? DEFAULT_PANEL_CONTENT_HEIGHT"
                    :min="MIN_PANEL_CONTENT_HEIGHT"
                    :max="MAX_PANEL_CONTENT_SIZE"
                    :step="8"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateMeta({ height: Number(v) || DEFAULT_PANEL_CONTENT_HEIGHT })"
                  />
                </label>
              </div>
              <label class="field">
                <span>填充方式</span>
                <el-select
                  size="small"
                  :model-value="draft.objectFit || 'none'"
                  @update:model-value="(v: string) => updateMeta({ objectFit: (v as 'none' | 'contain' | 'cover' | 'fill') || 'none' })"
                >
                  <el-option label="原始大小" value="none" />
                  <el-option label="适应" value="contain" />
                  <el-option label="裁剪铺满" value="cover" />
                  <el-option label="拉伸铺满" value="fill" />
                </el-select>
              </label>
              <el-button size="small" type="danger" plain @click="disablePanel">关闭面板</el-button>
            </div>

            <div v-if="selectedItem && selectedRect" class="prop-block">
              <div class="prop-block-title">{{ itemTypeLabel(selectedItem.type) }}</div>
              <label class="field">
                <span>名称 / 文案</span>
                <el-input
                  size="small"
                  :model-value="selectedItem.text || ''"
                  @update:model-value="(v: string) => updateItem({ text: v })"
                />
              </label>
              <div class="field-row">
                <label class="field">
                  <span>X</span>
                  <el-input-number
                    size="small"
                    :model-value="selectedRect.x"
                    :step="1"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateItem({ x: Number(v) || 0 })"
                  />
                </label>
                <label class="field">
                  <span>Y</span>
                  <el-input-number
                    size="small"
                    :model-value="selectedRect.y"
                    :step="1"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateItem({ y: Number(v) || 0 })"
                  />
                </label>
              </div>
              <div class="field-row">
                <label class="field">
                  <span>宽</span>
                  <el-input-number
                    size="small"
                    :model-value="selectedRect.width"
                    :min="24"
                    :step="1"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateItem({ width: Number(v) || 24 })"
                  />
                </label>
                <label class="field">
                  <span>高</span>
                  <el-input-number
                    size="small"
                    :model-value="selectedRect.height"
                    :min="16"
                    :step="1"
                    controls-position="right"
                    @update:model-value="(v: number | undefined) => updateItem({ height: Number(v) || 16 })"
                  />
                </label>
              </div>
              <template v-if="selectedItem.type !== 'image'">
                <div class="field-row">
                  <label class="field">
                    <span>字号</span>
                    <el-input-number
                      size="small"
                      :model-value="selectedItem.fontSize ?? panelBaseFontSize"
                      :min="4"
                      :max="72"
                      :step="1"
                      controls-position="right"
                      @update:model-value="(v: number | undefined) => updateItem({ fontSize: Math.max(4, Number(v) || panelBaseFontSize) })"
                    />
                  </label>
                  <div class="field field-inline">
                    <span>颜色</span>
                    <div class="color-row">
                      <el-color-picker
                        size="small"
                        :model-value="selectedItem.color || undefined"
                        @update:model-value="(v: string | null) => updateItem({ color: v || undefined })"
                      />
                      <el-button
                        v-if="selectedItem.color"
                        size="small"
                        text
                        @click="clearItemColor"
                      >
                        重置
                      </el-button>
                    </div>
                  </div>
                </div>
                <el-button
                  v-if="selectedItem.fontSize != null"
                  size="small"
                  text
                  class="reset-font-btn"
                  @click="clearItemFontSize"
                >
                  字号跟随面板（当前默认 {{ panelBaseFontSize }}px）
                </el-button>
                <p v-else class="font-hint">字号默认随面板大小：{{ panelBaseFontSize }}px</p>
              </template>
              <label v-if="selectedItem.type === 'image'" class="field">
                <span>图片资源</span>
                <el-select
                  size="small"
                  filterable
                  clearable
                  :model-value="selectedItem.resourceId || ''"
                  placeholder="选择工程图片"
                  @update:model-value="(v: string) => updateItem({ resourceId: v || '' })"
                >
                  <el-option v-for="r in imageResources" :key="r.id" :label="r.name" :value="r.id" />
                </el-select>
              </label>
              <label v-if="selectedItem.type === 'value' || selectedItem.type === 'button'" class="field">
                <span>Tag</span>
                <el-select
                  size="small"
                  filterable
                  clearable
                  :model-value="selectedItem.tagId || ''"
                  @update:model-value="(v: string) => updateItem({ tagId: v || '' })"
                >
                  <el-option
                    v-for="m in tags.metas"
                    :key="m.tagId"
                    :label="formatTagOptionLabel(m)"
                    :value="m.tagId"
                  />
                </el-select>
              </label>
              <template v-if="selectedItem.type === 'button'">
                <label class="field">
                  <span>写值</span>
                  <el-input
                    size="small"
                    :model-value="selectedItem.writeValue == null ? '' : String(selectedItem.writeValue)"
                    @update:model-value="(v: string) => updateItem({ writeValue: parseWriteValue(v) })"
                  />
                </label>
                <el-checkbox
                  :model-value="selectedItem.confirm !== false"
                  @update:model-value="(v: boolean | string | number) => updateItem({ confirm: Boolean(v) })"
                >
                  写前确认
                </el-checkbox>
              </template>
            </div>
            <p v-else class="side-hint">拖入控件后可拖动位置；选中后拖四角改大小</p>
          </template>
        </div>
      </aside>
      </div>
      <div class="editor-footer">
        <el-button @click="onCancel">取消</el-button>
        <el-button type="primary" @click="onConfirm">确认</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d24;
}

.empty > p {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  margin: 0;
}

.editor-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #1a1d24;
}

.editor {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr) 300px;
  gap: 0;
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: #1a1d24;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  background: #151820;
  border-top: 1px solid rgba(71, 85, 105, 0.45);
  flex-shrink: 0;
}

.palette {
  background: #151820;
  border-right: 1px solid rgba(71, 85, 105, 0.45);
  padding: 12px 10px;
  overflow: auto;
}

.section-title {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 10px;
  padding-left: 2px;
}

.palette-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.palette-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  border: none;
  background: transparent;
  cursor: grab;
  color: #cbd5e1;
  border-radius: 6px;
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item:hover {
  background: rgba(61, 139, 253, 0.12);
}

.palette-icon {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.palette-icon--img {
  background:
    linear-gradient(135deg, transparent 46%, #94a3b8 46%, #94a3b8 54%, transparent 54%),
    #f1f5f9;
}

.palette-icon--value {
  font-size: 11px;
  letter-spacing: -0.5px;
}

.palette-icon--btn {
  font-size: 11px;
}

.palette-label {
  font-size: 12px;
  color: #e2e8f0;
}

.palette-hint {
  margin: 14px 2px 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
}

.workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #12151c;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(71, 85, 105, 0.4);
  background: #171a21;
}

.tool-btn {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  border-radius: 4px;
  background: #1e2430;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tool-btn:hover:not(:disabled) {
  border-color: #3d8bfd;
  color: #93c5fd;
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tool-sep {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: rgba(100, 116, 139, 0.45);
}

.canvas {
  flex: 1;
  min-height: 0;
  display: block;
  padding: 0;
  background: #0a1628;
  overflow: hidden;
  position: relative;
}

.preview-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.preview-host :deep(.preview-empty) {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 13px;
}

.preview-host :deep(.is-selected) {
  outline: 2px solid #3d8bfd;
  outline-offset: 1px;
}

.preview-host :deep(.panel-resize-handle) {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #3d8bfd;
  border: 1px solid #fff;
  border-radius: 1px;
  z-index: 30;
  box-sizing: border-box;
  pointer-events: auto;
}

.preview-host :deep(.panel-resize-handle--nw) {
  left: -5px;
  top: -5px;
  cursor: nwse-resize;
}

.preview-host :deep(.panel-resize-handle--ne) {
  right: -5px;
  top: -5px;
  cursor: nesw-resize;
}

.preview-host :deep(.panel-resize-handle--sw) {
  left: -5px;
  bottom: -5px;
  cursor: nesw-resize;
}

.preview-host :deep(.panel-resize-handle--se) {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}

.preview-host :deep(.preview-stage) {
  outline: none;
}

.preview-host :deep(.preview-panel) {
  cursor: default;
  border-radius: 0 !important;
  max-width: none !important;
  box-shadow: none !important;
  border: none !important;
  margin: 0 !important;
  background:
    linear-gradient(180deg, rgba(14, 116, 144, 0.55) 0%, rgba(8, 47, 73, 0.95) 28%, rgba(15, 23, 42, 0.98) 100%) !important;
}

.side {
  display: flex;
  flex-direction: column;
  background: #151820;
  border-left: 1px solid rgba(71, 85, 105, 0.45);
  min-width: 0;
}

.side-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid rgba(71, 85, 105, 0.45);
}

.side-tab {
  height: 40px;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 13px;
  cursor: pointer;
}

.side-tab.active {
  color: #3d8bfd;
  box-shadow: inset 0 -2px 0 #3d8bfd;
  background: rgba(61, 139, 253, 0.06);
}

.side-body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.side-empty,
.side-hint {
  padding: 16px 8px;
  font-size: 12px;
  color: #64748b;
  text-align: center;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  color: #e2e8f0;
  font-size: 12px;
}

.list-row:hover {
  background: rgba(148, 163, 184, 0.1);
}

.list-row.active {
  background: rgba(61, 139, 253, 0.18);
}

.list-badge {
  color: #94a3b8;
  flex-shrink: 0;
}

.list-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-del {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #f87171;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}

.list-del:hover {
  color: #ef4444;
}

.props-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prop-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(71, 85, 105, 0.35);
}

.prop-block-title {
  font-size: 12px;
  font-weight: 600;
  color: #e2e8f0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #94a3b8;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field-inline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #94a3b8;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
}

.font-hint {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
}

.reset-font-btn {
  padding: 0 !important;
  height: auto !important;
  font-size: 11px !important;
  color: #64748b !important;
  justify-content: flex-start;
}

.field :deep(.el-input-number) {
  width: 100%;
}

.field :deep(.el-select) {
  width: 100%;
}
</style>

<style>
.panel-visual-editor-dialog.el-dialog.is-fullscreen {
  --el-dialog-width: 100%;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  margin: 0 !important;
  border-radius: 0 !important;
  border: none !important;
  background: #1a1d24 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-visual-editor-dialog .el-dialog__header {
  margin: 0 !important;
  padding: 12px 16px;
  text-align: center;
  background: #151820;
  border-bottom: 1px solid rgba(71, 85, 105, 0.45);
  flex-shrink: 0;
}

.panel-visual-editor-dialog .el-dialog__title {
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
}

.panel-visual-editor-dialog .el-dialog__headerbtn .el-dialog__close {
  color: #94a3b8;
}

.panel-visual-editor-dialog .el-dialog__body {
  padding: 0 !important;
  overflow: hidden;
  background: #1a1d24 !important;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel-visual-editor-dialog .el-dialog__footer {
  display: none !important;
  padding: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  border: none !important;
}
</style>
