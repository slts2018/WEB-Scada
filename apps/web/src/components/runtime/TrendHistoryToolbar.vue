<script setup lang="ts">
/**
 * 历史趋势的工具栏（挂在图元顶部一行）。
 *
 * 为什么是 HTML 叠层：趋势图本身画在 Konva 位图 / ECharts 原生叠层里，
 * 用 Element Plus 的日期选择器比在画布上自绘省事得多；与"历史报警"的搜索条同一套做法
 * （按图元矩形定位，见 trendToolbarClientRect）。
 *
 * 布局（单行，按功能分组；按图元宽度能放几组放几组，放不下的组整组收进「…」）：
 *
 *   间隔 开始 [自动: 结束 + 数字单位 | 原始点: 长度滑条] 搜索 刷新 │ 浏览 ⇤ ⇥ 放大 缩小 表 │ 工具 导出 最大化 快捷键 …
 *
 * 按钮一律只放图标，文字放在 title 里（鼠标悬停显示），省出地方给图表。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, withDefaults } from 'vue'
import {
  Bell,
  DArrowLeft,
  DArrowRight,
  Download,
  FullScreen,
  Memo,
  MoreFilled,
  QuestionFilled,
  Refresh,
  ScaleToOriginal,
  Search,
  ZoomIn,
  ZoomOut,
} from '@element-plus/icons-vue'
import type { TrendValueFormat } from '@web-scada/core'
import {
  onTrendHistoryTableChange,
  setTrendHistoryTableVisible,
  trendHistoryTableVisibleOf,
} from '@/shared/runtime/trendHistoryTable'
import {
  clearTrendHistoryCursor,
  onTrendHistoryCursor,
  setTrendHistoryCursor,
  stepTrendHistoryCursor,
  trendHistoryCursorOf,
} from '@/shared/runtime/trendHistoryCursor'
import { onTrendAlarmBandsChanged, trendAlarmBandsOf, type AlarmBand } from '@/shared/runtime/trendAlarmEvents'
import TrendRangeControl from '@/components/runtime/TrendRangeControl.vue'
import {
  TREND_INTERVALS,
  durationIdFromSpanMs,
  onTrendHistoryLoaded,
  parseTrendDuration,
  rawHistoryMaxSpanMs,
  refreshTrendHistory,
  setTrendHistoryFollow,
  setTrendHistoryInterval,
  setTrendHistoryWindow,
  shortestScanPeriodMs,
  trendPresetSpanMs,
  shiftTrendHistoryWindow,
  trendHistoryExportRows,
  trendHistoryFollowOf,
  trendHistoryIntervalOf,
  trendHistoryNoticeOf,
  trendHistoryQueryingOf,
  trendHistoryStatusOf,
  trendHistoryWindowOf,
  zoomTrendHistoryWindow,
  setTrendToolbarMeasuredHeight,
} from '@/shared/runtime/trendHistoryQuery'
import { useTagStore } from '@/stores/tag'
import {
  forgetTrendToolbar,
  setActiveTrendToolbar,
  shouldHandleTrendKeys,
} from '@/shared/runtime/trendToolbarFocus'
import { tagDisplayFormat } from '@/shared/runtime/tagDisplay'

/** 曲线标识（单位和小数位在变量上，不在这里配） */
export interface TrendToolbarCurve {
  tagId: string
  label?: string
  unit?: string
  decimals?: number
}

const props = withDefaults(defineProps<{
  widgetId: string
  tagIds: string[]
  /** 曲线列表（表头单位从变量读） */
  curves?: TrendToolbarCurve[]
  /** 运行端是否允许改时间区间/缩放/采样间隔（发布端可锁死） */
  allowEdit?: boolean
  /** 工具条实测宽度（px）；缺省时由父级定位框给出 */
  width?: number
  /** 该图元是否正在最大化显示 */
  fullscreen?: boolean
  /** 是否提供"最大化"按钮（3D 面板内的只读面板不提供） */
  fullscreenSupported?: boolean
}>(), {
  fullscreenSupported: true,
})

const rootEl = ref<HTMLDivElement | null>(null)
let rootObserver: ResizeObserver | null = null
let lastRootWidth = 0

function mainBar(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>('.trend-bar.is-main') ?? null
}

function reportBarHeight(): void {
  const h = mainBar()?.offsetHeight ?? 0
  if (h > 0) setTrendToolbarMeasuredHeight(props.widgetId, h)
}

/* ---------- 单行显示：按功能分组，放不下的组从末尾起整组收进「…」 ---------- */

const PLACES = ['bar', 'more'] as const
type Place = (typeof PLACES)[number]
type GroupKey = 'time' | 'nav' | 'tools'

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'nav', label: '浏览' },
  { key: 'tools', label: '工具' },
]

/** 「…」按钮自己要占的宽度（含间距） */
const MORE_BTN_W = 34
/** 与 `.trend-bar { gap }` 一致 */
const GROUP_GAP = 8
/** `.is-main .tb-group + .tb-group` 的 margin-left（竖线分隔，不进 width） */
const GROUP_MARGIN = 6

const showMore = ref(false)
/** 从第几组起收进「…」；Infinity = 全部放在条上 */
const hiddenFrom = ref(Number.POSITIVE_INFINITY)
/**
 * 各组自身宽度缓存。画布缩放只改工具条外框宽，组内按钮尺寸不变，
 * 所以缩放时用缓存同步算，避免「先全部摊开再收」的一帧闪满。
 */
let cachedGroupWs: number[] | null = null

const hasOverflow = computed(() => hiddenFrom.value < GROUPS.length)

function groupInPlace(index: number, place: Place): boolean {
  const hidden = index >= hiddenFrom.value
  return place === 'bar' ? !hidden : hidden
}

/** 前 count 组（可选再加「…」）一共要占多宽 */
function widthOf(count: number, widths: number[], withMore: boolean): number {
  if (count <= 0) return withMore ? MORE_BTN_W : 0
  let sum = 0
  for (let i = 0; i < count; i++) sum += widths[i] ?? 0
  // 组与组之间：flex gap + 后一组的 margin-left
  if (count > 1) sum += (count - 1) * (GROUP_GAP + GROUP_MARGIN)
  if (withMore) sum += GROUP_GAP + MORE_BTN_W
  return sum
}

function pickHiddenFrom(barInnerW: number, widths: number[]): number {
  if (widths.length === 0) return Number.POSITIVE_INFINITY
  if (widthOf(widths.length, widths, false) <= barInnerW) return Number.POSITIVE_INFINITY
  for (let k = widths.length - 1; k >= 0; k--) {
    if (widthOf(k, widths, true) <= barInnerW) return k
  }
  return 0
}

function applyHidden(next: number): void {
  if (next !== hiddenFrom.value) hiddenFrom.value = next
  if (next >= GROUPS.length) showMore.value = false
  reportBarHeight()
}

let layoutSeq = 0

/** 只用缓存按当前条宽立刻决定显示几组（缩放路径，无闪烁） */
function relayoutFromCache(): boolean {
  if (!cachedGroupWs || cachedGroupWs.length !== GROUPS.length) return false
  const bar = mainBar()
  if (!bar) return false
  // clientWidth 已扣掉边框；再扣左右 padding 8+8
  const inner = Math.max(0, bar.clientWidth - 16)
  applyHidden(pickHiddenFrom(inner, cachedGroupWs))
  return true
}

/**
 * 重新量各组宽度。量的时候临时全部摆上，并用 overflow:hidden 挡住，
 * 避免用户看到「一瞬间全挤在条上」。
 */
async function remasure(): Promise<void> {
  const seq = ++layoutSeq
  const bar = mainBar()
  if (!bar) return
  bar.classList.add('is-measuring')
  hiddenFrom.value = Number.POSITIVE_INFINITY
  await nextTick()
  if (seq !== layoutSeq) return
  const groups = Array.from(bar.querySelectorAll<HTMLElement>(':scope > [data-tg]'))
  cachedGroupWs = groups.map((el) => el.getBoundingClientRect().width)
  const inner = Math.max(0, bar.clientWidth - 16)
  applyHidden(pickHiddenFrom(inner, cachedGroupWs))
  await nextTick()
  bar.classList.remove('is-measuring')
  reportBarHeight()
}

/** 宽度变了优先走缓存；内容变了（报警按钮出现等）才重测 */
function relayout(forceMeasure = false): void {
  if (!forceMeasure && relayoutFromCache()) return
  void remasure()
}

function toggleHelp(): void {
  showHelp.value = !showHelp.value
  if (showHelp.value) showMore.value = false
}

/** 点到工具条外面就收起「…」面板 */
function onDocPointerDown(e: PointerEvent): void {
  if (!showMore.value) return
  const target = e.target as Node | null
  if (target && rootEl.value?.contains(target)) return
  showMore.value = false
}
const emit = defineEmits<{ change: []; toggleFullscreen: [] }>()
const querying = ref(false)
const canEdit = () => props.allowEdit !== false && !querying.value

const interval = ref('auto')
/** 与当前窗口跨度吻合的预设；对不上（手改起止、缩放、平移）就空着 */
const pastRange = ref('')
const follow = ref(false)
const aggWindow = ref<string | null>(null)
const notice = ref<{ kind: 'error' | 'empty'; text: string } | null>(null)
/**
 * 起止时间：**两个独立的输入框**（开始 / 结束，各自带日历+时间面板，秒精度）+
 * 一个「搜索」按钮 —— 现场就是"选开始、选结束、查一下"这个习惯（不是组合控件、也不是只能选相对区间）。
 * 自动应用：两个都填好且开始早于结束时，改完就查；「搜索」= 按当前这对起止时间重查一遍。
 */
const fromAt = ref<Date | null>(null)
const toAt = ref<Date | null>(null)
/**
 * 正在编辑哪一个字段（null = 没在编辑）。
 * 规则：只有"正在敲的那个框"不许被覆盖，另一个框始终跟着真实窗口走 ——
 * 否则会出现"开始框还是上一段区间的旧值，结束框是新选的"，
 * 一点下去就把窗口拼成一个莫名其妙的区间（比如开始停在昨天、结束是今天）。
 */
const editingField = ref<'from' | 'to' | null>(null)
const showHelp = ref(false)

/** 原始点可视时长滑条：只改查询条件里这段有多长（短→长），不跳到某一时刻。结束时间保持不动。点「搜索」后才请求。 */
const RAW_SPAN_MIN_MS = 5 * 1000
const tagStore = useTagStore()
/** 图上最短扫描周期 × 1200 点。未知周期按 50ms 估，避免先放出过长窗口再截断。 */
const rawSpanMaxMs = computed(() => {
  const ids = (props.curves?.length ? props.curves.map((curve) => curve.tagId) : props.tagIds) ?? []
  const periods = ids.map((id) => tagStore.metas.find((meta) => meta.tagId === id)?.scanPeriodMs)
  const known = periods.filter((ms) => Number(ms) > 0)
  const densest = known.length ? shortestScanPeriodMs(known) : 50
  return Math.max(RAW_SPAN_MIN_MS, rawHistoryMaxSpanMs(densest))
})
const rawSpanMaxSec = computed(() => Math.max(5, Math.round(rawSpanMaxMs.value / 1000)))
const rawSpanMs = ref(60 * 1000)
/** 间隔 / 开始 / 结束 / 长度 / 数字单位已改、尚未点搜索。为 true 时不同步覆盖草稿（避免滑条弹回上限）。 */
const draftDirty = ref(false)

function clampRawSpan(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return RAW_SPAN_MIN_MS
  return Math.max(RAW_SPAN_MIN_MS, Math.min(rawSpanMaxMs.value, Math.round(ms)))
}

function formatRawSpan(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  if (sec < 60) return `${sec} 秒`
  if (sec % 60 === 0) return `${sec / 60} 分钟`
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
}

function draftEndMs(): number {
  const t = toAt.value?.getTime()
  if (Number.isFinite(t)) return t as number
  return trendHistoryWindowOf(props.widgetId)?.to ?? Date.now()
}

/** 拖动过程中立刻改长度数字和旁边的时长文字 / 气泡，不改开始/结束日期框（每帧改 DatePicker 会卡顿），也不发查询。 */
function onRawSpanInput(v: number | number[]): void {
  const span = clampRawSpan(Number(Array.isArray(v) ? v[0] : v) * 1000)
  if (rawSpanMs.value !== span) rawSpanMs.value = span
  draftDirty.value = true
}

/** 滑条当前草稿长度，拖动时跟手，给旁边标签用。 */
const rawSpanLabel = computed(() => formatRawSpan(rawSpanMs.value))
const rawSpanSec = computed(() => Math.round(rawSpanMs.value / 1000))

function formatRawSpanTooltip(v: number): string {
  return formatRawSpan(Number(v) * 1000)
}

watch(rawSpanMaxMs, (maxMs) => {
  if (rawSpanMs.value > maxMs) rawSpanMs.value = maxMs
})

/** 松手后再回填开始时间（结束不动）。不发查询。 */
function setDraftRawSpan(ms: number): void {
  const span = clampRawSpan(Number(ms))
  rawSpanMs.value = span
  const to = draftEndMs()
  fromAt.value = new Date(to - span)
  toAt.value = new Date(to)
  draftDirty.value = true
}

function syncRawSpan(): void {
  if (draftDirty.value) return
  const win = trendHistoryWindowOf(props.widgetId)
  if (!win) return
  const next = clampRawSpan(win.to - win.from)
  if (rawSpanMs.value !== next) rawSpanMs.value = next
}

/* ---------- 曲线显示格式：读变量上的单位 / 小数位 ---------- */

const formatOf = computed(() => {
  const map = new Map<string, TrendValueFormat>()
  const ids = props.curves?.length ? props.curves.map((curve) => curve.tagId) : props.tagIds
  for (const tagId of ids) {
    if (!tagId) continue
    map.set(tagId, tagDisplayFormat(tagId))
  }
  return map
})

/** 点表表头：变量名后补上单位，现场看表不用猜量纲 */
function headerOf(tagId: string): string {
  const unit = formatOf.value.get(tagId)?.unit?.trim()
  return unit ? `${tagId} (${unit})` : tagId
}

/* ---------- 点表（图下方弹出的数据表，与游标联动） ---------- */

const showTable = ref(trendHistoryTableVisibleOf(props.widgetId))

function toggleTable(): void {
  showTable.value = !showTable.value
  setTrendHistoryTableVisible(props.widgetId, showTable.value)
  after()
}

const alarmBands = ref<AlarmBand[]>([])

/** 点"报警 N"把游标跳到第一条报警时刻（与历史报警表对照时最常用） */
function jumpToFirstAlarm(): void {
  const first = alarmBands.value[0]
  if (!first) return
  setTrendHistoryCursor(props.widgetId, first.from)
  after()
}

function syncAlarms(): void {
  alarmBands.value = trendAlarmBandsOf(props.widgetId)
}

const cursorAt = ref<number | null>(null)


/**
 * 起止时间框 ↔ 真实窗口：面板表头和两个输入框都按当前窗口刷新。
 * 正在编辑的那个框除外（别打断手输），编辑一结束（失焦）就回到真实值。
 */
function syncRangeFields(): void {
  if (draftDirty.value) return
  const win = trendHistoryWindowOf(props.widgetId)
  if (!win) return
  if (editingField.value !== 'from' && fromAt.value?.getTime() !== win.from) {
    fromAt.value = new Date(win.from)
  }
  if (editingField.value !== 'to' && toAt.value?.getTime() !== win.to) {
    toAt.value = new Date(win.to)
  }
}

function beginEditField(which: 'from' | 'to'): void {
  editingField.value = which
}

function endEditField(): void {
  editingField.value = null
  // 已改但还没点搜索：不要把开始/结束拉回已查询窗口（否则像滑条一样被弹回去）
  if (!draftDirty.value) syncRangeFields()
}

/**
 * 游标状态同步。游标读数不在工具条上重复显示：
 * 值看点表里那一行，时间看图上竖线。
 */
function syncCursor(): void {
  cursorAt.value = trendHistoryCursorOf(props.widgetId)
}

function stepCursor(dir: -1 | 1): void {
  stepTrendHistoryCursor(props.widgetId, dir, props.tagIds)
  after()
}

function clearCursor(): void {
  clearTrendHistoryCursor(props.widgetId)
  after()
}

/** 窗口长度能整除某个单位时，回填数字+单位；对不齐（手改起止、缩放）仍尽量按秒显示 */
function matchPastRange(from: number, to: number): string {
  const span = to - from
  if (!Number.isFinite(span) || span <= 0) return ''
  return durationIdFromSpanMs(span)
}

function syncPastRange(): void {
  if (draftDirty.value) return
  const win = trendHistoryWindowOf(props.widgetId)
  const next = win ? matchPastRange(win.from, win.to) : ''
  if (pastRange.value !== next) pastRange.value = next
}

function syncPastRangeFromDraft(): void {
  const f = fromAt.value?.getTime()
  const t = toAt.value?.getTime()
  const next = Number.isFinite(f) && Number.isFinite(t) ? matchPastRange(f as number, t as number) : ''
  if (pastRange.value !== next) pastRange.value = next
}

function sync(): void {
  follow.value = trendHistoryFollowOf(props.widgetId)
  notice.value = trendHistoryNoticeOf(props.widgetId)
  aggWindow.value = trendHistoryStatusOf(props.widgetId)?.aggWindow ?? null
  querying.value = trendHistoryQueryingOf(props.widgetId)
  if (!draftDirty.value) {
    interval.value = trendHistoryIntervalOf(props.widgetId)
    syncRangeFields()
    syncPastRange()
    syncRawSpan()
  }
  syncCursor()
  syncAlarms()
}

/** 键盘：←/→ 微调游标、+/- 缩放、Esc 清游标（输入框里不抢键） */
function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}

function onKeydown(e: KeyboardEvent): void {
  if (isTextTarget(e.target)) return
  const hasCursor = cursorAt.value != null
  if (!shouldHandleTrendKeys(props.widgetId, hasCursor)) return
  if (e.key === 'ArrowLeft') {
    if (!hasCursor) return
    stepCursor(-1)
    e.preventDefault()
  } else if (e.key === 'ArrowRight') {
    if (!hasCursor) return
    stepCursor(1)
    e.preventDefault()
  } else if (e.key === '+' || e.key === '=') {
    // 以游标为中心放大（没有游标时以窗口中心）
    if (!canEdit()) return
    zoom(0.5)
    e.preventDefault()
  } else if (e.key === '-' || e.key === '_') {
    if (!canEdit()) return
    zoom(2)
    e.preventDefault()
  } else if (e.key === 'Escape') {
    if (showHelp.value || showMore.value) {
      showHelp.value = false
      showMore.value = false
      return
    }
    if (hasCursor) clearCursor()
    else if (props.fullscreen) emit('toggleFullscreen')
  } else if (e.key === '?') {
    showHelp.value = !showHelp.value
  }
}

/** 鼠标进工具条 / 在工具条上操作 = "这个图元接着键盘" */
function markActive(): void {
  setActiveTrendToolbar(props.widgetId)
}

let offLoaded: (() => void) | null = null
let offCursor: (() => void) | null = null
let offAlarms: (() => void) | null = null
let offTable: (() => void) | null = null
onMounted(() => {
  sync()
  offLoaded = onTrendHistoryLoaded(sync)
  offCursor = onTrendHistoryCursor(sync)
  offAlarms = onTrendAlarmBandsChanged(syncAlarms)
  offTable = onTrendHistoryTableChange(() => {
    showTable.value = trendHistoryTableVisibleOf(props.widgetId)
  })
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  relayout(true)
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    rootObserver = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0 && w !== lastRootWidth) {
        lastRootWidth = w
        // 画布缩放只改外框宽：走宽度缓存，同步收起，不闪一整排按钮
        relayout()
      } else {
        reportBarHeight()
      }
    })
    rootObserver.observe(rootEl.value)
  }
})
onBeforeUnmount(() => {
  offLoaded?.()
  offLoaded = null
  offCursor?.()
  offCursor = null
  offAlarms?.()
  offAlarms = null
  offTable?.()
  offTable = null
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  rootObserver?.disconnect()
  rootObserver = null
  forgetTrendToolbar(props.widgetId)
})

watch(
  () => props.tagIds.join(','),
  () => syncCursor(),
)

watch(
  () => `${alarmBands.value.length > 0}|${props.fullscreenSupported !== false}`,
  () => {
    cachedGroupWs = null
    relayout(true)
  },
)

function after(): void {
  emit('change')
}

/** 数字+单位只改草稿：结束取现在，开始往前推这段。点「搜索」后才请求。 */
function applyPast(id: string): void {
  if (!parseTrendDuration(id)) return
  const to = Date.now()
  const from = to - trendPresetSpanMs(id)
  if (from >= to) return
  fromAt.value = new Date(from)
  toAt.value = new Date(to)
  pastRange.value = id
  rawSpanMs.value = clampRawSpan(to - from)
  draftDirty.value = true
}

/** 开始时间草稿。原始点模式保持长度，结束 = 开始 + 长度。不发查询。 */
function onDraftFromChange(): void {
  draftDirty.value = true
  const from = fromAt.value?.getTime()
  if (!Number.isFinite(from)) return
  if (interval.value === 'raw') {
    const span = clampRawSpan(rawSpanMs.value)
    toAt.value = new Date((from as number) + span)
  } else {
    syncPastRangeFromDraft()
  }
}

/** 结束时间草稿（仅自动模式可见）。不发查询。 */
function onDraftToChange(): void {
  draftDirty.value = true
  syncPastRangeFromDraft()
}

/**
 * 点「搜索」：把间隔 / 开始 / 结束或长度草稿一次性交给查询。
 * 原始点：结束保持草稿右端（默认是当前窗口右端），开始 = 结束 - 长度。
 */
function searchDraft(): void {
  let to = toAt.value?.getTime()
  let from = fromAt.value?.getTime()
  if (interval.value === 'raw') {
    const span = clampRawSpan(rawSpanMs.value)
    rawSpanMs.value = span
    to = Number.isFinite(to) ? (to as number) : draftEndMs()
    from = (to as number) - span
    fromAt.value = new Date(from)
    toAt.value = new Date(to as number)
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || (to as number) <= (from as number)) return
  const nextInterval = interval.value
  setTrendHistoryInterval(props.widgetId, nextInterval)
  setTrendHistoryFollow(props.widgetId, false)
  setTrendHistoryWindow(props.widgetId, from as number, to as number)
  refreshTrendHistory(props.widgetId)
  interval.value = nextInterval
  draftDirty.value = false
  after()
}

function shift(dir: -1 | 1): void {
  shiftTrendHistoryWindow(props.widgetId, dir)
  after()
}

function zoom(factor: number): void {
  zoomTrendHistoryWindow(props.widgetId, factor, cursorAt.value ?? undefined)
  after()
}

function isRawInterval(): boolean {
  return interval.value === 'raw'
}

/**
 * 只改草稿间隔，不发查询。点「搜索」后才按条上当前间隔请求。
 * draftDirty=true，避免 emitLoaded → sync() 把下拉框弹回 store 里尚未提交的旧间隔（查完原始点再选「自动」时尤其如此）。
 * 切到原始点：跨度超过滑条上限时按上限收、结束不动，不悄悄截断已查窗口。
 * 切到自动 / 固定聚合：数字+单位与当前起止对齐，立刻换成开始/结束+数字单位布局。
 */
function applyInterval(): void {
  draftDirty.value = true
  if (interval.value === 'raw') {
    const to = draftEndMs()
    const from = fromAt.value?.getTime()
    const span = clampRawSpan(Number.isFinite(from) ? (to - (from as number)) : rawSpanMs.value)
    rawSpanMs.value = span
    toAt.value = new Date(to)
    fromAt.value = new Date(to - span)
    return
  }
  syncPastRangeFromDraft()
}

function refresh(): void {
  refreshTrendHistory(props.widgetId)
  after()
}

/** 导出当前窗口的点表：加 UTF-8 BOM，Excel 打开才不会乱码 */
function exportCsv(): void {
  const rows = trendHistoryExportRows(props.widgetId)
  if (!rows || !rows.times.length) {
    return
  }
  const head = ['time', ...rows.tagIds.map((tagId) => headerOf(tagId))].join(',')
  const body = rows.times.map((t, i) => {
    const cells = rows.tagIds.map((_, k) => {
      const v = rows.values[k]?.[i]
      return v == null ? '' : String(v)
    })
    return [new Date(t).toISOString(), ...cells].join(',')
  })
  const csv = '\ufeff' + [head, ...body].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `trend_${props.widgetId}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const SHORTCUTS: Array<{ key: string; text: string }> = [
  { key: '间隔', text: '自动 / 原始点 / 固定聚合只改查询条件并切换条上控件，点「搜索」后才请求；下拉框保持所选草稿，不会弹回上一笔' },
  { key: '开始/结束', text: '起止时间各自一个输入框（秒精度）。只改查询条件，点「搜索」后才请求' },
  { key: '过去', text: '按现在往前准备一段：填数字并选秒 / 分钟 / 小时 / 天，点「搜索」后才请求' },
  { key: '长度', text: '间隔为「原始点」时出现：只改这段能看多长（短→长），最长 = 本图最短扫描周期 × 1200 点（50ms 约 1 分钟）；结束时间保持当前窗口右端；拖动时旁边时长立刻更新，点「搜索」后才请求，滑块保持所停位置' },
  { key: '← / →', text: '游标按采样点前后移动' },
  { key: '+ / -', text: '以游标为中心放大 / 缩小时间窗' },
  { key: 'Esc', text: '清除游标（最大化时退出最大化）' },
  { key: '单击图内', text: '落游标（吸附最近的采样点）' },
  { key: '拖动竖线', text: '移动游标，读数实时更新' },
  { key: '滚轮 / 框选', text: '缩放时间窗；双击还原' },
]
</script>

<template>
  <div ref="rootEl" class="trend-toolbar" :class="{ 'is-querying': querying }" :aria-busy="querying ? 'true' : undefined" @pointerenter="markActive">
    <!-- 同一套控件渲染两份：条上放得下的显示在条上，放不下的显示在「…」弹出面板里 -->
    <template v-for="place in PLACES" :key="place">
      <div
        v-if="place === 'bar' || (showMore && hasOverflow)"
        class="trend-bar"
        :class="place === 'bar' ? 'is-main' : 'more-panel'"
        @pointerdown.stop
        @mousedown.stop
        @click.stop="markActive"
        @dblclick.stop
        @wheel.stop
      >
        <!-- 时间：间隔在最左；自动 = 开始/结束 + 数字单位；原始点 = 开始 + 长度滑条 -->
        <span v-show="groupInPlace(0, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[0].label }}</span>
          <span class="tb-item">
            <span class="time-label">间隔</span>
            <el-select
              v-model="interval"
              size="small"
              class="w-interval"
              :teleported="false"
              :disabled="!canEdit()"
              title="自动按跨度聚合；原始点按真实记录取，并用长度滑条决定能看多长。改间隔只换查询条件和条上控件，点搜索后才请求"
              @change="applyInterval"
            >
              <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
            </el-select>
          </span>
          <span class="tb-item">
            <span class="time-label">开始</span>
            <el-date-picker
              v-model="fromAt"
              type="datetime"
              size="small"
              class="w-datetime"
              format="MM-DD HH:mm:ss"
              placeholder="开始时间"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @focus="beginEditField('from')"
              @blur="endEditField"
              @change="onDraftFromChange"
            />
          </span>
          <span v-if="!isRawInterval()" class="tb-item">
            <span class="time-label">结束</span>
            <el-date-picker
              v-model="toAt"
              type="datetime"
              size="small"
              class="w-datetime"
              format="MM-DD HH:mm:ss"
              placeholder="结束时间"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @focus="beginEditField('to')"
              @blur="endEditField"
              @change="onDraftToChange"
            />
          </span>
          <TrendRangeControl
            v-if="!isRawInterval()"
            class="w-past"
            compact
            :model-value="pastRange || '-1h'"
            :disabled="!canEdit()"
            @update:model-value="applyPast"
          />
          <span v-if="isRawInterval()" class="tb-item">
            <span class="time-label">长度</span>
            <el-slider
              class="w-raw-span"
              size="small"
              :min="5"
              :max="rawSpanMaxSec"
              :step="5"
              :show-tooltip="true"
              :format-tooltip="formatRawSpanTooltip"
              :model-value="rawSpanSec"
              :disabled="!canEdit()"
              title="只改查询条件里这段能看多长（短→长），最长为最短扫描周期 × 1200 点。结束时间保持当前窗口右端。点搜索后才查询，滑块不会被弹回上限。拖动时时长立刻更新"
              @input="onRawSpanInput"
              @update:model-value="onRawSpanInput"
              @change="(v: number | number[]) => setDraftRawSpan(Number(Array.isArray(v) ? v[0] : v) * 1000)"
            />
            <span class="raw-span-value" :title="'草稿长度 ' + rawSpanLabel">{{ rawSpanLabel }}</span>
          </span>
          <el-button
            size="small"
            :icon="Search"
            :disabled="!canEdit()"
            :loading="querying"
            title="搜索：按当前条件查询"
            @click="searchDraft"
          />
          <el-button
            size="small"
            :icon="Refresh"
            :disabled="!canEdit()"
            :title="follow ? '刷新：重新查询当前窗口' : '刷新：重新查询（回到最新）'"
            @click="refresh"
          />
        </span>

        <!-- 浏览：前移后移 / 放大缩小 / 点表 -->
        <span v-show="groupInPlace(1, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[1].label }}</span>
          <el-button-group>
            <el-button
              size="small"
              :icon="DArrowLeft"
              :disabled="!canEdit()"
              title="前移一个窗口"
              @click="shift(-1)"
            />
            <el-button
              size="small"
              :icon="DArrowRight"
              :disabled="!canEdit()"
              title="后移一个窗口"
              @click="shift(1)"
            />
          </el-button-group>
          <el-button size="small" :icon="ZoomIn" :disabled="!canEdit()" title="放大：缩小时间跨度（看得更细）" @click="zoom(0.5)" />
          <el-button size="small" :icon="ZoomOut" :disabled="!canEdit()" title="缩小：放大时间跨度（看得更久）" @click="zoom(2)" />
          <el-button
            size="small"
            :type="showTable ? 'primary' : 'default'"
            :icon="Memo"
            title="点表：图下数据表（与游标联动、可导出）"
            @click="toggleTable"
          />
        </span>

        <!-- 工具：导出 / 报警 / 最大化 / 快捷键 -->
        <span v-show="groupInPlace(2, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[2].label }}</span>
          <el-button size="small" :icon="Download" title="导出 CSV" @click="exportCsv" />
          <el-button
            v-if="alarmBands.length"
            size="small"
            type="danger"
            plain
            :icon="Bell"
            :title="`跳到报警（共 ${alarmBands.length} 处）`"
            @click="jumpToFirstAlarm"
          />
          <el-button
            v-if="fullscreenSupported !== false"
            size="small"
            :icon="fullscreen ? ScaleToOriginal : FullScreen"
            :title="fullscreen ? '还原' : '最大化'"
            @click="emit('toggleFullscreen')"
          />
          <el-button
            size="small"
            :icon="QuestionFilled"
            :type="showHelp ? 'primary' : 'default'"
            title="快捷键"
            @click="toggleHelp"
          />
        </span>

        <template v-if="place === 'bar'">
          <el-button
            v-if="hasOverflow"
            size="small"
            class="more-btn"
            :icon="MoreFilled"
            :type="showMore ? 'primary' : 'default'"
            title="更多"
            @click="showMore = !showMore"
          />
          <span v-if="querying" class="hint is-querying">查询中</span>
          <span v-if="notice" class="notice" :class="notice.kind">{{ notice.text }}</span>
          <span v-if="aggWindow && interval === 'auto'" class="hint">按 {{ aggWindow }} 平均</span>
        </template>
      </div>
    </template>

    <!-- 快捷键提示：从「⋯」或按 ? 打开，Esc 关闭 -->
    <div v-if="showHelp" class="shortcuts" @pointerdown.stop @wheel.stop>
      <div class="shortcuts-head">
        <span>快捷键 / 鼠标操作</span>
        <el-button size="small" text @click="showHelp = false">✕</el-button>
      </div>
      <div v-for="item in SHORTCUTS" :key="item.key" class="shortcuts-row">
        <kbd>{{ item.key }}</kbd>
        <span>{{ item.text }}</span>
      </div>
    </div>

  </div>
</template>

<style scoped>
.trend-toolbar {
  position: relative;
  width: 100%;
  height: auto;
  background: #0b1220;
}

.trend-bar {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: auto;
  box-sizing: border-box;
  padding: 4px 8px;
  overflow: visible;
  pointer-events: auto;
  background: #0b1220;
  border-bottom: 1px solid #1e293b;
}
/* 重测各组宽度时临时挡住溢出，避免「先全展开再收」被看见 */
.trend-bar.is-measuring {
  overflow: hidden;
}
/* 「…」弹出面板：贴在工具条下方右侧，收进来的组一组一行 */
.trend-bar.more-panel {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 5;
  width: auto;
  max-width: 100%;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(11, 18, 32, 0.97);
  border: 1px solid #1e3a5f;
  border-top: none;
  border-radius: 0 0 4px 4px;
}
.tb-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
/* 条上组与组之间的竖线 */
.is-main .tb-group + .tb-group {
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid #24344f;
}
.more-panel .tb-group {
  flex-wrap: wrap;
}
.group-label {
  flex: 0 0 auto;
  width: 28px;
  color: #64748b;
  font-size: 11px;
}
.tb-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.more-btn {
  flex: 0 0 auto;
}
.trend-bar :deep(.el-input__wrapper),
.trend-bar :deep(.el-range-editor),
.trend-bar :deep(.el-select__wrapper),
.trend-bar :deep(.el-input-number .el-input__wrapper) {
  --el-input-bg-color: #1e293b;
  --el-input-text-color: #e2e8f0;
  --el-input-border-color: #4b5d78;
  --el-input-hover-border-color: #64748b;
  --el-input-focus-border-color: #7aa2d4;
  --el-fill-color-blank: #1e293b;
  background-color: #1e293b !important;
  box-shadow: 0 0 0 1px #4b5d78 inset;
  height: 22px;
  min-height: 22px;
  font-size: 12px;
}
.trend-bar :deep(.el-select__wrapper) {
  padding-top: 0;
  padding-bottom: 0;
}
.trend-bar :deep(.el-select__placeholder),
.trend-bar :deep(.el-select__selected-item),
.trend-bar :deep(.el-select__input) {
  color: #e2e8f0;
}
.trend-bar :deep(.el-input__inner),
.trend-bar :deep(.el-range-input) {
  color: #e2e8f0;
  font-size: 12px;
}
.trend-bar.is-main :deep(.el-button:not(.el-button--primary):not(.el-button--danger)),
.trend-bar.more-panel :deep(.el-button:not(.el-button--primary):not(.el-button--danger)) {
  --el-button-bg-color: #1e293b;
  --el-button-hover-bg-color: #334155;
  --el-button-active-bg-color: #0f172a;
  --el-button-border-color: #4b5d78;
  --el-button-hover-border-color: #64748b;
  --el-button-text-color: #e8eef7;
  --el-button-hover-text-color: #ffffff;
  --el-button-icon-color: #e8eef7;
  background-color: #1e293b;
  border-color: #4b5d78;
  color: #e8eef7;
}
.trend-bar :deep(.el-button:not(.el-button--primary):not(.el-button--danger) .el-icon),
.trend-bar :deep(.el-button:not(.el-button--primary):not(.el-button--danger) svg) {
  color: #e8eef7;
}
.trend-bar :deep(.el-button) {
  flex: 0 0 auto;
}
.trend-bar :deep(.el-button + .el-button) {
  margin-left: 0;
}
/* MM-DD HH:mm:ss 刚好放得下；日历图标去掉省宽度，点输入框照样弹出日历 */
.trend-bar :deep(.w-datetime) {
  --el-date-editor-width: 108px;
  width: 108px;
  flex: 0 0 auto;
}
.trend-bar :deep(.w-datetime .el-input__prefix) {
  display: none;
}
.trend-bar :deep(.w-datetime .el-input__wrapper) {
  padding: 0 6px;
}
.time-label {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
}
.trend-bar :deep(.w-raw-span) {
  width: 132px;
  flex: 0 0 auto;
  margin: 0 4px;
}
.raw-span-value {
  flex: 0 0 auto;
  min-width: 4.8em;
  color: #e2e8f0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.trend-bar :deep(.w-interval) {
  width: 72px;
  flex: 0 0 auto;
}
.trend-bar :deep(.w-past) {
  width: auto;
  flex: 0 0 auto;
}
/* 快捷键提示面板：贴在图元左上角，不抢图内的鼠标 */
.shortcuts {
  position: absolute;
  left: 0;
  top: 100%;
  z-index: 4;
  min-width: 220px;
  padding: 6px 8px 8px;
  background: rgba(11, 18, 32, 0.97);
  border: 1px solid #1e3a5f;
  border-top: none;
  border-radius: 0 0 4px 4px;
  font-size: 11px;
  color: #cbd5e1;
  pointer-events: auto;
}
.shortcuts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  color: #93c5fd;
}
.shortcuts-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 6px;
  padding: 1px 0;
}
.shortcuts-row kbd {
  font-family: ui-monospace, Consolas, monospace;
  color: #e2e8f0;
  background: #16223a;
  border: 1px solid #24344f;
  border-radius: 3px;
  padding: 0 4px;
  text-align: center;
}

.hint {
  /* 位置不够时先压提示文字，别把按钮挤出图元 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hint.is-querying {
  flex: 0 0 auto;
  color: #fbbf24;
  font-weight: 600;
}
.notice {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notice.error {
  color: #fca5a5;
}
.notice.empty {
  color: #fcd34d;
}
</style>
