/** 报警级别。画面上对应：提示 / 报警 / 故障 */
export type AlarmLevel = 'info' | 'alarm' | 'fault'

export type AlarmKind = 'limit' | 'bool' | 'quality' | 'target' | 'rate' | 'match' | 'mismatch'

export type AlarmLimitCode = 'HH' | 'H' | 'L' | 'LL'

/** 变量报警配置（MySQL / 文件），不是当前是否在报警 */
export interface TagAlarmConfig {
  alarmId: string
  tagId: string
  name: string
  enabled: boolean
  level: AlarmLevel
  kind: AlarmKind
  /**
   * 上下限：HH/H/L/LL。
   * 开报警、关报警、目标、变化率、匹配、失配：只有 H / HH。
   */
  limit?: AlarmLimitCode
  /** 上下限阈值、目标允许偏差、变化率的变化量 */
  threshold?: number
  deadband?: number
  /** kind=bool：true 开报警，false 关报警 */
  boolValue?: boolean
  /** kind=quality */
  quality?: 'Bad' | 'Offline'
  /** 条件持续这么多秒才产生；0 表示立即 */
  delaySec: number
  /** kind=target 的目标值 */
  target?: number
  /** kind=rate 的时间窗（秒） */
  windowSec?: number
  /** kind=match / mismatch 要比对的文本 */
  expectText?: string
}

/** 实时表上的一行。正在报警，或还没确认，就留在这里。只有已经恢复并且确认过，才从这里消失。 */
export interface ActiveAlarm {
  alarmId: string
  tagId: string
  name: string
  level: AlarmLevel
  message: string
  value: boolean | number | string | null
  quality: string
  raisedAt: number
  updatedAt: number
  /** 条件是否仍成立 */
  active: boolean
  acked: boolean
  clearedAt?: number | null
  ackedAt?: number | null
}

/** 一条历史事件。触发、恢复、确认各记一行。 */
export interface AlarmEvent {
  alarmId: string
  tagId: string
  name: string
  level: AlarmLevel
  kind?: string | null
  /** raise 触发，clear 恢复，ack 确认 */
  eventKind: string
  message?: string | null
  valueText?: string | null
  quality?: string | null
  eventAt: number
}
