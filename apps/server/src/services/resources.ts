import fs from 'node:fs/promises'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { ProjectResource } from '@web-scada/core'
import { DATA_ROOT } from '../store.file.js'

const RESOURCES_DIR = path.join(DATA_ROOT, 'resources')

export function resourcesRoot() {
  return RESOURCES_DIR
}

export async function ensureResourcesDir() {
  await fs.mkdir(RESOURCES_DIR, { recursive: true })
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 120) || 'file'
}

function detectKind(fileName: string, mime?: string): ProjectResource['kind'] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.svg') || mime === 'image/svg+xml') return 'svg'
  if (
    lower.endsWith('.glb') ||
    lower.endsWith('.gltf') ||
    lower.endsWith('.obj') ||
    lower.endsWith('.fbx') ||
    lower.endsWith('.stl') ||
    mime?.includes('gltf') ||
    mime?.includes('fbx') ||
    mime === 'model/obj' ||
    mime === 'model/stl'
  ) {
    return 'model'
  }
  if (mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(lower)) return 'image'
  return 'other'
}

export async function saveUploadedResource(opts: {
  projectId: string
  fileName: string
  mimeType?: string
  stream: NodeJS.ReadableStream
}): Promise<ProjectResource & { size: number; diskPath: string }> {
  await ensureResourcesDir()
  const projectDir = path.join(RESOURCES_DIR, opts.projectId)
  await fs.mkdir(projectDir, { recursive: true })

  const id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const safe = safeFileName(opts.fileName)
  const storedName = `${id}_${safe}`
  const diskPath = path.join(projectDir, storedName)
  const relativeUrl = `/api/files/${opts.projectId}/${storedName}`

  await pipeline(opts.stream, createWriteStream(diskPath))
  const stat = await fs.stat(diskPath)

  return {
    id,
    name: opts.fileName,
    kind: detectKind(opts.fileName, opts.mimeType),
    path: relativeUrl,
    mimeType: opts.mimeType,
    size: stat.size,
    diskPath,
  }
}

export function resolveResourceFile(projectId: string, fileName: string): string | null {
  const base = path.resolve(RESOURCES_DIR, projectId)
  const full = path.resolve(base, fileName)
  if (!full.startsWith(base + path.sep) && full !== base) return null
  return full
}

export function getResourcesAbsoluteRoot() {
  return RESOURCES_DIR
}
