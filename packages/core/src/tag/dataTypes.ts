import type { TagMeta } from '../types/tag'

/** 与 Flight-SCADA 对齐的变量类型（含旧 int 兼容） */
export const TAG_DATA_TYPES = [
  'bool',
  'byte',
  'char',
  'short',
  'word',
  'int',
  'long',
  'dword',
  'float',
  'double',
  'llong',
  'qword',
  'string',
] as const

export type TagDataType = (typeof TAG_DATA_TYPES)[number]

export const TAG_DATA_TYPE_OPTIONS: Array<{ value: TagDataType; label: string }> = [
  { value: 'bool', label: '布尔 (bool)' },
  { value: 'float', label: '单精度浮点 (float32)' },
  { value: 'char', label: '字符 (char)' },
  { value: 'word', label: '字 (uint16 / word)' },
  { value: 'byte', label: '字节 (uint8 / byte)' },
  { value: 'short', label: '短整数 (int16 / short)' },
  { value: 'long', label: '长整数 (int32 / long)' },
  { value: 'dword', label: '双字 (uint32 / dword)' },
  { value: 'double', label: '双精度浮点 (float64 / double)' },
  { value: 'llong', label: '长长整数 (int64 / llong)' },
  { value: 'qword', label: '四字 (uint64 / qword)' },
  { value: 'string', label: '字符串 (string)' },
  { value: 'int', label: '短整数-兼容旧int (int16)' },
]

/** 旧工程 int → 按有符号 16 位 short 处理 */
export function normalizeTagDataType(dt: string | undefined | null): TagDataType {
  const s = (dt ?? 'float').trim().toLowerCase()
  if ((TAG_DATA_TYPES as readonly string[]).includes(s)) return s as TagDataType
  return 'float'
}

export function isIntegerTagType(dt: string | undefined | null): boolean {
  const n = normalizeTagDataType(dt)
  return (
    n === 'byte' ||
    n === 'char' ||
    n === 'short' ||
    n === 'word' ||
    n === 'int' ||
    n === 'long' ||
    n === 'dword' ||
    n === 'llong' ||
    n === 'qword'
  )
}

export function isNumericTagType(dt: string | undefined | null): boolean {
  const n = normalizeTagDataType(dt)
  return n !== 'bool' && n !== 'string' && n !== 'char'
}

/** Modbus 默认占用字数（可被地址 #长度 覆盖） */
export function defaultModbusLength(dt: string | undefined | null): number {
  switch (normalizeTagDataType(dt)) {
    case 'bool':
    case 'byte':
    case 'char':
    case 'short':
    case 'word':
    case 'int':
    case 'string':
      return 1
    case 'float':
    case 'long':
    case 'dword':
      return 2
    case 'double':
    case 'llong':
    case 'qword':
      return 4
    default:
      return 1
  }
}

export type ModbusSwapMode = 'SwapNone' | 'SwapBytes' | 'SwapWords' | 'SwapAll'

export const MODBUS_SWAP_OPTIONS: Array<{ value: ModbusSwapMode; label: string }> = [
  { value: 'SwapNone', label: 'SwapNone（不交换）' },
  { value: 'SwapBytes', label: 'SwapBytes（字节交换）' },
  { value: 'SwapWords', label: 'SwapWords（字交换）' },
  { value: 'SwapAll', label: 'SwapAll（字节+字）' },
]

export function normalizeModbusSwap(v: string | undefined | null, fallback: ModbusSwapMode): ModbusSwapMode {
  const s = (v ?? '').trim()
  if (s === 'SwapNone' || s === 'SwapBytes' || s === 'SwapWords' || s === 'SwapAll') return s
  return fallback
}

export function isBoolTagType(meta: Pick<TagMeta, 'dataType'>): boolean {
  return normalizeTagDataType(meta.dataType) === 'bool'
}
