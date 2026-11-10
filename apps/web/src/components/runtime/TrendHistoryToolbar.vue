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
 *   时间 开始 结束 过去 搜索 刷新 │ 浏览 ⇤ ⇥ 放大 缩小 表 │ 定位 时刻 间隔 │ 工具 导出 最大化 快捷键 …
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
import { ElMessage } from 'element-plus'
import {
  clearTrendHistoryCursor,
  onTrendHistoryCursor,
  setTrendHistoryCursor,
  stepTrendHistoryCursor,
  trendHistoryCursorOf,
} from '@/shared/runtime/trendHistoryCursor'
import { onTrendAlarmBandsChanged, trendAlarmBandsOf, type AlarmBand } from '@/shared/runtime/trendAlarmEvents'
import {
  TREND_INTERVALS,
  TREND_PAST_RANGES,
  onTrendHistoryLoaded,
  refreshTrendHistory,
  setTrendHistoryFollow,
  setTrendHistoryInterval,
  setTrendHistoryWindow,
  trendPresetSpanMs,
  shiftTrendHistoryWindow,
  trendHistoryExportRows,
  trendHistoryFollowOf,
  trendHistoryIntervalOf,
  trendHistoryNoticeOf,
  trendHistoryStatusOf,
  trendHistoryWindowOf,
  zoomTrendHistoryWindow,
  setTrendToolbarMeasuredHeight,
} from '@/shared/runtime/trendHistoryQuery'
import { jumpTrendHistoryWidgetToTime } from '@/shared/runtime/trendHistoryLink'
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
type GroupKey = 'time' | 'nav' | 'locate' | 'tools'

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'nav', label: '浏览' },
  { key: 'locate', label: '定位' },
  { key: 'tools', label: '工具' },
]

/** 「…」按钮自己要占的宽度（含间距） */
const MORE_BTN_W = 34
/** 与 `.trend-bar { gap }` 一致 */
const GROUP_GAP = 4
/** `.is-main .tb-group + .tb-group` 的 margin-left（竖线分隔，不进 width） */
const GROUP_MARGIN = 3

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
  // clientWidth 已扣掉边框；再扣左右 padding 4+4
  const inner = Math.max(0, bar.clientWidth - 8)
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
  const inner = Math.max(0, bar.clientWidth - 8)
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
const canEdit = () => props.allowEdit !== false

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
/**
 * 「时刻」：手动选/输**一个时间点**（秒精度），游标跳过去。
 * 它跟着游标走：图内点一下 / ◀▶ 微调也会同步显示，但改成别的时刻就等于"我要看这一刻"。
 */
const jumpAt = ref<Date | null>(null)
const showHelp = ref(false)

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
  // 手输/选了但没成交（或成交后窗口又变了）时，把框拉回真实窗口
  syncRangeFields()
}

/**
 * 游标状态同步。游标读数不在工具条上重复显示：
 * 值看点表里那一行，时间看图上竖线和「时刻」框。
 */
function syncCursor(): void {
  const at = trendHistoryCursorOf(props.widgetId)
  cursorAt.value = at
  // 「时刻」控件跟着游标（游标没变时不回写，避免打断正在手输的用户）
  if (at == null) {
    if (jumpAt.value) jumpAt.value = null
  } else if (jumpAt.value?.getTime() !== at) {
    jumpAt.value = new Date(at)
  }
}

function stepCursor(dir: -1 | 1): void {
  stepTrendHistoryCursor(props.widgetId, dir, props.tagIds)
  after()
}

/** 手动跳到某个时刻（可手输）：见 jumpTrendHistoryWidgetToTime 的注释 */
function jumpToTime(value: Date | string | number | null): void {
  const at =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Date.parse(value.replace(/-/g, '/'))
          : Number.NaN
  if (!Number.isFinite(at) || at <= 0) return
  jumpTrendHistoryWidgetToTime(props.widgetId, at)
  markActive()
  after()
}

function clearCursor(): void {
  clearTrendHistoryCursor(props.widgetId)
  after()
}

/** 窗口长度正好是某个预设时，下拉框显示该项；否则留空，避免标着「最近1小时」实际却不是 */
function matchPastRange(from: number, to: number): string {
  const span = to - from
  if (!Number.isFinite(span) || span <= 0) return ''
  for (const item of TREND_PAST_RANGES) {
    if (Math.abs(span - trendPresetSpanMs(item.id)) < 2000) return item.id
  }
  return ''
}

function syncPastRange(): void {
  const win = trendHistoryWindowOf(props.widgetId)
  const next = win ? matchPastRange(win.from, win.to) : ''
  if (pastRange.value !== next) pastRange.value = next
}

function sync(): void {
  interval.value = trendHistoryIntervalOf(props.widgetId)
  follow.value = trendHistoryFollowOf(props.widgetId)
  notice.value = trendHistoryNoticeOf(props.widgetId)
  aggWindow.value = trendHistoryStatusOf(props.widgetId)?.aggWindow ?? null
  syncRangeFields()
  syncPastRange()
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

/**
 * 按"开始 ~ 结束"查询。
 * search=true（点「搜索」或回车）= 这一对起止时间重查一遍；否则是改完自动应用。
 * 起止时间是用户明确指定的绝对区间 → 先关跟随，刷新时也保持这一段（不跳回最新）。
 */
/** 按「过去一段时间」查询：结束时间取现在，开始时间往前推这段，并关掉跟随 */
function applyPast(id: string): void {
  if (!TREND_PAST_RANGES.some((item) => item.id === id)) return
  const to = Date.now()
  const from = to - trendPresetSpanMs(id)
  setTrendHistoryFollow(props.widgetId, false)
  setTrendHistoryWindow(props.widgetId, from, to)
  refreshTrendHistory(props.widgetId)
  after()
}

function applyRange(search = false): void {
  const f = fromAt.value?.getTime()
  const t = toAt.value?.getTime()
  if (!Number.isFinite(f) || !Number.isFinite(t) || (t as number) <= (f as number)) {
    ElMessage.warning('开始时间要早于结束时间')
    return
  }
  setTrendHistoryFollow(props.widgetId, false)
  setTrendHistoryWindow(props.widgetId, f as number, t as number)
  if (search) refreshTrendHistory(props.widgetId)
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

function applyInterval(): void {
  setTrendHistoryInterval(props.widgetId, interval.value)
  after()
}

function refresh(): void {
  refreshTrendHistory(props.widgetId)
  after()
}

/** 导出当前窗口的点表：加 UTF-8 BOM，Excel 打开才不会乱码 */
function exportCsv(): void {
  const rows = trendHistoryExportRows(props.widgetId)
  if (!rows || !rows.times.length) {
    ElMessage.warning('当前区间没有历史数据可导出')
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
  { key: '开始/结束', text: '起止时间各自一个输入框（秒精度）→ 改完自动查，或点「搜索」重查一遍' },
  { key: '过去', text: '按现在往前查一段（5–30 分钟、1–3 小时，或 1 / 3 / 5 / 7 / 15 / 30 天）' },
  { key: '时刻', text: '看某一个瞬间 → 游标跳过去（不在起止区间里会自动把窗口挪过去）' },
  { key: '← / →', text: '游标按采样点前后移动' },
  { key: '+ / -', text: '以游标为中心放大 / 缩小时间窗' },
  { key: 'Esc', text: '清除游标（最大化时退出最大化）' },
  { key: '单击图内', text: '落游标（吸附最近的采样点）' },
  { key: '拖动竖线', text: '移动游标，读数实时更新' },
  { key: '滚轮 / 框选', text: '缩放时间窗；双击还原' },
]
</script>

<template>
  <div ref="rootEl" class="trend-toolbar" @pointerenter="markActive">
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
        <!-- 时间：起止 + 搜索 / 刷新 -->
        <span v-show="groupInPlace(0, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[0].label }}</span>
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
              @change="applyRange()"
            />
          </span>
          <span class="tb-item">
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
              @change="applyRange()"
            />
          </span>
          <el-select
            v-model="pastRange"
            size="small"
            class="w-past"
            placeholder="过去"
            :teleported="false"
            :disabled="!canEdit()"
            title="查询过去一段时间（结束时间为现在）"
            @change="applyPast"
          >
            <el-option v-for="item in TREND_PAST_RANGES" :key="item.id" :label="item.label" :value="item.id" />
          </el-select>
          <el-button
            size="small"
            :icon="Search"
            :disabled="!canEdit()"
            title="搜索：按这对起止时间查询"
            @click="applyRange(true)"
          />
          <el-button
            size="small"
            :icon="Refresh"
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

        <!-- 定位：跳到某一刻 / 聚合间隔 -->
        <span v-show="groupInPlace(2, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[2].label }}</span>
          <span class="tb-item">
            <span class="time-label">时刻</span>
            <el-date-picker
              v-model="jumpAt"
              type="datetime"
              size="small"
              class="w-datetime"
              format="MM-DD HH:mm:ss"
              placeholder="跳到某一刻"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @change="jumpToTime"
            />
          </span>
          <span class="tb-item">
            <span class="time-label">间隔</span>
            <el-select
              v-model="interval"
              size="small"
              class="w-interval"
              :teleported="false"
              :disabled="!canEdit()"
              @change="applyInterval"
            >
              <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
            </el-select>
          </span>
        </span>

        <!-- 工具：导出 / 报警 / 最大化 / 快捷键 -->
        <span v-show="groupInPlace(3, place)" class="tb-group" data-tg>
          <span v-if="place === 'more'" class="group-label">{{ GROUPS[3].label }}</span>
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
}

.trend-bar {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: auto;
  box-sizing: border-box;
  padding: 2px 4px;
  overflow: visible;
  pointer-events: auto;
  background: transparent;
  border-bottom: none;
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
  gap: 4px;
  padding: 4px 6px;
  background: rgba(11, 18, 32, 0.97);
  border: 1px solid #1e3a5f;
  border-top: none;
  border-radius: 0 0 4px 4px;
}
.tb-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
/* 条上组与组之间的竖线 */
.is-main .tb-group + .tb-group {
  margin-left: 3px;
  padding-left: 7px;
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
  gap: 4px;
  flex: 0 0 auto;
}
.more-btn {
  flex: 0 0 auto;
}
.trend-bar :deep(.el-input__wrapper),
.trend-bar :deep(.el-range-editor),
.trend-bar :deep(.el-select__wrapper) {
  --el-input-bg-color: transparent;
  --el-input-text-color: #e2e8f0;
  --el-input-border-color: #334155;
  --el-fill-color-blank: transparent;
  background-color: transparent;
  height: 22px;
  font-size: 12px;
}
.trend-bar.is-main :deep(.el-button:not(.el-button--primary):not(.el-button--danger)) {
  --el-button-bg-color: transparent;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.16);
  --el-button-border-color: #334155;
  background-color: transparent;
}
.trend-bar :deep(.el-range-input) {
  color: #e2e8f0;
  font-size: 11px;
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
.trend-bar :deep(.w-interval) {
  width: 72px;
  flex: 0 0 auto;
}
.trend-bar :deep(.w-past) {
  width: 112px;
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
