<script setup lang="ts">
/**
 * 跟镜头面板编辑画布：固定尺寸 Konva Stage + Transformer。
 * 读写走 project store（面板编辑上下文），不复制 Canvas2DBoard 全量逻辑。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import type { Widget2D } from '@web-scada/core'
import { createKonvaStage, type KonvaStageBundle } from '@/shared/konva/createKonvaStage'
import {
  createWidgetNode,
  readTransformFromNode,
  syncWidgetNode,
} from '@/shared/konva/widgetNodes'
import { snapTransform, snapWithGuides } from '@/shared/designer/geometry'
import {
  installPointerModifierTracker,
  isAdditivePointer,
} from '@/shared/designer/designerHotkeys'
import { PANEL_EDITOR_GRID } from '@/shared/designer/panelEditorToolbar'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{
  width: number
  height: number
  /** 页面底色；有背景图时用透明以露出下方 CSS 图 */
  background?: string
  /** 面板背景图 URL（工程资源） */
  backgroundImageUrl?: string
  snapEnabled?: boolean
  gridVisible?: boolean
}>()

const project = useProjectStore()
const host = ref<HTMLDivElement | null>(null)

let bundle: KonvaStageBundle | null = null
let syncingFromModel = false
let dragHistoryPushed = false
let dragOrigin: Record<string, { x: number; y: number }> = {}
let boxRect: Konva.Rect | null = null
let boxStart: { x: number; y: number } | null = null
let bgImageNode: Konva.Image | null = null

function pageFillColor() {
  return props.backgroundImageUrl ? 'rgba(0,0,0,0)' : props.background || '#1a1d24'
}

function syncBackgroundImage() {
  if (!bundle) return
  bgImageNode?.destroy()
  bgImageNode = null
  const url = props.backgroundImageUrl?.trim()
  if (!url) {
    bundle.setPageSize(props.width, props.height, pageFillColor())
    return
  }
  // 底框透明，图片铺在 contentLayer（page-frame 下）
  bundle.setPageSize(props.width, props.height, 'rgba(0,0,0,0)')
  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (!bundle) return
    bgImageNode?.destroy()
    const iw = img.naturalWidth || img.width || 1
    const ih = img.naturalHeight || img.height || 1
    // cover
    const scale = Math.max(props.width / iw, props.height / ih)
    const w = iw * scale
    const h = ih * scale
    bgImageNode = new Konva.Image({
      name: 'panel-bg-image',
      image: img,
      x: (props.width - w) / 2,
      y: (props.height - h) / 2,
      width: w,
      height: h,
      listening: false,
    })
    bundle.contentLayer.add(bgImageNode)
    bgImageNode.moveToBottom()
    // page-frame 描边仍在上层
    const frame = bundle.contentLayer.findOne('.page-frame')
    frame?.moveToTop()
    bundle.contentLayer.batchDraw()
  }
  img.src = url
}

function snapPanelTransform(t: Widget2D['transform']): Widget2D['transform'] {
  if (!props.snapEnabled) return t
  return snapTransform(t, PANEL_EDITOR_GRID)
}

function clearWidgetNodes() {
  if (!bundle) return
  bundle.widgetLayer.getChildren((node) => node.name() === 'widget').forEach((n) => n.destroy())
}

function applySelection(ids: string[]) {
  if (!bundle) return
  const widgets = ids
    .map((id) => project.getActiveWidgets().find((w) => w.id === id))
    .filter((w): w is Widget2D => w != null && w.visible !== false)
  const editable = widgets.filter((w) => !w.locked)
  const nodes = editable
    .map((w) => bundle!.widgetLayer.findOne(`#${w.id}`))
    .filter((n): n is Konva.Node => Boolean(n))
  bundle.transformer.nodes(nodes)
  const singlePoly =
    editable.length === 1 &&
    (editable[0]!.type === 'polyline' ||
      editable[0]!.type === 'polygon' ||
      editable[0]!.type === 'pipe')
  bundle.transformer.resizeEnabled(!singlePoly)
  bundle.transformer.rotateEnabled(true)
  bundle.transformer.moveToTop()
  if (boxRect) boxRect.moveToTop()
}

function commitSelectionTransforms() {
  if (!bundle) return
  const nodes = bundle.transformer.nodes() as Konva.Group[]
  const targets = nodes.length
    ? nodes
    : project.selectedWidgetIds
        .map((id) => bundle!.widgetLayer.findOne(`#${id}`) as Konva.Group | null)
        .filter(Boolean)

  const patches: Record<string, Widget2D['transform']> = {}
  for (const node of targets) {
    if (!node) continue
    const id = String(node.getAttr('widgetId'))
    let transform = readTransformFromNode(node)
    if (props.snapEnabled) transform = snapPanelTransform(transform)
    const widget = project.getActiveWidgets().find((w) => w.id === id)
    if (!widget) continue
    syncWidgetNode(node, { ...widget, transform })
    patches[id] = transform
  }
  if (!Object.keys(patches).length) return
  if (!dragHistoryPushed) {
    project.commitWidgetTransforms(patches)
    dragHistoryPushed = true
  } else {
    project.commitWidgetTransforms(patches, { recordHistory: false })
  }
  bundle.transformer.forceUpdate()
  bundle.widgetLayer.batchDraw()
}

function bindWidgetEvents(group: Konva.Group) {
  group.on('mousedown', (e) => {
    const id = String(group.getAttr('widgetId'))
    if (e.evt.button === 2) {
      e.cancelBubble = true
      if (!project.selectedWidgetIds.includes(id)) {
        project.selectWidget(id)
        applySelection(project.selectedWidgetIds)
      }
      return
    }
    if (e.evt.button !== 0) return
    e.cancelBubble = true
    project.selectWidget(id, { additive: isAdditivePointer(e.evt) })
    applySelection(project.selectedWidgetIds)
  })

  group.on('dragstart', () => {
    if (syncingFromModel) return
    dragHistoryPushed = false
    dragOrigin = {}
    for (const sid of project.selectedWidgetIds) {
      const w = project.getActiveWidgets().find((item) => item.id === sid)
      if (w) dragOrigin[sid] = { x: w.transform.x, y: w.transform.y }
    }
  })

  group.on('dragmove', () => {
    if (syncingFromModel || !bundle) return
    const ids = project.selectedWidgetIds
    const primaryId = String(group.getAttr('widgetId'))
    if (!ids.includes(primaryId)) return
    const widget = project.getActiveWidgets().find((w) => w.id === primaryId)
    if (!widget) return

    const moving = {
      x: group.x(),
      y: group.y(),
      width: widget.transform.width,
      height: Math.max(widget.transform.height, 1),
    }
    const others = project
      .getActiveWidgets()
      .filter((w) => !ids.includes(w.id))
      .map((w) => ({
        x: w.transform.x,
        y: w.transform.y,
        width: w.transform.width,
        height: Math.max(w.transform.height, 1),
      }))

    const snapped = snapWithGuides(moving, others, {
      snapGrid: props.snapEnabled !== false,
      grid: PANEL_EDITOR_GRID,
    })
    group.position({ x: snapped.x, y: snapped.y })
    bundle.showGuides(snapped.guides)

    if (ids.length > 1) {
      const origin = dragOrigin[primaryId]
      if (origin) {
        const dx = snapped.x - origin.x
        const dy = snapped.y - origin.y
        for (const id of ids) {
          if (id === primaryId) continue
          const node = bundle.widgetLayer.findOne(`#${id}`) as Konva.Group | null
          const srcOrigin = dragOrigin[id]
          const src = project.getActiveWidgets().find((w) => w.id === id)
          if (!node || !src || src.locked || !srcOrigin) continue
          node.position({ x: srcOrigin.x + dx, y: srcOrigin.y + dy })
        }
      }
    }
    bundle.transformer.forceUpdate()
  })

  group.on('dragend', () => {
    if (syncingFromModel) return
    bundle?.clearGuides()
    commitSelectionTransforms()
  })

  group.on('transformstart', () => {
    if (syncingFromModel) return
    dragHistoryPushed = false
  })

  group.on('transformend', () => {
    if (syncingFromModel) return
    commitSelectionTransforms()
  })
}

function renderAllWidgets() {
  if (!bundle) return
  syncingFromModel = true
  clearWidgetNodes()
  for (const widget of project.getActiveWidgets()) {
    if (widget.type === 'scene3d') continue
    if (widget.visible === false) continue
    const node = createWidgetNode(widget)
    node.draggable(!widget.locked)
    bindWidgetEvents(node)
    bundle.widgetLayer.add(node)
  }
  bundle.transformer.moveToTop()
  applySelection(project.selectedWidgetIds)
  if (boxRect) boxRect.moveToTop()
  bundle.widgetLayer.batchDraw()
  syncingFromModel = false
}

function ensureBoxRect() {
  if (!bundle || boxRect) return
  boxRect = new Konva.Rect({
    name: 'selection-box',
    fill: 'rgba(61,139,253,0.15)',
    stroke: '#3d8bfd',
    strokeWidth: 1,
    dash: [4, 4],
    visible: false,
    listening: false,
  })
  bundle.widgetLayer.add(boxRect)
}

let boxAdditive = false

function onStagePointerDown(e: Konva.KonvaEventObject<MouseEvent>) {
  if (!bundle || e.target !== bundle.stage) return
  if (e.evt.button !== 0) return
  const pointer = bundle.stage.getPointerPosition()
  if (!pointer) return
  const pt = bundle.toPagePoint(pointer)
  boxStart = pt
  boxAdditive = isAdditivePointer(e.evt)
  ensureBoxRect()
  if (boxRect) {
    boxRect.visible(true)
    boxRect.position(pt)
    boxRect.size({ width: 0, height: 0 })
  }
  if (!boxAdditive) {
    project.selectWidget(null)
    applySelection([])
  }
}

function onStagePointerMove() {
  if (!bundle || !boxStart || !boxRect) return
  const pointer = bundle.stage.getPointerPosition()
  if (!pointer) return
  const pt = bundle.toPagePoint(pointer)
  const x = Math.min(boxStart.x, pt.x)
  const y = Math.min(boxStart.y, pt.y)
  const width = Math.abs(pt.x - boxStart.x)
  const height = Math.abs(pt.y - boxStart.y)
  boxRect.position({ x, y })
  boxRect.size({ width, height })
  bundle.widgetLayer.batchDraw()
}

function onStagePointerUp() {
  if (!bundle || !boxStart || !boxRect) {
    boxStart = null
    boxAdditive = false
    return
  }
  const additive = boxAdditive
  const box = {
    x: boxRect.x(),
    y: boxRect.y(),
    width: boxRect.width(),
    height: boxRect.height(),
  }
  boxRect.visible(false)
  boxStart = null
  boxAdditive = false
  if (box.width < 4 && box.height < 4) return
  const hits = project.getActiveWidgets().filter((w) => {
    if (w.visible === false || w.type === 'scene3d') return false
    const t = w.transform
    return !(
      t.x + t.width < box.x ||
      t.x > box.x + box.width ||
      t.y + t.height < box.y ||
      t.y > box.y + box.height
    )
  })
  if (!hits.length) return
  const hitIds = hits.map((w) => w.id)
  if (additive) {
    project.setSelection([...new Set([...project.selectedWidgetIds, ...hitIds])])
  } else {
    project.setSelection(hitIds)
  }
  applySelection(project.selectedWidgetIds)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (!bundle || !host.value) return
  const type = e.dataTransfer?.getData('application/x-scada-widget')
  if (!type || type === 'scene3d') return
  const rect = host.value.getBoundingClientRect()
  const pt = bundle.toPagePoint({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  })
  project.addWidget(type as never, { x: pt.x, y: pt.y })
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

onMounted(() => {
  installPointerModifierTracker()
  if (!host.value) return
  bundle = createKonvaStage(host.value, {
    width: props.width,
    height: props.height,
    background: pageFillColor(),
  })
  bundle.setGridVisible(props.gridVisible !== false)
  bundle.stage.on('mousedown', onStagePointerDown)
  bundle.stage.on('mousemove', onStagePointerMove)
  bundle.stage.on('mouseup', onStagePointerUp)
  syncBackgroundImage()
  renderAllWidgets()
  bundle.fitToView()
})

onBeforeUnmount(() => {
  bgImageNode?.destroy()
  bgImageNode = null
  bundle?.dispose()
  bundle = null
  boxRect = null
})

watch(
  () => [props.width, props.height, props.background, props.backgroundImageUrl] as const,
  () => {
    syncBackgroundImage()
    bundle?.fitToView()
  },
)

watch(
  () => props.gridVisible,
  (v) => bundle?.setGridVisible(v !== false),
)

watch(
  () => project.getActiveWidgets(),
  () => renderAllWidgets(),
  { deep: true },
)

watch(
  () => [...project.selectedWidgetIds],
  (ids) => applySelection(ids),
)

defineExpose({
  fitToView: () => bundle?.fitToView(),
  refresh: () => renderAllWidgets(),
})
</script>

<template>
  <div
    ref="host"
    class="panel-konva-board"
    @dragover="onDragOver"
    @drop="onDrop"
  />
</template>

<style scoped>
.panel-konva-board {
  width: 100%;
  height: 100%;
  min-height: 240px;
  background: #0f1218;
  overflow: hidden;
}
</style>
