import { reactive } from 'vue'
import type { AlarmEvent } from '@web-scada/core'
import { apiListAlarmEvents } from '@/shared/api/client'

/** 运行时搜索和时间范围，不写入工程。 */
export interface AlarmHistorySearch {
  text: string
  event: '' | 'raise' | 'clear' | 'ack'
  level: '' | 'info' | 'alarm' | 'fault'
  /** 开始时间，epoch ms */
  from: number
  /** 结束时间，epoch ms */
  to: number
  /** 当前页，从 1 开始。只在画面里翻页，不写入工程。 */
  page: number
  /** 每页条数。只在画面里选择，不写入工程。 */
  pageSize: number
}

/** 图元内部留给一行筛选条的高度。 */
export const HISTORY_FILTER_HEIGHT = 26

/** 图元底部留给分页条的高度。 */
export const HISTORY_PAGER_HEIGHT = 26

/** 每页条数可选项。 */
export const HISTORY_PAGE_SIZES = [10, 20, 50, 100]

const queries = reactive<Record<string, AlarmHistorySearch>>({})
const eventsByWidget = new Map<string, AlarmEvent[]>()
const loadedKey = new Map<string, string>()
const pendingKey = new Map<string, string>()
const generation = new Map<string, number>()
const loadedListeners = new Set<() => void>()
const pageInfo = reactive<Record<string, { page: number; pages: number; total: number; size: number }>>({})

function startOfLocalDay(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime()
}

function endOfLocalDay(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime()
}

function rangeKey(query: AlarmHistorySearch): string {
  return `${query.from}|${query.to}`
}

function emitLoaded() {
  for (const listener of loadedListeners) listener()
}

/** 某控件的历史记录加载完成后通知画面重绘。 */
export function onAlarmHistoryLoaded(listener: () => void): () => void {
  loadedListeners.add(listener)
  return () => loadedListeners.delete(listener)
}

export function alarmHistoryEvents(widgetId: string): AlarmEvent[] {
  return eventsByWidget.get(widgetId) ?? []
}

async function loadAlarmHistory(widgetId: string, force: boolean): Promise<void> {
  const query = queries[widgetId]
  if (!query) return
  const key = rangeKey(query)
  if (!force && loadedKey.get(widgetId) === key) return
  if (!force && pendingKey.get(widgetId) === key) return
  const gen = (generation.get(widgetId) ?? 0) + 1
  generation.set(widgetId, gen)
  pendingKey.set(widgetId, key)
  const from = Math.min(query.from, query.to)
  const to = Math.max(query.from, query.to)
  try {
    const res = await apiListAlarmEvents({ from, to, limit: 500 })
    if (generation.get(widgetId) !== gen) return
    eventsByWidget.set(widgetId, res.items ?? [])
    loadedKey.set(widgetId, key)
    emitLoaded()
  } catch {
    // 查询失败时保留上一份，避免历史表被清空
  } finally {
    if (generation.get(widgetId) === gen) pendingKey.delete(widgetId)
  }
}

/** 实时预览或运行时按当前时间范围取历史。已加载且范围没变则不重复请求。 */
export function requestAlarmHistory(widgetId: string): void {
  void loadAlarmHistory(widgetId, false)
}

/** 轮询时刷新已经打开过的历史报警控件。 */
export async function reloadAlarmHistoryQueries(): Promise<void> {
  const ids = Object.keys(queries)
  await Promise.all(ids.map((id) => loadAlarmHistory(id, true)))
}

/** 搜索条在图元内的位置，换算到定位父元素的像素坐标。 */
export function historySearchClientRect(
  point: (p: { x: number; y: number }) => { x: number; y: number },
  widget: { props: Record<string, unknown>; transform: { width: number } },
  origin = { x: 0, y: 0 },
) {
  const title = String(widget.props.title ?? '历史报警')
  const top = title ? 26 : 6
  const p1 = point({ x: 4, y: top })
  const p2 = point({ x: Math.max(12, widget.transform.width - 4), y: top + HISTORY_FILTER_HEIGHT })
  return {
    x: origin.x + Math.min(p1.x, p2.x),
    y: origin.y + Math.min(p1.y, p2.y),
    w: Math.max(48, Math.abs(p2.x - p1.x)),
    h: Math.max(16, Math.abs(p2.y - p1.y)),
  }
}

/** 分页条在图元内的位置，换算到定位父元素的像素坐标。 */
export function historyPagerClientRect(
  point: (p: { x: number; y: number }) => { x: number; y: number },
  widget: { transform: { width: number; height: number } },
  origin = { x: 0, y: 0 },
) {
  const top = Math.max(0, widget.transform.height - 4 - HISTORY_PAGER_HEIGHT)
  const p1 = point({ x: 4, y: top })
  const p2 = point({ x: Math.max(12, widget.transform.width - 4), y: top + HISTORY_PAGER_HEIGHT })
  return {
    x: origin.x + Math.min(p1.x, p2.x),
    y: origin.y + Math.min(p1.y, p2.y),
    w: Math.max(48, Math.abs(p2.x - p1.x)),
    h: Math.max(16, Math.abs(p2.y - p1.y)),
  }
}

/** 筛选条和分页条之间能放下几行。 */
export function historyRowCapacity(widget: {
  props: Record<string, unknown>
  transform: { height: number }
}): number {
  const rowH = Math.max(18, Number(widget.props.rowHeight ?? 28))
  const title = String(widget.props.title ?? '历史报警')
  const top = (title ? 26 : 6) + HISTORY_FILTER_HEIGHT + 4
  const bottom = widget.transform.height - HISTORY_PAGER_HEIGHT - 4
  return Math.max(1, Math.floor((bottom - top) / rowH))
}

/** 按当前页和每页条数截取历史行，并记下总页数供分页条显示。 */
export function alarmHistoryWindow(widgetId: string, total: number, _capacity: number) {
  const query = alarmHistoryQuery(widgetId)
  const size = Math.max(1, Number(query.pageSize) || HISTORY_PAGE_SIZES[0])
  const pageCount = Math.max(1, Math.ceil(total / size))
  let page = Number(query.page) || 1
  if (page > pageCount) page = pageCount
  if (page < 1) page = 1
  if (query.page !== page) query.page = page
  const prev = pageInfo[widgetId]
  if (!prev || prev.page !== page || prev.pages !== pageCount || prev.total !== total || prev.size !== size) {
    pageInfo[widgetId] = { page, pages: pageCount, total, size }
  }
  return { page, pages: pageCount, total, start: (page - 1) * size, size }
}

export function alarmHistoryPageInfo(widgetId: string) {
  return pageInfo[widgetId] ?? { page: 1, pages: 1, total: 0, size: 1 }
}

export function alarmHistoryQuery(widgetId: string): AlarmHistorySearch {
  const existing = queries[widgetId]
  if (existing) return existing
  queries[widgetId] = {
    text: '',
    event: '',
    level: '',
    from: startOfLocalDay(),
    to: endOfLocalDay(),
    page: 1,
    pageSize: HISTORY_PAGE_SIZES[0],
  }
  return queries[widgetId]!
}

const EVENT_LABEL: Record<string, string> = {
  raise: '触发',
  clear: '恢复',
  ack: '确认',
}

const LEVEL_LABEL: Record<string, string> = {
  info: '提示',
  alarm: '报警',
  fault: '故障',
}

function sampleInstant(cols: string[]): number | null {
  const cells = cols.map((col) => col.trim())
  const date = cells.find((col) => /^\d{4}-\d{2}-\d{2}$/.test(col))
  if (!date) return null
  const time = cells.find((col) => /^\d{2}:\d{2}(:\d{2})?$/.test(col))
  const at = Date.parse(`${date}T${time ?? '00:00:00'}`)
  return Number.isFinite(at) ? at : null
}

/** 设计态示例行。按单元格精确匹配事件和级别，文字则包含即可。 */
export function historySampleMatches(cols: string[], widgetId: string): boolean {
  const query = alarmHistoryQuery(widgetId)
  const at = sampleInstant(cols)
  if (at != null) {
    const from = Math.min(query.from, query.to)
    const to = Math.max(query.from, query.to)
    if (at < from || at > to) return false
  }
  const text = query.text.trim().toLowerCase()
  if (text && !cols.join(' ').toLowerCase().includes(text)) return false
  const eventLabel = EVENT_LABEL[query.event]
  if (eventLabel && !cols.includes(eventLabel)) return false
  const levelLabel = LEVEL_LABEL[query.level]
  if (levelLabel && !cols.includes(levelLabel)) return false
  return true
}
