import {
  formatBoolText,
  type ActiveAlarm,
  type AlarmEvent,
  type AlarmLevel,
  type TagMeta,
} from '@web-scada/core'
import type { AlarmHistorySearch } from '@/shared/runtime/alarmHistoryQuery'

const LEVEL_LABEL: Record<AlarmLevel, string> = {
  info: '提示',
  alarm: '报警',
  fault: '故障',
}

function clock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function day(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function statusText(alarm: ActiveAlarm): string {
  if (alarm.active === false) return '已恢复'
  return alarm.acked ? '已确认' : '未确认'
}

export const ALARM_FIELDS = [
  { id: 'date', label: '日期' },
  { id: 'time', label: '时间' },
  { id: 'level', label: '级别' },
  { id: 'status', label: '状态' },
  { id: 'alarmName', label: '报警名称' },
  { id: 'tagName', label: '变量名' },
  { id: 'value', label: '值' },
] as const

export type AlarmFieldId = (typeof ALARM_FIELDS)[number]['id']

const DEFAULT_ALARM_FIELDS: AlarmFieldId[] = [
  'date',
  'time',
  'level',
  'status',
  'alarmName',
  'tagName',
  'value',
]

/** 旧工程里的名称、内容，对应现在的变量名、值。 */
const LEGACY_FIELD: Record<string, AlarmFieldId> = {
  name: 'tagName',
  message: 'value',
}

/** 未配置时显示全部字段。非法项丢掉，顺序固定。至少留一列。 */
export function alarmFieldsOf(raw: unknown): AlarmFieldId[] {
  const allowed = new Set<string>(ALARM_FIELDS.map((field) => field.id))
  if (!Array.isArray(raw)) return [...DEFAULT_ALARM_FIELDS]
  const picked = new Set(
    raw
      .map((id) => LEGACY_FIELD[String(id)] ?? String(id))
      .filter((id) => allowed.has(id)),
  )
  const ordered = DEFAULT_ALARM_FIELDS.filter((id) => picked.has(id))
  return ordered.length ? ordered : [...DEFAULT_ALARM_FIELDS]
}

export interface AlarmListText {
  text: string
  ids: string[]
  statuses: string[]
  levels: string[]
  /** 每行对应的事件时刻（epoch ms）；历史报警用它做"点一行 → 趋势跳该时刻" */
  times: number[]
  /** 每行对应的变量 id：反向联动时优先跳"曲线里有这个变量"的趋势图元 */
  tags: string[]
}

function tagNameOf(alarm: ActiveAlarm, meta: TagMeta | undefined): string {
  const name = meta?.name?.trim()
  return name || alarm.tagId
}

function valueText(alarm: ActiveAlarm, meta: TagMeta | undefined): string {
  const value = alarm.value
  if (value == null) return '-'
  if (meta?.dataType === 'bool' || typeof value === 'boolean') {
    return formatBoolText(value, meta) ?? String(value)
  }
  return String(value)
}

function fieldText(alarm: ActiveAlarm, field: AlarmFieldId, metas: Map<string, TagMeta>): string {
  if (field === 'date') return day(alarm.raisedAt)
  if (field === 'time') return clock(alarm.raisedAt)
  if (field === 'level') return LEVEL_LABEL[alarm.level] ?? alarm.level
  if (field === 'status') return statusText(alarm)
  if (field === 'alarmName') return alarm.name
  const meta = metas.get(alarm.tagId)
  if (field === 'tagName') return tagNameOf(alarm, meta)
  return valueText(alarm, meta)
}

/** 报警图元行。未确认和已恢复闪烁；已确认且仍在报警的行留着，不闪。 */
export function formatActiveAlarmItems(
  alarms: ActiveAlarm[],
  columns?: unknown,
  metas: TagMeta[] = [],
): AlarmListText {
  const fields = alarmFieldsOf(columns)
  const byId = new Map(metas.map((meta) => [meta.tagId, meta]))
  const rows = [...alarms].sort((a, b) => b.raisedAt - a.raisedAt)
  return {
    text: rows.map((alarm) => fields.map((field) => fieldText(alarm, field, byId)).join('\t')).join('\n'),
    ids: rows.map((alarm) => alarm.alarmId),
    statuses: rows.map((alarm) => statusText(alarm)),
    levels: rows.map((alarm) => LEVEL_LABEL[alarm.level] ?? alarm.level),
    times: rows.map((alarm) => alarm.raisedAt),
    tags: rows.map((alarm) => alarm.tagId),
  }
}

export const ALARM_HISTORY_FIELDS = [
  { id: 'date', label: '日期' },
  { id: 'time', label: '时间' },
  { id: 'event', label: '事件' },
  { id: 'level', label: '级别' },
  { id: 'alarmName', label: '报警名称' },
  { id: 'tagName', label: '变量名' },
  { id: 'value', label: '值' },
] as const

export type AlarmHistoryFieldId = (typeof ALARM_HISTORY_FIELDS)[number]['id']

const DEFAULT_HISTORY_FIELDS: AlarmHistoryFieldId[] = [
  'date',
  'time',
  'event',
  'level',
  'alarmName',
  'tagName',
  'value',
]

const EVENT_LABEL: Record<string, string> = {
  raise: '触发',
  clear: '恢复',
  ack: '确认',
}

/** 未配置时显示全部字段。非法项丢掉，顺序固定。至少留一列。 */
export function alarmHistoryFieldsOf(raw: unknown): AlarmHistoryFieldId[] {
  const allowed = new Set<string>(ALARM_HISTORY_FIELDS.map((field) => field.id))
  if (!Array.isArray(raw)) return [...DEFAULT_HISTORY_FIELDS]
  const picked = new Set(raw.map((id) => String(id)).filter((id) => allowed.has(id)))
  const ordered = DEFAULT_HISTORY_FIELDS.filter((id) => picked.has(id))
  return ordered.length ? ordered : [...DEFAULT_HISTORY_FIELDS]
}

function eventText(kind: string): string {
  return EVENT_LABEL[kind] ?? kind
}

function historyValue(event: AlarmEvent, meta: TagMeta | undefined): string {
  const raw = event.valueText
  if (raw == null || raw === '') return '-'
  if (meta?.dataType === 'bool' || raw === 'true' || raw === 'false') {
    return formatBoolText(raw, meta) ?? raw
  }
  return raw
}

function historyFieldText(
  event: AlarmEvent,
  field: AlarmHistoryFieldId,
  metas: Map<string, TagMeta>,
): string {
  if (field === 'date') return day(event.eventAt)
  if (field === 'time') return clock(event.eventAt)
  if (field === 'event') return eventText(event.eventKind)
  if (field === 'level') return LEVEL_LABEL[event.level] ?? event.level
  if (field === 'alarmName') return event.name
  const meta = metas.get(event.tagId)
  if (field === 'tagName') {
    const name = meta?.name?.trim()
    return name || event.tagId
  }
  return historyValue(event, meta)
}

function matchesHistorySearch(
  event: AlarmEvent,
  meta: TagMeta | undefined,
  search?: AlarmHistorySearch,
): boolean {
  if (!search) return true
  if (search.event && event.eventKind !== search.event) return false
  if (search.level && event.level !== search.level) return false
  const text = search.text.trim().toLowerCase()
  if (!text) return true
  const tagName = meta?.name?.trim() || event.tagId
  const blob = [
    event.name,
    tagName,
    event.tagId,
    historyValue(event, meta),
    event.message ?? '',
    eventText(event.eventKind),
    LEVEL_LABEL[event.level] ?? event.level,
  ]
    .join('\n')
    .toLowerCase()
  return blob.includes(text)
}

/** 历史报警行。按事件时间从新到旧，只留所选时间和搜索条件内的记录。 */
export function formatAlarmHistoryItems(
  events: AlarmEvent[],
  columns?: unknown,
  metas: TagMeta[] = [],
  search?: AlarmHistorySearch,
): AlarmListText {
  const fields = alarmHistoryFieldsOf(columns)
  const from = search ? Math.min(search.from, search.to) : null
  const to = search ? Math.max(search.from, search.to) : null
  const byId = new Map(metas.map((meta) => [meta.tagId, meta]))
  const rows = events
    .filter((event) => {
      if (from != null && event.eventAt < from) return false
      if (to != null && event.eventAt > to) return false
      return matchesHistorySearch(event, byId.get(event.tagId), search)
    })
    .sort((a, b) => b.eventAt - a.eventAt)
  return {
    text: rows
      .map((event) => fields.map((field) => historyFieldText(event, field, byId)).join('\t'))
      .join('\n'),
    ids: [],
    statuses: rows.map((event) => eventText(event.eventKind)),
    levels: rows.map((event) => LEVEL_LABEL[event.level] ?? event.level),
    times: rows.map((event) => event.eventAt),
    tags: rows.map((event) => event.tagId),
  }
}
