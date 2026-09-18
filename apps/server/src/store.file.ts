import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectDocument, PublishPackage } from '@web-scada/core'
import { getDataRoot } from './paths.js'

export const DATA_ROOT = getDataRoot()
const PROJECTS_DIR = path.join(DATA_ROOT, 'projects')
const PUBLISHES_DIR = path.join(DATA_ROOT, 'publishes')
const META_FILE = path.join(DATA_ROOT, 'meta.json')

export interface ProjectIndexItem {
  id: string
  name: string
  updatedAt: number
  version: string
}

interface MetaState {
  lastProjectId: string | null
}

async function ensureDirs() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true })
  await fs.mkdir(PUBLISHES_DIR, { recursive: true })
}

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

async function readMeta(): Promise<MetaState> {
  const meta = await readJsonFile<MetaState>(META_FILE)
  return meta ?? { lastProjectId: null }
}

async function writeMeta(meta: MetaState) {
  await writeJsonFile(META_FILE, meta)
}

function projectPath(id: string) {
  return path.join(PROJECTS_DIR, `${id}.json`)
}

function publishPath(id: string) {
  return path.join(PUBLISHES_DIR, `${id}.json`)
}

export async function initStore() {
  await ensureDirs()
}

export async function listProjects(): Promise<ProjectIndexItem[]> {
  await ensureDirs()
  const files = await fs.readdir(PROJECTS_DIR)
  const items: ProjectIndexItem[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const doc = await readJsonFile<ProjectDocument>(path.join(PROJECTS_DIR, file))
    if (!doc?.meta?.id) continue
    items.push({
      id: doc.meta.id,
      name: doc.meta.name,
      updatedAt: doc.meta.updatedAt,
      version: doc.meta.version,
    })
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<ProjectDocument | null> {
  return readJsonFile<ProjectDocument>(projectPath(id))
}

export async function saveProject(doc: ProjectDocument): Promise<ProjectDocument> {
  await ensureDirs()
  const next: ProjectDocument = {
    ...doc,
    meta: { ...doc.meta, updatedAt: Date.now() },
  }
  await writeJsonFile(projectPath(next.meta.id), next)
  const meta = await readMeta()
  meta.lastProjectId = next.meta.id
  await writeMeta(meta)
  return next
}

export async function deleteProject(id: string): Promise<boolean> {
  await ensureDirs()
  let removed = false
  try {
    await fs.unlink(projectPath(id))
    removed = true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  try {
    await fs.unlink(publishPath(id))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const meta = await readMeta()
  if (meta.lastProjectId === id) {
    meta.lastProjectId = null
    await writeMeta(meta)
  }
  return removed
}

export async function getLastProjectId(): Promise<string | null> {
  const meta = await readMeta()
  return meta.lastProjectId
}

export async function savePublish(pkg: PublishPackage): Promise<PublishPackage> {
  await ensureDirs()
  await writeJsonFile(publishPath(pkg.manifest.projectId), pkg)
  return pkg
}

export async function getPublish(projectId: string): Promise<PublishPackage | null> {
  return readJsonFile<PublishPackage>(publishPath(projectId))
}

export async function listPublishes() {
  await ensureDirs()
  const files = await fs.readdir(PUBLISHES_DIR)
  const items: Array<{
    projectId: string
    projectName: string
    publishVersion: string
    publishedAt: number
  }> = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const pkg = await readJsonFile<PublishPackage>(path.join(PUBLISHES_DIR, file))
    if (!pkg?.manifest) continue
    items.push({
      projectId: pkg.manifest.projectId,
      projectName: pkg.manifest.projectName,
      publishVersion: pkg.manifest.publishVersion,
      publishedAt: pkg.manifest.publishedAt,
    })
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt)
}

export async function getLatestPublish(): Promise<PublishPackage | null> {
  const lastId = await getLastProjectId()
  if (lastId) {
    const pkg = await getPublish(lastId)
    if (pkg) return pkg
  }
  const list = await listPublishes()
  if (!list[0]) return null
  return getPublish(list[0].projectId)
}
