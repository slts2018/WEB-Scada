/**
 * 变量「地址」按所属设备协议拆分/拼回（仍落盘为 TagMeta.address）。
 */
import type { DeviceProtocol } from '@web-scada/core'

export type ModbusArea = 'coil' | 'discrete' | 'input' | 'holding'

export type TagAddrFields = {
  raw: string
  mbArea: ModbusArea
  mbOffset: string
  nodeId: string
  topic: string
  path: string
  /** MCD4000：Sensors 项 */
  sensor: string
  /** MCD4000：Fields 项 */
  field: string
}

export function emptyTagAddrFields(): TagAddrFields {
  return {
    raw: '',
    mbArea: 'holding',
    mbOffset: '',
    nodeId: '',
    topic: '',
    path: '',
    sensor: '',
    field: '',
  }
}

const MB_AREAS: ModbusArea[] = ['coil', 'discrete', 'input', 'holding']

/** 从已存 address 解析 */
export function parseTagAddress(
  protocol: DeviceProtocol,
  address?: string,
): TagAddrFields {
  const f = emptyTagAddrFields()
  const s = (address ?? '').trim()
  if (!s) return f

  switch (protocol) {
    case 'modbus_tcp': {
      const m = s.match(/^(coil|discrete|input|holding)\s*:\s*(\d+)$/i)
      if (m) {
        f.mbArea = m[1].toLowerCase() as ModbusArea
        f.mbOffset = m[2]
        break
      }
      // 兼容纯数字：按保持寄存器
      if (/^\d+$/.test(s)) {
        f.mbArea = 'holding'
        f.mbOffset = s
        break
      }
      f.raw = s
      break
    }
    case 'opcua':
      f.nodeId = s
      break
    case 'mqtt':
      f.topic = s
      break
    case 'http':
      f.path = s
      break
    case 'mcd4000': {
      // Sensor|Field
      const i = s.indexOf('|')
      if (i >= 0) {
        f.sensor = s.slice(0, i).trim()
        f.field = s.slice(i + 1).trim()
      } else {
        f.sensor = s
      }
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

/** 表单拼回 address */
export function formatTagAddress(
  protocol: DeviceProtocol,
  fields: TagAddrFields,
): string | undefined {
  switch (protocol) {
    case 'mock': {
      const v = fields.raw.trim()
      return v || undefined
    }
    case 'modbus_tcp': {
      const off = fields.mbOffset.trim()
      if (!off) return undefined
      const area = MB_AREAS.includes(fields.mbArea) ? fields.mbArea : 'holding'
      return `${area}:${off}`
    }
    case 'opcua': {
      const v = fields.nodeId.trim()
      return v || undefined
    }
    case 'mqtt': {
      const v = fields.topic.trim()
      return v || undefined
    }
    case 'http': {
      const v = fields.path.trim()
      return v || undefined
    }
    case 'mcd4000': {
      const sensor = fields.sensor.trim()
      const field = fields.field.trim()
      if (!sensor && !field) return undefined
      return `${sensor}|${field}`
    }
    case 'other':
    default: {
      const v = fields.raw.trim()
      return v || undefined
    }
  }
}

export const MODBUS_AREA_OPTIONS: Array<{ value: ModbusArea; label: string }> = [
  { value: 'coil', label: '线圈 (0x)' },
  { value: 'discrete', label: '离散输入 (1x)' },
  { value: 'input', label: '输入寄存器 (3x)' },
  { value: 'holding', label: '保持寄存器 (4x)' },
]
