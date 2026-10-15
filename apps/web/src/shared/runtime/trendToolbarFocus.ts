/**
 * 哪个趋势图元"接着"键盘。
 *
 * 为什么需要它：工具条是每个图元各挂一份的 HTML 叠层，窗口级的 keydown 会同时进到
 * 所有工具条 —— 一个画面上有好几张历史趋势时，按 ← 会同时动好几条游标。
 * 这里记住"最后碰过的那一个"（鼠标进工具条 / 图内点了游标 / 工具条上操作过），
 * 键盘只交给它；没有活动图元时退回旧行为（谁有游标谁响应）。
 */
const listeners = new Set<() => void>()

let activeId: string | null = null

export function activeTrendToolbarId(): string | null {
  return activeId
}

export function setActiveTrendToolbar(widgetId: string | null): void {
  const next = widgetId && widgetId.trim() ? widgetId.trim() : null
  if (next === activeId) return
  activeId = next
  for (const listener of listeners) listener()
}

/** 忘记某个图元（图元卸载 / 页面切换时调用），避免键盘还发给已经不在的画面 */
export function forgetTrendToolbar(widgetId: string): void {
  if (activeId === widgetId) setActiveTrendToolbar(null)
}

export function onActiveTrendToolbarChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 这次键盘事件该不该由该图元处理 */
export function shouldHandleTrendKeys(widgetId: string, hasCursor: boolean): boolean {
  if (activeId) return activeId === widgetId
  return hasCursor
}
