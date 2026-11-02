import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { MOCK_DEVICES, type DeviceLinkStatus, type DeviceMeta } from '@web-scada/core'
import {
  apiCreateDevice,
  apiDeleteDevice,
  apiListDeviceStatus,
  apiListDevices,
  apiProbeDevicesNow,
  apiUpdateDevice,
} from '@/shared/api/client'

const PROBEABLE = new Set(['modbus_tcp', 'opcua', 'mqtt', 'http'])

function localLinkStatus(device: DeviceMeta): DeviceLinkStatus {
  if (!device.enabled) {
    return { deviceId: device.deviceId, online: false, state: 'disabled', message: '已停用' }
  }
  if (device.protocol === 'mock') {
    return { deviceId: device.deviceId, online: true, state: 'online', message: '模拟设备' }
  }
  if (device.protocol === 'mcd4000') {
    return { deviceId: device.deviceId, online: false, state: 'unknown', message: '尚未检测' }
  }
  if (PROBEABLE.has(device.protocol)) {
    if (!device.channel?.trim()) {
      return { deviceId: device.deviceId, online: false, state: 'offline', message: '未配置连接' }
    }
    return { deviceId: device.deviceId, online: false, state: 'unknown', message: '等待连通性检测' }
  }
  return {
    deviceId: device.deviceId,
    online: false,
    state: 'unsupported',
    message: '该协议不支持自动连通性检测',
  }
}

export const useDeviceStore = defineStore('device', () => {
  const items = ref<DeviceMeta[]>([...MOCK_DEVICES])
  const statusById = ref<Record<string, DeviceLinkStatus>>({})
  const mode = ref<'live' | 'mock'>('mock')
  const probing = ref(false)

  const enabledItems = computed(() => items.value.filter((d) => d.enabled))

  function applyStatusItems(list: DeviceLinkStatus[]) {
    const map: Record<string, DeviceLinkStatus> = {}
    for (const status of list) map[status.deviceId] = status
    statusById.value = map
  }

  async function hydrateFromServer(): Promise<boolean> {
    try {
      const res = await apiListDevices()
      items.value = res.items
      mode.value = 'live'
      return true
    } catch {
      items.value = [...MOCK_DEVICES]
      mode.value = 'mock'
      return false
    }
  }

  async function refreshStatus() {
    if (mode.value !== 'live') {
      const map: Record<string, DeviceLinkStatus> = {}
      for (const device of items.value) map[device.deviceId] = localLinkStatus(device)
      statusById.value = map
      return
    }
    try {
      const res = await apiListDeviceStatus()
      applyStatusItems(res.items)
    } catch {
      const map: Record<string, DeviceLinkStatus> = {}
      for (const device of items.value) map[device.deviceId] = localLinkStatus(device)
      statusById.value = map
    }
  }

  /** 触发后端立即探测全部可探测设备，并刷新状态列 */
  async function probeNow() {
    if (mode.value !== 'live') {
      await refreshStatus()
      return
    }
    probing.value = true
    try {
      const res = await apiProbeDevicesNow()
      applyStatusItems(res.items)
    } catch {
      await refreshStatus()
    } finally {
      probing.value = false
    }
  }

  async function createDevice(meta: DeviceMeta) {
    const saved = await apiCreateDevice(meta)
    await hydrateFromServer()
    return saved
  }

  async function updateDevice(deviceId: string, patch: Partial<DeviceMeta>) {
    const saved = await apiUpdateDevice(deviceId, patch)
    await hydrateFromServer()
    return saved
  }

  async function removeDevice(deviceId: string) {
    await apiDeleteDevice(deviceId)
    await hydrateFromServer()
  }

  function getById(deviceId: string): DeviceMeta | undefined {
    return items.value.find((d) => d.deviceId === deviceId)
  }

  return {
    items,
    statusById,
    mode,
    probing,
    enabledItems,
    hydrateFromServer,
    refreshStatus,
    probeNow,
    createDevice,
    updateDevice,
    removeDevice,
    getById,
  }
})
