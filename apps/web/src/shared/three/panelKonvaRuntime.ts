/**
 * CSS2D 面板内的 Konva 运行时：复用 createRuntimeStage + bindingEngine。
 */
import Konva from 'konva'
import type {
  EventBinding,
  EventTrigger,
  Object3DPanel,
  Page2D,
  TagValue,
  Widget2D,
} from '@web-scada/core'
import { resolvePanelContentSize, resolvePanelWidgets } from '@web-scada/core'
import {
  createRuntimeStage,
  type RuntimeStageBundle,
  type RuntimeStageHandlers,
} from '@/shared/konva/createRuntimeStage'
import { resolveWidgetVisual } from '@/shared/runtime/bindingEngine'

export type PanelKonvaRuntimeHandlers = RuntimeStageHandlers & {
  /** 只读预览（设计端场景）：禁用交互 */
  readOnly?: boolean
  /** 解析面板背景图资源 */
  resolveResourceUrl?: (resourceId: string) => string | undefined
  /** 解析 panel.page2dId → 完整 2D 页 */
  resolvePage2d?: (page2dId: string) => Page2D | null | undefined
}

function syncRuntimeBackgroundImage(
  bundle: RuntimeStageBundle,
  panel: Object3DPanel | null | undefined,
  resolveResourceUrl?: (resourceId: string) => string | undefined,
) {
  const layer = bundle.stage.getLayers()[0]
  if (!layer) return
  layer.find('.panel-bg-image').forEach((n) => n.destroy())
  const id = panel?.backgroundResourceId?.trim()
  const url = id && resolveResourceUrl ? resolveResourceUrl(id) : undefined
  if (!url) {
    layer.batchDraw()
    return
  }
  const { width, height } = resolvePanelContentSize(panel?.width, panel?.height)
  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const iw = img.naturalWidth || img.width || 1
    const ih = img.naturalHeight || img.height || 1
    const scale = Math.max(width / iw, height / ih)
    const w = iw * scale
    const h = ih * scale
    const node = new Konva.Image({
      name: 'panel-bg-image',
      image: img,
      x: (width - w) / 2,
      y: (height - h) / 2,
      width: w,
      height: h,
      listening: false,
    })
    layer.add(node)
    node.moveToBottom()
    // 纯色底在最底，图在其上
    const pageBg = layer.findOne('.page-bg')
    if (pageBg) {
      pageBg.moveToBottom()
      node.moveUp()
    }
    layer.batchDraw()
  }
  img.src = url
}

export interface PanelKonvaRuntime {
  bundle: RuntimeStageBundle
  widgets: Widget2D[]
  setWidgets: (widgets: Widget2D[], panel?: Object3DPanel | null) => void
  refresh: (getTag: (id: string) => TagValue | undefined) => void
  /**
   * CSS2D 世界缩放（createScene3D 的 zoom）会拉伸画布位图。
   * 按距离同步提高 pixelRatio，避免近处面板发糊。
   */
  setWorldScale: (worldScale: number) => void
  dispose: () => void
}

/** 面板画布最大像素比（过大占显存；覆盖常见近距 + 高分屏） */
const MAX_PANEL_PIXEL_RATIO = 4

function applyPanelStageSharpness(stage: Konva.Stage, worldScale: number) {
  const dpr =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1
  // zoom>1 时 CSS 放大位图；画布 pixelRatio 需覆盖 dpr×zoom。量化到 0.5 档，避免每帧重建。
  const raw = Math.min(
    MAX_PANEL_PIXEL_RATIO,
    Math.max(1, dpr * Math.max(1, Number.isFinite(worldScale) ? worldScale : 1)),
  )
  const need = Math.min(MAX_PANEL_PIXEL_RATIO, Math.ceil(raw * 2) / 2)
  let changed = false
  for (const layer of stage.getLayers()) {
    const canvas = layer.getCanvas()
    if (Math.abs(canvas.getPixelRatio() - need) < 0.01) continue
    canvas.setPixelRatio(need)
    changed = true
  }
  if (changed) stage.batchDraw()
}

function filterPanelWidgets(widgets: Widget2D[]): Widget2D[] {
  return widgets.filter((w) => w.type !== 'scene3d')
}

export function panelToRuntimePage(
  objectId: string,
  panel: Object3DPanel | null | undefined,
  widgets?: Widget2D[],
  page2d?: Page2D | null,
): Page2D {
  const hasBgImage = Boolean(panel?.backgroundResourceId?.trim())
  const shell = resolvePanelContentSize(panel?.width, panel?.height)

  if (page2d) {
    const width = shell.width || page2d.width
    const height = shell.height || page2d.height
    const list = filterPanelWidgets(page2d.layers.flatMap((l) => l.widgets))
    return {
      id: `panel_rt_${objectId}`,
      type: '2d',
      name: page2d.name || panel?.title || '面板',
      width,
      height,
      background: hasBgImage ? 'rgba(0,0,0,0)' : page2d.background || '#1a1d24',
      layers: [
        {
          id: 'panel_layer',
          name: '面板',
          visible: true,
          locked: false,
          widgets: list,
        },
      ],
    }
  }

  const list = filterPanelWidgets(widgets ?? resolvePanelWidgets(panel))
  return {
    id: `panel_rt_${objectId}`,
    type: '2d',
    name: panel?.title || '面板',
    width: shell.width,
    height: shell.height,
    background: hasBgImage ? 'rgba(0,0,0,0)' : '#1a1d24',
    layers: [
      {
        id: 'panel_layer',
        name: '面板',
        visible: true,
        locked: false,
        widgets: list,
      },
    ],
  }
}

function resolveBoundPage2d(
  panel: Object3DPanel | null | undefined,
  resolvePage2d?: (page2dId: string) => Page2D | null | undefined,
): Page2D | null {
  const id = panel?.page2dId?.trim()
  if (!id || !resolvePage2d) return null
  return resolvePage2d(id) ?? null
}

export function mountPanelKonvaRuntime(
  container: HTMLDivElement,
  objectId: string,
  panel: Object3DPanel | null | undefined,
  handlers: PanelKonvaRuntimeHandlers = {},
): PanelKonvaRuntime {
  const readOnly = handlers.readOnly === true
  const bound = resolveBoundPage2d(panel, handlers.resolvePage2d)
  const page = panelToRuntimePage(objectId, panel, undefined, bound)
  const stageHandlers: RuntimeStageHandlers = readOnly
    ? {}
    : {
        onWidgetEvent: handlers.onWidgetEvent,
        onWidgetClick: handlers.onWidgetClick,
        onAnimationInput: handlers.onAnimationInput,
        onDragWrite: handlers.onDragWrite,
      }

  // 固定舞台像素 = 面板设计尺寸，避免 CSS2D 内再缩放栅格
  container.style.width = `${page.width}px`
  container.style.height = `${page.height}px`
  container.style.position = 'relative'
  container.style.overflow = 'hidden'

  const bundle = createRuntimeStage(container, page, stageHandlers, { chartInteraction: true })
  // 1:1 像素，取消 fitToView 的等比缩放（容器已等于页面）
  bundle.stage.scale({ x: 1, y: 1 })
  bundle.stage.position({ x: 0, y: 0 })
  bundle.stage.width(page.width)
  bundle.stage.height(page.height)
  applyPanelStageSharpness(bundle.stage, 1)
  bundle.widgetLayer.batchDraw()
  syncRuntimeBackgroundImage(bundle, panel, handlers.resolveResourceUrl)

  let lastWorldScale = 1
  const setWorldScale = (worldScale: number) => {
    lastWorldScale = Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1
    applyPanelStageSharpness(bundle.stage, lastWorldScale)
  }

  bundle.setOverlayInteractive(!readOnly)
  bundle.syncOverlays()
  if (readOnly) {
    for (const node of bundle.widgetLayer.getChildren()) {
      node.listening(false)
      if ('draggable' in node) (node as { draggable: (v: boolean) => void }).draggable(false)
    }
  }

  let currentWidgets = page.layers[0]!.widgets
  let currentPanel = panel

  const setWidgets = (widgets: Widget2D[], nextPanel?: Object3DPanel | null) => {
    currentPanel = nextPanel ?? currentPanel
    const nextBound = resolveBoundPage2d(currentPanel, handlers.resolvePage2d)
    const next = panelToRuntimePage(objectId, currentPanel, widgets, nextBound)
    currentWidgets = next.layers[0]!.widgets
    container.style.width = `${next.width}px`
    container.style.height = `${next.height}px`
    bundle.setPage(next)
    bundle.stage.scale({ x: 1, y: 1 })
    bundle.stage.position({ x: 0, y: 0 })
    bundle.stage.width(next.width)
    bundle.stage.height(next.height)
    applyPanelStageSharpness(bundle.stage, lastWorldScale)
    bundle.syncOverlays()
    syncRuntimeBackgroundImage(bundle, currentPanel, handlers.resolveResourceUrl)
    if (readOnly) {
      for (const node of bundle.widgetLayer.getChildren()) {
        node.listening(false)
        if ('draggable' in node) (node as { draggable: (v: boolean) => void }).draggable(false)
      }
    }
  }

  const refresh = (getTag: (id: string) => TagValue | undefined) => {
    for (const widget of currentWidgets) {
      const resolved = resolveWidgetVisual(widget, getTag)
      if (resolved.widget.visible === false) {
        bundle.applyVisual(widget.id, resolved.widget, { blink: false })
        continue
      }
      bundle.applyVisual(widget.id, resolved.widget, { blink: resolved.blink })
    }
  }

  return {
    bundle,
    get widgets() {
      return currentWidgets
    },
    setWidgets,
    refresh,
    setWorldScale,
    dispose: () => bundle.dispose(),
  }
}

/** 收集面板 widgets 上的 Tag id（绑定/动画/事件写值） */
export function collectPanelWidgetTagIds(widgets: Widget2D[]): string[] {
  const ids = new Set<string>()
  for (const w of widgets) {
    if (w.type === 'scene3d') continue
    for (const b of w.bindings ?? []) if (b.tagId) ids.add(b.tagId)
    for (const a of w.animations ?? []) if (a.tagId) ids.add(a.tagId)
    for (const l of w.animationLinks ?? []) if (l.tagId) ids.add(l.tagId)
    for (const e of w.events ?? []) {
      for (const action of e.actions ?? []) {
        if (action.type === 'writeTag' && action.tagId) ids.add(action.tagId)
      }
    }
  }
  return [...ids]
}

export type PanelWidgetEventPayload = {
  objectId: string
  widgetId: string
  trigger: EventTrigger
  events: EventBinding[]
}
