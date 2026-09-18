import type { FastifyPluginAsync } from 'fastify'
import type { DeviceMeta } from '@web-scada/core'
import {
  deleteDevice,
  getDevice,
  listDevices,
  upsertDevice,
} from '../db/devices.js'

export const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/devices', async () => ({
    items: await listDevices(),
  }))

  app.post<{ Body: DeviceMeta }>('/api/devices', async (req, reply) => {
    const body = req.body
    if (!body?.deviceId || !body.name || !body.protocol) {
      return reply.code(400).send({ error: 'invalid_device_body' })
    }
    if (!/^[a-zA-Z0-9._\-]+$/.test(body.deviceId)) {
      return reply.code(400).send({ error: 'invalid_device_id' })
    }
    const existing = await getDevice(body.deviceId)
    if (existing) return reply.code(409).send({ error: 'device_exists' })
    try {
      const saved = await upsertDevice({
        deviceId: body.deviceId,
        name: body.name,
        protocol: body.protocol,
        channel: body.channel,
        enabled: body.enabled !== false,
        description: body.description,
      })
      return saved
    } catch (err) {
      return reply.code(503).send({
        error: 'mysql_unavailable',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.put<{ Params: { deviceId: string }; Body: Partial<DeviceMeta> }>(
    '/api/devices/:deviceId',
    async (req, reply) => {
      const existing = await getDevice(req.params.deviceId)
      if (!existing) return reply.code(404).send({ error: 'device_not_found' })
      const body = req.body || {}
      try {
        const saved = await upsertDevice({
          ...existing,
          ...body,
          deviceId: req.params.deviceId,
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled,
        })
        return saved
      } catch (err) {
        return reply.code(503).send({
          error: 'mysql_unavailable',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    },
  )

  app.delete<{ Params: { deviceId: string } }>('/api/devices/:deviceId', async (req, reply) => {
    try {
      const removed = await deleteDevice(req.params.deviceId)
      if (!removed) return reply.code(404).send({ error: 'device_not_found' })
      return { ok: true }
    } catch (err) {
      return reply.code(503).send({
        error: 'mysql_unavailable',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
