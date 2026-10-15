/**
 * 趋势图元的"原生 ECharts 活控件"叠层。
 *
 * 为什么有它：图片模式（离屏渲染再贴回 Konva）在旋转/缩放/层级上最稳，
 * 但 ECharts 自带的交互（游标跟随、滚轮缩放、底部滑块、图例点选、保存图片）全都吃不到鼠标。
 * 这里把趋势图元挂成**真正的 ECharts 实例**放在 HTML 叠层上：鼠标事件直接进 ECharts，
 * 上面那些交互原生可用，不用我们再自己画、自己算坐标。
 *
 * 不适合的场景（图元旋转、图元自己带业务点击事件）由调用方过滤，仍走图片模式。
 */
import { init, use, type ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([
  LineChart,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
])

export interface TrendLiveSlot {
  widgetId: string
  /** 相对叠层容器的屏幕矩形 */
  rect: { x: number; y: number; width: number; height: number }
  /** 组装好的原生 ECharts option */
  option: Record<string, unknown>
}

export interface TrendLiveOverlay {
  /**
   * 按当前页面/视图同步（多退少补）。
   * layoutOnly：只改位置和尺寸（拖图元），不重灌 option。
   */
  sync: (slots: TrendLiveSlot[], interactive: boolean, layoutOnly?: boolean) => void
  dispose: () => void
}

export function createTrendLiveOverlay(opts: {
  host: HTMLElement
  /** 图例点选变化 → 记下被点掉的曲线 */
  onLegendSelect?: (widgetId: string, hidden: string[]) => void
  /** 底部滑块 / 滚轮缩放 → 记下时间窗，下次 setOption 不会把窗口弹回去 */
  onZoom?: (widgetId: string, zoom: { start: number; end: number }) => void
  /** 图内单击 = 在该时刻落游标（历史趋势） */
  onCursor?: (widgetId: string, at: number) => void
  /** 当前游标时间（拖游标时判断“按住的是不是那条线”） */
  cursorOf?: (widgetId: string) => number | null
  /** 双击图内 = 还原缩放（图标路径由 trendChartInteraction 处理，这里只管原生叠层） */
  onReset?: (widgetId: string) => void
}): TrendLiveOverlay {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
  if (getComputedStyle(opts.host).position === 'static') opts.host.style.position = 'relative'
  opts.host.appendChild(host)

  const live = new Map<string, { el: HTMLDivElement; chart: ECharts }>()

  const drop = (widgetId: string) => {
    const item = live.get(widgetId)
    if (!item) return
    try {
      item.chart.dispose()
    } catch {
      /* 忽略销毁期异常 */
    }
    item.el.remove()
    live.delete(widgetId)
  }

  const readZoom = (chart: ECharts): { start: number; end: number } | null => {
    try {
      const option = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }> }
      const dz = option.dataZoom?.[0]
      if (!dz) return null
      const start = Number(dz.start)
      const end = Number(dz.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || (start === 0 && end === 100)) return null
      return { start: start / 100, end: end / 100 }
    } catch {
      return null
    }
  }

  const place = (el: HTMLDivElement, slot: TrendLiveSlot) => {
    const w = Math.max(20, Math.round(slot.rect.width))
    const h = Math.max(20, Math.round(slot.rect.height))
    el.style.left = `${Math.round(slot.rect.x)}px`
    el.style.top = `${Math.round(slot.rect.y)}px`
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.dataset.rect = `${w}x${h}`
  }

  const ensure = (slot: TrendLiveSlot, layoutOnly: boolean) => {
    const existed = live.has(slot.widgetId)
    let item = live.get(slot.widgetId)
    if (!item) {
      const el = document.createElement('div')
      el.style.cssText = 'position:absolute;pointer-events:auto;overflow:hidden;'
      // 先给尺寸再 init：ECharts 初始化时量不到容器宽高会直接摆烂
      place(el, slot)
      host.appendChild(el)
      const chart = init(el, undefined, { renderer: 'canvas' })
      item = { el, chart }
      live.set(slot.widgetId, item)
      // 双击 = 还原显示缩放（历史趋势还会因此跳回“当前查询窗口”）
      chart.getZr().on('dblclick', () => opts.onReset?.(slot.widgetId))
      // 拖游标：按住时指针离竖线 ±8px 内就算“拖游标”，
      // 拖期间临时关掉 dataZoom 的左键平移（否则窗口会跟着一起跑），松手恢复。
      let cursorDrag = false
      const nearCursor = (offsetX: number): boolean => {
        const at = opts.cursorOf?.(slot.widgetId)
        if (at == null) return false
        try {
          const px = chart.convertToPixel({ xAxisIndex: 0 }, at)
          const x = Array.isArray(px) ? Number(px[0]) : Number(px)
          return Number.isFinite(x) && Math.abs(offsetX - x) <= 8
        } catch {
          return false
        }
      }
      const setPanEnabled = (on: boolean) => {
        try {
          chart.setOption({ dataZoom: [{ moveOnMouseMove: on }] })
        } catch {
          /* 窗口正在换算时可能报错：忽略 */
        }
      }
      chart.getZr().on('mousedown', (e: { offsetX: number }) => {
        if (!opts.onCursor || !nearCursor(e.offsetX)) return
        cursorDrag = true
        setPanEnabled(false)
      })
      chart.getZr().on('mousemove', (e: { offsetX: number; offsetY: number }) => {
        if (!cursorDrag || !opts.onCursor) return
        try {
          const v = chart.convertFromPixel({ xAxisIndex: 0 }, [e.offsetX, e.offsetY])
          const at = Array.isArray(v) ? Number(v[0]) : Number(v)
          if (Number.isFinite(at)) opts.onCursor(slot.widgetId, at)
        } catch {
          /* 换算不出来就跳过这一帧 */
        }
      })
      chart.getZr().on('mouseup', () => {
        if (!cursorDrag) return
        cursorDrag = false
        setPanEnabled(true)
      })
      // zrender 只在"没有拖动"时才发 click：拖拽平移不会误落游标
      chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
        if (!opts.onCursor) return
        try {
          const v = chart.convertFromPixel({ xAxisIndex: 0 }, [e.offsetX, e.offsetY])
          const at = Array.isArray(v) ? Number(v[0]) : Number(v)
          if (Number.isFinite(at)) opts.onCursor(slot.widgetId, at)
        } catch {
          /* 缩放/改窗口瞬间换算出 NaN：忽略 */
        }
      })
      // 图例点选：写回"被点掉的曲线"，这样每 tick 重画不会把它弹回来
      chart.on('legendselectchanged', (params: unknown) => {
        const selected = (params as { selected?: Record<string, boolean> }).selected ?? {}
        const hidden = Object.keys(selected).filter((name) => selected[name] === false)
        opts.onLegendSelect?.(slot.widgetId, hidden)
      })
      // 滑块 / 滚轮缩放：记下时间窗
      chart.on('datazoom', () => {
        const zoom = readZoom(item!.chart)
        if (zoom) opts.onZoom?.(slot.widgetId, zoom)
      })
    }
    const { el, chart } = item
    const rectKey = `${Math.max(20, Math.round(slot.rect.width))}x${Math.max(20, Math.round(slot.rect.height))}`
    const moved = el.dataset.rect !== rectKey
    place(el, slot)
    if (moved) {
      chart.resize({
        width: Math.max(20, Math.round(slot.rect.width)),
        height: Math.max(20, Math.round(slot.rect.height)),
      })
    }
    // 拖拽图元时只改位置，不必每帧 setOption。
    // replaceMerge series：曲线条数变化时清掉旧序列，同时留下 dataZoom。
    if (!layoutOnly || !existed) {
      chart.setOption(slot.option, { notMerge: false, lazyUpdate: true, replaceMerge: ['series'] })
    }
  }

  return {
    sync: (slots: TrendLiveSlot[], interactive: boolean, layoutOnly = false) => {
      const keep = new Set(slots.map((slot) => slot.widgetId))
      for (const widgetId of [...live.keys()]) if (!keep.has(widgetId)) drop(widgetId)
      for (const slot of slots) {
        ensure(slot, layoutOnly)
        const item = live.get(slot.widgetId)
        if (item) item.el.style.pointerEvents = interactive ? 'auto' : 'none'
      }
      host.style.display = slots.length ? 'block' : 'none'
    },
    dispose: () => {
      for (const widgetId of [...live.keys()]) drop(widgetId)
      host.remove()
    },
  }
}