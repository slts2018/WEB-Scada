/**
 * 运行端挂载后：为工程里所有 ECharts 折线/面积保持后台订阅，
 * 并在离开当前页时继续把实时点写入缓冲。
 * 否则回页时旧尾巴和新进页历史对不齐，会在缺口上画出一条斜线。
 */
import type { Widget2D } from '@web-scada/core'
import { echartTagIds } from '@/shared/echart/content'
import { isLiveEchartWidget, sampleLiveEchartWidget } from '@/shared/runtime/bindingEngine'
import { releaseChartsOnPageChange } from '@/shared/runtime/chartPageCleanup'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'

let users = 0
let stopListen: (() => void) | null = null
let lastActivePageId: string | null = null

function pageWidgets(page: { layers?: Array<{ widgets?: Widget2D[] }> }): Widget2D[] {
  return (page.layers ?? []).flatMap((layer) => layer.widgets ?? [])
}

function collectLiveEchartWidgets(): Array<{ pageId: string; widget: Widget2D }> {
  const project = useProjectStore()
  const out: Array<{ pageId: string; widget: Widget2D }> = []
  for (const page of project.document.pages) {
    if (page.type === '3d') continue
    for (const widget of pageWidgets(page)) {
      if (widget.visible === false) continue
      if (!isLiveEchartWidget(widget)) continue
      out.push({ pageId: page.id, widget })
    }
  }
  return out
}

function tick(): void {
  const tags = useTagStore()
  const project = useProjectStore()
  const items = collectLiveEchartWidgets()
  const ids = new Set<string>()
  for (const { widget } of items) {
    for (const id of echartTagIds(widget.props)) if (id) ids.add(id)
  }
  tags.setBackgroundSubscription([...ids])
  const active = project.activePageId
  if (active && active !== lastActivePageId) {
    lastActivePageId = active
    const page = project.document.pages.find((item) => item.id === active)
    if (page && page.type !== '3d') releaseChartsOnPageChange(page)
  }
  const getTag = (id: string) => tags.getValue(id)
  for (const { pageId, widget } of items) {
    if (pageId === active) continue
    sampleLiveEchartWidget(widget, getTag)
  }
}

/** 调用方卸载时要执行返回的停止函数。 */
export function retainLiveTrendSampling(): () => void {
  const tags = useTagStore()
  users += 1
  if (users === 1) {
    tick()
    stopListen = tags.addListener(() => tick())
  }
  let released = false
  return () => {
    if (released) return
    released = true
    users -= 1
    if (users > 0) return
    users = 0
    stopListen?.()
    stopListen = null
    tags.setBackgroundSubscription([])
  }
}
