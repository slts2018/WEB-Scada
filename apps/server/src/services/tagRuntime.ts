import type { RawData, WebSocket } from 'ws'
import {
  createInitialMockValues,
  type QualityCode,
  type TagMeta,
  type TagValue,
} from '@web-scada/core'
import { getInfluxStatus, writeTagSamples } from '../db/influx.js'
import { listTagMetas } from '../db/tags.js'

type Client = {
  socket: WebSocket
  subscribed: Set<string> | null // null = all
  allowWrite: boolean
}

const values = new Map<string, TagValue>()
const clients = new Set<Client>()
let metas: TagMeta[] = []
let timer: ReturnType<typeof setInterval> | null = null
let qualityTimer: ReturnType<typeof setInterval> | null = null
let started = false

function nowValue(
  tagId: string,
  value: TagValue['value'],
  quality: QualityCode = 'Good',
): TagValue {
  return { tagId, value, quality, timestamp: Date.now() }
}

function broadcast(changed: TagValue[]) {
  if (!changed.length || !clients.size) return
  for (const client of clients) {
    if (client.socket.readyState !== 1) continue
    const filtered =
      client.subscribed == null
        ? changed
        : changed.filter((v) => client.subscribed!.has(v.tagId))
    if (!filtered.length) continue
    client.socket.send(JSON.stringify({ type: 'tag.delta', values: filtered }))
  }
}

async function persistHistory(changed: TagValue[]) {
  if (!getInfluxStatus().ready || !changed.length) return
  try {
    await writeTagSamples(
      changed.map((v) => ({
        tagId: v.tagId,
        value: v.value,
        quality: v.quality,
        timestamp: v.timestamp,
      })),
    )
  } catch {
    // history write failure should not break realtime
  }
}

export function getCurrentValues(): TagValue[] {
  return [...values.values()]
}

export function getTagValue(tagId: string): TagValue | undefined {
  return values.get(tagId)
}

export async function reloadTagRuntime() {
  metas = await listTagMetas()
  const seed = Object.fromEntries(createInitialMockValues().map((v) => [v.tagId, v]))
  for (const meta of metas) {
    if (!values.has(meta.tagId)) {
      const initial = seed[meta.tagId]
      if (initial) values.set(meta.tagId, initial)
      else {
        const fallback =
          meta.dataType === 'bool'
            ? false
            : meta.dataType === 'string'
              ? ''
              : 0
        values.set(meta.tagId, nowValue(meta.tagId, fallback))
      }
    }
  }
  // drop values for removed tags
  for (const id of [...values.keys()]) {
    if (!metas.some((m) => m.tagId === id)) values.delete(id)
  }
}

export function setTagValue(
  tagId: string,
  value: TagValue['value'],
  quality: QualityCode = 'Good',
): TagValue {
  const next = nowValue(tagId, value, quality)
  values.set(tagId, next)
  broadcast([next])
  void persistHistory([next])
  return next
}

export async function writeTag(
  tagId: string,
  value: TagValue['value'],
): Promise<{ ok: boolean; message: string; value?: TagValue }> {
  const meta =
    metas.find((m) => m.tagId === tagId) ??
    (await listTagMetas()).find((m: TagMeta) => m.tagId === tagId)
  if (!meta) return { ok: false, message: 'Tag not found' }
  if (!meta.writable) return { ok: false, message: 'Tag is read-only' }

  let normalized: TagValue['value'] = value
  if (meta.dataType === 'bool') normalized = Boolean(value)
  else if (meta.dataType === 'int') normalized = Math.trunc(Number(value))
  else if (meta.dataType === 'float') normalized = Number(value)
  else normalized = value == null ? null : String(value)

  if (
    (meta.dataType === 'int' || meta.dataType === 'float') &&
    typeof normalized === 'number' &&
    !Number.isFinite(normalized)
  ) {
    return { ok: false, message: 'Invalid numeric value' }
  }

  const next = setTagValue(tagId, normalized, 'Good')
  return { ok: true, message: 'ok', value: next }
}

function tickSimulate() {
  const changed: TagValue[] = []
  const bump = (tagId: string, next: TagValue['value'], quality: QualityCode = 'Good') => {
    const v = nowValue(tagId, next, quality)
    values.set(tagId, v)
    changed.push(v)
  }

  for (const meta of metas) {
    const cur = values.get(meta.tagId)
    if (!cur) continue
    if (meta.dataType === 'float' && typeof cur.value === 'number') {
      const amp = meta.tagId.includes('level') ? 2 : meta.tagId.includes('pressure') ? 0.4 : 0.8
      let next = cur.value + (Math.random() - 0.5) * amp
      if (meta.tagId.includes('level')) next = Math.min(100, Math.max(0, next))
      bump(meta.tagId, +next.toFixed(1))
    }
  }

  if (changed.length) {
    broadcast(changed)
    void persistHistory(changed)
  }
}

export function startTagRuntime() {
  if (started) return
  started = true
  void reloadTagRuntime()
  timer = setInterval(() => tickSimulate(), 1000)
  qualityTimer = setInterval(() => {
    const cur = values.get('demo.temp')
    if (!cur || typeof cur.value !== 'number') return
    if (Math.random() > 0.85) {
      setTagValue('demo.temp', cur.value, Math.random() > 0.5 ? 'Bad' : 'Uncertain')
      setTimeout(() => {
        const latest = values.get('demo.temp')
        if (latest) setTagValue('demo.temp', latest.value, 'Good')
      }, 2000)
    }
  }, 8000)
}

export function stopTagRuntime() {
  if (timer) clearInterval(timer)
  if (qualityTimer) clearInterval(qualityTimer)
  timer = null
  qualityTimer = null
  started = false
}

export function attachTagClient(
  socket: WebSocket,
  opts?: { allowWrite?: boolean },
) {
  const client: Client = {
    socket,
    subscribed: null,
    allowWrite: opts?.allowWrite !== false,
  }
  clients.add(client)

  socket.send(
    JSON.stringify({
      type: 'tag.snapshot',
      metas,
      values: getCurrentValues(),
    }),
  )

  socket.on('message', (raw: RawData) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string
        tagIds?: string[]
        tagId?: string
        value?: TagValue['value']
      }
      if (msg.type === 'subscribe') {
        client.subscribed = Array.isArray(msg.tagIds) ? new Set(msg.tagIds) : null
        const snapshot =
          client.subscribed == null
            ? getCurrentValues()
            : getCurrentValues().filter((v) => client.subscribed!.has(v.tagId))
        socket.send(JSON.stringify({ type: 'tag.snapshot', metas, values: snapshot }))
      } else if (msg.type === 'unsubscribe') {
        client.subscribed = new Set()
      } else if (msg.type === 'write' && msg.tagId !== undefined) {
        if (!client.allowWrite) {
          socket.send(
            JSON.stringify({
              type: 'tag.writeResult',
              ok: false,
              message: 'unauthorized',
              tagId: msg.tagId,
            }),
          )
          return
        }
        void writeTag(msg.tagId, msg.value ?? null).then((res) => {
          socket.send(JSON.stringify({ type: 'tag.writeResult', ...res, tagId: msg.tagId }))
        })
      }
    } catch {
      // ignore malformed
    }
  })

  socket.on('close', () => {
    clients.delete(client)
  })
}

export function getRuntimeMetas() {
  return metas
}
