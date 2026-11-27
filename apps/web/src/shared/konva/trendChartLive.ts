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
import { setTrendZoom } from '@/shared/konva/trendChart'
import { trendHistoryQueryingOf, trendHistoryViewEpoch } from '@/shared/runtime/trendHistoryQuery'

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
  /** 底部滑块 / 滚轮缩放。历史趋势忽略它（只看已查出的点）；实时趋势用来记住显示窗口 */
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

  type LiveItem = {
    el: HTMLDivElement
    mask: HTMLDivElement
    chart: ECharts
    /** 尚未写入的整图 option；多次重画只保留最后一次 */
    pendingOption: Record<string, unknown> | null
    pendingSetOpts: Record<string, unknown> | null
    pendingShowFull: boolean
    pendingPan: boolean | undefined
    flushTimer: ReturnType<typeof setTimeout> | null
    flushing: boolean
  }

  const hiddenNamesOf = (item: LiveItem): string[] =>
    (item.el.dataset.legendHidden ?? "").split("|").filter(Boolean)

  /** 把已点掉的图例写进即将 flush 的 option，避免排队的 setOption 把刚隐藏的曲线灌回来。 */
  const withPersistedLegend = (
    option: Record<string, unknown>,
    hidden: string[],
  ): Record<string, unknown> => {
    if (!hidden.length) return option
    const legend = option.legend
    if (!legend || typeof legend !== "object" || Array.isArray(legend)) return option
    const current = (legend as { selected?: Record<string, boolean> }).selected ?? {}
    const selected = { ...current }
    for (const name of hidden) selected[name] = false
    return { ...option, legend: { ...(legend as Record<string, unknown>), selected } }
  }

  const placeMask = (item: LiveItem, slot: { rect: { x: number; y: number; width: number; height: number } }) => {
    const w = Math.max(20, Math.round(slot.rect.width))
    const h = Math.max(20, Math.round(slot.rect.height))
    item.mask.style.left = `${Math.round(slot.rect.x)}px`
    item.mask.style.top = `${Math.round(slot.rect.y)}px`
    item.mask.style.width = `${w}px`
    item.mask.style.height = `${h}px`
  }

  const syncQueryingUi = (item: LiveItem, interactive: boolean, widgetId: string) => {
    const querying = trendHistoryQueryingOf(widgetId)
    item.mask.style.display = querying ? "flex" : "none"
    item.mask.style.pointerEvents = querying ? "auto" : "none"
    item.el.style.pointerEvents = interactive && !querying ? "auto" : "none"
  }
  const live = new Map<string, LiveItem>()

  const isDisposed = (chart: ECharts): boolean => {
    try {
      return typeof chart.isDisposed === 'function' && chart.isDisposed()
    } catch {
      return true
    }
  }

  /**
   * 所有 setOption 都排到当前 ECharts/zrender 主流程之后再写。
   * 否则会在 mousemove / datazoom / 图例点选 / 上一次 setOption 的回调里再次 setOption：
   * 控制台报 `setOption` should not be called during main process，
   * 随后 Unknown dataType / getRawIndex，图停在上一笔原始点，切回「自动」看起来改不回来。
   * 同一图元多次排队只落最后一次 option。
   */
  const enqueueFlush = (item: LiveItem): void => {
    if (item.flushTimer != null) return
    item.flushTimer = setTimeout(() => {
      item.flushTimer = null
      flushItem(item)
    }, 0)
  }

  const flushItem = (item: LiveItem): void => {
    if (isDisposed(item.chart)) {
      item.pendingOption = null
      item.pendingSetOpts = null
      item.pendingShowFull = false
      item.pendingPan = undefined
      return
    }
    if (item.flushing) {
      enqueueFlush(item)
      return
    }
    item.flushing = true
    try {
      if (item.pendingOption) {
        const option = item.pendingOption
        const setOpts = item.pendingSetOpts ?? { notMerge: false, lazyUpdate: false, replaceMerge: ['series'] }
        item.pendingOption = null
        item.pendingSetOpts = null
        const nextOption = withPersistedLegend(option, hiddenNamesOf(item))
        try {
          item.chart.dispatchAction({ type: 'hideTip' })
        } catch {
          /* 提示框可能还没建 */
        }
        item.chart.setOption(nextOption, setOpts)
        item.flushing = false
        if (item.pendingOption || item.pendingShowFull || item.pendingPan !== undefined) enqueueFlush(item)
        return
      }
      if (item.pendingShowFull) {
        item.pendingShowFull = false
        item.chart.setOption(
          { dataZoom: [{ start: 0, end: 100 }, { start: 0, end: 100 }] },
          { notMerge: false, lazyUpdate: false },
        )
        item.flushing = false
        if (item.pendingOption || item.pendingShowFull || item.pendingPan !== undefined) enqueueFlush(item)
        return
      }
      if (item.pendingPan !== undefined) {
        const on = item.pendingPan
        item.pendingPan = undefined
        item.chart.setOption({ dataZoom: [{ moveOnMouseMove: on }] }, { notMerge: false, lazyUpdate: false })
      }
    } catch (err) {
      enqueueFlush(item)
    } finally {
      item.flushing = false
    }
  }

  const queueOption = (
    item: LiveItem,
    option: Record<string, unknown>,
    setOpts: Record<string, unknown>,
    showFull = false,
  ): void => {
    item.pendingOption = option
    item.pendingSetOpts = setOpts
    if (showFull) item.pendingShowFull = true
    enqueueFlush(item)
  }

  const drop = (widgetId: string) => {
    const item = live.get(widgetId)
    if (!item) return
    if (item.flushTimer != null) {
      clearTimeout(item.flushTimer)
      item.flushTimer = null
    }
    item.pendingOption = null
    item.pendingShowFull = false
    item.pendingPan = undefined
    try {
      item.chart.dispose()
    } catch {
      /* 忽略销毁期异常 */
    }
    item.el.remove()
    item.mask.remove()
    live.delete(widgetId)
  }

  /** 把滑块和滚轮拨回整段查询窗口。历史趋势换了开始/结束，或双击还原时用 */
  const showFullRange = (chart: ECharts) => {
    for (const item of live.values()) {
      if (item.chart !== chart) continue
      item.pendingShowFull = true
      enqueueFlush(item)
      return
    }
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
      const mask = document.createElement('div')
      mask.className = 'trend-querying-mask'
      mask.dataset.trendQuerying = slot.widgetId
      mask.textContent = '查询中'
      mask.style.cssText = [
        'position:absolute',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'pointer-events:none',
        'z-index:3',
        'background:rgba(11,18,32,0.58)',
        'color:#e8eef7',
        'font-size:16px',
        'font-weight:600',
        'letter-spacing:0.16em',
        'user-select:none',
      ].join(';')
      host.appendChild(mask)
      const chart = init(el, undefined, { renderer: 'canvas' })
      el.dataset.trendLive = slot.widgetId
      if (typeof window !== 'undefined') {
        const g = window as unknown as { __scadaTrendChart?: Record<string, unknown> }
        g.__scadaTrendChart = { ...(g.__scadaTrendChart ?? {}), [slot.widgetId]: chart }
      }
      ;(el as HTMLDivElement & { __trendLiveChart?: typeof chart }).__trendLiveChart = chart
      item = {
        el,
        mask,
        chart,
        pendingOption: null,
        pendingSetOpts: null,
        pendingShowFull: false,
        pendingPan: undefined,
        flushTimer: null,
        flushing: false,
      }
      live.set(slot.widgetId, item)
      // 双击 = 滑块回到这次查询的整段，不重新查
      chart.getZr().on('dblclick', () => {
        showFullRange(chart)
        opts.onReset?.(slot.widgetId)
      })
      // 拖游标：按住时指针离竖线 ±8px 内就算“拖游标”，
      // 拖期间临时关掉 dataZoom 的左键平移（否则窗口会跟着一起跑），松手恢复。
      let cursorDrag = false
      const inPlot = (x: number, y: number): boolean => {
        try {
          return chart.containPixel({ gridIndex: 0 }, [x, y]) === true
        } catch {
          return false
        }
      }
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
        item!.pendingPan = on
        enqueueFlush(item!)
      }
      chart.getZr().on('mousedown', (e: { offsetX: number; offsetY: number }) => {
        if (!opts.onCursor || !inPlot(e.offsetX, e.offsetY) || !nearCursor(e.offsetX)) return
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
      // 只在绘图区落游标。图例 / 工具箱 / 底部滑块上的点击若也走这里，
      // 会 sync 整图 option 并在排队的 setOption 里把刚点掉的图例又灌回去，看起来像点了没反应。
      chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
        if (!opts.onCursor || !inPlot(e.offsetX, e.offsetY)) return
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
        item!.el.dataset.legendHidden = hidden.join("|")
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
    placeMask(item, slot)
    if (moved) {
      chart.resize({
        width: Math.max(20, Math.round(slot.rect.width)),
        height: Math.max(20, Math.round(slot.rect.height)),
      })
    }
    // 拖拽图元时只改位置，不必每帧 setOption。
    // replaceMerge series：曲线条数变化时清掉旧序列，同时留下 dataZoom。
    if (!layoutOnly || !existed) {
      // 查询窗口换了：写入 option 后把 dataZoom 拨回 0–100（在下一拍执行，避免套叠 setOption）。
      // 不能在 zrender 事件里同步 setOption：原始点 5000 点时 mousemove 就可能占几百毫秒，
      // 此时切回自动灌新数据会被丢掉，图仍停在密原始点。
      const epoch = String(trendHistoryViewEpoch(slot.widgetId))
      const epochChanged = el.dataset.winEpoch != null && el.dataset.winEpoch !== epoch
      if (epochChanged) setTrendZoom(slot.widgetId, null)
      queueOption(
        item,
        slot.option,
        { notMerge: false, lazyUpdate: false, replaceMerge: ['series'] },
        epochChanged,
      )
      el.dataset.winEpoch = epoch
    }
  }

  return {
    sync: (slots: TrendLiveSlot[], interactive: boolean, layoutOnly = false) => {
      const keep = new Set(slots.map((slot) => slot.widgetId))
      for (const widgetId of [...live.keys()]) if (!keep.has(widgetId)) drop(widgetId)
      for (const slot of slots) {
        ensure(slot, layoutOnly)
        const item = live.get(slot.widgetId)
        if (item) syncQueryingUi(item, interactive, slot.widgetId)
      }
      host.style.display = slots.length ? 'block' : 'none'
    },
    dispose: () => {
      for (const widgetId of [...live.keys()]) drop(widgetId)
      host.remove()
    },
  }
}