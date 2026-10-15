import type {
  DeviceMeta,
  ProjectDocument,
  PublishPackage,
  TagAlarmConfig,
  TagMeta,
  TagValue,
  ActiveAlarm,
  AlarmEvent,
} from '@web-scada/core'
import type { ProjectIndexItem, PublishIndexItem } from '@/shared/storage/projectStorage'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const API_TOKEN = String(import.meta.env.VITE_SCADA_API_TOKEN || '').trim()

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function authHeaders(): Record<string, string> {
  if (!API_TOKEN) return {}
  return {
    Authorization: `Bearer ${API_TOKEN}`,
    'X-SCADA-Token': API_TOKEN,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw new ApiError(`API ${res.status} ${path}`, res.status, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function healthCheck(): Promise<boolean> {
  try {
    const data = await request<{ ok: boolean }>('/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    })
    return Boolean(data.ok)
  } catch {
    return false
  }
}

export async function apiListProjects(): Promise<{
  items: ProjectIndexItem[]
  lastProjectId: string | null
}> {
  return request('/projects')
}

export async function apiGetProject(id: string): Promise<ProjectDocument> {
  return request(`/projects/${encodeURIComponent(id)}`)
}

export async function apiSaveProject(doc: ProjectDocument): Promise<ProjectDocument> {
  return request(`/projects/${encodeURIComponent(doc.meta.id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
}

export async function apiDeleteProject(id: string): Promise<void> {
  await request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 下载完整工程包（JSON + 资源 zip） */
export async function apiExportProject(id: string): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}/export`, {
    method: 'GET',
    headers: {
      Accept: 'application/zip',
      ...authHeaders(),
    },
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw new ApiError(`API ${res.status} /projects/${id}/export`, res.status, body)
  }
  return parseZipDownload(res, 'project.webscada.zip')
}

/** 下载网站部署包（Runtime + 工程 + 资源） */
export async function apiExportSite(id: string): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}/export/site`, {
    method: 'GET',
    headers: {
      Accept: 'application/zip',
      ...authHeaders(),
    },
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw new ApiError(`API ${res.status} /projects/${id}/export/site`, res.status, body)
  }
  return parseZipDownload(res, 'WebScada-Site.zip')
}

async function parseZipDownload(
  res: Response,
  fallbackName: string,
): Promise<{ blob: Blob; fileName: string }> {
  const disposition = res.headers.get('Content-Disposition') || ''
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  let fileName = fallbackName
  if (utfMatch?.[1]) {
    try {
      fileName = decodeURIComponent(utfMatch[1])
    } catch {
      fileName = utfMatch[1]
    }
  } else if (plainMatch?.[1]) {
    fileName = plainMatch[1]
  }
  const blob = await res.blob()
  return { blob, fileName }
}

/** 导入工程包 → 服务端新建工程并返回文档 */
export async function apiImportProject(file: File): Promise<ProjectDocument> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`${API_BASE}/projects/import`, {
    method: 'POST',
    body: form,
    headers: {
      ...authHeaders(),
    },
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw new ApiError(`API ${res.status} /projects/import`, res.status, body)
  }
  return (await res.json()) as ProjectDocument
}

export async function apiListPublishes(): Promise<{ items: PublishIndexItem[] }> {
  return request('/publishes')
}

export async function apiGetPublish(projectId: string): Promise<PublishPackage> {
  return request(`/publishes/${encodeURIComponent(projectId)}?_=${Date.now()}`, {
    cache: 'no-store',
  })
}

export async function apiGetLatestPublish(): Promise<PublishPackage> {
  return request(`/publishes/latest?_=${Date.now()}`, {
    cache: 'no-store',
  })
}

export async function apiSavePublish(pkg: PublishPackage): Promise<PublishPackage> {
  return request(`/publishes/${encodeURIComponent(pkg.manifest.projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(pkg),
  })
}

export interface DbSettingsPublic {
  mysql: {
    host: string
    port: number
    user: string
    database: string
    fallbackToFile: boolean
    passwordSet: boolean
    passwordMasked: string
  }
  influx: {
    url: string
    org: string
    bucket: string
    measurement: string
    required: boolean
    tokenSet: boolean
    tokenMasked: string
  }
}

export interface DbStatusSnapshot {
  mysql: { ready: boolean; error: string | null; host: string; port: number; database: string }
  influx: {
    ready: boolean
    error: string | null
    url: string
    org: string
    bucket: string
    configured: boolean
  }
  storage: 'mysql' | 'file'
}

export async function apiGetDatabaseSettings(): Promise<{
  settings: DbSettingsPublic
  status: DbStatusSnapshot
}> {
  return request('/settings/database')
}

export async function apiSaveDatabaseSettings(body: {
  mysql?: Partial<{
    host: string
    port: number
    user: string
    password: string
    database: string
    fallbackToFile: boolean
  }>
  influx?: Partial<{
    url: string
    token: string
    org: string
    bucket: string
    measurement: string
    required: boolean
  }>
}): Promise<{
  ok: boolean
  mysqlOk: boolean
  influxOk: boolean
  settings: DbSettingsPublic
  status: DbStatusSnapshot
}> {
  return request('/settings/database', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function apiTestDatabaseSettings(body: {
  mysql?: Partial<{
    host: string
    port: number
    user: string
    password: string
    database: string
  }>
  influx?: Partial<{
    url: string
    token: string
    org: string
    bucket: string
  }>
}): Promise<{
  mysql: { ok: boolean; error?: string }
  influx: { ok: boolean; error?: string }
}> {
  return request('/settings/database/test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function apiListTags(): Promise<{ items: TagMeta[]; values: TagValue[] }> {
  return request('/tags')
}

export async function apiListAlarms(tagId?: string): Promise<{ items: TagAlarmConfig[] }> {
  const q = tagId ? `?tagId=${encodeURIComponent(tagId)}` : ''
  return request(`/alarms${q}`)
}

export async function apiAckAlarm(alarmId: string): Promise<{
  ok: boolean
  removed: boolean
  alarm?: ActiveAlarm
}> {
  return request(`/alarms/${encodeURIComponent(alarmId)}/ack`, { method: 'POST' })
}

export async function apiListActiveAlarms(): Promise<{ items: ActiveAlarm[] }> {
  return request('/alarms/active')
}

export async function apiListAlarmEvents(query?: {
  tagId?: string
  from?: number
  to?: number
  limit?: number
}): Promise<{ items: AlarmEvent[] }> {
  const params = new URLSearchParams()
  if (query?.tagId) params.set('tagId', query.tagId)
  if (query?.from != null) params.set('from', String(query.from))
  if (query?.to != null) params.set('to', String(query.to))
  if (query?.limit != null) params.set('limit', String(query.limit))
  const q = params.toString()
  return request(`/alarms/events${q ? `?${q}` : ''}`)
}

export async function apiCreateAlarm(body: TagAlarmConfig): Promise<TagAlarmConfig> {
  return request('/alarms', { method: 'POST', body: JSON.stringify(body) })
}

export async function apiUpdateAlarm(alarmId: string, body: TagAlarmConfig): Promise<TagAlarmConfig> {
  return request(`/alarms/${encodeURIComponent(alarmId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function apiDeleteAlarm(alarmId: string): Promise<void> {
  await request(`/alarms/${encodeURIComponent(alarmId)}`, { method: 'DELETE' })
}

export async function apiCreateTag(meta: TagMeta): Promise<TagMeta> {
  return request('/tags', { method: 'POST', body: JSON.stringify(meta) })
}

export async function apiUpdateTag(tagId: string, patch: Partial<TagMeta>): Promise<TagMeta> {
  return request(`/tags/${encodeURIComponent(tagId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function apiDeleteTag(tagId: string): Promise<void> {
  await request(`/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' })
}

export async function apiListDevices(): Promise<{ items: DeviceMeta[] }> {
  return request('/devices')
}

export async function apiCreateDevice(meta: DeviceMeta): Promise<DeviceMeta> {
  return request('/devices', { method: 'POST', body: JSON.stringify(meta) })
}

export async function apiUpdateDevice(
  deviceId: string,
  patch: Partial<DeviceMeta>,
): Promise<DeviceMeta> {
  return request(`/devices/${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function apiDeleteDevice(deviceId: string): Promise<void> {
  await request(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}

export async function apiWriteTag(
  tagId: string,
  value: boolean | number | string | null,
): Promise<{ ok: boolean; message: string; value?: TagValue }> {
  return request(`/tags/${encodeURIComponent(tagId)}/write`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

export async function apiGetTagHistory(
  tagId: string,
  opts?: { start?: string; stop?: string; limit?: number },
): Promise<{ tagId: string; points: Array<{ tagId: string; time: string; value: number | string | null; quality: string }> }> {
  const q = new URLSearchParams()
  if (opts?.start) q.set('start', opts.start)
  if (opts?.stop) q.set('stop', opts.stop)
  if (opts?.limit) q.set('limit', String(opts.limit))
  const suffix = q.toString() ? `?${q}` : ''
  return request(`/tags/${encodeURIComponent(tagId)}/history${suffix}`)
}

export function tagsWebSocketUrl(): string {
  const base = import.meta.env.VITE_API_BASE || '/api'
  const tokenQ = API_TOKEN ? `?token=${encodeURIComponent(API_TOKEN)}` : ''
  if (base.startsWith('http')) {
    const u = new URL(base)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = `${u.pathname.replace(/\/$/, '')}/ws/tags`
    u.search = API_TOKEN ? `token=${encodeURIComponent(API_TOKEN)}` : ''
    return u.toString()
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${base}/ws/tags${tokenQ}`
}

export async function apiUploadResource(
  projectId: string,
  file: File,
): Promise<{
  id: string
  name: string
  kind: 'image' | 'svg' | 'model' | 'other'
  path: string
  mimeType?: string
  size: number
}> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(
    `${API_BASE}/resources/upload?projectId=${encodeURIComponent(projectId)}`,
    {
      method: 'POST',
      body: form,
      headers: {
        ...authHeaders(),
      },
    },
  )
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw new ApiError(`API ${res.status} /resources/upload`, res.status, body)
  }
  return (await res.json()) as {
    id: string
    name: string
    kind: 'image' | 'svg' | 'model' | 'other'
    path: string
    mimeType?: string
    size: number
  }
}
