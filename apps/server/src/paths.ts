import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 安装包 / 开发态根目录：
 * - 打包：server.mjs 与 public/ 同级 → 该目录
 * - 开发：与历史一致，根为 apps/（数据在 apps/data）
 */
export function getScadaHome(): string {
  if (process.env.SCADA_HOME) return path.resolve(process.env.SCADA_HOME)
  if (fs.existsSync(path.join(__dirname, 'public', 'index.html'))) return __dirname
  // apps/server/src → apps
  return path.resolve(__dirname, '../..')
}

export function getDataRoot(): string {
  if (process.env.SCADA_DATA) return path.resolve(process.env.SCADA_DATA)
  return path.join(getScadaHome(), 'data')
}

export function getWebRoot(): string {
  if (process.env.SCADA_WEB_ROOT) return path.resolve(process.env.SCADA_WEB_ROOT)
  const beside = path.join(__dirname, 'public')
  if (fs.existsSync(path.join(beside, 'index.html'))) return beside
  return path.join(getScadaHome(), 'public')
}

export function getSettingsFile(): string {
  return path.join(getDataRoot(), 'db-settings.json')
}

/** 开发时额外加载 apps/server/.env */
export function getServerPackageRoot(): string {
  if (process.env.SCADA_HOME) return path.resolve(process.env.SCADA_HOME)
  if (fs.existsSync(path.join(__dirname, 'public', 'index.html'))) return __dirname
  return path.resolve(__dirname, '..')
}
