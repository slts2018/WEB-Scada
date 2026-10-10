<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  createWidget2D,
  isDrawToolType,
  normalizePolyPoints,
  type BuiltinWidgetType,
  type Page2D,
  type Widget2D,
} from '@web-scada/core'
import Konva from 'konva'
import { createKonvaStage, type KonvaStageBundle } from '@/shared/konva/createKonvaStage'
import {
  createWidgetNode,
  readTransformFromNode,
  syncWidgetNode,
} from '@/shared/konva/widgetNodes'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { collectPageTagIds, resolveWidgetVisual } from '@/shared/runtime/bindingEngine'
import { rectsIntersect, snapTransform, snapWithGuides } from '@/shared/designer/geometry'
import { isDesignerCanvasContext, isTypingTarget } from '@/shared/designer/designerHotkeys'

const RULER = 24
const DND_TYPE = 'application/x-scada-widget'

const props = defineProps<{
  page: Page2D
  /** 可选页面/面板背景图（如跟镜头面板 backgroundResourceId） */
  backgroundImageUrl?: string
}>()

const project = useProjectStore()
const tags = useTagStore()
const host = ref<HTMLDivElement | null>(null)
const rulerX = ref<HTMLCanvasElement | null>(null)
const rulerY = ref<HTMLCanvasElement | null>(null)
const zoomPercent = ref(100)
const handMode = ref(false)
const ctxMenu = ref<{
  visible: boolean
  x: number
  y: number
  pageX: number
  pageY: number
}>({ visible: false, x: 0, y: 0, pageX: 0, pageY: 0 })

let bundle: KonvaStageBundle | null = null
let syncingFromModel = false
let boxRect: Konva.Rect | null = null
let boxStart: { x: number; y: number } | null = null
let dragHistoryPushed = false
let dragOrigin: Record<string, { x: number; y: number }> = {}
/** 绘制中的页面坐标点列 */
let drawPoints: number[] = []
let drawPreview: Konva.Line | null = null
let drawCursor: Konva.Circle | null = null
let vertexLayer: Konva.Group | null = null
let lastDrawClickAt = 0
let removeTagListener: (() => void) | null = null
const previewBlinkTimers = new Map<string, ReturnType<typeof setInterval>>()
let rulerDragging: { orientation: 'h' | 'v' } | null = null
let rulerGhost: Konva.Line | null = null
let bgImageNode: Konva.Image | null = null
let bgImageLoadToken = 0

function pageFillColor() {
  return props.backgroundImageUrl?.trim()
    ? 'rgba(0,0,0,0)'
    : props.page.background || '#1a1d24'
}

function syncBackgroundImage() {
  if (!bundle) return
  bgImageNode?.destroy()
  bgImageNode = null
  const url = props.backgroundImageUrl?.trim()
  bundle.setPageSize(props.page.width, props.page.height, pageFillColor())
  if (!url) {
    bundle.contentLayer.batchDraw()
    return
  }
  const token = ++bgImageLoadToken
  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (!bundle || token !== bgImageLoadToken) return
    bgImageNode?.destroy()
    const iw = img.naturalWidth || img.width || 1
    const ih = img.naturalHeight || img.height || 1
    const scale = Math.max(props.page.width / iw, props.page.height / ih)
    const w = iw * scale
    const h = ih * scale
    bgImageNode = new Konva.Image({
      name: 'panel-bg-image',
      image: img,
      x: (props.page.width - w) / 2,
      y: (props.page.height - h) / 2,
      width: w,
      height: h,
      listening: false,
    })
    bundle.contentLayer.add(bgImageNode)
    bgImageNode.moveToBottom()
    const frame = bundle.contentLayer.findOne('.page-frame')
    frame?.moveToTop()
    bundle.contentLayer.batchDraw()
  }
  img.onerror = () => {
    if (token !== bgImageLoadToken) return
    // 加载失败时回退纯色底，避免透明空洞
    bundle?.setPageSize(props.page.width, props.page.height, props.page.background || '#1a1d24')
  }
  img.src = url
}

const widgetCount = computed(() =>
  props.page.layers.reduce((n, layer) => n + layer.widgets.length, 0),
)

const drawHint = computed(() => {
  if (project.previewLive) return '实时预览中：动画随 Tag 刷新（只读预览，不写回工程）'
  if (project.drawTool === 'polyline') return '绘制折线：单击加点 · 双击/Enter 完成 · Esc 取消'
  if (project.drawTool === 'polygon') return '绘制多边形：单击加点 · 双击/Enter 完成 · Esc 取消'
  if (project.drawTool === 'pipe') return '绘制管线：单击加点 · 双击/Enter 完成 · Esc 取消'
  return '点画布后：拖放添加 · Ctrl+C/V 复制粘贴 · Delete 删除 · 方向键微调'
})

function paintRulers(view?: { scale: number; x: number; y: number }) {
  const v = view ?? bundle?.getView()
  if (!v || !rulerX.value || !rulerY.value || !host.value) return
  const { scale, x, y } = v
  zoomPercent.value = Math.round(scale * 100)
  const w = host.value.clientWidth
  const h = host.value.clientHeight

  const cx = rulerX.value.getContext('2d')
  const cy = rulerY.value.getContext('2d')
  if (!cx || !cy) return

  rulerX.value.width = w
  rulerX.value.height = RULER
  rulerY.value.width = RULER
  rulerY.value.height = h

  cx.fillStyle = '#151821'
  cx.fillRect(0, 0, w, RULER)
  cy.fillStyle = '#151821'
  cy.fillRect(0, 0, RULER, h)
  cx.strokeStyle = cy.strokeStyle = '#3d4454'
  cx.fillStyle = cy.fillStyle = '#9aa3b2'
  cx.font = cy.font = '10px sans-serif'

  const step = scale >= 1.2 ? 50 : scale >= 0.6 ? 100 : 200
  const startX = Math.floor(-x / scale / step) * step
  const endX = Math.ceil((-x + w) / scale / step) * step
  for (let px = startX; px <= endX; px += step) {
    const sx = x + px * scale
    cx.beginPath()
    cx.moveTo(sx + 0.5, RULER)
    cx.lineTo(sx + 0.5, RULER - (px % (step * 2) === 0 ? 10 : 6))
    cx.stroke()
    if (px % (step * 2) === 0) cx.fillText(String(px), sx + 3, 10)
  }

  const startY = Math.floor(-y / scale / step) * step
  const endY = Math.ceil((-y + h) / scale / step) * step
  for (let py = startY; py <= endY; py += step) {
    const sy = y + py * scale
    cy.beginPath()
    cy.moveTo(RULER, sy + 0.5)
    cy.lineTo(RULER - (py % (step * 2) === 0 ? 10 : 6), sy + 0.5)
    cy.stroke()
    if (py % (step * 2) === 0) {
      cy.save()
      cy.translate(10, sy + 3)
      cy.rotate(-Math.PI / 2)
      cy.fillText(String(py), 0, 0)
      cy.restore()
    }
  }
}

function clearWidgetNodes() {
  if (!bundle) return
  bundle.widgetLayer.getChildren((node) => node.name() === 'widget').forEach((n) => n.destroy())
}

function renderAllWidgets() {
  if (!bundle) return
  syncingFromModel = true
  clearWidgetNodes()
  for (const layer of props.page.layers) {
    if (!layer.visible) continue
    for (const widget of layer.widgets) {
      const node = createWidgetNode(widget)
      node.draggable(!widget.locked && !layer.locked)
      bindWidgetEvents(node)
      bundle.widgetLayer.add(node)
    }
  }
  bundle.transformer.moveToTop()
  applySelection(project.selectedWidgetIds)
  if (boxRect) boxRect.moveToTop()
  bundle.widgetLayer.batchDraw()
  syncingFromModel = false
  syncPageGuides()
  if (project.previewLive) applyDesignerPreview()
}

function clearPreviewBlink() {
  for (const t of previewBlinkTimers.values()) clearInterval(t)
  previewBlinkTimers.clear()
}

function syncPageGuides() {
  if (!bundle) return
  bundle.guideLayer.find('.page-guide').forEach((n) => n.destroy())
  const guides = props.page.guides ?? []
  const pad = 2000
  for (const g of guides) {
    const line = new Konva.Line({
      name: 'page-guide',
      id: g.id,
      points:
        g.orientation === 'v'
          ? [g.pos, -pad, g.pos, props.page.height + pad]
          : [-pad, g.pos, props.page.width + pad, g.pos],
      stroke: '#38bdf8',
      strokeWidth: 1,
      dash: [6, 4],
      hitStrokeWidth: 10,
      draggable: true,
    })
    line.on('dragmove', () => {
      if (g.orientation === 'v') line.y(0)
      else line.x(0)
    })
    line.on('dragend', () => {
      if (g.orientation === 'v') {
        const pos = g.pos + line.x()
        line.x(0)
        project.updateGuide(g.id, Math.round(pos))
      } else {
        const pos = g.pos + line.y()
        line.y(0)
        project.updateGuide(g.id, Math.round(pos))
      }
    })
    line.on('dblclick dbltap', () => {
      project.removeGuide(g.id)
    })
    bundle.guideLayer.add(line)
  }
  bundle.guideLayer.batchDraw()
}

function onRulerPointerDown(orientation: 'h' | 'v', e: MouseEvent) {
  if (!bundle || !host.value || project.previewLive || project.drawTool) return
  e.preventDefault()
  rulerDragging = { orientation }
  const rect = host.value.getBoundingClientRect()
  const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  const pt = bundle.toPagePoint(pointer)
  rulerGhost?.destroy()
  const pad = 2000
  rulerGhost = new Konva.Line({
    name: 'page-guide-ghost',
    points:
      orientation === 'v'
        ? [pt.x, -pad, pt.x, props.page.height + pad]
        : [-pad, pt.y, props.page.width + pad, pt.y],
    stroke: '#7dd3fc',
    strokeWidth: 1,
    dash: [4, 4],
    listening: false,
  })
  bundle.guideLayer.add(rulerGhost)
  bundle.guideLayer.batchDraw()
}

function onRulerPointerMove(e: MouseEvent) {
  if (!rulerDragging || !bundle || !host.value || !rulerGhost) return
  const rect = host.value.getBoundingClientRect()
  const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  const pt = bundle.toPagePoint(pointer)
  const pad = 2000
  if (rulerDragging.orientation === 'v') {
    rulerGhost.points([pt.x, -pad, pt.x, props.page.height + pad])
  } else {
    rulerGhost.points([-pad, pt.y, props.page.width + pad, pt.y])
  }
  bundle.guideLayer.batchDraw()
}

function onRulerPointerUp(e: MouseEvent) {
  if (!rulerDragging || !bundle || !host.value) return
  const orientation = rulerDragging.orientation
  const rect = host.value.getBoundingClientRect()
  const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  const pt = bundle.toPagePoint(pointer)
  rulerGhost?.destroy()
  rulerGhost = null
  rulerDragging = null
  const pos = Math.round(orientation === 'v' ? pt.x : pt.y)
  if (pos < -50 || (orientation === 'v' ? pos > props.page.width + 50 : pos > props.page.height + 50)) {
    return
  }
  project.addGuide(orientation, pos)
}

function applyDesignerPreview() {
  if (!bundle || !project.previewLive) return
  clearPreviewBlink()
  clearVertexHandles()
  for (const layer of props.page.layers) {
    if (!layer.visible) continue
    for (const widget of layer.widgets) {
      const resolved = resolveWidgetVisual(widget, (id) => tags.getValue(id))
      const node = bundle.widgetLayer.findOne(`#${widget.id}`) as Konva.Group | null
      if (!node) continue
      if (resolved.widget.visible === false) {
        node.visible(false)
        continue
      }
      node.visible(true)
      syncWidgetNode(node, resolved.widget)
      node.draggable(false)
      if (resolved.blink) {
        let on = true
        const opacity = Number(resolved.widget.style.opacity ?? 1)
        previewBlinkTimers.set(
          widget.id,
          setInterval(() => {
            on = !on
            node.opacity(on ? opacity : 0.25)
            bundle?.widgetLayer.batchDraw()
          }, 400),
        )
      } else {
        node.opacity(Number(resolved.widget.style.opacity ?? 1))
      }
    }
  }
  bundle.transformer.nodes([])
  bundle.widgetLayer.batchDraw()
}

function startPreviewMode() {
  const ids = collectPageTagIds(props.page)
  tags.setPageSubscription(ids)
  removeTagListener?.()
  removeTagListener = tags.addListener(() => applyDesignerPreview())
  applyDesignerPreview()
}

function stopPreviewMode() {
  removeTagListener?.()
  removeTagListener = null
  clearPreviewBlink()
  tags.clearPageSubscription()
  renderAllWidgets()
}

function clearDrawPreview() {
  drawPreview?.destroy()
  drawCursor?.destroy()
  drawPreview = null
  drawCursor = null
  drawPoints = []
  lastDrawClickAt = 0
  bundle?.widgetLayer.batchDraw()
}

function ensureDrawPreview() {
  if (!bundle || drawPreview) return
  drawPreview = new Konva.Line({
    name: 'draw-preview',
    stroke: project.drawTool === 'polygon' ? '#93c5fd' : '#f8fafc',
    strokeWidth: 2,
    dash: [6, 4],
    lineJoin: 'round',
    lineCap: 'round',
    listening: false,
    closed: false,
  })
  drawCursor = new Konva.Circle({
    name: 'draw-cursor',
    radius: 4,
    fill: '#3d8bfd',
    listening: false,
  })
  bundle.widgetLayer.add(drawPreview)
  bundle.widgetLayer.add(drawCursor)
}

function updateDrawPreview(cursor?: { x: number; y: number }) {
  if (!bundle || !project.drawTool) return
  ensureDrawPreview()
  if (!drawPreview || !drawCursor) return
  const pts = cursor ? [...drawPoints, cursor.x, cursor.y] : [...drawPoints]
  drawPreview.points(pts.length >= 2 ? pts : [])
  if (cursor) {
    drawCursor.visible(true)
    drawCursor.position(cursor)
  } else {
    drawCursor.visible(false)
  }
  drawPreview.moveToTop()
  drawCursor.moveToTop()
  bundle.widgetLayer.batchDraw()
}

function finishDraw() {
  const tool = project.drawTool
  if (!tool) return
  const minPts = tool === 'polygon' ? 3 : 2
  if (drawPoints.length / 2 < minPts) {
    clearDrawPreview()
    project.cancelDrawTool()
    return
  }
  const norm = normalizePolyPoints(drawPoints)
  const widget = createWidget2D(tool, {
    transform: {
      x: norm.x,
      y: norm.y,
      width: norm.width,
      height: norm.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    props: { points: norm.points },
  })
  clearDrawPreview()
  const inserted = project.insertWidget(widget)
  if (!inserted) {
    // 图层锁定等
  }
}

function addDrawPoint(pt: { x: number; y: number }) {
  if (!project.drawTool) return
  const now = Date.now()
  if (now - lastDrawClickAt < 320 && drawPoints.length >= 4) {
    finishDraw()
    return
  }
  lastDrawClickAt = now
  const x = project.snapEnabled ? Math.round(pt.x / 20) * 20 : pt.x
  const y = project.snapEnabled ? Math.round(pt.y / 20) * 20 : pt.y
  drawPoints.push(x, y)
  updateDrawPreview({ x, y })
}

function clearVertexHandles() {
  vertexLayer?.destroy()
  vertexLayer = null
}

function syncVertexHandles(widget: Widget2D | null) {
  clearVertexHandles()
  if (!bundle || !widget || widget.locked) return
  if (widget.type !== 'polyline' && widget.type !== 'polygon' && widget.type !== 'pipe') return
  const raw = widget.props.points
  if (!Array.isArray(raw) || raw.length < 4) return

  vertexLayer = new Konva.Group({ name: 'vertex-handles', listening: true })
  const pts = (raw as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  for (let i = 0; i < pts.length; i += 2) {
    const idx = i
    const handle = new Konva.Circle({
      x: widget.transform.x + pts[i],
      y: widget.transform.y + pts[i + 1],
      radius: 5,
      fill: '#fff',
      stroke: '#3d8bfd',
      strokeWidth: 2,
      draggable: true,
      name: 'vertex-handle',
    })
    handle.on('mousedown', (e) => {
      e.cancelBubble = true
    })
    handle.on('dragmove', () => {
      const abs: number[] = []
      for (let j = 0; j < pts.length; j += 2) {
        if (j === idx) abs.push(handle.x(), handle.y())
        else abs.push(widget.transform.x + pts[j], widget.transform.y + pts[j + 1])
      }
      const norm = normalizePolyPoints(abs)
      const node = bundle?.widgetLayer.findOne(`#${widget.id}`) as Konva.Group | null
      if (node) {
        syncWidgetNode(node, {
          ...widget,
          transform: {
            ...widget.transform,
            x: norm.x,
            y: norm.y,
            width: norm.width,
            height: norm.height,
          },
          props: { ...widget.props, points: norm.points },
        })
      }
      const children = vertexLayer?.getChildren() ?? []
      for (let k = 0; k < children.length; k++) {
        const c = children[k]
        if (c === handle) continue
        const pi = k * 2
        c.position({
          x: norm.x + norm.points[pi],
          y: norm.y + norm.points[pi + 1],
        })
      }
      bundle?.widgetLayer.batchDraw()
    })
    handle.on('dragend', () => {
      const abs: number[] = []
      for (let j = 0; j < pts.length; j += 2) {
        if (j === idx) abs.push(handle.x(), handle.y())
        else abs.push(widget.transform.x + pts[j], widget.transform.y + pts[j + 1])
      }
      const norm = normalizePolyPoints(abs)
      project.updateWidget(widget.id, {
        transform: {
          ...widget.transform,
          x: norm.x,
          y: norm.y,
          width: norm.width,
          height: norm.height,
        },
        props: { points: norm.points },
      })
    })
    vertexLayer.add(handle)
  }
  bundle.widgetLayer.add(vertexLayer)
  vertexLayer.moveToTop()
  bundle.widgetLayer.batchDraw()
}

function bindWidgetEvents(group: Konva.Group) {
  group.on('mousedown', (e) => {
    if (project.drawTool) {
      e.cancelBubble = true
      const pointer = bundle?.stage.getPointerPosition()
      if (!pointer || !bundle) return
      addDrawPoint(bundle.toPagePoint(pointer))
      return
    }
    const id = String(group.getAttr('widgetId'))
    const layer = project.findLayerOfWidget(id)
    if (layer?.locked) {
      e.cancelBubble = true
      project.selectWidget(id, { additive: e.evt.shiftKey })
      applySelection(project.selectedWidgetIds)
      return
    }
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
    project.selectWidget(id, { additive: e.evt.shiftKey })
    applySelection(project.selectedWidgetIds)
  })

  group.on('dragstart', () => {
    if (syncingFromModel) return
    const id = String(group.getAttr('widgetId'))
    if (project.findLayerOfWidget(id)?.locked) {
      group.stopDrag()
      return
    }
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
      snapGrid: project.snapEnabled,
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
    if (project.snapEnabled) transform = snapTransform(transform)
    const widget = project.getActiveWidgets().find((w) => w.id === id)
    if (!widget) continue
    syncWidgetNode(node, { ...widget, transform })
    patches[id] = transform
  }
  if (!dragHistoryPushed) {
    project.commitWidgetTransforms(patches)
    dragHistoryPushed = true
  } else {
    project.commitWidgetTransforms(patches, { recordHistory: false })
  }
  bundle.transformer.forceUpdate()
  bundle.widgetLayer.batchDraw()
}

function applySelection(ids: string[]) {
  if (!bundle) return
  if (project.previewLive) {
    bundle.transformer.nodes([])
    clearVertexHandles()
    return
  }
  const widgets = ids
    .map((id) => project.getActiveWidgets().find((w) => w.id === id))
    .filter((w): w is Widget2D => w != null && w.visible !== false)
  // 锁定图元可被选中，但不挂 Transformer（避免被拖/缩放）
  const editable = widgets.filter((w) => {
    if (w.locked) return false
    const layer = project.findLayerOfWidget(w.id)
    return !layer?.locked
  })
  const nodes = editable
    .map((w) => bundle!.widgetLayer.findOne(`#${w.id}`))
    .filter((n): n is Konva.Node => Boolean(n))
  bundle.transformer.nodes(nodes)
  const singlePoly =
    editable.length === 1 &&
    (editable[0].type === 'polyline' ||
      editable[0].type === 'polygon' ||
      editable[0].type === 'pipe')
  // 折线/多边形：禁止拉伸改包围盒（用顶点手柄改形，对齐 Flight）
  bundle.transformer.resizeEnabled(!singlePoly)
  bundle.transformer.rotateEnabled(true)
  bundle.transformer.moveToTop()
  if (boxRect) boxRect.moveToTop()
  syncVertexHandles(singlePoly ? editable[0] : null)
  if (vertexLayer) vertexLayer.moveToTop()
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

function onStagePointerDown(e: Konva.KonvaEventObject<MouseEvent>) {
  if (!bundle) return
  hideCtx()
  if (e.evt.button !== 0) return
  if (bundle.stage.draggable() || bundle.isHandMode()) return

  if (project.drawTool) {
    const pointer = bundle.stage.getPointerPosition()
    if (!pointer) return
    addDrawPoint(bundle.toPagePoint(pointer))
    return
  }

  if (e.target !== bundle.stage) return

  const pointer = bundle.stage.getPointerPosition()
  if (!pointer) return
  const pt = bundle.toPagePoint(pointer)
  boxStart = pt
  ensureBoxRect()
  if (boxRect) {
    boxRect.visible(true)
    boxRect.position({ x: pt.x, y: pt.y })
    boxRect.size({ width: 0, height: 0 })
  }
  if (!e.evt.shiftKey) {
    project.selectWidget(null)
    applySelection([])
  }
}

function onStagePointerMove() {
  if (!bundle) return
  if (project.drawTool) {
    const pointer = bundle.stage.getPointerPosition()
    if (!pointer) return
    updateDrawPreview(bundle.toPagePoint(pointer))
    return
  }
  if (!boxStart || !boxRect) return
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

function onStagePointerUp(e: Konva.KonvaEventObject<MouseEvent>) {
  if (!bundle || !boxStart || !boxRect) return
  const box = {
    x: boxRect.x(),
    y: boxRect.y(),
    width: boxRect.width(),
    height: boxRect.height(),
  }
  boxRect.visible(false)
  boxStart = null

  if (box.width < 3 && box.height < 3) return

  const hit = project
    .getActiveWidgets()
    .filter(
      (w) =>
        w.visible !== false &&
        rectsIntersect(box, {
          x: w.transform.x,
          y: w.transform.y,
          width: Math.max(w.transform.width, 4),
          height: Math.max(w.transform.height, 4),
        }),
    )
    .map((w) => w.id)

  if (e.evt.shiftKey) {
    const set = new Set([...project.selectedWidgetIds, ...hit])
    project.setSelection([...set])
  } else {
    project.setSelection(hit)
  }
  applySelection(project.selectedWidgetIds)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (!bundle || !host.value) return
  const rect = host.value.getBoundingClientRect()
  const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  const pt = bundle.toPagePoint(pointer)
  ctxMenu.value = {
    visible: true,
    x: e.clientX - rect.left + 24,
    y: e.clientY - rect.top + 24,
    pageX: pt.x,
    pageY: pt.y,
  }
}

function hideCtx() {
  ctxMenu.value.visible = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (!bundle || !host.value) return
  const type = e.dataTransfer?.getData(DND_TYPE) as BuiltinWidgetType | undefined
  if (!type || isDrawToolType(type)) return
  const rect = host.value.getBoundingClientRect()
  const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  const pt = bundle.toPagePoint(pointer)
  const temp = createWidget2D(type)
  project.addWidget(type, {
    x: pt.x - temp.transform.width / 2,
    y: pt.y - temp.transform.height / 2,
  })
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes(DND_TYPE)) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

function toggleHand() {
  handMode.value = !handMode.value
  bundle?.setHandMode(handMode.value)
}

function fitView() {
  bundle?.fitToView()
}

function zoomBy(factor: number) {
  if (!bundle) return
  bundle.setZoom(bundle.getView().scale * factor)
}

function zoomExact(percent: number) {
  bundle?.setZoom(percent / 100)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.isComposing) return
  // 通用编辑快捷键由 DesignerView 统一处理；此处只保留画线确认
  if (project.drawTool && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
    if (!isDesignerCanvasContext(e.target)) return
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    finishDraw()
  }
}

function ctxAction(action: string) {
  hideCtx()
  const ids = project.selectedWidgetIds
  switch (action) {
    case 'paste':
      project.pasteClipboard()
      break
    case 'copy':
      project.copySelected()
      break
    case 'cut':
      project.cutSelected()
      break
    case 'duplicate':
      if (ids.length) project.duplicateWidgets(ids)
      break
    case 'delete':
      if (ids.length) project.removeWidgets(ids)
      break
    case 'front':
      project.reorderSelected('front')
      break
    case 'forward':
      project.reorderSelected('forward')
      break
    case 'backward':
      project.reorderSelected('backward')
      break
    case 'back':
      project.reorderSelected('back')
      break
    case 'lock':
      project.setSelectedFlags('locked')
      break
    case 'hide':
      project.setSelectedFlags('visible')
      break
    case 'group':
      project.groupSelected()
      break
    case 'ungroup':
      project.ungroupSelected()
      break
    case 'animation':
      if (ids.length) project.openAnimationConnection()
      break
  }
}

watch(
  () => project.gridVisible,
  (visible) => {
    bundle?.setGridVisible(visible)
  },
)

onMounted(() => {
  if (!host.value) return
  bundle = createKonvaStage(host.value, props.page, {
    onViewChange: (view) => paintRulers(view),
  })
  bundle.setGridVisible(project.gridVisible)
  bundle.stage.on('mousedown', onStagePointerDown)
  bundle.stage.on('mousemove', onStagePointerMove)
  bundle.stage.on('mouseup', onStagePointerUp)
  host.value.addEventListener('contextmenu', onContextMenu)
  host.value.addEventListener('dragover', onDragOver)
  host.value.addEventListener('drop', onDrop)
  window.addEventListener('mousemove', onRulerPointerMove)
  window.addEventListener('mouseup', onRulerPointerUp)
  ensureBoxRect()
  syncBackgroundImage()
  renderAllWidgets()
  paintRulers()
  window.addEventListener('keydown', onKeyDown, true)
})

watch(
  () =>
    [
      props.page.id,
      props.page.width,
      props.page.height,
      props.page.background,
      props.backgroundImageUrl ?? '',
    ] as const,
  () => {
    syncBackgroundImage()
    renderAllWidgets()
    paintRulers()
  },
)

watch(
  () => props.page.layers,
  () => renderAllWidgets(),
  { deep: true },
)

watch(
  () => props.page.guides,
  () => syncPageGuides(),
  { deep: true },
)

watch(
  () => project.drawTool,
  (tool) => {
    if (!tool) clearDrawPreview()
    else {
      clearVertexHandles()
      bundle?.transformer.nodes([])
    }
  },
)

watch(
  () => project.previewLive,
  (on) => {
    if (on) startPreviewMode()
    else stopPreviewMode()
  },
)

watch(
  () => props.page.id,
  () => {
    if (project.previewLive) startPreviewMode()
  },
)

watch(
  () => [...project.selectedWidgetIds],
  (ids) => applySelection(ids),
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('mousemove', onRulerPointerMove)
  window.removeEventListener('mouseup', onRulerPointerUp)
  host.value?.removeEventListener('contextmenu', onContextMenu)
  host.value?.removeEventListener('dragover', onDragOver)
  host.value?.removeEventListener('drop', onDrop)
  removeTagListener?.()
  removeTagListener = null
  clearPreviewBlink()
  clearDrawPreview()
  clearVertexHandles()
  rulerGhost?.destroy()
  rulerGhost = null
  bgImageLoadToken += 1
  bgImageNode?.destroy()
  bgImageNode = null
  bundle?.dispose()
  bundle = null
  boxRect = null
})

defineExpose({ fitView, zoomBy, zoomExact, toggleHand, handMode })
</script>

<template>
  <div
    class="board"
    data-scada-canvas="2d"
    tabindex="0"
    @pointerdown.capture="($event.currentTarget as HTMLElement).focus({ preventScroll: true })"
  >
    <div class="ruler-corner" />
    <canvas
      ref="rulerX"
      class="ruler-x"
      title="向下拖出水平参考线"
      @mousedown="(e) => onRulerPointerDown('h', e)"
    />
    <canvas
      ref="rulerY"
      class="ruler-y"
      title="向右拖出垂直参考线"
      @mousedown="(e) => onRulerPointerDown('v', e)"
    />
    <div ref="host" class="konva-host" />

    <div class="view-bar">
      <el-button size="small" :type="handMode ? 'primary' : 'default'" @click="toggleHand">
        手型
      </el-button>
      <el-button size="small" @click="zoomBy(1 / 1.2)">-</el-button>
      <el-dropdown trigger="click" @command="(p: number) => zoomExact(p)">
        <el-button size="small">{{ zoomPercent }}%</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :command="50">50%</el-dropdown-item>
            <el-dropdown-item :command="100">100%</el-dropdown-item>
            <el-dropdown-item :command="150">150%</el-dropdown-item>
            <el-dropdown-item :command="200">200%</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" @click="zoomBy(1.2)">+</el-button>
      <el-button size="small" @click="fitView">适应</el-button>
    </div>

    <div
      v-if="ctxMenu.visible"
      class="ctx"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @mousedown.stop
    >
      <button
        type="button"
        class="accent"
        :disabled="!project.selectedWidgetIds.length"
        @click="ctxAction('animation')"
      >
        动画连接
      </button>
      <hr />
      <button type="button" @click="ctxAction('copy')">复制</button>
      <button type="button" @click="ctxAction('cut')">剪切</button>
      <button type="button" @click="ctxAction('paste')">粘贴</button>
      <button type="button" @click="ctxAction('duplicate')">复制副本</button>
      <hr />
      <button type="button" @click="ctxAction('front')">置顶</button>
      <button type="button" @click="ctxAction('forward')">上移一层</button>
      <button type="button" @click="ctxAction('backward')">下移一层</button>
      <button type="button" @click="ctxAction('back')">置底</button>
      <button type="button" @click="ctxAction('group')">组合</button>
      <button type="button" @click="ctxAction('ungroup')">解组</button>
      <button type="button" @click="ctxAction('lock')">锁定/解锁</button>
      <button type="button" @click="ctxAction('hide')">显示/隐藏</button>
      <hr />
      <button type="button" class="danger" @click="ctxAction('delete')">删除</button>
    </div>

    <div class="hud">
      <span>2D 编辑</span>
      <span>{{ page.width }} × {{ page.height }}</span>
      <span>图元 {{ widgetCount }}</span>
      <span>选中 {{ project.selectedWidgetIds.length }}</span>
      <span>{{ drawHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.board {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b0d11;
  display: grid;
  grid-template-columns: 24px 1fr;
  grid-template-rows: 24px 1fr;
  outline: none;
}

.ruler-corner {
  grid-column: 1;
  grid-row: 1;
  background: #10131a;
  border-right: 1px solid #2a2f3a;
  border-bottom: 1px solid #2a2f3a;
}

.ruler-x {
  grid-column: 2;
  grid-row: 1;
  width: 100%;
  height: 24px;
  display: block;
  border-bottom: 1px solid #2a2f3a;
}

.ruler-y {
  grid-column: 1;
  grid-row: 2;
  width: 24px;
  height: 100%;
  display: block;
  border-right: 1px solid #2a2f3a;
}

.konva-host {
  grid-column: 2;
  grid-row: 2;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.view-bar {
  position: absolute;
  right: 12px;
  top: 36px;
  display: flex;
  gap: 4px;
  z-index: 3;
  padding: 4px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
}

.ctx {
  position: absolute;
  z-index: 20;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--scada-border);
  border-radius: 6px;
  background: #171a21;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
}

.ctx button {
  border: none;
  background: transparent;
  color: var(--scada-text);
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.ctx button:hover {
  background: rgba(61, 139, 253, 0.16);
}

.ctx button.danger {
  color: #f87171;
}

.ctx button.accent {
  color: #93c5fd;
  font-weight: 600;
}

.ctx button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctx hr {
  border: none;
  border-top: 1px solid var(--scada-border);
  margin: 4px 0;
}

.hud {
  position: absolute;
  left: 36px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  max-width: calc(100% - 48px);
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 12px;
  color: var(--scada-muted);
  pointer-events: none;
  z-index: 2;
}
</style>
