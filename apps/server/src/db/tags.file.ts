/**
 * 无 MySQL 时变量元数据落盘（对齐工程 file fallback）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_TAG_DEVICE_ID, MOCK_TAG_METAS, type TagMeta } from '@web-scada/core'
import { getDataRoot } from '../paths.js'

const TAGS_FILE = path.join(getDataRoot(), 'tags.json')

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

function normalizeTag(raw: TagMeta): TagMeta {
  return {
    ...raw,
    deviceId: (raw.deviceId && String(raw.deviceId).trim()) || DEFAULT_TAG_DEVICE_ID,
  }
}

function sortTags(items: TagMeta[]): TagMeta[] {
  return [...items].sort((a, b) => {
    const ga = a.group ?? ''
    const gb = b.group ?? ''
    if (ga !== gb) {
      if (!ga) return 1
      if (!gb) return -1
      return ga.localeCompare(gb)
    }
    return a.tagId.localeCompare(b.tagId)
  })
}

export async function listTagMetasFile(): Promise<TagMeta[]> {
  const items = await readJsonFile<TagMeta[]>(TAGS_FILE)
  if (!items?.length) return []
  return sortTags(items.map(normalizeTag))
}

export async function getTagMetaFile(tagId: string): Promise<TagMeta | null> {
  const items = await listTagMetasFile()
  return items.find((t) => t.tagId === tagId) ?? null
}

export async function upsertTagMetaFile(meta: TagMeta): Promise<TagMeta> {
  const deviceId = String(meta.deviceId ?? '').trim()
  if (!deviceId) throw new Error('device_id_required')
  const next: TagMeta = { ...meta, deviceId }
  const items = await listTagMetasFile()
  const idx = items.findIndex((t) => t.tagId === next.tagId)
  const list = [...items]
  if (idx >= 0) list[idx] = next
  else list.push(next)
  await writeJsonFile(TAGS_FILE, sortTags(list))
  return next
}

export async function deleteTagMetaFile(tagId: string): Promise<boolean> {
  const items = await listTagMetasFile()
  const next = items.filter((t) => t.tagId !== tagId)
  if (next.length === items.length) return false
  await writeJsonFile(TAGS_FILE, next)
  return true
}

/** 文件为空时写入演示变量，便于开箱试用 */
export async function seedTagsFileIfEmpty() {
  const items = await readJsonFile<TagMeta[]>(TAGS_FILE)
  if (items && items.length > 0) return
  await writeJsonFile(TAGS_FILE, sortTags(MOCK_TAG_METAS.map(normalizeTag)))
}
