/** 数据质量码 — 采集/Runtime/报警统一使用 */
export type QualityCode = 'Good' | 'Bad' | 'Uncertain' | 'Offline'

/** 统一 Tag 标识与当前值 */
export interface TagMeta {
  tagId: string
  name: string
  /** 变量分组（工程师站习惯，如 工艺/设备） */
  group?: string
  /** 所属设备（必填；一对多：一台设备下多个变量） */
  deviceId: string
  address?: string
  dataType: 'bool' | 'int' | 'float' | 'string'
  unit?: string
  writable: boolean
  description?: string
}

export interface TagValue {
  tagId: string
  value: boolean | number | string | null
  quality: QualityCode
  timestamp: number
  sourceTimestamp?: number
}

/** 设备协议（元数据；真采集在阶段 G） */
export type DeviceProtocol = 'mock' | 'modbus_tcp' | 'opcua' | 'mqtt' | 'http' | 'other'

/** 设备 / 通道配置（MySQL；Tag.deviceId 引用） */
export interface DeviceMeta {
  deviceId: string
  name: string
  protocol: DeviceProtocol
  /** 通道连接信息，如 host:port / topic / endpoint */
  channel?: string
  enabled: boolean
  description?: string
}

/** 历史数据缺 deviceId 时的回填默认设备（与 MOCK_DEVICES 一致） */
export const DEFAULT_TAG_DEVICE_ID = 'demo.plc'

