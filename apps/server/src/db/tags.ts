import type { RowDataPacket, ResultSetHeader } from 'mysql2'
import { DEFAULT_TAG_DEVICE_ID, MOCK_TAG_METAS, type TagMeta } from '@web-scada/core'
import { config } from '../config.js'
import { getMysqlStatus, getPool } from './mysql.js'
import {
  deleteTagMetaFile,
  getTagMetaFile,
  listTagMetasFile,
  seedTagsFileIfEmpty,
  upsertTagMetaFile,
} from './tags.file.js'

function useMysql() {
  return getMysqlStatus().ready
}

function useFileFallback() {
  return !useMysql() && config.mysql.fallbackToFile
}

function normalizeDeviceId(raw: unknown): string {
  const id = raw == null ? '' : String(raw).trim()
  return id || DEFAULT_TAG_DEVICE_ID
}

function requireDeviceId(raw: unknown): string {
  const id = raw == null ? '' : String(raw).trim()
  if (!id) throw new Error('device_id_required')
  return id
}

export async function ensureTagsTable() {
  if (!useMysql()) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS tags (
      tag_id VARCHAR(128) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      tag_group VARCHAR(128) NULL,
      device_id VARCHAR(128) NOT NULL,
      address VARCHAR(255) NULL,
      data_type ENUM('bool','int','float','string') NOT NULL DEFAULT 'float',
      unit VARCHAR(64) NULL,
      writable TINYINT(1) NOT NULL DEFAULT 0,
      description VARCHAR(512) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_tags_name (name),
      INDEX idx_tags_group (tag_group)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  // 兼容旧库：补充分组列
  try {
    await getPool().query(
      'ALTER TABLE tags ADD COLUMN tag_group VARCHAR(128) NULL AFTER name',
    )
  } catch {
    // duplicate column — ignore
  }
  try {
    await getPool().query('CREATE INDEX idx_tags_group ON tags (tag_group)')
  } catch {
    // index may already exist
  }
  // 旧数据 device_id 可空 → 回填默认设备后改为 NOT NULL
  try {
    await getPool().query(
      `UPDATE tags SET device_id = :defaultId
       WHERE device_id IS NULL OR TRIM(device_id) = ''`,
      { defaultId: DEFAULT_TAG_DEVICE_ID },
    )
    await getPool().query(
      `ALTER TABLE tags MODIFY COLUMN device_id VARCHAR(128) NOT NULL`,
    )
  } catch (err) {
    console.warn('[tags] device_id NOT NULL migrate skipped', err)
  }
}

function rowToMeta(row: RowDataPacket): TagMeta {
  return {
    tagId: String(row.tag_id),
    name: String(row.name),
    group: row.tag_group == null || row.tag_group === '' ? undefined : String(row.tag_group),
    deviceId: normalizeDeviceId(row.device_id),
    address: row.address == null ? undefined : String(row.address),
    dataType: row.data_type as TagMeta['dataType'],
    unit: row.unit == null ? undefined : String(row.unit),
    writable: Boolean(row.writable),
    description: row.description == null ? undefined : String(row.description),
  }
}

export async function listTagMetas(): Promise<TagMeta[]> {
  if (useFileFallback()) return listTagMetasFile()
  if (!useMysql()) return [...MOCK_TAG_METAS]
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT tag_id, name, tag_group, device_id, address, data_type, unit, writable, description
     FROM tags ORDER BY tag_group IS NULL, tag_group ASC, tag_id ASC`,
  )
  return rows.map(rowToMeta)
}

export async function getTagMeta(tagId: string): Promise<TagMeta | null> {
  if (useFileFallback()) return getTagMetaFile(tagId)
  if (!useMysql()) {
    return MOCK_TAG_METAS.find((t) => t.tagId === tagId) ?? null
  }
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT tag_id, name, tag_group, device_id, address, data_type, unit, writable, description
     FROM tags WHERE tag_id = :tagId LIMIT 1`,
    { tagId },
  )
  if (!rows[0]) return null
  return rowToMeta(rows[0])
}

export async function upsertTagMeta(meta: TagMeta): Promise<TagMeta> {
  const deviceId = requireDeviceId(meta.deviceId)
  const next: TagMeta = { ...meta, deviceId }
  if (useFileFallback()) return upsertTagMetaFile(next)
  if (!useMysql()) throw new Error('MySQL is not ready')
  const now = Date.now()
  await getPool().query(
    `INSERT INTO tags
      (tag_id, name, tag_group, device_id, address, data_type, unit, writable, description, created_at, updated_at)
     VALUES
      (:tagId, :name, :tagGroup, :deviceId, :address, :dataType, :unit, :writable, :description, :now, :now)
     ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      tag_group = VALUES(tag_group),
      device_id = VALUES(device_id),
      address = VALUES(address),
      data_type = VALUES(data_type),
      unit = VALUES(unit),
      writable = VALUES(writable),
      description = VALUES(description),
      updated_at = VALUES(updated_at)`,
    {
      tagId: next.tagId,
      name: next.name,
      tagGroup: next.group?.trim() || null,
      deviceId: next.deviceId,
      address: next.address ?? null,
      dataType: next.dataType,
      unit: next.unit ?? null,
      writable: next.writable ? 1 : 0,
      description: next.description ?? null,
      now,
    },
  )
  return next
}

export async function deleteTagMeta(tagId: string): Promise<boolean> {
  if (useFileFallback()) return deleteTagMetaFile(tagId)
  if (!useMysql()) throw new Error('MySQL is not ready')
  const [result] = await getPool().query<ResultSetHeader>(
    'DELETE FROM tags WHERE tag_id = :tagId',
    { tagId },
  )
  return (result.affectedRows ?? 0) > 0
}

export async function seedTagsIfEmpty() {
  if (useFileFallback()) {
    await seedTagsFileIfEmpty()
    return
  }
  if (!useMysql()) return
  const [rows] = await getPool().query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM tags')
  const count = Number(rows[0]?.c ?? 0)
  if (count > 0) return
  for (const meta of MOCK_TAG_METAS) {
    await upsertTagMeta(meta)
  }
}
