/**
 * 3D 面板（跟镜头 HTML 面板）里的历史趋势工具条。
 *
 * 为什么单独挂一层：面板内容是 Konva 画的（`panelKonvaRuntime`），工具栏是 Vue 组件，
 * 直接复用 2D 画面上那一份 `TrendHistoryToolbar`（区间 / 缩放 / 跟随 / 采样间隔 / 点表 /
 * 导出 / 快捷键提示全都有），位置仍按图元矩形算 —— 面板里 Konva 是 1:1 像素，
 * 所以矩形就是面板内的 CSS 像素，不用再做缩放换算。
 *
 * 只读（设计端场景）不挂：那个视图里改区间/缩放没有意义。
 */
import { createApp, h, shallowRef, type App } from 'vue'
import { trendCurves } from '@web-scada/core'
import TrendHistoryToolbar from '@/components/runtime/TrendHistoryToolbar.vue'
import TrendHistoryTable from '@/components/runtime/TrendHistoryTable.vue'
import type { PanelKonvaRuntime } from '@/shared/three/panelKonvaRuntime'
import { registerTrendHistoryLinkTarget } from '@/shared/runtime/trendHistoryLink'
import {
  onTrendHistoryTableChange,
  trendHistoryTableHeightOf,
  trendHistoryTableVisibleOf,
  trendTableHeightFor,
} from '@/shared/runtime/trendHistoryTable'

export interface PanelTrendToolbarLayer {
  /** 面板内容/尺寸变化后重算矩形 */
  refresh: () => void
  dispose: () => void
}

interface PanelTrendTable {
  id: string
  curves: Array<{ tagId: string; label?: string; unit?: string; decimals?: number }>
  x: number
  y: number
  w: number
  h: number
}

interface PanelTrendBar {
  id: string
  preset: string
  tagIds: string[]
  curves: Array<{ tagId: string; label?: string; unit?: string; decimals?: number }>
  allowEdit: boolean
  x: number
  y: number
  w: number
  h: number
}

const layersByHost = new WeakMap<HTMLElement, PanelTrendToolbarLayer>()

/** 面板元素上挂着的趋势工具条（没有则 undefined） */
export function getPanelTrendToolbarLayer(host: HTMLElement): PanelTrendToolbarLayer | undefined {
  return layersByHost.get(host)
}

export function mountPanelTrendToolbars(
  host: HTMLElement,
  runtime: PanelKonvaRuntime,
): PanelTrendToolbarLayer {
  const layer = document.createElement('div')
  layer.className = 'panel-trend-layer'
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;'
  host.appendChild(layer)

  const bars = shallowRef<PanelTrendBar[]>([])
  const tables = shallowRef<PanelTrendTable[]>([])
  let unregister: Array<() => void> = []
  /** 同 Canvas2DRuntime：哨兵用 null，"关掉点表"算出来的空签名才不会被当成没变化 */
  let lastSignature: string | null = null

  const refresh = () => {
    const next: PanelTrendBar[] = []
    const nextTables: PanelTrendTable[] = []
    for (const widget of runtime.widgets) {
      if (widget.type !== 'trendHistory' || widget.visible === false) continue
      if (widget.props.showToolbar === false) continue
      const rect = runtime.bundle.getWidgetClientRect(widget.id)
      if (!rect) continue
      const curves = trendCurves(widget.props)
      // 点表：贴在这个图元底部，高度与图表让出的 chromeBottom 同源
      if (trendHistoryTableVisibleOf(widget.id)) {
        const stored = trendHistoryTableHeightOf(widget.id)
        const h = stored > 0 ? stored : trendTableHeightFor(rect.height)
        if (h > 0) {
          nextTables.push({
            id: widget.id,
            curves: curves.map((curve) => ({
              tagId: curve.tagId,
              label: curve.label,
              unit: curve.unit,
              decimals: curve.decimals,
            })),
            x: rect.x,
            y: rect.y + rect.height - h,
            w: rect.width,
            h,
          })
        }
      }
      next.push({
        id: widget.id,
        preset: String(widget.props.range ?? '-1h'),
        tagIds: curves.map((curve) => curve.tagId).filter(Boolean),
        curves: curves.map((curve) => ({
          tagId: curve.tagId,
          label: curve.label,
          unit: curve.unit,
          decimals: curve.decimals,
        })),
        allowEdit: widget.props.allowTimeEdit !== false,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
      })
    }
    const signature =
      next
        .map(
          (bar) =>
            `${bar.id}:${Math.round(bar.x)},${Math.round(bar.y)},${Math.round(bar.w)},${Math.round(bar.h)},${bar.preset},${bar.tagIds.join('+')}`,
        )
        .join('|') +
      '##' +
      nextTables
        .map((slot) => `${slot.id}:${Math.round(slot.x)},${Math.round(slot.y)},${Math.round(slot.w)},${Math.round(slot.h)}`)
        .join('|')
    if (signature === lastSignature) return
    lastSignature = signature
    tables.value = nextTables
    for (const off of unregister) off()
    unregister = next
      .filter((bar) => bar.tagIds.length)
      .map((bar) => registerTrendHistoryLinkTarget({ widgetId: bar.id, tagIds: bar.tagIds }))
    bars.value = next
  }

  const app: App = createApp({
    name: 'PanelTrendToolbarLayer',
    setup() {
      // 面板里不做"图元最大化"（那会放大整个面板内容，没有意义）
      return () => {
        const children = bars.value.map((bar) =>
          h(TrendHistoryToolbar, {
            key: bar.id,
            widgetId: bar.id,
            preset: bar.preset,
            tagIds: bar.tagIds,
            curves: bar.curves,
            allowEdit: bar.allowEdit,
            width: bar.w,
            fullscreenSupported: false,
            style: {
              position: 'absolute',
              left: `${Math.round(bar.x)}px`,
              top: `${Math.round(bar.y)}px`,
              width: `${Math.max(80, Math.round(bar.w))}px`,
              height: `${Math.max(20, Math.round(bar.h))}px`,
              pointerEvents: 'auto',
            },
          }),
        )
        for (const slot of tables.value) {
          children.push(
            h(TrendHistoryTable, {
              key: `${slot.id}:table`,
              widgetId: slot.id,
              curves: slot.curves,
              style: {
                position: 'absolute',
                left: `${Math.round(slot.x)}px`,
                top: `${Math.round(slot.y)}px`,
                width: `${Math.max(80, Math.round(slot.w))}px`,
                height: `${Math.max(40, Math.round(slot.h))}px`,
              },
            }),
          )
        }
        return h(
          'div',
          { class: 'panel-trend-layer-inner', style: 'position:absolute;inset:0;' },
          children,
        )
      }
    },
  })
  app.mount(layer)
  refresh()

  // 面板里的点表开关：先让图表按新状态重排（顺便算出表该占多高），再摆表。
  // 3D 页面没有 2D 运行端那套刷新链路，这里自己接上（判断相等有守卫，不会来回抖）。
  const offTable = onTrendHistoryTableChange(() => {
    runtime.bundle.syncOverlays()
    refresh()
  })

  const handle: PanelTrendToolbarLayer = {
    refresh,
    dispose: () => {
      offTable()
      for (const off of unregister) off()
      unregister = []
      bars.value = []
      tables.value = []
      app.unmount()
      layer.remove()
      layersByHost.delete(host)
    },
  }
  layersByHost.set(host, handle)
  return handle
}
