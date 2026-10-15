/**
 * 防双击误触单击：同 key 在延时窗口内若收到 dblclick，则取消待执行的 click。
 * 纯逻辑，无 DOM；定时器可注入便于单测。
 */

export const DEFAULT_CLICK_DBLCLICK_DELAY_MS = 280

export type ClickDblclickGateTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

export type ClickDblclickGate = {
  /**
   * 调度单击。若 expectDblclick 为 false，立即执行（无延时）。
   * 若为 true，延时后再执行；窗口内 triggerDblclick 会取消。
   */
  scheduleClick: (key: string, run: () => void, expectDblclick: boolean) => void
  /** 取消待执行单击并立刻跑双击 */
  triggerDblclick: (key: string, run: () => void) => void
  dispose: () => void
}

export function createClickDblclickGate(opts?: {
  delayMs?: number
  timers?: ClickDblclickGateTimers
}): ClickDblclickGate {
  const delayMs = opts?.delayMs ?? DEFAULT_CLICK_DBLCLICK_DELAY_MS
  const timers: ClickDblclickGateTimers = opts?.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  }
  const pending = new Map<string, unknown>()

  const clear = (key: string) => {
    const id = pending.get(key)
    if (id === undefined) return
    timers.clearTimeout(id)
    pending.delete(key)
  }

  const scheduleClick = (key: string, run: () => void, expectDblclick: boolean) => {
    clear(key)
    if (!expectDblclick) {
      run()
      return
    }
    const id = timers.setTimeout(() => {
      pending.delete(key)
      run()
    }, delayMs)
    pending.set(key, id)
  }

  const triggerDblclick = (key: string, run: () => void) => {
    clear(key)
    run()
  }

  const dispose = () => {
    for (const key of [...pending.keys()]) clear(key)
  }

  return { scheduleClick, triggerDblclick, dispose }
}
