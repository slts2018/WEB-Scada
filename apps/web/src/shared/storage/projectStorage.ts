import type { ProjectDocument, PublishPackage } from '@web-scada/core'

const INDEX_KEY = 'web-scada:project-index'
const LAST_KEY = 'web-scada:last-project-id'
const docKey = (id: string) => `web-scada:project:${id}`
const publishKey = (id: string) => `web-scada:publish:${id}`

export interface ProjectIndexItem {
  id: string
  name: string
  updatedAt: number
  version: string
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

/** 浏览器 localStorage 约 5MB，整份工程或发布包经常超限。 */
export function isStorageQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String((err as { name?: unknown }).name) : ''
  const code = 'code' in err ? Number((err as { code?: unknown }).code) : NaN
  const message = err instanceof Error ? err.message : ''
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    /quota/i.test(message)
  )
}

/** 删掉其他工程的本地副本，给当前这份腾位置。不删 keepId 自己的条目。 */
export function evictOtherDocuments(keepId: string): void {
  const keepDoc = docKey(keepId)
  const keepPublish = publishKey(keepId)
  const drop: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || key === keepDoc || key === keepPublish) continue
    if (key.startsWith('web-scada:project:') || key.startsWith('web-scada:publish:')) drop.push(key)
  }
  for (const key of drop) localStorage.removeItem(key)
}

export function listProjectIndex(): ProjectIndexItem[] {
  return readJson<ProjectIndexItem[]>(INDEX_KEY) ?? []
}

function upsertIndex(doc: ProjectDocument) {
  const list = listProjectIndex().filter((item) => item.id !== doc.meta.id)
  list.unshift({
    id: doc.meta.id,
    name: doc.meta.name,
    updatedAt: doc.meta.updatedAt,
    version: doc.meta.version,
  })
  writeJson(INDEX_KEY, list)
}

export function saveProjectDocument(doc: ProjectDocument): void {
  const next = {
    ...doc,
    meta: { ...doc.meta, updatedAt: Date.now() },
  }
  writeJson(docKey(next.meta.id), next)
  upsertIndex(next)
  localStorage.setItem(LAST_KEY, next.meta.id)
}

export function loadProjectDocument(id: string): ProjectDocument | null {
  return readJson<ProjectDocument>(docKey(id))
}

export function deleteProjectDocument(id: string): void {
  localStorage.removeItem(docKey(id))
  localStorage.removeItem(publishKey(id))
  writeJson(
    INDEX_KEY,
    listProjectIndex().filter((item) => item.id !== id),
  )
  if (localStorage.getItem(LAST_KEY) === id) {
    localStorage.removeItem(LAST_KEY)
  }
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_KEY)
}

export function savePublishPackage(pkg: PublishPackage): void {
  writeJson(publishKey(pkg.manifest.projectId), pkg)
}

export function loadPublishPackage(projectId: string): PublishPackage | null {
  return readJson<PublishPackage>(publishKey(projectId))
}

export function loadLatestPublishPackage(): PublishPackage | null {
  const lastId = getLastProjectId()
  if (lastId) {
    const pkg = loadPublishPackage(lastId)
    if (pkg) return pkg
  }
  const index = listProjectIndex()
  for (const item of index) {
    const pkg = loadPublishPackage(item.id)
    if (pkg) return pkg
  }
  return null
}

export interface PublishIndexItem {
  projectId: string
  projectName: string
  publishVersion: string
  publishedAt: number
}

/** 列出本地所有已发布包（按发布时间倒序） */
export function listPublishPackages(): PublishIndexItem[] {
  const items: PublishIndexItem[] = []
  for (const item of listProjectIndex()) {
    const pkg = loadPublishPackage(item.id)
    if (!pkg) continue
    items.push({
      projectId: pkg.manifest.projectId,
      projectName: pkg.manifest.projectName,
      publishVersion: pkg.manifest.publishVersion,
      publishedAt: pkg.manifest.publishedAt,
    })
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt)
}
