import Konva from 'konva'
import { trendCurves, type Page2D, type Widget2D } from '@web-scada/core'
import { attachTrendChartInteraction } from '@/shared/konva/trendChartInteraction'
import { setTrendZoom } from '@/shared/konva/trendChart'
import { createTrendLiveOverlay } from '@/shared/konva/trendChartLive'
import { createTrendHistoryZoomBridge } from '@/shared/konva/trendHistoryZoom'
import { syncNativeTrendCharts } from '@/shared/konva/trendNativeCharts'
import { setHiddenCurves, syncWidgetNode } from '@/shared/konva/widgetNodes'

export interface KonvaStageBundle {
  stage: Konva.Stage
  gridLayer: Konva.Layer
  contentLayer: Konva.Layer
  widgetLayer: Konva.Layer
  guideLayer: Konva.Layer
  transformer: Konva.Transformer
  dispose: () => void
  fitToView: () => void
  setZoom: (scale: number, center?: { x: number; y: number }) => void
  setHandMode: (on: boolean) => void
  isHandMode: () => boolean
  setGridVisible: (visible: boolean) => void
  setPageSize: (width: number, height: number, background?: string) => void
  /** 舞台坐标 → 页面内容坐标 */
  toPagePoint: (pointer: { x: number; y: number }) => { x: number; y: number }
  getView: () => { scale: number; x: number; y: number }
  showGuides: (guides: Array<{ orientation: 'v' | 'h'; pos: number }>) => void
  clearGuides: () => void
  /** 趋势图元是否可交互（悬停读数 / 拖拽缩放时间窗）；设计端仅实时预览时开 */
  setChartInteraction: (on: boolean) => void
  /**
   * 同步趋势图元上的原生 ECharts。
   * interactive 为 false 时图表仍显示，鼠标穿透，方便拖拽图元。
   */
  syncTrendOverlays: (widgets: Widget2D[], interactive: boolean, layoutOnly?: boolean) => void
}

export interface CreateKonvaStageOptions {
  onViewChange?: (view: { scale: number; x: number; y: number }) => void
  /** 按 id 找图元（趋势图元交互用） */
  resolveWidget?: (id: string) => Widget2D | undefined
}

const GRID = 20

function drawGrid(layer: Konva.Layer, width: number, height: number) {
  layer.destroyChildren()
  const pad = 800
  for (let x = -pad; x <= width + pad; x += GRID) {
    layer.add(
      new Konva.Line({
        points: [x, -pad, x, height + pad],
        stroke: x % (GRID * 5) === 0 ? '#2a3140' : '#1c212b',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }
  for (let y = -pad; y <= height + pad; y += GRID) {
    layer.add(
      new Konva.Line({
        points: [-pad, y, width + pad, y],
        stroke: y % (GRID * 5) === 0 ? '#2a3140' : '#1c212b',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }
  layer.batchDraw()
}

export { GRID as KONVA_GRID }

/**
 * Konva 2D 画布底座：
 * - 网格 / 页面框
 * - 滚轮缩放
 * - 空格+拖拽 或 中键拖拽平移（避免与图元拖拽冲突）
 * - 手型工具常驻平移
 */
export function createKonvaStage(
  container: HTMLDivElement,
  page: Pick<Page2D, 'width' | 'height' | 'background'>,
  options: CreateKonvaStageOptions = {},
): KonvaStageBundle {
  const width = container.clientWidth || 800
  const height = container.clientHeight || 600
  let pageWidth = page.width
  let pageHeight = page.height
  let spacePressed = false
  let handMode = false

  const stage = new Konva.Stage({
    container,
    width,
    height,
    draggable: false,
  })

  const gridLayer = new Konva.Layer({ listening: false })
  const contentLayer = new Konva.Layer({ listening: false })
  const widgetLayer = new Konva.Layer()
  const guideLayer = new Konva.Layer()
  stage.add(gridLayer)
  stage.add(contentLayer)
  stage.add(widgetLayer)
  stage.add(guideLayer)

  const pageRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    fill: page.background || '#1a1d24',
    stroke: '#3d4454',
    strokeWidth: 1,
    name: 'page-frame',
    listening: false,
  })
  contentLayer.add(pageRect)

  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    rotationSnaps: Array.from({ length: 24 }, (_, i) => i * 15),
    rotationSnapTolerance: 5,
    enabledAnchors: [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
      'middle-left',
      'middle-right',
      'top-center',
      'bottom-center',
    ],
    boundBoxFunc: (_oldBox, newBox) => {
      if (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4) return _oldBox
      return newBox
    },
  })
  widgetLayer.add(transformer)

  transformer.on('transform', (e) => {
    const shift = Boolean(e.evt?.shiftKey)
    transformer.rotationSnapTolerance(shift ? 20 : 5)
  })

  drawGrid(gridLayer, pageWidth, pageHeight)

  const trendLiveOverlay = createTrendLiveOverlay({
    host: container,
    onLegendSelect: (widgetId, hiddenNames) => {
      const widget = options.resolveWidget?.(widgetId)
      if (!widget) return
      const hiddenTags = trendCurves(widget.props)
        .filter((curve) => hiddenNames.includes(curve.label || curve.tagId))
        .map((curve) => curve.tagId)
      setHiddenCurves(widget, hiddenTags)
      const node = widgetLayer.findOne('#' + widgetId) as Konva.Group | null
      const next = options.resolveWidget?.(widgetId) ?? widget
      if (node) syncWidgetNode(node, next)
      flushTrend(false)
    },
    onZoom: (widgetId, zoom) => {
      setTrendZoom(widgetId, { start: zoom.start, end: zoom.end })
      historyZoom.handleZoom(widgetId, zoom)
    },
    onReset: (widgetId) => historyZoom.handleReset(widgetId),
  })

  const historyZoom = createTrendHistoryZoomBridge({
    resolveWidget: (id) => options.resolveWidget?.(id),
    repaint: () => flushTrend(false),
  })

  let trendWidgets: Widget2D[] = []
  let trendInteractive = false

  const flushTrend = (layoutOnly: boolean) => {
    syncNativeTrendCharts({
      stage,
      widgetLayer,
      widgets: trendWidgets,
      overlay: trendLiveOverlay,
      interactive: trendInteractive,
      layoutOnly,
    })
  }

  const notifyView = () => {
    options.onViewChange?.({
      scale: stage.scaleX(),
      x: stage.x(),
      y: stage.y(),
    })
    if (trendWidgets.length) flushTrend(false)
  }

  const applyPanState = () => {
    const pan = handMode || spacePressed
    stage.draggable(pan)
    widgetLayer.listening(!pan)
    stage.container().style.cursor = pan ? 'grab' : 'default'
  }

  const fitToView = () => {
    const cw = stage.width()
    const ch = stage.height()
    const scale = Math.min(cw / pageWidth, ch / pageHeight) * 0.9
    stage.scale({ x: scale, y: scale })
    stage.position({
      x: (cw - pageWidth * scale) / 2,
      y: (ch - pageHeight * scale) / 2,
    })
    stage.batchDraw()
    notifyView()
  }

  const setZoom = (scale: number, center?: { x: number; y: number }) => {
    const clamped = Math.min(4, Math.max(0.15, scale))
    const oldScale = stage.scaleX()
    const pointer = center ?? {
      x: stage.width() / 2,
      y: stage.height() / 2,
    }
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    stage.scale({ x: clamped, y: clamped })
    stage.position({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    })
    stage.batchDraw()
    notifyView()
  }

  const setPageSize = (w: number, h: number, background?: string) => {
    pageWidth = w
    pageHeight = h
    pageRect.width(w)
    pageRect.height(h)
    if (background) pageRect.fill(background)
    drawGrid(gridLayer, w, h)
    fitToView()
  }

  const toPagePoint = (pointer: { x: number; y: number }) => {
    const transform = stage.getAbsoluteTransform().copy().invert()
    return transform.point(pointer)
  }

  const clearGuides = () => {
    guideLayer.find('.snap-guide').forEach((n) => n.destroy())
    guideLayer.batchDraw()
  }

  const showGuides = (guides: Array<{ orientation: 'v' | 'h'; pos: number }>) => {
    clearGuides()
    const pad = 2000
    for (const g of guides) {
      if (g.orientation === 'v') {
        guideLayer.add(
          new Konva.Line({
            name: 'snap-guide',
            points: [g.pos, -pad, g.pos, pageHeight + pad],
            stroke: '#f472b6',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          }),
        )
      } else {
        guideLayer.add(
          new Konva.Line({
            name: 'snap-guide',
            points: [-pad, g.pos, pageWidth + pad, g.pos],
            stroke: '#f472b6',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          }),
        )
      }
    }
    guideLayer.batchDraw()
  }

  stage.on('wheel', (e) => {
    e.evt.preventDefault()
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const scaleBy = 1.08
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy
    setZoom(newScale, pointer)
  })

  stage.on('dragmove', () => notifyView())
  stage.on('dragend', () => notifyView())

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !spacePressed) {
      spacePressed = true
      applyPanState()
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      spacePressed = false
      applyPanState()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  stage.on('mousedown', (e) => {
    if (e.evt.button === 1) {
      stage.draggable(true)
    }
  })
  stage.on('mouseup', () => {
    if (!spacePressed && !handMode) stage.draggable(false)
  })

  const onResize = () => {
    stage.width(container.clientWidth || width)
    stage.height(container.clientHeight || height)
  }
  const ro = new ResizeObserver(onResize)
  ro.observe(container)

  fitToView()

  const trendInteraction = attachTrendChartInteraction(stage, (id) => options.resolveWidget?.(id), {
    enabled: false,
  })

  return {
    stage,
    gridLayer,
    contentLayer,
    widgetLayer,
    guideLayer,
    transformer,
    fitToView,
    setZoom,
    setHandMode: (on: boolean) => {
      handMode = on
      applyPanState()
    },
    isHandMode: () => handMode,
    setGridVisible: (visible: boolean) => {
      gridLayer.visible(visible)
      gridLayer.batchDraw()
    },
    setPageSize,
    toPagePoint,
    showGuides,
    clearGuides,
    setChartInteraction: (on: boolean) => trendInteraction.setEnabled(on),
    syncTrendOverlays: (widgets: Widget2D[], interactive: boolean, layoutOnly = false) => {
      trendWidgets = widgets
      trendInteractive = interactive
      flushTrend(layoutOnly)
    },
    getView: () => ({
      scale: stage.scaleX(),
      x: stage.x(),
      y: stage.y(),
    }),
    dispose: () => {
      historyZoom.dispose()
      trendLiveOverlay.dispose()
      ro.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      stage.destroy()
    },
  }
}
