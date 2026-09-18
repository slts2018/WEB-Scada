import type { RowDataPacket, ResultSetHeader } from 'mysql2'
import type { ProjectDocument, PublishPackage } from '@web-scada/core'
import { config } from './config.js'
import { getMysqlStatus, getPool } from './db/mysql.js'
import * as fileStore from './store.file.js'

export type { ProjectIndexItem } from './store.file.js'

const MYSQL_DOWN = 'MySQL is not ready'

function useMysql() {
  return getMysqlStatus().ready
}

function requireMysqlOrFallback() {
  if (useMysql()) return 'mysql' as const
  if (!config.mysql.fallbackToFile) throw new Error(MYSQL_DOWN)
  return 'file' as const
}

export async function initStore() {
  await fileStore.initStore()
}

export async function listProjects() {
  if (requireMysqlOrFallback() === 'file') return fileStore.listProjects()
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT id, name, updated_at, version FROM projects ORDER BY updated_at DESC',
  )
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    updatedAt: Number(r.updated_at),
    version: String(r.version),
  }))
}

export async function getProject(id: string): Promise<ProjectDocument | null> {
  if (requireMysqlOrFallback() === 'file') return fileStore.getProject(id)
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT document_json FROM projects WHERE id = :id LIMIT 1',
    { id },
  )
  if (!rows[0]) return null
  return JSON.parse(String(rows[0].document_json)) as ProjectDocument
}

export async function saveProject(doc: ProjectDocument): Promise<ProjectDocument> {
  const next: ProjectDocument = {
    ...doc,
    meta: { ...doc.meta, updatedAt: Date.now() },
  }

  if (requireMysqlOrFallback() === 'file') return fileStore.saveProject(next)

  await getPool().query(
    `INSERT INTO projects (id, name, version, updated_at, document_json, created_at)
     VALUES (:id, :name, :version, :updatedAt, :documentJson, :createdAt)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       version = VALUES(version),
       updated_at = VALUES(updated_at),
       document_json = VALUES(document_json)`,
    {
      id: next.meta.id,
      name: next.meta.name,
      version: next.meta.version,
      updatedAt: next.meta.updatedAt,
      documentJson: JSON.stringify(next),
      createdAt: next.meta.createdAt,
    },
  )
  await getPool().query(
    `INSERT INTO app_meta (meta_key, meta_value) VALUES ('last_project_id', :id)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    { id: next.meta.id },
  )
  if (config.mysql.fallbackToFile) {
    await fileStore.saveProject(next).catch(() => undefined)
  }
  return next
}

export async function deleteProject(id: string): Promise<boolean> {
  if (requireMysqlOrFallback() === 'file') return fileStore.deleteProject(id)

  const [result] = await getPool().query<ResultSetHeader>('DELETE FROM projects WHERE id = :id', {
    id,
  })
  await getPool().query('DELETE FROM publishes WHERE project_id = :id', { id })
  const [metaRows] = await getPool().query<RowDataPacket[]>(
    `SELECT meta_value FROM app_meta WHERE meta_key = 'last_project_id' LIMIT 1`,
  )
  if (metaRows[0]?.meta_value === id) {
    await getPool().query(`UPDATE app_meta SET meta_value = NULL WHERE meta_key = 'last_project_id'`)
  }
  if (config.mysql.fallbackToFile) {
    await fileStore.deleteProject(id).catch(() => undefined)
  }
  return (result.affectedRows ?? 0) > 0
}

export async function getLastProjectId(): Promise<string | null> {
  if (requireMysqlOrFallback() === 'file') return fileStore.getLastProjectId()
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT meta_value FROM app_meta WHERE meta_key = 'last_project_id' LIMIT 1`,
  )
  const v = rows[0]?.meta_value
  return v == null ? null : String(v)
}

export async function savePublish(pkg: PublishPackage): Promise<PublishPackage> {
  if (requireMysqlOrFallback() === 'file') return fileStore.savePublish(pkg)

  await getPool().query(
    `INSERT INTO publishes (project_id, project_name, publish_version, published_at, package_json)
     VALUES (:projectId, :projectName, :publishVersion, :publishedAt, :packageJson)
     ON DUPLICATE KEY UPDATE
       project_name = VALUES(project_name),
       publish_version = VALUES(publish_version),
       published_at = VALUES(published_at),
       package_json = VALUES(package_json)`,
    {
      projectId: pkg.manifest.projectId,
      projectName: pkg.manifest.projectName,
      publishVersion: pkg.manifest.publishVersion,
      publishedAt: pkg.manifest.publishedAt,
      packageJson: JSON.stringify(pkg),
    },
  )
  if (config.mysql.fallbackToFile) {
    await fileStore.savePublish(pkg).catch(() => undefined)
  }
  return pkg
}

export async function getPublish(projectId: string): Promise<PublishPackage | null> {
  if (requireMysqlOrFallback() === 'file') return fileStore.getPublish(projectId)
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT package_json FROM publishes WHERE project_id = :projectId LIMIT 1',
    { projectId },
  )
  if (!rows[0]) return null
  return JSON.parse(String(rows[0].package_json)) as PublishPackage
}

export async function listPublishes() {
  if (requireMysqlOrFallback() === 'file') return fileStore.listPublishes()
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT project_id, project_name, publish_version, published_at
     FROM publishes ORDER BY published_at DESC`,
  )
  return rows.map((r) => ({
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    publishVersion: String(r.publish_version),
    publishedAt: Number(r.published_at),
  }))
}

export async function getLatestPublish(): Promise<PublishPackage | null> {
  if (requireMysqlOrFallback() === 'file') return fileStore.getLatestPublish()
  const lastId = await getLastProjectId()
  if (lastId) {
    const pkg = await getPublish(lastId)
    if (pkg) return pkg
  }
  const list = await listPublishes()
  if (!list[0]) return null
  return getPublish(list[0].projectId)
}
