import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { getDataRoot, getScadaHome, getServerPackageRoot, getSettingsFile } from './paths.js'

const SETTINGS_FILE = getSettingsFile()

dotenv.config({ path: path.resolve(getScadaHome(), '.env') })
dotenv.config({ path: path.resolve(getServerPackageRoot(), '.env') })
dotenv.config({ path: path.resolve(getDataRoot(), '.env') })

function env(key: string, fallback = '') {
  return process.env[key] ?? fallback
}

function envBool(key: string, fallback: boolean) {
  const v = process.env[key]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

export interface MysqlSettings {
  host: string
  port: number
  user: string
  password: string
  database: string
  fallbackToFile: boolean
}

export interface InfluxSettings {
  url: string
  token: string
  org: string
  bucket: string
  measurement: string
  required: boolean
}

export interface DbSettingsPayload {
  mysql: MysqlSettings
  influx: InfluxSettings
}

/** Public view: secrets masked */
export interface DbSettingsPublic {
  mysql: Omit<MysqlSettings, 'password'> & { passwordSet: boolean; passwordMasked: string }
  influx: Omit<InfluxSettings, 'token'> & { tokenSet: boolean; tokenMasked: string }
}

function defaultSettings(): DbSettingsPayload {
  return {
    mysql: {
      host: env('MYSQL_HOST', '127.0.0.1'),
      port: Number(env('MYSQL_PORT', '3306')),
      user: env('MYSQL_USER', 'root'),
      password: env('MYSQL_PASSWORD', 'root'),
      database: env('MYSQL_DATABASE', 'web_scada'),
      fallbackToFile: envBool('MYSQL_FALLBACK_FILE', true),
    },
    influx: {
      url: env('INFLUX_URL', 'http://127.0.0.1:8086'),
      token: env('INFLUX_TOKEN', ''),
      org: env('INFLUX_ORG', 'web-scada'),
      bucket: env('INFLUX_BUCKET', 'tags'),
      measurement: env('INFLUX_MEASUREMENT', 'tag_value'),
      required: envBool('INFLUX_REQUIRED', false),
    },
  }
}

export const config = {
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '8787')),
  mysql: defaultSettings().mysql,
  influx: defaultSettings().influx,
  /**
   * 最小 API Token。为空 = 鉴权关闭（本地 pnpm dev 默认可用）。
   * 设置后写值 / 改库 / 工程变更等需 Authorization: Bearer <token>
   */
  auth: {
    apiToken: env('SCADA_API_TOKEN', ''),
    /** 为 true 且 token 为空时拒绝启动（生产 fail-closed，可选） */
    required: envBool('SCADA_AUTH_REQUIRED', false),
  },
}

function maskSecret(value: string) {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`
}

export function toPublicSettings(): DbSettingsPublic {
  return {
    mysql: {
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      database: config.mysql.database,
      fallbackToFile: config.mysql.fallbackToFile,
      passwordSet: Boolean(config.mysql.password),
      passwordMasked: maskSecret(config.mysql.password),
    },
    influx: {
      url: config.influx.url,
      org: config.influx.org,
      bucket: config.influx.bucket,
      measurement: config.influx.measurement,
      required: config.influx.required,
      tokenSet: Boolean(config.influx.token),
      tokenMasked: maskSecret(config.influx.token),
    },
  }
}

export async function loadPersistedSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8')
    const saved = JSON.parse(raw) as Partial<DbSettingsPayload>
    if (saved.mysql) Object.assign(config.mysql, saved.mysql)
    if (saved.influx) Object.assign(config.influx, saved.influx)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

export async function savePersistedSettings() {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true })
  const payload: DbSettingsPayload = {
    mysql: { ...config.mysql },
    influx: { ...config.influx },
  }
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await fs.rename(tmp, SETTINGS_FILE)
}

export type DbSettingsUpdate = {
  mysql?: Partial<MysqlSettings> & { password?: string }
  influx?: Partial<InfluxSettings> & { token?: string }
}

/** Apply UI updates. Empty password/token means keep previous. */
export function applyDbSettingsUpdate(update: DbSettingsUpdate) {
  if (update.mysql) {
    const { password, ...rest } = update.mysql
    Object.assign(config.mysql, rest)
    if (password !== undefined && password !== '') {
      config.mysql.password = password
    }
  }
  if (update.influx) {
    const { token, ...rest } = update.influx
    Object.assign(config.influx, rest)
    if (token !== undefined && token !== '') {
      config.influx.token = token
    }
  }
}
