/**
 * 趋势图元的图内交互：**悬停游标读数** + **拖拽平移时间窗** + **底部滑块** + **导出图片** + **双击还原**。
 *
 * 为什么单独一个模块：设计端画布走 `createKonvaStage`，运行端/3D 面板走 `createRuntimeStage`，
 * 两条路的舞台不一样，但交互逻辑完全一样 —— 抽出来两边都挂一份。
 *
 * 为什么是"自己转发"而不是让 ECharts 原生接指针：图表画在**离屏 canvas** 里（再当图像贴进 Konva），
 * 指针事件落在 Konva 上；这里把命中位置换算成图表 CSS 像素，交给 ECharts 的 showTip / 自己的时间窗换算。
 * 底部滑块、导出按钮同理：由图表把控件画出来，手势算在我们这边。
 */
import type Konva from 'konva'
import { buildTrendChartImage, trendExportRect } from '@/shared/konva/widgetNodes'
import {
  clampTrendZoom,
  setTrendHover,
  setTrendZoom,
  trendChartCssSize,
  trendZoomOf,
} from '@/shared/konva/trendChart'
import type { Widget2D } from '@web-scada/core'

export interface TrendChartInteractionHandle {
  /** 设计端只有"实时预览"时才开；运行端一直开 */
  setEnabled: (on: boolean) => void
  isEnabled: () => boolean
}

interface TrendHit {
  widgetId: string
  widget: Widget2D
  image: Konva.Image
}



export function attachTrendChartInteraction(
  stage: Konva.Stage,
  resolveWidget: (id: string) => Widget2D | undefined,
  opts?: { enabled?: boolean },
): TrendChartInteractionHandle {
  let enabled = opts?.enabled === true
  let hoveredId: string | null = null
  let drag: {
    widgetId: string
    widget: Widget2D
    image: Konva.Image
    /** 平移用：上一个指针 x（CSS 像素） */
    lastX: number
    width: number
    restoreDraggable: boolean
  } | null = null

  const trendImageOf = (widgetId: string): Konva.Image | null => {
    const group = stage.findOne('#' + widgetId) as Konva.Group | null
    return ((group?.findOne?.('.trend-chart') ?? null) as Konva.Image | null) ?? null
  }

  /** 命中趋势图元（图表节点是 Konva.Image，名字 trend-chart） */
  const hitAt = (pos: { x: number; y: number } | null): TrendHit | null => {
    if (!pos) return null
    let node = stage.getIntersection(pos) as Konva.Node | null
    while (node && !node.id()) node = node.parent as Konva.Node | null
    const widgetId = node?.id()
    if (!widgetId) return null
    const widget = resolveWidget(widgetId)
    if (!widget || (widget.type !== 'trend' && widget.type !== 'trendHistory')) return null
    const image = ((node as Konva.Group).findOne?.('.trend-chart') ?? null) as Konva.Image | null
    if (!image) return null
    return { widgetId, widget, image }
  }

  /**
   * 指针在图表里的位置 → **ECharts CSS 像素**坐标。
   *
   * 这里最容易踩的坑：画布是 dpr 倍超采样的（460px 图元 → 1840px 画布），
   * 而 ECharts 的 showTip 只认 CSS 像素；喂画布像素会直接落到绘图区外，
   * 结果是"鼠标划过去什么都没有"。渲染时把 CSS 尺寸记在了画布上，这里照着换算。
   * 另外图表图像高度只到绘图区+坐标轴（不含图例），落在那下面就不显示游标。
   */
  const chartPoint = (
    hit: TrendHit,
  ): { x: number; y: number; width: number; local: { x: number; y: number } } | null => {
    const rel = hit.image.getRelativePointerPosition()
    const canvas = hit.image.image()
    if (!rel || !(canvas instanceof HTMLCanvasElement)) return null
    const nodeW = Math.max(1, hit.image.width())
    const nodeH = Math.max(1, hit.image.height())
    if (rel.y > nodeH) return null
    const css = trendChartCssSize(canvas)
    return {
      x: Math.max(0, Math.min(css.width, (rel.x / nodeW) * css.width)),
      y: Math.max(0, Math.min(css.height, (rel.y / nodeH) * css.height)),
      width: css.width,
      // 图元局部坐标：右上角"导出图片"按钮是 Konva 节点，命中判定用这个空间
      local: { x: rel.x, y: rel.y },
    }
  }

  /** 指针是否落在右上角"导出图片"按钮上（按钮自己的 Konva 节点会处理点击） */
  const onExportButton = (hit: TrendHit, local: { x: number; y: number }): boolean =>
    inside(local, trendExportRect(hit.widget), 2)


  const inside = (
    point: { x: number; y: number },
    rect: { x: number; y: number; width: number; height: number },
    pad = 0,
  ): boolean =>
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad

  const repaint = (hit: TrendHit) => {
    const canvas = buildTrendChartImage(hit.widget)
    if (!canvas) return
    hit.image.image(canvas)
    hit.image.getLayer()?.batchDraw()
  }

  const clearHover = () => {
    const id = hoveredId
    hoveredId = null
    if (!id) return
    setTrendHover(id, null)
    const image = trendImageOf(id)
    const widget = resolveWidget(id)
    if (image && widget) repaint({ widgetId: id, widget, image })
  }

  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!enabled) return
    if (drag) {
      const px = chartPoint(drag)
      if (!px) return
      // 在绘图区拖动 = 平移时间窗（双击还原）；不再有底部滑块
      const zoom = trendZoomOf(drag.widgetId) ?? { start: 0, end: 1 }
      const span = zoom.end - zoom.start
      const dxFrac = (px.x - drag.lastX) / Math.max(1, px.width)
      setTrendZoom(
        drag.widgetId,
        clampTrendZoom(zoom.start - dxFrac * span, zoom.end - dxFrac * span),
      )
      drag.lastX = px.x
      repaint(drag)
      e.cancelBubble = true
      return
    }
    const hit = hitAt(stage.getPointerPosition())
    if (!hit) {
      clearHover()
      return
    }
    const px = chartPoint(hit)
    if (!px) {
      clearHover()
      return
    }
    // 右上角导出按钮上不显示游标读数
    if (onExportButton(hit, px.local)) {
      clearHover()
      return
    }
    hoveredId = hit.widgetId
    setTrendHover(hit.widgetId, { x: px.x, y: px.y })
    repaint(hit)
    e.cancelBubble = true
  }

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!enabled) return
    const hit = hitAt(stage.getPointerPosition())
    if (!hit) return
    const px = chartPoint(hit)
    if (!px) return
    // 导出按钮：由它自己的 Konva 节点处理（会 cancelBubble 掉这里）
    if (onExportButton(hit, px.local)) return
    // 拖时间窗期间先关掉图元自身的拖动（设计端拖图元），松手恢复
    const group = stage.findOne('#' + hit.widgetId) as Konva.Group | null
    const restoreDraggable = group?.draggable() ?? false
    group?.draggable(false)
    drag = {
      widgetId: hit.widgetId,
      widget: hit.widget,
      image: hit.image,
      lastX: px.x,
      width: px.width,
      restoreDraggable,
    }
    e.cancelBubble = true
  }

  const onUp = () => {
    if (!drag) return
    const group = stage.findOne('#' + drag.widgetId) as Konva.Group | null
    if (group && drag.restoreDraggable) group.draggable(true)
    drag = null
  }

  const onDbl = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!enabled) return
    const hit = hitAt(stage.getPointerPosition())
    if (!hit) return
    setTrendZoom(hit.widgetId, null)
    repaint(hit)
    e.cancelBubble = true
  }

  stage.on('mousemove', onMove)
  stage.on('mouseleave', clearHover)
  stage.on('mousedown', onDown)
  stage.on('mouseup', onUp)
  stage.on('dblclick dbltap', onDbl)

  return {
    setEnabled: (on: boolean) => {
      enabled = on
      if (!on) {
        clearHover()
        onUp()
      }
    },
    isEnabled: () => enabled,
  }
}

