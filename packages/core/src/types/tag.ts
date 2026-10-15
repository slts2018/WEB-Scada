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
  /**
   * 仅模拟设备使用。缺省时服务端按类型给只读点一套默认参数。
   * 可写变量默认不模拟，避免盖掉运行端写入。
   */
  simulation?: TagSimulation
  /** 布尔为 true 时的显示文本。空则仍显示 true */
  onText?: string
  /** 布尔为 false 时的显示文本。空则仍显示 false */
  offText?: string
  /** 模拟设备采样周期（毫秒）。缺省 1000。其它协议先只保存 */
  scanPeriodMs?: number
  /** 打开后按 pushPeriodMs 合并推送，只发窗口内最后一个值。缺省为值一变就推 */
  pushEnabled?: boolean
  /** 推送合并窗口（毫秒）。缺省 1000 */
  pushPeriodMs?: number
  /**
   * 历史存档。缺省对象表示沿用旧行为：写值和质量变化记一条，模拟抖动不记。
   * enabled=false 时只在质量好坏切换时记一条。
   */
  history?: TagHistoryConfig
}

/** 变量历史存档。mode=legacy 只用于保存时清回默认，服务端不落库。 */
export interface TagHistoryConfig {
  enabled?: boolean
  mode?: 'change' | 'interval' | 'legacy'
  intervalMs?: number
  deadband?: number
}

/** 模拟设备上单个变量的出值方式 */
export interface TagSimulation {
  enabled: boolean
  /** 每隔多少秒变化一次 */
  periodSec: number
  /** 数值下限；不填则不限制 */
  min?: number
  /** 数值上限；不填则不限制 */
  max?: number
  /** 浮点每次振幅，或整数步进 */
  step?: number
  /** 字符串候选，一行一个 */
  options?: string
  /**
   * 仿真方式，随变量类型变化。
   * bool: toggle | random
   * int/float: walk | random | ramp | sine
   * string: cycle | random
   */
  mode?: SimMode
}

export type SimMode = 'toggle' | 'random' | 'walk' | 'ramp' | 'sine' | 'cycle'

export interface TagValue {
  tagId: string
  value: boolean | number | string | null
  quality: QualityCode
  timestamp: number
  sourceTimestamp?: number
}

/**
 * 设备协议。
 * - mock：内存模拟
 * - mcd4000：数据中台 Query* 轮询读（写值不下发现场）
 * - 其余：目前仅元数据，真 IO 未接
 */
export type DeviceProtocol =
  | 'mock'
  | 'modbus_tcp'
  | 'opcua'
  | 'mqtt'
  | 'http'
  /** 沈鼓 MCD4000 / 数据中台历史 Query API（HTTP 轮询最新值） */
  | 'mcd4000'
  | 'other'

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

