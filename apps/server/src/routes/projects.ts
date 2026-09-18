import type { FastifyPluginAsync } from 'fastify'
import type { ProjectDocument } from '@web-scada/core'
import {
  deleteProject,
  getLastProjectId,
  getProject,
  listProjects,
  saveProject,
} from '../store.js'
import {
  buildProjectExportZip,
  importProjectFromZip,
} from '../services/projectPackage.js'
import { buildSiteExportZip } from '../services/sitePackage.js'

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/projects', async () => ({
    items: await listProjects(),
    lastProjectId: await getLastProjectId(),
  }))

  /** 导出完整工程包（JSON + 资源），须放在 :id 通用路由之前 */
  app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (req, reply) => {
    try {
      const { zip, fileName } = await buildProjectExportZip(req.params.id)
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .send(Buffer.from(zip))
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'project_not_found') {
        return reply.code(404).send({ error: 'project_not_found' })
      }
      req.log.error(err)
      return reply.code(500).send({ error: 'export_failed' })
    }
  })

  /** 导出网站包（可部署 Runtime：server + public + 工程/发布/资源） */
  app.get<{ Params: { id: string } }>('/api/projects/:id/export/site', async (req, reply) => {
    try {
      const { zip, fileName } = await buildSiteExportZip(req.params.id)
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .send(zip)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'project_not_found') {
        return reply.code(404).send({ error: 'project_not_found' })
      }
      if (code === 'site_template_missing') {
        return reply.code(503).send({
          error: 'site_template_missing',
          message:
            '缺少网站模板。请先在仓库执行 pnpm pack:win:node，或设置环境变量 SCADA_SITE_TEMPLATE 指向 release/WebScada-0.1.0-win-x64',
        })
      }
      if (code === 'site_export_windows_only') {
        return reply.code(501).send({ error: 'site_export_windows_only' })
      }
      req.log.error(err)
      return reply.code(500).send({ error: 'site_export_failed' })
    }
  })

  /** 导入工程包 → 始终新建工程（新 ID），不覆盖现有 */
  app.post('/api/projects/import', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'file_required' })
    try {
      const chunks: Buffer[] = []
      for await (const chunk of file.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const zipBytes = new Uint8Array(Buffer.concat(chunks))
      const doc = await importProjectFromZip(zipBytes)
      return doc
    } catch (err) {
      const code = (err as { code?: string }).code || 'import_failed'
      const status =
        code === 'invalid_zip' ||
        code === 'missing_project_json' ||
        code === 'invalid_project_json' ||
        code === 'invalid_project_body' ||
        code === 'unsupported_package_format'
          ? 400
          : 500
      if (status >= 500) req.log.error(err)
      return reply.code(status).send({ error: code })
    }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const doc = await getProject(req.params.id)
    if (!doc) return reply.code(404).send({ error: 'project_not_found' })
    return doc
  })

  app.put<{ Params: { id: string }; Body: ProjectDocument }>(
    '/api/projects/:id',
    async (req, reply) => {
      const body = req.body
      if (!body?.meta?.id || body.meta.id !== req.params.id) {
        return reply.code(400).send({ error: 'invalid_project_body' })
      }
      return saveProject(body)
    },
  )

  app.post<{ Body: ProjectDocument }>('/api/projects', async (req, reply) => {
    const body = req.body
    if (!body?.meta?.id) {
      return reply.code(400).send({ error: 'invalid_project_body' })
    }
    const existing = await getProject(body.meta.id)
    if (existing) return reply.code(409).send({ error: 'project_exists' })
    return saveProject(body)
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const removed = await deleteProject(req.params.id)
    if (!removed) return reply.code(404).send({ error: 'project_not_found' })
    return { ok: true }
  })
}
