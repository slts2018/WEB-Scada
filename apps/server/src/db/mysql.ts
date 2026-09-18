import mysql from 'mysql2/promise'
import { config } from '../config.js'

let pool: mysql.Pool | null = null
let ready = false
let lastError: string | null = null

export function getMysqlStatus() {
  return {
    ready,
    error: lastError,
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
  }
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('MySQL pool not initialized')
  return pool
}

export async function initMysql(): Promise<boolean> {
  await closeMysql()
  try {
    // Connect without DB first, ensure database exists
    const bootstrap = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      multipleStatements: true,
    })
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await bootstrap.end()

    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    })

    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        version VARCHAR(64) NOT NULL DEFAULT '0.1.0',
        updated_at BIGINT NOT NULL,
        document_json LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_projects_updated (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS publishes (
        project_id VARCHAR(64) PRIMARY KEY,
        project_name VARCHAR(255) NOT NULL,
        publish_version VARCHAR(64) NOT NULL,
        published_at BIGINT NOT NULL,
        package_json LONGTEXT NOT NULL,
        INDEX idx_publishes_published (published_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_meta (
        meta_key VARCHAR(64) PRIMARY KEY,
        meta_value VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tags (
        tag_id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        tag_group VARCHAR(128) NULL,
        device_id VARCHAR(128) NULL,
        address VARCHAR(255) NULL,
        data_type ENUM('bool','int','float','string') NOT NULL DEFAULT 'float',
        unit VARCHAR(64) NULL,
        writable TINYINT(1) NOT NULL DEFAULT 0,
        description VARCHAR(512) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_tags_name (name),
        INDEX idx_tags_group (tag_group)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        protocol VARCHAR(32) NOT NULL DEFAULT 'mock',
        channel VARCHAR(512) NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        description VARCHAR(512) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_devices_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await pool.query('SELECT 1')
    ready = true
    lastError = null
    return true
  } catch (err) {
    ready = false
    lastError = err instanceof Error ? err.message : String(err)
    pool = null
    return false
  }
}

/** Test connection without replacing the active pool */
export async function testMysqlConnection(opts?: {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}): Promise<{ ok: boolean; error?: string }> {
  const host = opts?.host ?? config.mysql.host
  const port = opts?.port ?? config.mysql.port
  const user = opts?.user ?? config.mysql.user
  const password =
    opts?.password !== undefined && opts.password !== ''
      ? opts.password
      : config.mysql.password
  const database = opts?.database ?? config.mysql.database
  try {
    const conn = await mysql.createConnection({ host, port, user, password, database })
    await conn.query('SELECT 1')
    await conn.end()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function closeMysql() {
  if (pool) {
    await pool.end()
    pool = null
  }
  ready = false
}
