import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { MOCK_DEVICES, type DeviceLinkStatus, type DeviceMeta } from '@web-scada/core'
import {
  apiCreateDevice,
  apiDeleteDevice,
  apiListDeviceStatus,
  apiListDevices,
  apiUpdateDevice,
} from '@/shared/api/client'

function localLinkStatus(device: DeviceMeta): DeviceLinkStatus {
  if (!device.enabled) {
    return { deviceId: device.deviceId, online: false, state: 'disabled', message: '已停用' }
  }
  if (device.protocol === 'mock') {
    return { deviceId: device.deviceId, online: true, state: 'online' }
  }
  if (device.protocol === 'mcd4000') {
    return { deviceId: device.deviceId, online: false, state: 'unknown', message: '尚未检测' }
  }
  return { deviceId: device.deviceId, online: false, state: 'unsupported', message: '未接入采集' }
}

export const useDeviceStore = defineStore('device', () => {
  const items = ref<DeviceMeta[]>([...MOCK_DEVICES])
  const statusById = ref<Record<string, DeviceLinkStatus>>({})
  const mode = ref<'live' | 'mock'>('mock')

  const enabledItems = computed(() => items.value.filter((d) => d.enabled))

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
      const map: Record<string, DeviceLinkStatus> = {}
      for (const status of res.items) map[status.deviceId] = status
      statusById.value = map
    } catch {
      const map: Record<string, DeviceLinkStatus> = {}
      for (const device of items.value) map[device.deviceId] = localLinkStatus(device)
      statusById.value = map
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
    enabledItems,
    hydrateFromServer,
    refreshStatus,
    createDevice,
    updateDevice,
    removeDevice,
    getById,
  }
})
