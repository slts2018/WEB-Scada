import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiListLogs, apiPostLog } from '@/shared/api/client'

export type OutputLevel = 'info' | 'success' | 'warn' | 'error'

export interface OutputEntry {
  id: string
  time: number
  level: OutputLevel
  source: string
  message: string
}

const MAX = 1000
const sessionStart = Date.now()

export const useOutputLogStore = defineStore('outputLog', () => {
  const entries = ref<OutputEntry[]>([])
  /** 输出栏只展示本会话（及清空之后）的记录；管理页走服务端完整历史。 */
  const paneClearedAt = ref(sessionStart)

  const list = computed(() => entries.value)
  const paneList = computed(() => entries.value.filter((e) => e.time >= paneClearedAt.value))

  function merge(items: OutputEntry[]) {
    if (!items.length) return
    const map = new Map(entries.value.map((e) => [e.id, e]))
    for (const it of items) {
      if (!it?.id) continue
      map.set(it.id, it)
    }
    entries.value = [...map.values()].sort((a, b) => b.time - a.time).slice(0, MAX)
  }

  function push(level: OutputLevel, message: string, source = '系统') {
    const entry: OutputEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: Date.now(),
      level,
      source,
      message,
    }
    entries.value = [entry, ...entries.value].slice(0, MAX)
    void apiPostLog(entry).catch(() => {
      /* 服务端不可用时仍保留本机输出栏记录 */
    })
    ensureOutputLogSync()
  }

  function info(message: string, source?: string) {
    push('info', message, source)
  }
  function success(message: string, source?: string) {
    push('success', message, source)
  }
  function warn(message: string, source?: string) {
    push('warn', message, source)
  }
  function error(message: string, source?: string) {
    push('error', message, source)
  }

  /** 只清空输出栏视图，不删除共享日志文件 / 管理页记录。 */
  function clear() {
    paneClearedAt.value = Date.now()
  }

  function ingest(items: OutputEntry[]) {
    merge(items)
  }

  return { entries, list, paneList, push, info, success, warn, error, clear, ingest }
})

let syncStarted = false
let syncTimer: ReturnType<typeof setInterval> | null = null

async function pullSharedLogs() {
  try {
    const res = await apiListLogs({ from: sessionStart - 15_000, limit: 1000 })
    useOutputLogStore().ingest(res.items || [])
  } catch {
    /* ignore */
  }
}

/** 设计端 / 运行端共用：从服务端拉取同一份记录，使两窗同步。 */
export function ensureOutputLogSync() {
  if (syncStarted) return
  if (typeof window === 'undefined') return
  syncStarted = true
  void pullSharedLogs()
  syncTimer = setInterval(() => void pullSharedLogs(), 2000)
}
