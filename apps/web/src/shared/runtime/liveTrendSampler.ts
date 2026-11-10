/**
 * 实时趋势在页面切走后继续记点，但不重画看不见的图。
 * 设计端和运行端各挂一份；重复调用按采样时间戳去重，不会把同一个点记两次。
 */
import type { ProjectDocument, Widget2D } from '@web-scada/core'
import { liveTrendSourceTagIds, sampleLiveTrendWidget } from '@/shared/runtime/bindingEngine'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'

function eachWidget(widgets: Widget2D[] | undefined, visit: (widget: Widget2D) => void) {
  if (!widgets) return
  for (const widget of widgets) {
    visit(widget)
    if (widget.children?.length) eachWidget(widget.children, visit)
  }
}

function eachLiveTrend(doc: ProjectDocument, visit: (widget: Widget2D) => void) {
  for (const page of doc.pages) {
    if (page.type !== '2d') continue
    for (const layer of page.layers) {
      eachWidget(layer.widgets, (widget) => {
        if (widget.type === 'trend') visit(widget)
      })
    }
  }
}

let users = 0
let stopSampling: (() => void) | null = null

function start() {
  const project = useProjectStore()
  const tags = useTagStore()
  let subscribedKey = ''

  const sample = () => {
    const widgets: Widget2D[] = []
    const tagIds: string[] = []
    eachLiveTrend(project.document, (widget) => {
      widgets.push(widget)
      for (const id of liveTrendSourceTagIds(widget)) tagIds.push(id)
    })
    const key = [...new Set(tagIds)].sort().join('\0')
    if (key !== subscribedKey) {
      subscribedKey = key
      tags.setBackgroundSubscription(key ? key.split('\0') : [])
    }
    const getTag = (id: string) => tags.getValue(id)
    for (const widget of widgets) sampleLiveTrendWidget(widget, getTag)
  }

  sample()
  const removeListener = tags.addListener(() => sample())
  const timer = window.setInterval(sample, 1000)
  stopSampling = () => {
    removeListener()
    window.clearInterval(timer)
    subscribedKey = ''
    tags.setBackgroundSubscription([])
    stopSampling = null
  }
}

/** 调用方卸载时要执行返回的停止函数。没有实时趋势时几乎不做事。 */
export function retainLiveTrendSampling(): () => void {
  users += 1
  if (users === 1) start()
  let released = false
  return () => {
    if (released) return
    released = true
    users -= 1
    if (users > 0) return
    users = 0
    stopSampling?.()
  }
}
