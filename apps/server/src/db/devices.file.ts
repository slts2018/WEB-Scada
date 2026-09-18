/**
 * 无 MySQL 时设备元数据落盘（对齐工程 file fallback）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { MOCK_DEVICES, type DeviceMeta } from '@web-scada/core'
import { getDataRoot } from '../paths.js'

const DEVICES_FILE = path.join(getDataRoot(), 'devices.json')

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw err
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, filePath)
}

function sortDevices(items: DeviceMeta[]): DeviceMeta[] {
  return [...items].sort((a, b) => a.deviceId.localeCompare(b.deviceId))
}

export async function listDevicesFile(): Promise<DeviceMeta[]> {
  const items = await readJsonFile<DeviceMeta[]>(DEVICES_FILE)
  if (!items?.length) return []
  return sortDevices(items)
}

export async function getDeviceFile(deviceId: string): Promise<DeviceMeta | null> {
  const items = await listDevicesFile()
  return items.find((d) => d.deviceId === deviceId) ?? null
}

export async function upsertDeviceFile(meta: DeviceMeta): Promise<DeviceMeta> {
  const items = await listDevicesFile()
  const idx = items.findIndex((d) => d.deviceId === meta.deviceId)
  const next = [...items]
  if (idx >= 0) next[idx] = meta
  else next.push(meta)
  await writeJsonFile(DEVICES_FILE, sortDevices(next))
  return meta
}

export async function deleteDeviceFile(deviceId: string): Promise<boolean> {
  const items = await listDevicesFile()
  const next = items.filter((d) => d.deviceId !== deviceId)
  if (next.length === items.length) return false
  await writeJsonFile(DEVICES_FILE, next)
  return true
}

/** 文件为空时写入演示设备，便于开箱试用 */
export async function seedDevicesFileIfEmpty() {
  const items = await readJsonFile<DeviceMeta[]>(DEVICES_FILE)
  if (items && items.length > 0) return
  await writeJsonFile(DEVICES_FILE, sortDevices([...MOCK_DEVICES]))
}
