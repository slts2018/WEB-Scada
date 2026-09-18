import type { RowDataPacket, ResultSetHeader } from 'mysql2'
import { MOCK_DEVICES, type DeviceMeta, type DeviceProtocol } from '@web-scada/core'
import { config } from '../config.js'
import {
  deleteDeviceFile,
  getDeviceFile,
  listDevicesFile,
  seedDevicesFileIfEmpty,
  upsertDeviceFile,
} from './devices.file.js'
import { getMysqlStatus, getPool } from './mysql.js'

const PROTOCOLS: DeviceProtocol[] = ['mock', 'modbus_tcp', 'opcua', 'mqtt', 'http', 'other']

function useMysql() {
  return getMysqlStatus().ready
}

function useFileFallback() {
  return !useMysql() && config.mysql.fallbackToFile
}

export async function ensureDevicesTable() {
  if (!useMysql()) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id VARCHAR(128) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      protocol VARCHAR(32) NOT NULL DEFAULT 'mock',
      channel VARCHAR(512) NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      description VARCHAR(512) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_devices_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

function rowToDevice(row: RowDataPacket): DeviceMeta {
  const protocol = String(row.protocol) as DeviceProtocol
  return {
    deviceId: String(row.device_id),
    name: String(row.name),
    protocol: PROTOCOLS.includes(protocol) ? protocol : 'other',
    channel: row.channel == null ? undefined : String(row.channel),
    enabled: Boolean(row.enabled),
    description: row.description == null ? undefined : String(row.description),
  }
}

export async function listDevices(): Promise<DeviceMeta[]> {
  if (useFileFallback()) return listDevicesFile()
  if (!useMysql()) return [...MOCK_DEVICES]
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT device_id, name, protocol, channel, enabled, description
     FROM devices ORDER BY device_id ASC`,
  )
  return rows.map(rowToDevice)
}

export async function getDevice(deviceId: string): Promise<DeviceMeta | null> {
  if (useFileFallback()) return getDeviceFile(deviceId)
  if (!useMysql()) {
    return MOCK_DEVICES.find((d) => d.deviceId === deviceId) ?? null
  }
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT device_id, name, protocol, channel, enabled, description
     FROM devices WHERE device_id = :deviceId LIMIT 1`,
    { deviceId },
  )
  if (!rows[0]) return null
  return rowToDevice(rows[0])
}

export async function upsertDevice(meta: DeviceMeta): Promise<DeviceMeta> {
  if (useFileFallback()) return upsertDeviceFile(meta)
  if (!useMysql()) throw new Error('MySQL is not ready')
  const now = Date.now()
  await getPool().query(
    `INSERT INTO devices
      (device_id, name, protocol, channel, enabled, description, created_at, updated_at)
     VALUES
      (:deviceId, :name, :protocol, :channel, :enabled, :description, :now, :now)
     ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      protocol = VALUES(protocol),
      channel = VALUES(channel),
      enabled = VALUES(enabled),
      description = VALUES(description),
      updated_at = VALUES(updated_at)`,
    {
      deviceId: meta.deviceId,
      name: meta.name,
      protocol: meta.protocol,
      channel: meta.channel ?? null,
      enabled: meta.enabled ? 1 : 0,
      description: meta.description ?? null,
      now,
    },
  )
  return meta
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  if (useFileFallback()) return deleteDeviceFile(deviceId)
  if (!useMysql()) throw new Error('MySQL is not ready')
  const [result] = await getPool().query<ResultSetHeader>(
    'DELETE FROM devices WHERE device_id = :deviceId',
    { deviceId },
  )
  return (result.affectedRows ?? 0) > 0
}

export async function seedDevicesIfEmpty() {
  if (useFileFallback()) {
    await seedDevicesFileIfEmpty()
    return
  }
  if (!useMysql()) return
  const [rows] = await getPool().query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM devices')
  const count = Number(rows[0]?.c ?? 0)
  if (count > 0) return
  for (const meta of MOCK_DEVICES) {
    await upsertDevice(meta)
  }
}
