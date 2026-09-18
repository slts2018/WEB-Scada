import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  MOCK_TAG_METAS,
  createInitialMockValues,
  type QualityCode,
  type TagMeta,
  type TagValue,
} from '@web-scada/core'
import {
  apiCreateTag,
  apiDeleteTag,
  apiListTags,
  apiUpdateTag,
  apiWriteTag,
  tagsWebSocketUrl,
} from '@/shared/api/client'

type TagListener = (changedTagIds: string[]) => void

/**
 * Tag 数据源：优先 REST + WebSocket；后端不可用时回退本地 Mock。
 */
export const useTagStore = defineStore('tag', () => {
  const metas = ref<TagMeta[]>([...MOCK_TAG_METAS])
  const values = ref<Record<string, TagValue>>(
    Object.fromEntries(createInitialMockValues().map((v) => [v.tagId, v])),
  )
  const subscribed = ref<Set<string>>(new Set())
  const connected = ref(false)
  const mode = ref<'live' | 'mock'>('mock')
  const listeners = new Set<TagListener>()

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let mockTimer: ReturnType<typeof setInterval> | null = null
  let qualityTimer: ReturnType<typeof setInterval> | null = null
  let wantLive = false

  const list = computed(() =>
    metas.value.map((meta) => ({
      meta,
      value: values.value[meta.tagId],
    })),
  )

  function notify(changed: string[]) {
    if (!changed.length) return
    for (const listener of listeners) listener(changed)
  }

  function applyValues(list: TagValue[], silent = false) {
    const changed: string[] = []
    for (const v of list) {
      values.value[v.tagId] = v
      changed.push(v.tagId)
    }
    if (!silent) notify(changed)
  }

  function getValue(tagId: string): TagValue | undefined {
    return values.value[tagId]
  }

  function setValue(tagId: string, value: TagValue['value'], quality: QualityCode = 'Good') {
    values.value[tagId] = {
      tagId,
      value,
      quality,
      timestamp: Date.now(),
    }
    notify([tagId])
  }

  async function hydrateFromServer(): Promise<boolean> {
    try {
      const res = await apiListTags()
      metas.value = res.items
      applyValues(res.values, true)
      mode.value = 'live'
      return true
    } catch {
      mode.value = 'mock'
      return false
    }
  }

  async function createTag(meta: TagMeta) {
    const saved = await apiCreateTag(meta)
    await hydrateFromServer()
    return saved
  }

  async function updateTag(tagId: string, patch: Partial<TagMeta>) {
    const saved = await apiUpdateTag(tagId, patch)
    await hydrateFromServer()
    return saved
  }

  async function removeTag(tagId: string) {
    await apiDeleteTag(tagId)
    await hydrateFromServer()
  }

  async function writeValue(
    tagId: string,
    value: TagValue['value'],
  ): Promise<{ ok: boolean; message: string }> {
    const meta = metas.value.find((m) => m.tagId === tagId)
    if (!meta) return { ok: false, message: 'Tag 不存在' }
    if (!meta.writable) return { ok: false, message: 'Tag 只读' }

    if (mode.value === 'live') {
      try {
        const res = await apiWriteTag(tagId, value)
        if (res.value) applyValues([res.value])
        return { ok: res.ok, message: res.ok ? '写值成功' : res.message }
      } catch {
        return { ok: false, message: '写值请求失败' }
      }
    }

    await new Promise((r) => setTimeout(r, 80))
    setValue(tagId, value, 'Good')
    return { ok: true, message: '写值成功（本地 Mock）' }
  }

  function setPageSubscription(tagIds: string[]) {
    subscribed.value = new Set(tagIds)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', tagIds }))
    }
  }

  function clearPageSubscription() {
    subscribed.value = new Set()
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe' }))
    }
  }

  function addListener(listener: TagListener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function stopMockStream() {
    if (mockTimer) {
      clearInterval(mockTimer)
      mockTimer = null
    }
    if (qualityTimer) {
      clearInterval(qualityTimer)
      qualityTimer = null
    }
  }

  function startMockStream() {
    if (mockTimer) return
    mode.value = 'mock'
    mockTimer = setInterval(() => {
      const changed: string[] = []
      const maybe = (tagId: string, next: TagValue['value']) => {
        if (subscribed.value.size && !subscribed.value.has(tagId)) return
        values.value[tagId] = {
          tagId,
          value: next,
          quality: 'Good',
          timestamp: Date.now(),
        }
        changed.push(tagId)
      }
      const temp = values.value['demo.temp']
      if (temp && typeof temp.value === 'number') {
        maybe('demo.temp', +(temp.value + (Math.random() - 0.5) * 0.8).toFixed(1))
      }
      const level = values.value['demo.level']
      if (level && typeof level.value === 'number') {
        const next = Math.min(100, Math.max(0, level.value + (Math.random() - 0.5) * 2))
        maybe('demo.level', +next.toFixed(1))
      }
      const pressure = values.value['demo.pressure']
      if (pressure && typeof pressure.value === 'number') {
        maybe('demo.pressure', +(pressure.value + (Math.random() - 0.5) * 0.4).toFixed(1))
      }
      if (changed.length) notify(changed)
    }, 1000)
  }

  function disconnectWs() {
    wantLive = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    connected.value = false
  }

  function connectRealtime() {
    wantLive = true
    stopMockStream()
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    void hydrateFromServer().then((ok) => {
      if (!ok) {
        startMockStream()
        return
      }
      try {
        ws = new WebSocket(tagsWebSocketUrl())
      } catch {
        startMockStream()
        return
      }

      ws.onopen = () => {
        connected.value = true
        mode.value = 'live'
        if (subscribed.value.size) {
          ws?.send(JSON.stringify({ type: 'subscribe', tagIds: [...subscribed.value] }))
        }
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type: string
            metas?: TagMeta[]
            values?: TagValue[]
          }
          if (msg.type === 'tag.snapshot') {
            if (msg.metas?.length) metas.value = msg.metas
            if (msg.values) applyValues(msg.values, true)
            notify(msg.values?.map((v) => v.tagId) ?? [])
          } else if (msg.type === 'tag.delta' && msg.values) {
            applyValues(msg.values)
          }
        } catch {
          // ignore
        }
      }

      ws.onclose = () => {
        connected.value = false
        ws = null
        if (!wantLive) return
        reconnectTimer = setTimeout(() => {
          if (wantLive) connectRealtime()
        }, 2000)
      }

      ws.onerror = () => {
        // onclose will handle reconnect / fallback
      }
    })
  }

  /** 兼容旧调用名 */
  function startLiveOrMock() {
    connectRealtime()
  }

  return {
    metas,
    values,
    list,
    subscribed,
    connected,
    mode,
    getValue,
    setValue,
    writeValue,
    setPageSubscription,
    clearPageSubscription,
    addListener,
    hydrateFromServer,
    createTag,
    updateTag,
    removeTag,
    connectRealtime,
    disconnectWs,
    startMockStream,
    stopMockStream,
    startLiveOrMock,
  }
})
