/**
 * 报警限值线：把变量上配置的 HH/H/L/LL 阈值画到历史曲线上，
 * 一眼看出"越限了没、离限值多远"。
 *
 * 只在有历史趋势图元求值时惰性拉一次报警配置（60 秒缓存），
 * 拿不到配置就不画线 —— 不影响曲线本身。
 */
import { apiListAlarms } from '@/shared/api/client'

export interface AlarmLimit {
  tagId: string
  /** 阈值 */
  value: number
  /** HH / H / L / LL */
  code: string
  /** info / alarm / fault */
  level: string
}

const byTag = new Map<string, AlarmLimit[]>()
const listeners = new Set<() => void>()
const TTL_MS = 60_000
let fetchedAt = 0
let inflight: Promise<void> | null = null

const CODES = new Set(['HH', 'H', 'L', 'LL'])

export function alarmLimitsOf(tagId: string): AlarmLimit[] {
  return byTag.get(tagId) ?? []
}

export function onAlarmLimitsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 惰性拉取并缓存报警配置（运行/预览每次重绘都会调，必须廉价） */
export function ensureAlarmLimits(): void {
  if (inflight || Date.now() - fetchedAt < TTL_MS) return
  inflight = (async () => {
    try {
      const res = await apiListAlarms()
      const next = new Map<string, AlarmLimit[]>()
      for (const cfg of res.items ?? []) {
        if (!cfg || cfg.enabled === false) continue
        if (cfg.kind !== 'limit') continue
        if (typeof cfg.threshold !== 'number' || !Number.isFinite(cfg.threshold)) continue
        const code = String(cfg.limit ?? '')
        if (!CODES.has(code)) continue
        const list = next.get(cfg.tagId) ?? []
        list.push({ tagId: cfg.tagId, value: cfg.threshold, code, level: String(cfg.level ?? '') })
        next.set(cfg.tagId, list)
      }
      byTag.clear()
      for (const [tagId, list] of next) byTag.set(tagId, list)
      fetchedAt = Date.now()
      for (const listener of listeners) listener()
    } catch {
      // 报警配置不可用时保持上一次（或空）；不打断曲线
    } finally {
      inflight = null
    }
  })()
}