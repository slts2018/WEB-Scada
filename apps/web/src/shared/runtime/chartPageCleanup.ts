/**
 * 运行端翻页时释放上一页的历史查询和 ECharts 离屏位图。
 * 目录里连续点「下一页」时，若不丢掉这些缓存，查询和画布会一直堆到内存不足。
 */
import type { Widget2D } from '@web-scada/core'
import { clearEchartCache } from '@/shared/echart/render'
import { forgetEchartHistorySeedExcept, forgetEchartHistorySeeds } from '@/shared/runtime/bindingEngine'
import { invalidateTrendHistoryForEnter, releaseTrendHistoryExcept } from '@/shared/runtime/trendHistoryQuery'

type CleanupPage = { id?: string; layers?: Array<{ widgets?: Widget2D[] }> } | null | undefined

let lastKeepPageId: string | null = null

function keepPageKey(page: CleanupPage): string {
  if (page && typeof page.id === 'string' && page.id) return page.id
  return pageWidgetIds(page).join(',')
}

export function pageWidgetIds(page: { layers?: Array<{ widgets?: Widget2D[] }> } | null | undefined): string[] {
  const ids: string[] = []
  for (const layer of page?.layers ?? []) {
    for (const widget of layer.widgets ?? []) {
      if (widget?.id) ids.push(widget.id)
    }
  }
  return ids
}

/** 只保留当前页图元的历史缓存和种子；离屏折线位图缓存一并清空。 */
export function releaseChartsOnPageChange(
  keepPage: { id?: string; layers?: Array<{ widgets?: Widget2D[] }> } | null | undefined,
): void {
  const keep = new Set(pageWidgetIds(keepPage))
  const pageId = keepPageKey(keepPage)
  const flipped = pageId !== lastKeepPageId
  lastKeepPageId = pageId
  releaseTrendHistoryExcept(keep)
  forgetEchartHistorySeedExcept(keep)
  if (flipped) {
    // 进入新页或返回已访问页：清掉本页进页种子并重查，避免取消上一页查询后只剩实时右端点。
    forgetEchartHistorySeeds(keep)
    invalidateTrendHistoryForEnter(keep)
  }
  clearEchartCache()
}
