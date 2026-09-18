/**
 * 工程持久化仓储：优先走后端 API，不可用时回退 localStorage。
 */
import type { ProjectDocument, PublishPackage } from '@web-scada/core'
import {
  apiDeleteProject,
  apiGetLatestPublish,
  apiGetProject,
  apiGetPublish,
  apiListProjects,
  apiListPublishes,
  apiSaveProject,
  apiSavePublish,
  healthCheck,
} from '@/shared/api/client'
import * as local from '@/shared/storage/projectStorage'
import type { ProjectIndexItem, PublishIndexItem } from '@/shared/storage/projectStorage'

export type { ProjectIndexItem, PublishIndexItem }

export type StorageMode = 'api' | 'local'

let mode: StorageMode = 'local'
let probed = false

export function getStorageMode(): StorageMode {
  return mode
}

export async function probeStorage(): Promise<StorageMode> {
  const ok = await healthCheck()
  mode = ok ? 'api' : 'local'
  probed = true
  return mode
}

async function ensureProbed() {
  if (!probed) await probeStorage()
}

export async function listProjectIndex(): Promise<ProjectIndexItem[]> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      const res = await apiListProjects()
      return res.items
    } catch {
      mode = 'local'
    }
  }
  return local.listProjectIndex()
}

export async function saveProjectDocument(doc: ProjectDocument): Promise<ProjectDocument> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      const saved = await apiSaveProject(doc)
      // 本地镜像，便于离线打开最近工程
      local.saveProjectDocument(saved)
      return saved
    } catch {
      mode = 'local'
    }
  }
  local.saveProjectDocument(doc)
  return local.loadProjectDocument(doc.meta.id) ?? doc
}

export async function loadProjectDocument(id: string): Promise<ProjectDocument | null> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      return await apiGetProject(id)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) return null
      mode = 'local'
    }
  }
  return local.loadProjectDocument(id)
}

export async function deleteProjectDocument(id: string): Promise<void> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      await apiDeleteProject(id)
      local.deleteProjectDocument(id)
      return
    } catch {
      mode = 'local'
    }
  }
  local.deleteProjectDocument(id)
}

export async function getLastProjectId(): Promise<string | null> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      const res = await apiListProjects()
      return res.lastProjectId
    } catch {
      mode = 'local'
    }
  }
  return local.getLastProjectId()
}

export async function savePublishPackage(pkg: PublishPackage): Promise<void> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      await apiSavePublish(pkg)
      local.savePublishPackage(pkg)
      return
    } catch {
      mode = 'local'
    }
  }
  local.savePublishPackage(pkg)
}

export async function loadPublishPackage(projectId: string): Promise<PublishPackage | null> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      return await apiGetPublish(projectId)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) return null
      mode = 'local'
    }
  }
  return local.loadPublishPackage(projectId)
}

export async function loadLatestPublishPackage(): Promise<PublishPackage | null> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      return await apiGetLatestPublish()
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) return null
      mode = 'local'
    }
  }
  return local.loadLatestPublishPackage()
}

export async function listPublishPackages(): Promise<PublishIndexItem[]> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      const res = await apiListPublishes()
      return res.items
    } catch {
      mode = 'local'
    }
  }
  return local.listPublishPackages()
}
