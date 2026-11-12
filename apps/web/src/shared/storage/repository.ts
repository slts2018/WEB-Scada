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
import { isStorageQuotaError } from '@/shared/storage/projectStorage'
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

/**
 * 本地镜像失败不能把「服务端已保存」当成失败，也不能因此改成纯本地模式。
 * 配额不足时先清掉其他工程的副本再试一次；单份仍然放不下就跳过镜像。
 */
function writeLocalMirror(write: () => void, keepId: string, label: string): 'ok' | 'skipped' {
  try {
    write()
    return 'ok'
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err
  }
  local.evictOtherDocuments(keepId)
  try {
    write()
    return 'ok'
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err
    console.warn(`[web-scada] ${label}未写入浏览器本地存储：单份数据已超过配额`)
    return 'skipped'
  }
}

export async function saveProjectDocument(doc: ProjectDocument): Promise<ProjectDocument> {
  await ensureProbed()
  if (mode === 'api') {
    try {
      const saved = await apiSaveProject(doc)
      writeLocalMirror(() => local.saveProjectDocument(saved), saved.meta.id, '工程')
      return saved
    } catch (err) {
      if (isStorageQuotaError(err)) {
        console.warn('[web-scada] 工程已由服务端保存，本地镜像因配额未写入')
        return doc
      }
      mode = 'local'
    }
  }
  const mirrored = writeLocalMirror(() => local.saveProjectDocument(doc), doc.meta.id, '工程')
  if (mirrored === 'ok') return local.loadProjectDocument(doc.meta.id) ?? doc
  const ok = await healthCheck()
  if (!ok) {
    throw new Error('工程太大，浏览器本地存储已满。请连接服务端后再保存或进入运行。')
  }
  mode = 'api'
  const saved = await apiSaveProject(doc)
  console.warn('[web-scada] 本地存储已满，工程已改由服务端保存')
  return saved
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
  const id = pkg.manifest.projectId
  if (mode === 'api') {
    try {
      await apiSavePublish(pkg)
      writeLocalMirror(() => local.savePublishPackage(pkg), id, '发布包')
      return
    } catch (err) {
      if (isStorageQuotaError(err)) {
        console.warn('[web-scada] 发布包已由服务端保存，本地镜像因配额未写入')
        return
      }
      mode = 'local'
    }
  }
  const mirrored = writeLocalMirror(() => local.savePublishPackage(pkg), id, '发布包')
  if (mirrored === 'ok') return
  const ok = await healthCheck()
  if (!ok) {
    throw new Error('发布包太大，浏览器本地存储已满。请连接服务端后再进入运行。')
  }
  mode = 'api'
  await apiSavePublish(pkg)
  console.warn('[web-scada] 本地存储已满，发布包已改由服务端保存')
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
