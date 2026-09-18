/** 设计端快捷键公共判断（2D/3D 共用） */

export const DESIGNER_CANVAS_ATTR = 'data-scada-canvas'

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (el.closest('.el-input, .el-textarea, .el-select, .el-input-number')) return true
  return false
}

export function hasMod(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey
}

/** 键盘修饰键按下态：部分环境下 pointer 事件的 ctrlKey 会丢 */
const heldMods = { ctrl: false, shift: false, meta: false }
let modsInstalled = false

export function installPointerModifierTracker() {
  if (modsInstalled || typeof window === 'undefined') return
  modsInstalled = true
  const down = (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') heldMods.ctrl = true
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') heldMods.shift = true
    if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') heldMods.meta = true
  }
  const up = (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') heldMods.ctrl = false
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') heldMods.shift = false
    if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') heldMods.meta = false
  }
  const clear = () => {
    heldMods.ctrl = false
    heldMods.shift = false
    heldMods.meta = false
  }
  window.addEventListener('keydown', down, true)
  window.addEventListener('keyup', up, true)
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear()
  })
}

export function isAdditivePointer(e: {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  getModifierState?: (key: string) => boolean
}): boolean {
  return Boolean(
    e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.getModifierState?.('Shift') ||
      e.getModifierState?.('Control') ||
      e.getModifierState?.('Meta') ||
      heldMods.ctrl ||
      heldMods.shift ||
      heldMods.meta,
  )
}

/**
 * 控件相关快捷键是否在「画布区域」上下文。
 * 点选画布会 focus 画布根节点；属性面板等区域不满足，快捷键不抢系统行为。
 */
export function isDesignerCanvasContext(el?: EventTarget | null): boolean {
  const candidates: Array<EventTarget | null | undefined> = [el, document.activeElement]
  for (const node of candidates) {
    if (!(node instanceof Element)) continue
    if (node.closest(`[${DESIGNER_CANVAS_ATTR}]`)) return true
  }
  return false
}

export function blurTypingTarget() {
  const el = document.activeElement
  if (el instanceof HTMLElement && isTypingTarget(el)) {
    el.blur()
  }
}
