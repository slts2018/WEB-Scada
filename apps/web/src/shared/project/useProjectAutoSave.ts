import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useOutputLogStore } from '@/stores/outputLog'

export type AutoSaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'error'

/**
 * 设计端自动保存：dirty 后防抖写入（API / 本地镜像），不弹成功 Toast。
 */
export function useProjectAutoSave(options?: { delayMs?: number }) {
  const project = useProjectStore()
  const log = useOutputLogStore()
  const delayMs = options?.delayMs ?? 3000

  const status = ref<AutoSaveStatus>('idle')
  const lastSavedAt = ref<number | null>(null)
  const lastError = ref('')

  let timer: ReturnType<typeof setTimeout> | null = null
  let savedHintTimer: ReturnType<typeof setTimeout> | null = null
  let saving = false

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clearTimer()
    if (!project.dirty) return
    status.value = 'waiting'
    timer = setTimeout(() => {
      timer = null
      void runSave()
    }, delayMs)
  }

  async function runSave() {
    if (saving || !project.dirty) return
    saving = true
    status.value = 'saving'
    try {
      await project.save()
      lastSavedAt.value = Date.now()
      lastError.value = ''
      status.value = 'saved'
      log.info(`自动保存：${project.document.meta.name}`, '设计端')
      if (savedHintTimer) clearTimeout(savedHintTimer)
      savedHintTimer = setTimeout(() => {
        if (status.value === 'saved' && !project.dirty) status.value = 'idle'
      }, 2500)
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : '自动保存失败'
      status.value = 'error'
      log.error(`自动保存失败：${lastError.value}`, '设计端')
    } finally {
      saving = false
      if (project.dirty) schedule()
    }
  }

  /** 立即落盘（手动保存前可先取消定时器，或路由离开时冲刷） */
  async function flush() {
    clearTimer()
    await runSave()
  }

  function cancelPending() {
    clearTimer()
    if (status.value === 'waiting') status.value = 'idle'
  }

  watch(
    () => project.dirty,
    (isDirty) => {
      if (isDirty) schedule()
      else {
        clearTimer()
        if (status.value === 'waiting' || status.value === 'error') {
          status.value = lastSavedAt.value ? 'saved' : 'idle'
        }
      }
    },
  )

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!project.dirty) return
    void flush()
    e.preventDefault()
    e.returnValue = ''
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload)
    if (project.dirty) schedule()
  })

  onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    clearTimer()
    if (savedHintTimer) clearTimeout(savedHintTimer)
    if (project.dirty) void flush()
  })

  return {
    status,
    lastSavedAt,
    lastError,
    flush,
    cancelPending,
    schedule,
  }
}
