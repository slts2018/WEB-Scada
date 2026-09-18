import Konva from 'konva'
import type { AnimationLinkRange, EventBinding, EventTrigger, Page2D, Widget2D } from '@web-scada/core'
import { createWidgetNode, syncWidgetNode } from '@/shared/konva/widgetNodes'
import {
  isWidgetRuntimeEnabled,
  mapDragOffsetToTag,
  widgetHasInteractiveLinks,
} from '@/shared/runtime/bindingEngine'

export interface RuntimeStageHandlers {
  /** 图元交互事件（含 mouseEnter / mouseLeave） */
  onWidgetEvent?: (widgetId: string, trigger: EventTrigger, events: EventBinding[]) => void
  /** @deprecated 请用 onWidgetEvent；保留兼容 */
  onWidgetClick?: (widgetId: string, events: EventBinding[]) => void
  onAnimationInput?: (widgetId: string) => void
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
}

/**
 * Runtime 2D 舞台：静态还原 + 实时外观刷新 + 点击/拖拽写值。
 */
export function createRuntimeStage(
  container: HTMLDivElement,
  page: Page2D,
  handlers: RuntimeStageHandlers = {},
): RuntimeStageBundle {
  let pageWidth = page.width
  let pageHeight = page.height
  let spacePressed = false
  let currentPage: Page2D = page
  const sourceMap = new Map<string, Widget2D>()
  const blinkTimers = new Map<string, ReturnType<typeof setInterval>>()

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
      // 透明热区：把指针事件交给下方 HTML 三维层（叠在 Konva 之下）
      const forward = (e: Konva.KonvaEventObject<MouseEvent | PointerEvent | WheelEvent>) => {
        e.cancelBubble = true
        const pe = e.evt
        pe.preventDefault()
        pe.stopPropagation()
        const el = stage.container()
        const prev = el.style.pointerEvents
        el.style.pointerEvents = 'none'
        const below = document.elementFromPoint(pe.clientX, pe.clientY)
        el.style.pointerEvents = prev
        if (!below || below === el || el.contains(below)) return
        const init: MouseEventInit & PointerEventInit & WheelEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: pe.clientX,
          clientY: pe.clientY,
          screenX: pe.screenX,
          screenY: pe.screenY,
          button: 'button' in pe ? pe.button : 0,
          buttons: 'buttons' in pe ? pe.buttons : 0,
          ctrlKey: pe.ctrlKey,
          shiftKey: pe.shiftKey,
          altKey: pe.altKey,
          metaKey: pe.metaKey,
        }
        if (pe instanceof WheelEvent) {
          below.dispatchEvent(
            new WheelEvent(pe.type, {
              ...init,
              deltaX: pe.deltaX,
              deltaY: pe.deltaY,
              deltaZ: pe.deltaZ,
              deltaMode: pe.deltaMode,
            }),
          )
          return
        }
        if (typeof PointerEvent !== 'undefined' && pe instanceof PointerEvent) {
          below.dispatchEvent(
            new PointerEvent(pe.type, {
              ...init,
              pointerId: pe.pointerId,
              pointerType: pe.pointerType,
              isPrimary: pe.isPrimary,
              pressure: pe.pressure,
            }),
          )
          return
        }
        below.dispatchEvent(new MouseEvent(pe.type, init))
      }
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'mousedown',
        'mouseup',
        'mousemove',
        'click',
        'dblclick',
        'wheel',
        'contextmenu',
      ] as const) {
        node.on(type, forward)
      }
      return
    }

    const interactive =
      (widget.events?.length ?? 0) > 0 || widgetHasInteractiveLinks(widget)
    const dragH = getDragLink(widget, 'h')
    const dragV = getDragLink(widget, 'v')
    const canDrag = Boolean(dragH || dragV)

    node.draggable(canDrag)
    node.listening(interactive)

    if (!interactive) return

    const designX = widget.transform.x
    const designY = widget.transform.y

    const emitEvent = (trigger: EventTrigger) => {
      handlers.onWidgetEvent?.(widget.id, trigger, widget.events ?? [])
      if (trigger === 'click') {
        handlers.onWidgetClick?.(widget.id, widget.events ?? [])
        if (hasInputLink(widget)) handlers.onAnimationInput?.(widget.id)
      }
    }

    node.on('mouseenter', () => {
      if (spacePressed) return
      stage.container().style.cursor = canDrag ? 'grab' : 'pointer'
      emitEvent('mouseEnter')
    })
    node.on('mouseleave', () => {
      if (!spacePressed) stage.container().style.cursor = 'default'
      emitEvent('mouseLeave')
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
      if (spacePressed) return
      emitEvent('mousedown')
    })
    node.on('mouseup', (e) => {
      e.cancelBubble = true
      if (spacePressed) return
      emitEvent('mouseup')
    })
    node.on('click', (e) => {
      e.cancelBubble = true
      if (spacePressed) return
      emitEvent('click')
    })
    node.on('dblclick', (e) => {
      e.cancelBubble = true
      if (spacePressed) return
      emitEvent('dblclick')
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

  /** 运行端：仅透明热区；挖洞在 bgLayer，真实 3D 在下方 HTML 叠层 */
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
      listening: true,
      draggable: false,
    })
    group.setAttr('widgetId', widget.id)
    group.setAttr('widgetType', 'scene3d')
    group.add(
      new Konva.Rect({
        width,
        height,
        fill: 'rgba(0,0,0,0)',
        listening: true,
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
      return
    }

    if (visual.visible === false) {
      clearBlink(widgetId)
      node.visible(false)
      widgetLayer.batchDraw()
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
    node.listening(interactive)
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
    getSourceWidget: (id) =>
      sourceMap.get(id) ??
      currentPage.layers.flatMap((l) => l.widgets).find((w) => w.id === id),
    getWidgetClientRect,
    setViewChangeListener: (fn) => {
      viewChangeListener = fn
    },
    dispose: () => {
      clearAllBlink()
      viewChangeListener = null
      ro.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      stage.destroy()
    },
  }
}
