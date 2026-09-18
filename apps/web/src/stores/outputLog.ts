import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type OutputLevel = 'info' | 'success' | 'warn' | 'error'

export interface OutputEntry {
  id: string
  time: number
  level: OutputLevel
  source: string
  message: string
}

const MAX = 200

export const useOutputLogStore = defineStore('outputLog', () => {
  const entries = ref<OutputEntry[]>([])

  const list = computed(() => entries.value)

  function push(level: OutputLevel, message: string, source = '系统') {
    entries.value = [
      {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: Date.now(),
        level,
        source,
        message,
      },
      ...entries.value,
    ].slice(0, MAX)
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

  function clear() {
    entries.value = []
  }

  return { entries, list, push, info, success, warn, error, clear }
})
