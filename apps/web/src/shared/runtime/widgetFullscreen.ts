/**
 * 图元级全屏 / 最大化（历史趋势工具栏右上角的"最大化"按钮）。
 *
 * 为什么不写进工程 JSON：全屏是"怎么看"的运行态，不是画面配置；
 * 和 trendZoomOf / 窗口状态一样只放内存，按图元 id 存。运行时把**视口**聚焦到该图元
 * （缩放 + 平移 + 隐藏其它图元），不改变图元自身的 transform，退出后原样恢复。
 */
const listeners = new Set<() => void>()

let fullscreenId: string | null = null

/** 当前最大化的图元 id（null = 没有） */
export function widgetFullscreenId(): string | null {
  return fullscreenId
}

export function widgetFullscreenOf(widgetId: string): boolean {
  return fullscreenId === widgetId
}

export function setWidgetFullscreen(widgetId: string | null): void {
  const next = widgetId && widgetId.trim() ? widgetId.trim() : null
  if (next === fullscreenId) return
  fullscreenId = next
  for (const listener of listeners) listener()
}

export function toggleWidgetFullscreen(widgetId: string): void {
  setWidgetFullscreen(fullscreenId === widgetId ? null : widgetId)
}

export function onWidgetFullscreenChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
