import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { MOCK_DEVICES, type DeviceMeta } from '@web-scada/core'
import {
  apiCreateDevice,
  apiDeleteDevice,
  apiListDevices,
  apiUpdateDevice,
} from '@/shared/api/client'

export const useDeviceStore = defineStore('device', () => {
  const items = ref<DeviceMeta[]>([...MOCK_DEVICES])
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
    mode,
    enabledItems,
    hydrateFromServer,
    createDevice,
    updateDevice,
    removeDevice,
    getById,
  }
})
