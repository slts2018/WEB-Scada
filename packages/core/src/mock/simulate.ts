import type { SimMode, TagMeta, TagSimulation, TagValue } from '../types/tag'

type SimMeta = Pick<TagMeta, 'tagId' | 'dataType' | 'unit' | 'writable' | 'simulation'>

export function defaultSimMode(dataType: TagMeta['dataType']): SimMode {
  if (dataType === 'bool') return 'toggle'
  if (dataType === 'string') return 'cycle'
  return 'walk'
}

export function simModeOptions(dataType: TagMeta['dataType']): Array<{ value: SimMode; label: string }> {
  if (dataType === 'bool') {
    return [
      { value: 'toggle', label: '翻转' },
      { value: 'random', label: '随机' },
    ]
  }
  if (dataType === 'string') {
    return [
      { value: 'cycle', label: '顺序轮换' },
      { value: 'random', label: '随机' },
    ]
  }
  return [
    { value: 'walk', label: '随机游走' },
    { value: 'random', label: '范围内随机' },
    { value: 'ramp', label: '斜坡' },
    { value: 'sine', label: '正弦' },
  ]
}

/** 正弦按时间连续变化，不受「每隔一个周期才跳一次」限制。 */
export function simulationFollowsClock(mode: SimMode | undefined): boolean {
  return mode === 'sine'
}

/** 未保存过模拟配置时的默认参数。服务端 Java 有一份相同规则。 */
export function defaultTagSimulation(meta: SimMeta): TagSimulation {
  const id = meta.tagId || ''
  const percent = meta.unit === '%' || id.includes('level')
  const numeric = meta.dataType === 'int' || meta.dataType === 'float'
  const step =
    meta.dataType === 'int' ? 1 : id.includes('level') || meta.unit === '%' ? 2 : id.includes('pressure') ? 0.4 : 0.8
  const periodSec = meta.dataType === 'bool' ? 5 : meta.dataType === 'string' ? 3 : 1
  return {
    enabled: !meta.writable,
    periodSec,
    min: numeric && percent ? 0 : undefined,
    max: numeric && percent ? 100 : undefined,
    step: numeric ? step : undefined,
    options: meta.dataType === 'string' ? '待机\n运行\n停止' : undefined,
    mode: defaultSimMode(meta.dataType),
  }
}

/** 已保存的配置优先；没存过则用默认。enabled 为 false 时调用方应保持当前值。 */
export function effectiveTagSimulation(meta: SimMeta): TagSimulation {
  const defaults = defaultTagSimulation(meta)
  const saved = meta.simulation
  if (!saved) return defaults
  const period = Number(saved.periodSec)
  return {
    enabled: saved.enabled,
    periodSec: Number.isFinite(period) ? Math.min(3600, Math.max(1, period)) : defaults.periodSec,
    min: saved.min,
    max: saved.max,
    step: saved.step ?? defaults.step,
    options: saved.options?.trim() ? saved.options : defaults.options,
    mode: resolveSimMode(meta.dataType, saved.mode),
  }
}

function resolveSimMode(dataType: TagMeta['dataType'], mode: SimMode | undefined): SimMode {
  const allowed = simModeOptions(dataType).map((item) => item.value)
  if (mode && allowed.includes(mode)) return mode
  return defaultSimMode(dataType)
}

export function simulationSlot(nowMs: number, periodSec: number): number {
  const period = Math.min(3600, Math.max(1, periodSec)) * 1000
  return Math.floor(nowMs / period)
}

/** 调用方应按 simulationSlot 每个周期最多调用一次。 */
export function stepSimulatedValue(
  meta: SimMeta,
  current: TagValue['value'],
  rand: number,
  nowMs = Date.now(),
): TagValue['value'] {
  const sim = effectiveTagSimulation(meta)
  if (!sim.enabled) return current
  const mode = sim.mode ?? defaultSimMode(meta.dataType)
  if (meta.dataType === 'bool') return mode === 'random' ? rand < 0.5 : !toBool(current)
  if (meta.dataType === 'int') return stepNumber(current, sim, rand, nowMs, true)
  if (meta.dataType === 'float') return stepNumber(current, sim, rand, nowMs, false)
  if (meta.dataType === 'string') return stepString(meta.tagId || '', sim, current, rand, nowMs)
  return current
}

function toBool(value: TagValue['value']): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'on'
  }
  return false
}

function clamp(n: number, sim: TagSimulation): number {
  let min = sim.min
  let max = sim.max
  if (min != null && max != null && min > max) {
    const swap = min
    min = max
    max = swap
  }
  if (min != null && n < min) n = min
  if (max != null && n > max) n = max
  return n
}

function bounds(sim: TagSimulation): { min: number; max: number } {
  let min = sim.min ?? 0
  let max = sim.max ?? 100
  if (min > max) {
    const swap = min
    min = max
    max = swap
  }
  return { min, max }
}

function stepNumber(
  current: TagValue['value'],
  sim: TagSimulation,
  rand: number,
  nowMs: number,
  asInt: boolean,
): number {
  const mode = sim.mode ?? 'walk'
  const finish = (n: number) => (asInt ? Math.round(n) : +n.toFixed(1))
  if (mode === 'random') {
    const { min, max } = bounds(sim)
    return finish(min + rand * (max - min))
  }
  if (mode === 'sine') {
    const { min, max } = bounds(sim)
    const mid = (min + max) / 2
    const amp = (max - min) / 2
    const periodMs = Math.max(1, sim.periodSec) * 1000
    const phase = (nowMs % periodMs) / periodMs
    return finish(mid + amp * Math.sin(2 * Math.PI * phase))
  }
  if (mode === 'ramp') {
    const { min, max } = bounds(sim)
    const base = typeof current === 'number' && Number.isFinite(current) ? current : min
    const delta = Math.abs(sim.step ?? 1) || 1
    let next = base + delta
    if (next > max) next = min
    return finish(next)
  }
  return asInt ? stepInt(current, sim, rand) : stepFloat(current, sim, rand)
}

function stepInt(current: TagValue['value'], sim: TagSimulation, rand: number): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0
  const mag = Math.max(1, Math.round(Math.abs(sim.step ?? 1)))
  const delta = Math.max(1, Math.round(rand * mag)) * (rand < 0.5 ? -1 : 1)
  return clamp(Math.round(base) + delta, sim)
}

function stepFloat(current: TagValue['value'], sim: TagSimulation, rand: number): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0
  const amp = Math.abs(sim.step ?? 0.8)
  const next = clamp(base + (rand - 0.5) * 2 * amp, sim)
  return +next.toFixed(1)
}

function stepString(
  tagId: string,
  sim: TagSimulation,
  current: TagValue['value'],
  rand: number,
  nowMs: number,
): string {
  const options = (sim.options || '待机\n运行\n停止')
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!options.length) return typeof current === 'string' ? current : ''
  if (sim.mode === 'random') return options[Math.min(options.length - 1, Math.floor(rand * options.length))]
  const salt = Math.abs(hashTag(tagId)) % options.length
  const slot = Math.floor(nowMs / (Math.max(1, sim.periodSec) * 1000))
  return options[(slot + salt) % options.length]
}

function hashTag(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return h
}
