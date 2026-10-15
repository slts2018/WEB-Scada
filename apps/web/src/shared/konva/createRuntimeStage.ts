import Konva from 'konva'
import type { AnimationLinkRange, EventBinding, EventTrigger, Page2D, Widget2D } from '@web-scada/core'
import { trendCurves } from '@web-scada/core'
import {
  createWidgetNode,
  setHiddenCurves,
  syncWidgetNode,
  widgetHasCurveLegend,
} from '@/shared/konva/widgetNodes'
import { setTrendZoom } from '@/shared/konva/trendChart'
import { createTrendLiveOverlay } from '@/shared/konva/trendChartLive'
import { createTrendHistoryZoomBridge } from '@/shared/konva/trendHistoryZoom'
import { syncNativeTrendCharts } from '@/shared/konva/trendNativeCharts'
import { attachTrendChartInteraction } from '@/shared/konva/trendChartInteraction'
import {
  isWidgetRuntimeEnabled,
  mapDragOffsetToTag,
  widgetHasInteractiveLinks,
} from '@/shared/runtime/bindingEngine'
import { createClickDblclickGate } from '@/shared/runtime/clickDblclickGate'

export interface RuntimeStageHandlers {
  /** 图元交互事件（含 mouseEnter / mouseLeave） */
  onWidgetEvent?: (widgetId: string, trigger: EventTrigger, events: EventBinding[]) => void
  /** @deprecated 请用 onWidgetEvent；保留兼容 */
  onWidgetClick?: (widgetId: string, events: EventBinding[]) => void
  onAnimationInput?: (widgetId: string) => void
  /** 实时报警行被点击，确认这一条 */
  onAlarmAck?: (alarmId: string) => void
  onDragWrite?: (
    widgetId: string,
    axis: 'h' | 'v',
    tagId: string,
    value: number,
  ) => void
}

export interface RuntimeStageBundle {
  stage: Konva.Stage
  widgetLayer: Konva.Layer
  dispose: () => void
  fitToView: () => void
  setPage: (page: Page2D) => void
  renderPage: (page: Page2D) => void
  /** 用运行态解析后的图元刷新节点 */
  applyVisual: (widgetId: string, visual: Widget2D, opts?: { blink?: boolean }) => void
  getSourceWidget: (widgetId: string) => Widget2D | undefined
  /** 图元在舞台容器内的屏幕包围盒（含缩放/平移） */
  getWidgetClientRect: (widgetId: string) => { x: number; y: number; width: number; height: number } | null
  /** 舞台缩放/平移变化时回调（用于 HTML 叠层同步） */
  setViewChangeListener: (fn: (() => void) | null) => void
  /** 趋势图元是否可交互（悬停读数 / 拖拽缩放时间窗） */
  setChartInteraction: (on: boolean) => void
  /** 视图/数据变化后同步趋势图元的原生叠层 */
  syncOverlays: () => void
  /** 原生叠层是否接收鼠标（只读 3D 面板里关掉） */
  setOverlayInteractive: (on: boolean) => void
}

/**
 * Runtime 2D 舞台：静态还原 + 实时外观刷新 + 点击/拖拽写值。
 */
export function createRuntimeStage(
  container: HTMLDivElement,
  page: Page2D,
  handlers: RuntimeStageHandlers = {},
  opts?: { chartInteraction?: boolean },
): RuntimeStageBundle {
  let pageWidth = page.width
  let pageHeight = page.height
  let spacePressed = false
  let currentPage: Page2D = page
  const sourceMap = new Map<string, Widget2D>()
  const blinkTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** 同图元既有单击又有双击时，延时单击以免双击误触 */
  const clickDblGate = createClickDblclickGate()

  const stage = new Konva.Stage({
    container,
    width: container.clientWidth || 800,
    height: container.clientHeight || 600,
    draggable: false,
  })

  const bgLayer = new Konva.Layer({ listening: false })
  const widgetLayer = new Konva.Layer()
  stage.add(bgLayer)
  stage.add(widgetLayer)

  let pageRect: Konva.Rect | null = null

  const clearBlink = (id: string) => {
    const t = blinkTimers.get(id)
    if (t) clearInterval(t)
    blinkTimers.delete(id)
  }

  const clearAllBlink = () => {
    for (const id of blinkTimers.keys()) clearBlink(id)
  }

  let alarmBlinkOn = true
  const alarmBlinkTimer = setInterval(() => {
    alarmBlinkOn = !alarmBlinkOn
    const nodes = widgetLayer.find('.alarm-blink')
    if (!nodes.length) return
    nodes.forEach((n) => n.opacity(alarmBlinkOn ? 1 : 0.2))
    widgetLayer.batchDraw()
  }, 500)

  // ── 趋势图元：原生 ECharts 活控件叠层 ───────────────────────────────
  // 图片模式（离屏位图贴回 Konva）拿不到鼠标，ECharts 自带的游标/滑块/图例/导出都用不了；
  // 这里给趋势图元挂真实例：只要图元没旋转、也没有业务点击事件（那两个场景仍走图片模式）。
  const allWidgetsOf = (): Widget2D[] => {
    const out: Widget2D[] = []
    for (const layer of currentPage.layers ?? []) {
      for (const widget of layer.widgets ?? []) out.push(widget)
    }
    return out
  }

  /** 原生叠层是否接收鼠标（只读面板里关掉，避免抢 3D 的指针） */
  let overlayInteractive = true

  const sourceWidgetOf = (id: string): Widget2D | undefined =>
    sourceMap.get(id) ?? currentPage.layers.flatMap((layer) => layer.widgets).find((w) => w.id === id)

  const isTrendWidget = (widget: Widget2D): boolean =>
    widget.type === 'trend' || widget.type === 'trendHistory'

  const trendLiveOverlay = createTrendLiveOverlay({
    host: container,
    onLegendSelect: (widgetId, hiddenNames) => {
      const widget = sourceWidgetOf(widgetId)
      if (!widget) return
      // 图例用的是显示名，这里换算回 tagId
      const hiddenTags = trendCurves(widget.props)
        .filter((curve) => hiddenNames.includes(curve.label || curve.tagId))
        .map((curve) => curve.tagId)
      setHiddenCurves(widget, hiddenTags)
      // 立刻按新的显隐重画图元（原生叠层与图片路径都要跟着变）
      const node = widgetLayer.findOne('#' + widgetId) as Konva.Group | null
      if (node) syncWidgetNode(node, sourceWidgetOf(widgetId) ?? widget)
      syncTrendOverlays()
    },
    onZoom: (widgetId, zoom) => {
      setTrendZoom(widgetId, { start: zoom.start, end: zoom.end })
      // 历史趋势：缩放/框选结束后按新窗口重查（否则放大后点数不够）
      historyZoom.handleZoom(widgetId, zoom)
    },
    onReset: (widgetId) => historyZoom.handleReset(widgetId),
  })

  const historyZoom = createTrendHistoryZoomBridge({
    resolveWidget: (id) => sourceWidgetOf(id),
    repaint: () => syncTrendOverlays(),
  })

  /** 同步原生 ECharts：位置、数据，以及位图是否还要画 */
  const syncTrendOverlays = () => {
    syncNativeTrendCharts({
      stage,
      widgetLayer,
      widgets: allWidgetsOf().map((widget) => sourceWidgetOf(widget.id) ?? widget),
      overlay: trendLiveOverlay,
      interactive: overlayInteractive,
    })
  }
  const fitToView = () => {
    const cw = stage.width()
    const ch = stage.height()
    // 按页面分辨率等比铺满视口（可放大/缩小），保持宽高比
    const scale = Math.min(cw / pageWidth, ch / pageHeight)
    stage.scale({ x: scale, y: scale })
    stage.position({
      x: (cw - pageWidth * scale) / 2,
      y: (ch - pageHeight * scale) / 2,
    })
    stage.batchDraw()
    viewChangeListener?.()
    // 视图变了：原生叠层的位置/字号跟着重算
    syncTrendOverlays()
  }

  let viewChangeListener: (() => void) | null = null

  const getWidgetClientRect = (widgetId: string) => {
    const node = widgetLayer.findOne(`#${widgetId}`) as Konva.Group | null
    if (!node || !node.visible()) return null
    const rect = node.getClientRect({ skipShadow: true, skipStroke: false })
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null
    if (rect.width < 1 || rect.height < 1) return null
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }

  const getDragLink = (widget: Widget2D, axis: 'h' | 'v'): AnimationLinkRange | undefined => {
    const type = axis === 'h' ? 'dragH' : 'dragV'
    const link = (widget.animationLinks ?? []).find((l) => l.enabled && l.type === type)
    return link && (link.type === 'dragH' || link.type === 'dragV') ? link : undefined
  }

  const hasInputLink = (widget: Widget2D) =>
    (widget.animationLinks ?? []).some(
      (l) => l.enabled && (l.type === 'valueIn' || l.type === 'digitalIn' || l.type === 'textIn'),
    )

  const bindNodeEvents = (node: Konva.Group, widget: Widget2D) => {
    node.off('mouseenter mouseleave click dblclick mousedown mouseup dragstart dragmove dragend')
    node.off('pointerdown pointermove pointerup pointercancel wheel contextmenu')
    if (widget.type === 'scene3d') {
      // 可交互三维由上层 HTML 叠层直接接收指针；此处不再转发合成事件
      node.listening(false)
      return
    }

    const interactive =
      (widget.events?.length ?? 0) > 0 || widgetHasInteractiveLinks(widget)
    const alarmWidget = widget.type === 'alarm'
    // 趋势图元的图例要能点（隐藏/恢复曲线）：它不是"图元事件"，但必须参与命中测试，
    // 否则 listening(false) 会让整棵子树都点不到 —— 运行端"点了没反应"的根因。
    const legendToggle = widgetHasCurveLegend(widget)
    const dragH = getDragLink(widget, 'h')
    const dragV = getDragLink(widget, 'v')
    const canDrag = Boolean(dragH || dragV)

    node.draggable(canDrag)
    node.listening(interactive || alarmWidget || legendToggle)

    if (!interactive && !alarmWidget) return

    const designX = widget.transform.x
    const designY = widget.transform.y

    const expectDblclick = (widget.events ?? []).some((e) => e.trigger === 'dblclick')

    const emitEvent = (trigger: EventTrigger) => {
      handlers.onWidgetEvent?.(widget.id, trigger, widget.events ?? [])
      if (trigger === 'click') {
        handlers.onWidgetClick?.(widget.id, widget.events ?? [])
        if (hasInputLink(widget)) handlers.onAnimationInput?.(widget.id)
      }
    }

    const emitClickOrDbl = (trigger: 'click' | 'dblclick') => {
      if (trigger === 'click') {
        clickDblGate.scheduleClick(widget.id, () => emitEvent('click'), expectDblclick)
        return
      }
      clickDblGate.triggerDblclick(widget.id, () => emitEvent('dblclick'))
    }

    node.on('mouseenter', () => {
      if (spacePressed) return
      stage.container().style.cursor = canDrag ? 'grab' : 'pointer'
      if (interactive) emitEvent('mouseEnter')
    })
    node.on('mouseleave', () => {
      if (!spacePressed) stage.container().style.cursor = 'default'
      if (interactive) emitEvent('mouseLeave')
    })

    node.on('dragstart', () => {
      if (spacePressed) {
        node.stopDrag()
        return
      }
      stage.container().style.cursor = 'grabbing'
    })

    node.on('dragmove', () => {
      if (dragH && !dragV) {
        node.y(designY)
        const minX = designX + Math.min(dragH.outMin, dragH.outMax)
        const maxX = designX + Math.max(dragH.outMin, dragH.outMax)
        node.x(Math.min(maxX, Math.max(minX, node.x())))
      } else if (dragV && !dragH) {
        node.x(designX)
        const minY = designY + Math.min(dragV.outMin, dragV.outMax)
        const maxY = designY + Math.max(dragV.outMin, dragV.outMax)
        node.y(Math.min(maxY, Math.max(minY, node.y())))
      } else if (dragH && dragV) {
        const minX = designX + Math.min(dragH.outMin, dragH.outMax)
        const maxX = designX + Math.max(dragH.outMin, dragH.outMax)
        const minY = designY + Math.min(dragV.outMin, dragV.outMax)
        const maxY = designY + Math.max(dragV.outMin, dragV.outMax)
        node.x(Math.min(maxX, Math.max(minX, node.x())))
        node.y(Math.min(maxY, Math.max(minY, node.y())))
      }
    })

    node.on('dragend', () => {
      stage.container().style.cursor = canDrag ? 'grab' : 'pointer'
      if (dragH) {
        const offset = node.x() - designX
        const value = mapDragOffsetToTag(offset, dragH)
        handlers.onDragWrite?.(widget.id, 'h', dragH.tagId, value)
      }
      if (dragV) {
        const offset = node.y() - designY
        const value = mapDragOffsetToTag(offset, dragV)
        handlers.onDragWrite?.(widget.id, 'v', dragV.tagId, value)
      }
    })

    node.on('mousedown', (e) => {
      e.cancelBubble = true
      if (spacePressed || !interactive) return
      emitEvent('mousedown')
    })
    node.on('mouseup', (e) => {
      e.cancelBubble = true
      if (spacePressed || !interactive) return
      emitEvent('mouseup')
    })
    node.on('click', (e) => {
      e.cancelBubble = true
      if (spacePressed) return
      const alarmId = e.target?.getAttr?.('alarmId')
      if (alarmWidget && alarmId) {
        handlers.onAlarmAck?.(String(alarmId))
        return
      }
      if (interactive) emitClickOrDbl('click')
    })
    node.on('dblclick', (e) => {
      e.cancelBubble = true
      if (spacePressed || !interactive) return
      emitClickOrDbl('dblclick')
    })
  }

  /**
   * scene3d 挖洞必须在背景层：与图元同层时 destination-out 会抹掉
   * 排在 scene3d 之前的兄弟图元，运行时看起来像「窜位」。
   */
  const syncScene3dHole = (widget: Widget2D) => {
    const holeId = `scene3d-hole:${widget.id}`
    let hole = bgLayer.findOne(`#${holeId}`) as Konva.Group | null
    if (widget.visible === false) {
      hole?.destroy()
      return
    }
    const { width, height } = widget.transform
    if (!hole) {
      hole = new Konva.Group({
        id: holeId,
        name: 'scene3d-hole',
        listening: false,
      })
      hole.add(
        new Konva.Rect({
          width,
          height,
          fill: '#000',
          globalCompositeOperation: 'destination-out',
          listening: false,
        }),
      )
      bgLayer.add(hole)
    }
    hole.position({ x: widget.transform.x, y: widget.transform.y })
    hole.rotation(widget.transform.rotation)
    hole.scale({ x: widget.transform.scaleX ?? 1, y: widget.transform.scaleY ?? 1 })
    hole.visible(true)
    for (const child of hole.getChildren()) {
      if (child instanceof Konva.Rect) {
        child.width(width)
        child.height(height)
      }
    }
  }

  /**
   * 运行端 scene3d：挖洞在 bgLayer。
   * 可交互时 HTML 三维叠层在 Konva 之上，此处不 listening，避免抢点击。
   * 仅展示时仍可 listening=false（无需热区）。
   */
  const createScene3dRuntimeNode = (widget: Widget2D) => {
    const { width, height } = widget.transform
    const group = new Konva.Group({
      id: widget.id,
      name: 'widget',
      x: widget.transform.x,
      y: widget.transform.y,
      rotation: widget.transform.rotation,
      scaleX: widget.transform.scaleX ?? 1,
      scaleY: widget.transform.scaleY ?? 1,
      visible: widget.visible !== false,
      listening: false,
      draggable: false,
    })
    group.setAttr('widgetId', widget.id)
    group.setAttr('widgetType', 'scene3d')
    group.add(
      new Konva.Rect({
        width,
        height,
        fill: 'rgba(0,0,0,0)',
        listening: false,
        name: 'scene3d-hit',
      }),
    )
    return group
  }

  const renderPage = (next: Page2D) => {
    clearAllBlink()
    currentPage = next
    pageWidth = next.width
    pageHeight = next.height

    sourceMap.clear()
    bgLayer.destroyChildren()
    widgetLayer.destroyChildren()
    // 背景 + 挖洞在下层；图元在上层，避免 destination-out 吃掉兄弟图元
    pageRect = new Konva.Rect({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      fill: next.background || '#1a1d24',
      listening: false,
      name: 'page-bg',
    })
    bgLayer.add(pageRect)
    for (const layer of next.layers) {
      if (!layer.visible) continue
      for (const widget of layer.widgets) {
        sourceMap.set(widget.id, widget)
        if (widget.visible === false) continue
        if (widget.type === 'scene3d') {
          syncScene3dHole(widget)
          const node = createScene3dRuntimeNode(widget)
          bindNodeEvents(node, widget)
          widgetLayer.add(node)
          continue
        }
        const node = createWidgetNode(widget)
        bindNodeEvents(node, widget)
        widgetLayer.add(node)
      }
    }
    bgLayer.batchDraw()
    widgetLayer.batchDraw()
    fitToView()
  }

  const applyVisual = (widgetId: string, visual: Widget2D, opts?: { blink?: boolean }) => {
    const source = sourceMap.get(widgetId)
    const node = widgetLayer.findOne(`#${widgetId}`) as Konva.Group | null

    if (visual.type === 'scene3d' || source?.type === 'scene3d') {
      if (!node) {
        if (visual.visible === false) return
        syncScene3dHole(visual)
        const created = createScene3dRuntimeNode(visual)
        bindNodeEvents(created, source ?? visual)
        widgetLayer.add(created)
        bgLayer.batchDraw()
        widgetLayer.batchDraw()
        return
      }
      if (visual.visible === false) {
        node.visible(false)
        syncScene3dHole(visual)
        bgLayer.batchDraw()
        widgetLayer.batchDraw()
        return
      }
      node.visible(true)
      node.position({ x: visual.transform.x, y: visual.transform.y })
      node.rotation(visual.transform.rotation)
      node.scale({ x: visual.transform.scaleX ?? 1, y: visual.transform.scaleY ?? 1 })
      const w = visual.transform.width
      const h = visual.transform.height
      for (const child of node.getChildren()) {
        if (child instanceof Konva.Rect) {
          child.width(w)
          child.height(h)
        }
      }
      syncScene3dHole(visual)
      bgLayer.batchDraw()
      widgetLayer.batchDraw()
      return
    }

    if (!node) {
      if (!source || visual.visible === false) return
      const created = createWidgetNode(visual)
      bindNodeEvents(created, source)
      widgetLayer.add(created)
      widgetLayer.batchDraw()
      if (isTrendWidget(visual)) syncTrendOverlays()
      return
    }

    if (visual.visible === false) {
      clearBlink(widgetId)
      node.visible(false)
      widgetLayer.batchDraw()
      if (isTrendWidget(visual)) syncTrendOverlays()
      return
    }

    node.visible(true)
    const wasDragging = node.isDragging()
    if (!wasDragging) {
      syncWidgetNode(node, visual)
    } else {
      // 拖拽中只更新外观，不抢位置
      const x = node.x()
      const y = node.y()
      syncWidgetNode(node, visual)
      node.position({ x, y })
    }

    const enabled = isWidgetRuntimeEnabled(visual)
    const interactive =
      enabled &&
      ((source?.events?.length ?? 0) > 0 || (source ? widgetHasInteractiveLinks(source) : false))
    // 图例点击是纯本地显示开关，不受"图元使能/有无事件"影响
    const legendToggle = widgetHasCurveLegend(source ?? visual)
    node.listening(interactive || (visual.type === 'alarm' && enabled) || legendToggle)
    if (source) {
      const dragH = getDragLink(source, 'h')
      const dragV = getDragLink(source, 'v')
      node.draggable(enabled && Boolean(dragH || dragV))
    }

    clearBlink(widgetId)
    if (opts?.blink && enabled) {
      let on = true
      blinkTimers.set(
        widgetId,
        setInterval(() => {
          on = !on
          node.opacity(on ? Number(visual.style.opacity ?? 1) : 0.25)
          widgetLayer.batchDraw()
        }, 400),
      )
    } else {
      node.opacity(Number(visual.style.opacity ?? 1))
    }
    widgetLayer.batchDraw()
    // 趋势图元：数据每 tick 都在变，原生叠层跟着刷新
    if (isTrendWidget(visual)) syncTrendOverlays()
  }

  // 运行端固定 fitToView 适配，不提供滚轮缩放（设计端 createKonvaStage 才有）

  stage.on('dragmove', () => {
    viewChangeListener?.()
  })
  stage.on('dragend', () => {
    viewChangeListener?.()
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !spacePressed) {
      spacePressed = true
      stage.draggable(true)
      stage.container().style.cursor = 'grab'
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      spacePressed = false
      stage.draggable(false)
      stage.container().style.cursor = 'default'
    }
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const onResize = () => {
    stage.width(container.clientWidth || 800)
    stage.height(container.clientHeight || 600)
    fitToView()
  }
  const findWidgetById = (id: string): Widget2D | undefined =>
    sourceMap.get(id) ?? currentPage.layers.flatMap((l) => l.widgets).find((w) => w.id === id)

  // 趋势图元交互（悬停读数 / 拖时间窗缩放 / 双击还原）；运行端默认开
  const trendInteraction = attachTrendChartInteraction(stage, findWidgetById, {
    enabled: opts?.chartInteraction === true,
  })

  const ro = new ResizeObserver(onResize)
  ro.observe(container)

  renderPage(page)

  return {
    stage,
    widgetLayer,
    fitToView,
    setPage: renderPage,
    renderPage,
    applyVisual,
    syncOverlays: () => syncTrendOverlays(),
    setOverlayInteractive: (on: boolean) => {
      overlayInteractive = on
      syncTrendOverlays()
    },
    getSourceWidget: sourceWidgetOf,
    getWidgetClientRect,
    setViewChangeListener: (fn) => {
      viewChangeListener = fn
    },
    setChartInteraction: (on: boolean) => trendInteraction.setEnabled(on),
    dispose: () => {
      historyZoom.dispose()
      trendLiveOverlay.dispose()
      clearAllBlink()
      clearInterval(alarmBlinkTimer)
      clickDblGate.dispose()
      viewChangeListener = null
      ro.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      stage.destroy()
    },
  }
}
