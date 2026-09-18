import type { Page, Page3D, ScriptAsset } from '@web-scada/core'
import { useProjectStore } from '@/stores/project'

/** 脚本执行上下文（试跑 / 运行端只读注入） */
export interface ScriptRunContext {
  scriptId?: string
  scriptName?: string
  pageId?: string
  widgetId?: string
  trigger?: string
  mode: 'runtime' | 'try'
}

export interface ScriptApi {
  getTag: (tagId: string) => unknown
  writeTag: (tagId: string, value: unknown) => void
  log: (message: unknown) => void
  context: ScriptRunContext
}

export interface ScriptRunResult {
  ok: boolean
  error?: string
  logs: string[]
}

function buildApi(
  api: {
    getTag: ScriptApi['getTag']
    writeTag: ScriptApi['writeTag']
    log: ScriptApi['log']
  },
  context: ScriptRunContext,
  capture?: string[],
): ScriptApi {
  return {
    getTag: api.getTag,
    writeTag: api.writeTag,
    log: (message) => {
      const text = String(message)
      capture?.push(text)
      api.log(message)
    },
    context,
  }
}

/** 有限 API 沙箱执行脚本；返回是否成功（供试跑面板） */
export function runScriptSource(
  source: string,
  api: {
    getTag: ScriptApi['getTag']
    writeTag: ScriptApi['writeTag']
    log: ScriptApi['log']
    context?: Partial<ScriptRunContext>
  },
): ScriptRunResult {
  const logs: string[] = []
  const context: ScriptRunContext = {
    mode: 'runtime',
    ...api.context,
  }
  const full = buildApi(api, context, logs)
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'getTag',
      'writeTag',
      'log',
      'context',
      `"use strict";\n${source}`,
    )
    fn(full.getTag, full.writeTag, full.log, full.context)
    return { ok: true, logs }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    full.log(`脚本错误: ${error}`)
    return { ok: false, error, logs }
  }
}

export type ScriptApiInput = {
  getTag: ScriptApi['getTag']
  writeTag: ScriptApi['writeTag']
  log: ScriptApi['log']
  context?: Partial<ScriptRunContext>
}

/** 页面进入时执行挂载脚本（一次性） */
export function runPageScripts(page: Page, api: ScriptApiInput) {
  const project = useProjectStore()
  const ids = page.scriptIds ?? []
  for (const scriptId of ids) {
    const script = project.document.scripts.find((s) => s.id === scriptId)
    if (!script) continue
    runScriptSource(script.source, {
      ...api,
      context: {
        mode: 'runtime',
        ...api.context,
        scriptId: script.id,
        scriptName: script.name,
        pageId: page.id,
        trigger: 'load',
      },
    })
  }
}

function scheduleEligible(script: ScriptAsset): number | null {
  if (script.intervalEnabled === false) return null
  const ms = Number(script.intervalMs)
  if (!Number.isFinite(ms) || ms < 100) return null
  return Math.min(Math.floor(ms), 3600_000)
}

/**
 * 启动页面挂载脚本的周期调度；返回清理函数。
 * 进入页面时的一次性执行仍由 runPageScripts 负责。
 */
export function startPageScriptSchedules(page: Page, api: ScriptApiInput): () => void {
  const project = useProjectStore()
  const timers: ReturnType<typeof setInterval>[] = []
  const ids = page.scriptIds ?? []
  for (const scriptId of ids) {
    const script = project.document.scripts.find((s) => s.id === scriptId)
    if (!script) continue
    const ms = scheduleEligible(script)
    if (ms == null) continue
    const timer = setInterval(() => {
      runScriptSource(script.source, {
        ...api,
        context: {
          mode: 'runtime',
          ...api.context,
          scriptId: script.id,
          scriptName: script.name,
          pageId: page.id,
          trigger: 'timer',
        },
      })
    }, ms)
    timers.push(timer)
  }
  return () => {
    for (const t of timers) clearInterval(t)
  }
}

export function isPage3D(page: Page): page is Page3D {
  return page.type === '3d'
}
