import type { FastifyPluginAsync } from 'fastify'
import { saveUploadedResource } from '../services/resources.js'

export const resourceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/resources/upload', async (req, reply) => {
    const projectId =
      typeof req.query === 'object' && req.query && 'projectId' in req.query
        ? String((req.query as { projectId?: string }).projectId || '')
        : ''
    if (!projectId) return reply.code(400).send({ error: 'project_id_required' })
    if (!/^[a-zA-Z0-9._\-]+$/.test(projectId)) {
      return reply.code(400).send({ error: 'invalid_project_id' })
    }

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'file_required' })

    try {
      const saved = await saveUploadedResource({
        projectId,
        fileName: file.filename,
        mimeType: file.mimetype,
        stream: file.file,
      })
      return {
        id: saved.id,
        name: saved.name,
        kind: saved.kind,
        path: saved.path,
        mimeType: saved.mimeType,
        size: saved.size,
      }
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: 'upload_failed' })
    }
  })
}
