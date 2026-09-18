import type { FastifyPluginAsync } from 'fastify'
import type { PublishPackage } from '@web-scada/core'
import {
  getLatestPublish,
  getPublish,
  listPublishes,
  savePublish,
} from '../store.js'

export const publishRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/publishes', async () => ({
    items: await listPublishes(),
  }))

  app.get('/api/publishes/latest', async (_req, reply) => {
    const pkg = await getLatestPublish()
    if (!pkg) return reply.code(404).send({ error: 'publish_not_found' })
    return pkg
  })

  app.get<{ Params: { projectId: string } }>(
    '/api/publishes/:projectId',
    async (req, reply) => {
      const pkg = await getPublish(req.params.projectId)
      if (!pkg) return reply.code(404).send({ error: 'publish_not_found' })
      return pkg
    },
  )

  app.put<{ Params: { projectId: string }; Body: PublishPackage }>(
    '/api/publishes/:projectId',
    async (req, reply) => {
      const body = req.body
      if (!body?.manifest?.projectId || body.manifest.projectId !== req.params.projectId) {
        return reply.code(400).send({ error: 'invalid_publish_body' })
      }
      return savePublish(body)
    },
  )
}
