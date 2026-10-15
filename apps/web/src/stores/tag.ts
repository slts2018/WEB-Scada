import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  MOCK_TAG_METAS,
  createInitialMockValues,
  effectiveTagSimulation,
  simulationFollowsClock,
  simulationSlot,
  stepSimulatedValue,
  type ActiveAlarm,
  type QualityCode,
  type TagMeta,
  type TagValue,
} from '@web-scada/core'
import { useDeviceStore } from './device'
import {
  apiCreateTag,
  apiDeleteTag,
  apiListActiveAlarms,
  apiAckAlarm,
  apiListTags,
  apiUpdateTag,
  apiWriteTag,
  tagsWebSocketUrl,
} from '@/shared/api/client'
import { onAlarmHistoryLoaded, reloadAlarmHistoryQueries } from '@/shared/runtime/alarmHistoryQuery'
import { onTrendHistoryLoaded, reloadTrendHistoryQueries } from '@/shared/runtime/trendHistoryQuery'

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
  const activeAlarms = ref<ActiveAlarm[]>([])
  const listeners = new Set<TagListener>()

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let mockTimer: ReturnType<typeof setInterval> | null = null
  let qualityTimer: ReturnType<typeof setInterval> | null = null
  let historyTimer: ReturnType<typeof setInterval> | null = null
  let historySoon: ReturnType<typeof setTimeout> | null = null
  let wantLive = false
  const simSlots = new Map<string, number>()
  const scanSlots = new Map<string, number>()

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

  onAlarmHistoryLoaded(() => notify(['__alarm_history__']))
  onTrendHistoryLoaded(() => notify(['__trend_history__']))

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
      try {
        const alarms = await apiListActiveAlarms()
        activeAlarms.value = alarms.items ?? []
      } catch {
        activeAlarms.value = []
      }
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
      const devices = useDeviceStore()
      const mockIds = new Set(
        devices.items.filter((d) => d.enabled && d.protocol === 'mock').map((d) => d.deviceId),
      )
      const changed: string[] = []
      const nowMs = Date.now()
      for (const meta of metas.value) {
        if (!meta.deviceId || !mockIds.has(meta.deviceId)) continue
        if (subscribed.value.size && !subscribed.value.has(meta.tagId)) continue
        const scan = Math.max(200, meta.scanPeriodMs ?? 1000)
        const scanSlot = Math.floor(nowMs / scan)
        if (scanSlots.get(meta.tagId) === scanSlot) continue
        scanSlots.set(meta.tagId, scanSlot)
        const sim = effectiveTagSimulation(meta)
        if (!sim.enabled) continue
        const slot = simulationFollowsClock(sim.mode) ? Math.floor(nowMs / 1000) : simulationSlot(nowMs, sim.periodSec)
        if (simSlots.get(meta.tagId) === slot) continue
        simSlots.set(meta.tagId, slot)
        const cur = values.value[meta.tagId]
        if (!cur) continue
        const next = stepSimulatedValue(meta, cur.value, Math.random(), nowMs)
        if (Object.is(next, cur.value)) continue
        values.value[meta.tagId] = {
          tagId: meta.tagId,
          value: next,
          quality: 'Good',
          timestamp: nowMs,
        }
        changed.push(meta.tagId)
      }
      if (changed.length) notify(changed)
    }, 200)
  }

  async function refreshAlarmHistory() {
    if (mode.value !== 'live') return
    try {
      await Promise.all([reloadAlarmHistoryQueries(), reloadTrendHistoryQueries()])
    } catch {
      // 单个控件的失败已在查询里保留上一份
    }
  }

  function scheduleHistoryRefresh() {
    if (historySoon) return
    historySoon = setTimeout(() => {
      historySoon = null
      void refreshAlarmHistory()
    }, 400)
  }

  function startHistoryPoll() {
    void refreshAlarmHistory()
    if (historyTimer) return
    historyTimer = setInterval(() => void refreshAlarmHistory(), 10000)
  }

  function stopHistoryPoll() {
    if (historyTimer) {
      clearInterval(historyTimer)
      historyTimer = null
    }
    if (historySoon) {
      clearTimeout(historySoon)
      historySoon = null
    }
  }

  function disconnectWs() {
    wantLive = false
    stopHistoryPoll()
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
      startHistoryPoll()
      return
    }

    void hydrateFromServer().then((ok) => {
      if (!ok) {
        stopHistoryPoll()
        startMockStream()
        return
      }
      startHistoryPoll()
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
            active?: ActiveAlarm[]
            raised?: ActiveAlarm[]
            updated?: ActiveAlarm[]
            cleared?: string[]
          }
          if (msg.type === 'tag.snapshot') {
            if (msg.metas?.length) metas.value = msg.metas
            if (msg.values) applyValues(msg.values, true)
            notify(msg.values?.map((v) => v.tagId) ?? [])
          } else if (msg.type === 'tag.delta' && msg.values) {
            applyValues(msg.values)
          } else if (msg.type === 'alarm.snapshot') {
            activeAlarms.value = msg.active ?? []
            notify(['__alarm__'])
            scheduleHistoryRefresh()
          } else if (msg.type === 'alarm.delta') {
            const cleared = new Set(msg.cleared ?? [])
            const next = activeAlarms.value.filter((a) => !cleared.has(a.alarmId))
            for (const alarm of [...(msg.raised ?? []), ...(msg.updated ?? [])]) {
              const idx = next.findIndex((a) => a.alarmId === alarm.alarmId)
              if (idx >= 0) next[idx] = alarm
              else next.push(alarm)
            }
            activeAlarms.value = next
            notify(['__alarm__'])
            scheduleHistoryRefresh()
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

  async function ackAlarm(alarmId: string): Promise<{ ok: boolean; message: string }> {
    if (mode.value !== 'live') return { ok: false, message: '未连接服务，不能确认' }
    try {
      const res = await apiAckAlarm(alarmId)
      if (res.removed) {
        activeAlarms.value = activeAlarms.value.filter((a) => a.alarmId !== alarmId)
      } else if (res.alarm) {
        const next = activeAlarms.value.slice()
        const idx = next.findIndex((a) => a.alarmId === alarmId)
        if (idx >= 0) next[idx] = res.alarm
        else next.push(res.alarm)
        activeAlarms.value = next
      }
      notify(['__alarm__'])
      scheduleHistoryRefresh()
      return { ok: true, message: '已确认' }
    } catch {
      return { ok: false, message: '确认失败' }
    }
  }

  return {
    metas,
    values,
    list,
    activeAlarms,
    subscribed,
    connected,
    mode,
    getValue,
    setValue,
    writeValue,
    ackAlarm,
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
