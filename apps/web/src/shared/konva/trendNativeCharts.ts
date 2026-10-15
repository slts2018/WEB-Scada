/**
 * 把实时趋势 / 历史趋势图元挂成原生 ECharts 控件。
 * 设计端、运行端、3D 面板共用：位置跟 Konva 图元矩形，数据走 buildTrendLiveSpec。
 */
import type Konva from 'konva'
import type { Widget2D } from '@web-scada/core'
import { buildTrendChartOption, trendZoomOf } from '@/shared/konva/trendChart'
import type { TrendLiveOverlay, TrendLiveSlot } from '@/shared/konva/trendChartLive'
import {
  buildTrendLiveSpec,
  chartFontSize,
  setTrendChartRendered,
} from '@/shared/konva/widgetNodes'
import { TREND_TOOLBAR_H } from '@/shared/runtime/trendHistoryQuery'
import { trendHistoryTableHeightOf } from '@/shared/runtime/trendHistoryTable'

/** 旋转或自带点击事件的图元仍走位图：叠层会挡拖拽 / 业务点击。 */
export function widgetUsesNativeTrend(widget: Widget2D): boolean {
  if (widget.type !== 'trend' && widget.type !== 'trendHistory') return false
  if (widget.visible === false) return false
  if (Math.abs(Number(widget.transform.rotation) || 0) > 0.01) return false
  if ((widget.events?.length ?? 0) > 0) return false
  return true
}

export function syncNativeTrendCharts(opts: {
  stage: Konva.Stage
  widgetLayer: Konva.Layer
  widgets: Widget2D[]
  overlay: TrendLiveOverlay
  /** 为 false 时图表看得见，但鼠标穿透，方便设计端拖图元 */
  interactive: boolean
  layoutOnly?: boolean
}): void {
  const scale = Math.abs(opts.stage.scaleX()) || 1
  const slots: TrendLiveSlot[] = []
  for (const widget of opts.widgets) {
    if (widget.type !== 'trend' && widget.type !== 'trendHistory') continue
    const node = opts.widgetLayer.findOne('#' + widget.id) as Konva.Group | null
    const live = widgetUsesNativeTrend(widget) && Boolean(node?.visible())
    if (node) setTrendChartRendered(node, !live)
    if (!live || !node) continue
    const rect = node.getClientRect({ skipShadow: true, skipStroke: false })
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) continue
    if (rect.width < 40 || rect.height < 30) continue
    // 历史趋势顶部留出时间搜索条，避免盖住曲线
    if (widget.type === 'trendHistory') {
      const bar = 32
      rect.y += bar
      rect.height = Math.max(30, rect.height - bar)
    }
    const pageFont = chartFontSize(
      widget,
      Math.max(20, widget.transform.width),
      Math.max(20, widget.transform.height),
    )
    // 历史趋势的 HTML 工具栏挂在图元顶部：图表要把这一条空出来，否则会被工具栏盖住
    const showToolbar = widget.type === 'trendHistory' && widget.props.showToolbar !== false
    const spec = buildTrendLiveSpec(widget, {
      width: rect.width,
      height: rect.height,
      fontSize: Math.max(10, pageFont * scale),
      chromeTop: showToolbar ? Math.round(TREND_TOOLBAR_H * scale) : 0,
      chromeBottom:
        widget.type === 'trendHistory' ? Math.round(trendHistoryTableHeightOf(widget.id) * scale) : 0,
    })
    spec.zoom = trendZoomOf(widget.id) ?? undefined
    slots.push({
      widgetId: widget.id,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      option: buildTrendChartOption(spec),
    })
  }
  opts.overlay.sync(slots, opts.interactive, opts.layoutOnly === true)
}
