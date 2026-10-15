/**
 * 历史趋势上的报警区间：把窗口内的报警事件配对成 [触发, 恢复] 区间，在曲线上淡红底着色。
 * 数据源是已有的 `GET /api/alarms/events`（与"历史报警"控件同一份），按窗口缓存 30 秒。
 */
import { apiListAlarmEvents } from '@/shared/api/client'

export interface AlarmBand {
  tagId: string
  name: string
  level: string
  from: number
  to: number
}

const bandsByWidget = new Map<string, AlarmBand[]>()
const listeners = new Set<() => void>()
const lastFetch = new Map<string, { key: string; at: number }>()
const inflight = new Set<string>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function trendAlarmBandsOf(widgetId: string): AlarmBand[] {
  return bandsByWidget.get(widgetId) ?? []
}

export function onTrendAlarmBandsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 窗口变化时惰性拉一次；同窗口 30 秒内不重复请求 */
export function ensureTrendAlarmBands(
  widgetId: string,
  tagIds: string[],
  from: number,
  to: number,
): void {
  if (!tagIds.length || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return
  const key = `${Math.round(from)}-${Math.round(to)}-${tagIds.slice().sort().join(',')}`
  const prev = lastFetch.get(widgetId)
  if (prev && prev.key === key && Date.now() - prev.at < 30_000) return
  if (inflight.has(widgetId)) return
  inflight.add(widgetId)
  void (async () => {
    try {
      // apiListAlarmEvents 的 from/to 是 epoch 毫秒（不是 ISO 字符串）
      const res = await apiListAlarmEvents({ from, to, limit: 500 })
      const wanted = new Set(tagIds)
      const open = new Map<string, AlarmBand>()
      const bands: AlarmBand[] = []
      for (const event of res.items ?? []) {
        const tagId = String(event.tagId ?? '')
        if (!wanted.has(tagId)) continue
        const at = Number(event.eventAt)
        if (!Number.isFinite(at)) continue
        const id = String(event.alarmId)
        const kind = String(event.eventKind ?? '')
        if (kind === 'raise') {
          open.set(id, {
            tagId,
            name: String(event.name ?? id),
            level: String(event.level ?? ''),
            from: at,
            to,
          })
        } else if (kind === 'clear') {
          const band = open.get(id)
          if (band) {
            band.to = Math.max(band.from + 1000, at)
            bands.push(band)
            open.delete(id)
          }
        }
      }
      for (const band of open.values()) bands.push(band)
      bandsByWidget.set(widgetId, bands)
      lastFetch.set(widgetId, { key, at: Date.now() })
      emit()
    } catch {
      // 报警事件拿不到就不画区间，不影响曲线
    } finally {
      inflight.delete(widgetId)
    }
  })()
}