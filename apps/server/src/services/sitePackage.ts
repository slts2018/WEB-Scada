/**
 * 导出「网站包」：可部署的 Windows 运行目录 zip（Runtime 默认入口）。
 * 依赖已构建的 win-x64 模板（SCADA_SITE_TEMPLATE 或 release/… 或当前安装目录）。
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProjectDocument, PublishPackage } from '@web-scada/core'
import { getProject, getPublish, savePublish } from '../store.js'
import { getDataRoot, getScadaHome } from '../paths.js'
import { getResourcesAbsoluteRoot } from './resources.js'

const execFileAsync = promisify(execFile)

const SITE_VERSION = '0.1.0'
const BASE_PACK_NAME = `WebScada-${SITE_VERSION}-win-x64`

export function resolveSiteTemplateDir(): string | null {
  const fromEnv = process.env.SCADA_SITE_TEMPLATE?.trim()
  if (fromEnv && fsSync.existsSync(path.join(fromEnv, 'server.mjs'))) {
    return path.resolve(fromEnv)
  }

  const home = getScadaHome()
  if (
    fsSync.existsSync(path.join(home, 'server.mjs')) &&
    fsSync.existsSync(path.join(home, 'public', 'index.html'))
  ) {
    return home
  }

  // monorepo: apps/server/src → repo/release/...
  const candidates = [
    path.resolve(home, '..', 'release', BASE_PACK_NAME),
    path.resolve(home, '../..', 'release', BASE_PACK_NAME),
    path.resolve(process.cwd(), 'release', BASE_PACK_NAME),
  ]
  for (const c of candidates) {
    if (fsSync.existsSync(path.join(c, 'server.mjs'))) return c
  }
  return null
}

function siteStartBat(): string {
  // Prefer template next to packaging when developing; fall back to embedded minimal.
  const home = getScadaHome()
  const candidates = [
    path.resolve(home, '../../packaging/templates/start-site.bat'),
    path.resolve(home, '../packaging/templates/start-site.bat'),
    path.join(home, 'start-site.bat'),
  ]
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return fsSync.readFileSync(p, 'utf8')
  }
  return `@echo off\r\ncd /d "%~dp0"\r\nset SCADA_URL=http://127.0.0.1:8787/runtime\r\ncall "%~dp0start.bat"\r\n`
}

function siteReadme(): string {
  const home = getScadaHome()
  const candidates = [
    path.resolve(home, '../../packaging/templates/README-SITE.txt'),
    path.resolve(home, '../packaging/templates/README-SITE.txt'),
    path.join(home, 'README-SITE.txt'),
  ]
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return fsSync.readFileSync(p, 'utf8')
  }
  return 'WebScada Site — open http://SERVER_IP:8787/runtime\r\n'
}

async function ensurePublish(projectId: string): Promise<PublishPackage> {
  const existing = await getPublish(projectId)
  if (existing) return existing
  const doc = await getProject(projectId)
  if (!doc) throw Object.assign(new Error('project_not_found'), { code: 'project_not_found' })
  const now = Date.now()
  const pkg: PublishPackage = {
    manifest: {
      projectId: doc.meta.id,
      projectName: doc.meta.name,
      publishVersion: doc.meta.version || '1.0.0',
      publishedAt: now,
      homePageId: doc.homePageId,
      documentPath: 'document.json',
      resourceIndex: (doc.resources ?? []).map((r) => ({
        id: r.id,
        path: r.path,
        kind: r.kind,
      })),
    },
    document: doc,
  }
  return savePublish(pkg)
}

async function copyTemplate(template: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(template, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === 'data') continue
    const from = path.join(template, ent.name)
    const to = path.join(dest, ent.name)
    await fs.cp(from, to, { recursive: true })
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

async function injectProjectData(dest: string, projectId: string, doc: ProjectDocument, pkg: PublishPackage) {
  const dataDir = path.join(dest, 'data')
  await fs.mkdir(path.join(dataDir, 'projects'), { recursive: true })
  await fs.mkdir(path.join(dataDir, 'publishes'), { recursive: true })
  await fs.mkdir(path.join(dataDir, 'resources', projectId), { recursive: true })

  await writeJson(path.join(dataDir, 'projects', `${projectId}.json`), doc)
  await writeJson(path.join(dataDir, 'publishes', `${projectId}.json`), pkg)
  await writeJson(path.join(dataDir, 'meta.json'), { lastProjectId: projectId })

  const resSrc = path.join(getResourcesAbsoluteRoot(), projectId)
  const resDst = path.join(dataDir, 'resources', projectId)
  try {
    await fs.cp(resSrc, resDst, { recursive: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  for (const name of ['tags.json', 'devices.json']) {
    const src = path.join(getDataRoot(), name)
    try {
      await fs.copyFile(src, path.join(dataDir, name))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  const startBat = siteStartBat()
  await fs.writeFile(path.join(dest, 'start.bat'), startBat, 'utf8')
  await fs.writeFile(path.join(dest, 'start-site.bat'), startBat, 'utf8')
  const readme = siteReadme()
  await fs.writeFile(path.join(dest, 'README.txt'), readme, 'utf8')
  await fs.writeFile(path.join(dest, 'README-SITE.txt'), readme, 'utf8')
}

async function zipDirectoryWindows(dirPath: string, zipPath: string) {
  if (fsSync.existsSync(zipPath)) await fs.unlink(zipPath)
  // Compress-Archive needs the folder as item → zip contains Site folder
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -LiteralPath '${dirPath.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  )
}

export async function buildSiteExportZip(projectId: string): Promise<{
  zip: Buffer
  fileName: string
  projectName: string
}> {
  const template = resolveSiteTemplateDir()
  if (!template) {
    throw Object.assign(
      new Error(
        'site_template_missing: run pnpm pack:win:node once, or set SCADA_SITE_TEMPLATE to that folder',
      ),
      { code: 'site_template_missing' },
    )
  }

  const doc = await getProject(projectId)
  if (!doc) throw Object.assign(new Error('project_not_found'), { code: 'project_not_found' })
  const pkg = await ensurePublish(projectId)

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webscada-site-'))
  const folderName = `WebScada-Site-${SITE_VERSION}-win-x64`
  const dest = path.join(tmpRoot, folderName)
  const zipPath = path.join(tmpRoot, `${folderName}.zip`)

  try {
    await copyTemplate(template, dest)
    await injectProjectData(dest, projectId, doc, pkg)

    if (process.platform === 'win32') {
      await zipDirectoryWindows(dest, zipPath)
    } else {
      throw Object.assign(new Error('site_export_windows_only'), {
        code: 'site_export_windows_only',
      })
    }

    const zip = await fs.readFile(zipPath)
    const safeName = (doc.meta.name || 'site').replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 60)
    return {
      zip,
      fileName: `${safeName || 'site'}-WebScada-Site.zip`,
      projectName: doc.meta.name,
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
