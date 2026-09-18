import type { FastifyPluginAsync } from 'fastify'
import type { TagMeta } from '@web-scada/core'
import { getDevice } from '../db/devices.js'
import { getInfluxStatus, queryTagHistory, writeTagSamples } from '../db/influx.js'
import {
  deleteTagMeta,
  getTagMeta,
  listTagMetas,
  upsertTagMeta,
} from '../db/tags.js'
import {
  attachTagClient,
  getCurrentValues,
  reloadTagRuntime,
  writeTag,
} from '../services/tagRuntime.js'
import { extractRequestToken, tokenMatches } from '../plugins/auth.js'

async function requireBoundDevice(
  deviceId: unknown,
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
): Promise<string | null> {
  const id = typeof deviceId === 'string' ? deviceId.trim() : ''
  if (!id) {
    reply.code(400).send({ error: 'device_id_required' })
    return null
  }
  const device = await getDevice(id)
  if (!device) {
    reply.code(400).send({ error: 'device_not_found', deviceId: id })
    return null
  }
  return id
}

export const tagRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/tags', async () => {
    const items = await listTagMetas()
    return { items, values: getCurrentValues() }
  })

  app.get('/api/tags/values', async () => ({
    values: getCurrentValues(),
  }))

  app.post<{ Body: TagMeta }>('/api/tags', async (req, reply) => {
    const body = req.body
    if (!body?.tagId || !body.name || !body.dataType) {
      return reply.code(400).send({ error: 'invalid_tag_body' })
    }
    if (!/^[a-zA-Z0-9._\-]+$/.test(body.tagId)) {
      return reply.code(400).send({ error: 'invalid_tag_id' })
    }
    const deviceId = await requireBoundDevice(body.deviceId, reply)
    if (!deviceId) return
    const existing = await getTagMeta(body.tagId)
    if (existing) return reply.code(409).send({ error: 'tag_exists' })
    const saved = await upsertTagMeta({
      tagId: body.tagId,
      name: body.name,
      group: body.group,
      deviceId,
      address: body.address,
      dataType: body.dataType,
      unit: body.unit,
      writable: Boolean(body.writable),
      description: body.description,
    })
    await reloadTagRuntime()
    return saved
  })

  app.put<{ Params: { tagId: string }; Body: Partial<TagMeta> }>(
    '/api/tags/:tagId',
    async (req, reply) => {
      const existing = await getTagMeta(req.params.tagId)
      if (!existing) return reply.code(404).send({ error: 'tag_not_found' })
      const body = req.body || {}
      const deviceId = await requireBoundDevice(
        body.deviceId !== undefined ? body.deviceId : existing.deviceId,
        reply,
      )
      if (!deviceId) return
      const saved = await upsertTagMeta({
        ...existing,
        ...body,
        tagId: req.params.tagId,
        deviceId,
        writable: body.writable !== undefined ? Boolean(body.writable) : existing.writable,
      })
      await reloadTagRuntime()
      return saved
    },
  )

  app.delete<{ Params: { tagId: string } }>('/api/tags/:tagId', async (req, reply) => {
    const removed = await deleteTagMeta(req.params.tagId)
    if (!removed) return reply.code(404).send({ error: 'tag_not_found' })
    await reloadTagRuntime()
    return { ok: true }
  })

  app.post<{
    Params: { tagId: string }
    Body: { value: boolean | number | string | null }
  }>('/api/tags/:tagId/write', async (req, reply) => {
    const res = await writeTag(req.params.tagId, req.body?.value ?? null)
    if (!res.ok) return reply.code(400).send(res)
    return res
  })

  app.post<{
    Body: {
      samples: Array<{
        tagId: string
        value: boolean | number | string | null
        quality: string
        timestamp?: number
      }>
    }
  }>('/api/tags/history', async (req, reply) => {
    if (!getInfluxStatus().ready) {
      return reply.code(503).send({ error: 'influx_unavailable', detail: getInfluxStatus().error })
    }
    const samples = req.body?.samples
    if (!Array.isArray(samples) || !samples.length) {
      return reply.code(400).send({ error: 'invalid_samples' })
    }
    const written = await writeTagSamples(samples)
    return { ok: true, written }
  })

  app.get<{
    Params: { tagId: string }
    Querystring: { start?: string; stop?: string; limit?: string }
  }>('/api/tags/:tagId/history', async (req, reply) => {
    if (!getInfluxStatus().ready) {
      return reply.code(503).send({ error: 'influx_unavailable', detail: getInfluxStatus().error })
    }
    const points = await queryTagHistory({
      tagId: req.params.tagId,
      start: req.query.start,
      stop: req.query.stop,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })
    return { tagId: req.params.tagId, points }
  })

  app.get('/api/ws/tags', { websocket: true }, (socket, req) => {
    const allowWrite = tokenMatches(extractRequestToken(req))
    attachTagClient(socket, { allowWrite })
  })
}
