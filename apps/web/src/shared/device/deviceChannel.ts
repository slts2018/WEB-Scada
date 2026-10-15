/**
 * 设备「通道」字段按协议拆分/拼回（仍落盘为 DeviceMeta.channel 字符串）。
 * MCD4000 已接数据中台 Query* 轮询；其余协议仍为元数据。
 */
import type { DeviceProtocol } from '@web-scada/core'

/** MCD4000 数据源：振动 / PLC / ARM */
export type Mcd4000Source = 'vib' | 'plc' | 'arm'

export type DeviceConnFields = {
  host: string
  port: string
  endpoint: string
  topic: string
  baseUrl: string
  /** MCD4000：4000 序列号 DeviceId */
  mcdDeviceId: string
  /** MCD4000：边缘设备 UnitId */
  unitId: string
  /** MCD4000：Query 接口族 */
  mcdSource: Mcd4000Source
  raw: string
}

export function emptyConnFields(): DeviceConnFields {
  return {
    host: '',
    port: '',
    endpoint: '',
    topic: '',
    baseUrl: '',
    mcdDeviceId: '',
    unitId: '',
    mcdSource: 'vib',
    raw: '',
  }
}

function normalizeMcdSource(v: string | undefined): Mcd4000Source {
  const s = (v ?? '').trim().toLowerCase()
  if (s === 'plc' || s === 'arm' || s === 'vib') return s
  return 'vib'
}

/** 从已存 channel 解析到表单字段 */
export function parseDeviceChannel(
  protocol: DeviceProtocol,
  channel?: string,
): DeviceConnFields {
  const f = emptyConnFields()
  const s = (channel ?? '').trim()
  if (!s) {
    if (protocol === 'modbus_tcp') f.port = '502'
    if (protocol === 'mqtt') f.port = '1883'
    return f
  }

  switch (protocol) {
    case 'modbus_tcp': {
      const m = s.match(/^([^:]+):(\d+)$/)
      if (m) {
        f.host = m[1]
        f.port = m[2]
      } else {
        f.host = s
        f.port = '502'
      }
      break
    }
    case 'opcua':
      f.endpoint = s
      break
    case 'mqtt': {
      // broker|topic 或 host:port|topic；无 | 则整段当 broker
      const i = s.indexOf('|')
      if (i >= 0) {
        const broker = s.slice(0, i).trim()
        f.topic = s.slice(i + 1).trim()
        const m = broker.match(/^([^:]+):(\d+)$/)
        if (m) {
          f.host = m[1]
          f.port = m[2]
        } else {
          f.host = broker
          f.port = '1883'
        }
      } else {
        const m = s.match(/^([^:]+):(\d+)$/)
        if (m) {
          f.host = m[1]
          f.port = m[2]
        } else {
          f.host = s
          f.port = '1883'
        }
      }
      break
    }
    case 'http':
      f.baseUrl = s
      break
    case 'mcd4000': {
      // baseUrl|DeviceId|UnitId|source(vib|plc|arm)
      const parts = s.split('|')
      f.baseUrl = (parts[0] ?? '').trim()
      f.mcdDeviceId = (parts[1] ?? '').trim()
      f.unitId = (parts[2] ?? '').trim()
      f.mcdSource = normalizeMcdSource(parts[3])
      break
    }
    case 'mock':
    case 'other':
    default:
      f.raw = s
      break
  }
  return f
}

/** 表单字段拼回 channel；空则 undefined */
export function formatDeviceChannel(
  protocol: DeviceProtocol,
  fields: DeviceConnFields,
): string | undefined {
  switch (protocol) {
    case 'mock':
      return undefined
    case 'modbus_tcp': {
      const host = fields.host.trim()
      if (!host) return undefined
      const port = fields.port.trim() || '502'
      return `${host}:${port}`
    }
    case 'opcua': {
      const ep = fields.endpoint.trim()
      return ep || undefined
    }
    case 'mqtt': {
      const host = fields.host.trim()
      if (!host) return undefined
      const port = fields.port.trim() || '1883'
      const broker = `${host}:${port}`
      const topic = fields.topic.trim()
      return topic ? `${broker}|${topic}` : broker
    }
    case 'http': {
      const url = fields.baseUrl.trim()
      return url || undefined
    }
    case 'mcd4000': {
      const base = fields.baseUrl.trim()
      const did = fields.mcdDeviceId.trim()
      const uid = fields.unitId.trim()
      const src = normalizeMcdSource(fields.mcdSource)
      if (!base && !did && !uid) return undefined
      return `${base}|${did}|${uid}|${src}`
    }
    case 'other':
    default: {
      const raw = fields.raw.trim()
      return raw || undefined
    }
  }
}
