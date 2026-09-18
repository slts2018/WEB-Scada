import { InfluxDB, Point, type QueryApi, type WriteApi } from '@influxdata/influxdb-client'
import { config } from '../config.js'

let client: InfluxDB | null = null
let writeApi: WriteApi | null = null
let queryApi: QueryApi | null = null
let ready = false
let lastError: string | null = null

export function getInfluxStatus() {
  return {
    ready,
    error: lastError,
    url: config.influx.url,
    org: config.influx.org,
    bucket: config.influx.bucket,
    configured: Boolean(config.influx.token),
  }
}

export async function initInflux(): Promise<boolean> {
  await closeInflux()
  if (!config.influx.token) {
    ready = false
    lastError = 'INFLUX_TOKEN is not set'
    return false
  }

  try {
    client = new InfluxDB({
      url: config.influx.url,
      token: config.influx.token,
      timeout: 5000,
    })
    writeApi = client.getWriteApi(config.influx.org, config.influx.bucket, 'ms')
    writeApi.useDefaultTags({ app: 'web-scada' })
    queryApi = client.getQueryApi(config.influx.org)

    const flux = `
      from(bucket: "${config.influx.bucket}")
        |> range(start: -1m)
        |> limit(n: 1)
    `
    await new Promise<void>((resolve, reject) => {
      let settled = false
      queryApi!.queryRows(flux, {
        next() {},
        error(err) {
          if (!settled) {
            settled = true
            reject(err)
          }
        },
        complete() {
          if (!settled) {
            settled = true
            resolve()
          }
        },
      })
    })

    ready = true
    lastError = null
    return true
  } catch (err) {
    ready = false
    lastError = err instanceof Error ? err.message : String(err)
    writeApi = null
    queryApi = null
    client = null
    return false
  }
}

export async function testInfluxConnection(opts?: {
  url?: string
  token?: string
  org?: string
  bucket?: string
}): Promise<{ ok: boolean; error?: string }> {
  const url = opts?.url ?? config.influx.url
  const token =
    opts?.token !== undefined && opts.token !== '' ? opts.token : config.influx.token
  const org = opts?.org ?? config.influx.org
  const bucket = opts?.bucket ?? config.influx.bucket
  if (!token) return { ok: false, error: 'token is empty' }
  try {
    const testClient = new InfluxDB({ url, token, timeout: 5000 })
    const q = testClient.getQueryApi(org)
    const flux = `
      from(bucket: "${bucket}")
        |> range(start: -1m)
        |> limit(n: 1)
    `
    await new Promise<void>((resolve, reject) => {
      let settled = false
      q.queryRows(flux, {
        next() {},
        error(err) {
          if (!settled) {
            settled = true
            reject(err)
          }
        },
        complete() {
          if (!settled) {
            settled = true
            resolve()
          }
        },
      })
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface TagSampleInput {
  tagId: string
  value: boolean | number | string | null
  quality: string
  timestamp?: number
}

function toNumeric(value: boolean | number | string | null): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function writeTagSamples(samples: TagSampleInput[]): Promise<number> {
  if (!ready || !writeApi) {
    throw new Error(lastError || 'InfluxDB is not ready')
  }
  for (const s of samples) {
    const point = new Point(config.influx.measurement)
      .tag('tagId', s.tagId)
      .tag('quality', s.quality || 'Uncertain')
      .timestamp(s.timestamp ?? Date.now())

    const num = toNumeric(s.value)
    if (num !== null) {
      point.floatField('value', num)
    } else if (typeof s.value === 'string') {
      point.stringField('value_str', s.value)
    } else {
      point.floatField('value', 0)
    }
    writeApi.writePoint(point)
  }
  await writeApi.flush()
  return samples.length
}

export interface TagHistoryPoint {
  tagId: string
  time: string
  value: number | string | null
  quality: string
}

export async function queryTagHistory(opts: {
  tagId: string
  start?: string
  stop?: string
  limit?: number
}): Promise<TagHistoryPoint[]> {
  if (!ready || !queryApi) {
    throw new Error(lastError || 'InfluxDB is not ready')
  }
  const start = opts.start || '-1h'
  const stop = opts.stop || 'now()'
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000)
  const flux = `
    from(bucket: "${config.influx.bucket}")
      |> range(start: ${start.startsWith('-') || start.match(/^\d/) ? start : `"${start}"`}, stop: ${stop === 'now()' ? 'now()' : `"${stop}"`})
      |> filter(fn: (r) => r._measurement == "${config.influx.measurement}")
      |> filter(fn: (r) => r.tagId == "${opts.tagId.replace(/"/g, '\\"')}")
      |> filter(fn: (r) => r._field == "value" or r._field == "value_str")
      |> sort(columns: ["_time"], desc: false)
      |> limit(n: ${limit})
  `

  const rows: TagHistoryPoint[] = []
  await new Promise<void>((resolve, reject) => {
    queryApi!.queryRows(flux, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row)
        rows.push({
          tagId: String(o.tagId ?? opts.tagId),
          time: String(o._time ?? ''),
          value: (o._value as number | string | null) ?? null,
          quality: String(o.quality ?? 'Uncertain'),
        })
      },
      error(err) {
        reject(err)
      },
      complete() {
        resolve()
      },
    })
  })
  return rows
}

export async function closeInflux() {
  try {
    await writeApi?.flush()
    await writeApi?.close()
  } catch {
    // ignore
  }
  writeApi = null
  queryApi = null
  client = null
  ready = false
}
