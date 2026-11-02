/**
 * 变量「地址」按所属设备协议拆分/拼回（仍落盘为 TagMeta.address）。
 * Modbus 对齐 Flight：区 + 字地址 + 长度(字) + 可选位号。
 * 落盘：holding:144 / holding:144.1 / holding:18448#2
 */
import type { DeviceProtocol } from '@web-scada/core'

export type ModbusArea = 'coil' | 'discrete' | 'input' | 'holding'

export type TagAddrFields = {
  raw: string
  mbArea: ModbusArea
  mbOffset: string
  /** 空=整字；0～15=字内位号（对齐检测柜 144.1 写法） */
  mbBit: string
  /** 空=按变量类型默认长度；否则 1～125 字（Flight「长度」） */
  mbLength: string
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
    mbBit: '',
    mbLength: '',
    nodeId: '',
    topic: '',
    path: '',
    sensor: '',
    field: '',
  }
}

const MB_AREAS: ModbusArea[] = ['coil', 'discrete', 'input', 'holding']

/** 解析「字」或「字.位」或「字#长度」；位须 0～15 */
export function parseModbusWordBit(text: string): { offset: string; bit: string; length: string } | null {
  const s = text.trim()
  const m = s.match(/^(\d+)\s*(?:#\s*(\d+))?(?:\s*[./．。]\s*(\d+))?$/)
  if (!m) return null
  const offset = m[1]
  const length = m[2] ?? ''
  if (m[3] == null || m[3] === '') return { offset, bit: '', length }
  const bitNum = Number(m[3])
  if (!Number.isInteger(bitNum) || bitNum < 0 || bitNum > 15) return null
  return { offset, bit: String(bitNum), length: '' }
}

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
      const m = s.match(/^(coil|discrete|input|holding)\s*:\s*(.+)$/i)
      if (m) {
        f.mbArea = m[1].toLowerCase() as ModbusArea
        const wb = parseModbusWordBit(m[2])
        if (wb) {
          f.mbOffset = wb.offset
          f.mbBit = wb.bit
          f.mbLength = wb.length
          break
        }
        f.raw = s
        break
      }
      // 兼容纯数字 / 字.位 / 字#长：按保持寄存器
      const wb = parseModbusWordBit(s)
      if (wb) {
        f.mbArea = 'holding'
        f.mbOffset = wb.offset
        f.mbBit = wb.bit
        f.mbLength = wb.length
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
      if (!/^\d+$/.test(off)) return undefined
      const area = MB_AREAS.includes(fields.mbArea) ? fields.mbArea : 'holding'
      const bitRaw = (fields.mbBit ?? '').trim()
      if (bitRaw) {
        const bitNum = Number(bitRaw)
        if (!Number.isInteger(bitNum) || bitNum < 0 || bitNum > 15) return `${area}:${off}`
        return `${area}:${off}.${bitNum}`
      }
      const lenRaw = (fields.mbLength ?? '').trim()
      if (lenRaw) {
        const len = Number(lenRaw)
        if (Number.isInteger(len) && len >= 1 && len <= 125) {
          return `${area}:${off}#${len}`
        }
      }
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
  { value: 'coil', label: '线圈 Coil (0x)' },
  { value: 'discrete', label: '离散输入 Discrete Input (1x)' },
  { value: 'input', label: '输入寄存器 Input Register (3x)' },
  { value: 'holding', label: '保持寄存器 Holding Register (4x)' },
]
