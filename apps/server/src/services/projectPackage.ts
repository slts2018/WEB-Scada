/**
 * 工程导入导出包（传输层，不改变 ProjectDocument 契约）
 *
 * zip 结构：
 *   manifest.json  — 格式版本
 *   project.json   — ProjectDocument
 *   resources/*    — data/resources/{projectId}/ 下文件
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type { ProjectDocument } from '@web-scada/core'
import { normalizeProjectDocument } from '@web-scada/core'
import { getProject, saveProject } from '../store.js'
import { getResourcesAbsoluteRoot } from './resources.js'

export const PACKAGE_FORMAT = 'web-scada-project'
export const PACKAGE_VERSION = 1

export interface ProjectPackageManifest {
  format: typeof PACKAGE_FORMAT
  version: number
  exportedAt: number
  sourceProjectId: string
  sourceProjectName: string
}

function resourceDir(projectId: string) {
  return path.join(getResourcesAbsoluteRoot(), projectId)
}

function safeSegment(name: string) {
  const base = path.basename(name).replace(/[/\\]/g, '_')
  if (!base || base === '.' || base === '..') return null
  return base
}

async function listResourceFiles(projectId: string): Promise<string[]> {
  const dir = resourceDir(projectId)
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function remapFilePaths(doc: ProjectDocument, oldId: string, newId: string): ProjectDocument {
  if (oldId === newId) return doc
  const raw = JSON.stringify(doc)
  const next = raw.split(`/api/files/${oldId}/`).join(`/api/files/${newId}/`)
  return JSON.parse(next) as ProjectDocument
}

export async function buildProjectExportZip(projectId: string): Promise<{
  zip: Uint8Array
  fileName: string
  projectName: string
}> {
  const doc = await getProject(projectId)
  if (!doc) throw Object.assign(new Error('project_not_found'), { code: 'project_not_found' })

  const files: Record<string, Uint8Array> = {}
  const manifest: ProjectPackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: Date.now(),
    sourceProjectId: doc.meta.id,
    sourceProjectName: doc.meta.name,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['project.json'] = strToU8(JSON.stringify(doc, null, 2))

  const names = await listResourceFiles(projectId)
  const dir = resourceDir(projectId)
  for (const name of names) {
    const buf = await fs.readFile(path.join(dir, name))
    files[`resources/${name}`] = new Uint8Array(buf)
  }

  const zip = zipSync(files, { level: 6 })
  const safeName = (doc.meta.name || 'project').replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 80)
  return {
    zip,
    fileName: `${safeName || 'project'}.webscada.zip`,
    projectName: doc.meta.name,
  }
}

export async function importProjectFromZip(zipBytes: Uint8Array): Promise<ProjectDocument> {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(zipBytes)
  } catch {
    throw Object.assign(new Error('invalid_zip'), { code: 'invalid_zip' })
  }

  const projectRaw = unzipped['project.json']
  if (!projectRaw) {
    throw Object.assign(new Error('missing_project_json'), { code: 'missing_project_json' })
  }

  let source: ProjectDocument
  try {
    source = JSON.parse(strFromU8(projectRaw)) as ProjectDocument
  } catch {
    throw Object.assign(new Error('invalid_project_json'), { code: 'invalid_project_json' })
  }
  if (!source?.meta?.id || !Array.isArray(source.pages)) {
    throw Object.assign(new Error('invalid_project_body'), { code: 'invalid_project_body' })
  }

  const manifestRaw = unzipped['manifest.json']
  if (manifestRaw) {
    try {
      const man = JSON.parse(strFromU8(manifestRaw)) as ProjectPackageManifest
      if (man.format && man.format !== PACKAGE_FORMAT) {
        throw Object.assign(new Error('unsupported_package_format'), {
          code: 'unsupported_package_format',
        })
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'unsupported_package_format') throw err
      // manifest 损坏不阻断：仍按 project.json 导入
    }
  }

  const oldId = source.meta.id
  const now = Date.now()
  const newId = `prj_${now}_${Math.random().toString(36).slice(2, 7)}`
  let doc = remapFilePaths(source, oldId, newId)
  doc = normalizeProjectDocument({
    ...doc,
    meta: {
      ...doc.meta,
      id: newId,
      name: `${doc.meta.name || '导入工程'} (导入)`,
      createdAt: now,
      updatedAt: now,
    },
  })

  const destDir = resourceDir(newId)
  await fs.mkdir(destDir, { recursive: true })
  for (const [entryPath, data] of Object.entries(unzipped)) {
    if (!entryPath.startsWith('resources/')) continue
    const base = safeSegment(entryPath.slice('resources/'.length))
    if (!base) continue
    await fs.writeFile(path.join(destDir, base), Buffer.from(data))
  }

  return saveProject(doc)
}
