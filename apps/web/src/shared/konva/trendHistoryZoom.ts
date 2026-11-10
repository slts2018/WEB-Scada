/**
 * 历史趋势双击还原。
 *
 * 底部滑块、滚轮、框选只在已经查回来的点里移动，不改查询窗口，也不再按缩放重查。
 * 双击清掉位图路径上记下的显示缩放；原生 ECharts 的滑块由叠层自己拨回 0%–100%。
 */
import { setTrendZoom } from '@/shared/konva/trendChart'

export interface TrendHistoryZoomBridge {
  /** 双击还原：清显示缩放，不重查 */
  handleReset: (widgetId: string) => void
  dispose: () => void
}

export function createTrendHistoryZoomBridge(opts: {
  /** 清掉显示缩放后重画 */
  repaint: () => void
}): TrendHistoryZoomBridge {
  return {
    handleReset: (widgetId: string) => {
      setTrendZoom(widgetId, null)
      opts.repaint()
    },
    dispose: () => {},
  }
}
