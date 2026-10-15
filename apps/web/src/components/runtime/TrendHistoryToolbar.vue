<script setup lang="ts">
/**
 * 历史趋势的工具栏（挂在图元顶部一行）。
 *
 * 为什么是 HTML 叠层：趋势图本身画在 Konva 位图 / ECharts 原生叠层里，
 * 用 Element Plus 的日期选择器比在画布上自绘省事得多；与"历史报警"的搜索条同一套做法
 * （按图元矩形定位，见 trendToolbarClientRect）。
 *
 * 窄图元自适应：工具条是按图元宽度定位的，图元一小就必然放不下全部控件，
 * 所以按实测宽度分档（宽 / 中 / 窄），放不下的收进"更多"气泡里，而不是被裁掉。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatTrendValue, type TrendValueFormat } from '@web-scada/core'
import {
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
  trendHistoryCursorReadout,
  trendHistoryCursorText,
  type CursorRow,
} from '@/shared/runtime/trendHistoryCursor'
import { onTrendAlarmBandsChanged, trendAlarmBandsOf, type AlarmBand } from '@/shared/runtime/trendAlarmEvents'
import {
  TREND_INTERVALS,
  TREND_RANGES,
  onTrendHistoryLoaded,
  refreshTrendHistory,
  setTrendHistoryFollow,
  setTrendHistoryInterval,
  setTrendHistoryPreset,
  setTrendHistoryWindow,
  shiftTrendHistoryWindow,
  trendHistoryExportRows,
  trendHistoryFollowOf,
  trendHistoryIntervalOf,
  trendHistoryNoticeOf,
  trendHistoryStatusOf,
  trendHistoryWindowOf,
  zoomTrendHistoryWindow,
} from '@/shared/runtime/trendHistoryQuery'
import { jumpTrendHistoryWidgetToTime } from '@/shared/runtime/trendHistoryLink'
import {
  forgetTrendToolbar,
  setActiveTrendToolbar,
  shouldHandleTrendKeys,
} from '@/shared/runtime/trendToolbarFocus'

/** 曲线的显示格式（属性面板里配的单位 / 小数位） */
export interface TrendToolbarCurve {
  tagId: string
  label?: string
  unit?: string
  decimals?: number
}

const props = defineProps<{
  widgetId: string
  preset: string
  tagIds: string[]
  /** 曲线的单位 / 小数位（图例名可选，用于点表表头） */
  curves?: TrendToolbarCurve[]
  /** 运行端是否允许改时间区间/缩放/采样间隔（发布端可锁死） */
  allowEdit?: boolean
  /** 工具条实测宽度（px）；缺省时由 ResizeObserver 量 */
  width?: number
  /** 该图元是否正在最大化显示 */
  fullscreen?: boolean
  /** 是否提供"最大化"按钮（3D 面板内的只读面板不提供） */
  fullscreenSupported?: boolean
}>()

const canEdit = () => props.allowEdit !== false
const emit = defineEmits<{ change: []; toggleFullscreen: [] }>()

const preset = ref(props.preset || '-1h')
const interval = ref('auto')
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
/** 正在编辑起止时间时不要被后台刷新回来的窗口盖掉 */
const editingRange = ref(false)
/**
 * 「时刻」：手动选/输**一个时间点**（秒精度），游标跳过去。
 * 它跟着游标走：图内点一下 / ◀▶ 微调也会同步显示，但改成别的时刻就等于"我要看这一刻"。
 */
const jumpAt = ref<Date | null>(null)
const showHelp = ref(false)
const showMore = ref(false)

/* ---------- 曲线显示格式（单位 / 小数位） ---------- */

const formatOf = computed(() => {
  const map = new Map<string, TrendValueFormat>()
  for (const curve of props.curves ?? []) {
    map.set(curve.tagId, { unit: curve.unit, decimals: curve.decimals })
  }
  return map
})

/** 数值（不含单位）：游标读数与点表里的数字都用它，小数位跟属性面板一致 */
function fmtNumber(tagId: string, value: number | null): string {
  return formatTrendValue(value, formatOf.value.get(tagId))
}

/** 点表表头：变量名后补上单位，现场看表不用猜量纲 */
function headerOf(tagId: string): string {
  const unit = formatOf.value.get(tagId)?.unit?.trim()
  return unit ? `${tagId} (${unit})` : tagId
}

/* ---------- 宽度分档：放不下的控件收进"更多" ---------- */

const measured = ref(props.width && props.width > 0 ? props.width : 9999)
const barWidth = computed(() => (measured.value > 0 ? measured.value : 9999))
/**
 * 宽档（≥1240）：全量控件常驻。
 * 中档：收起采样间隔 / 跟随 / 刷新 / 导出、「时刻」（起止时间还留着 —— 那是现场最常用的）。
 */
const compact = computed(() => barWidth.value < 1240)
/** 窄档：起止时间也放不下 → 收进「⋯」（只留区间快捷 + 前后平移） */
const narrow = computed(() => barWidth.value < 640)


const root = ref<HTMLDivElement | null>(null)
let observer: ResizeObserver | null = null

/* ---------- 点表（图下方弹出的数据表，与游标联动） ---------- */

const showTable = ref(trendHistoryTableVisibleOf(props.widgetId))
const TABLE_PAGE_SIZES = [11, 20, 50, 100]
const tablePage = ref(1)
const tablePageSize = ref(11)
const tableWrap = ref<HTMLDivElement | null>(null)

function toggleTable(): void {
  showTable.value = !showTable.value
  setTrendHistoryTableVisible(props.widgetId, showTable.value)
  after()
}

const tableRows = computed(() => trendHistoryExportRows(props.widgetId))

const tableTotal = computed(() => tableRows.value?.times.length ?? 0)
const tablePages = computed(() => Math.max(1, Math.ceil(tableTotal.value / Math.max(1, tablePageSize.value))))

/** 游标所在的行号（没有游标或不在本窗口 = -1） */
const cursorRowIndex = computed(() => {
  const rows = tableRows.value
  const at = cursorAt.value
  if (!rows || at == null) return -1
  let idx = -1
  for (let i = 0; i < rows.times.length; i++) {
    if ((rows.times[i] as number) <= at) idx = i
    else break
  }
  return idx
})

const tableData = computed(() => {
  const rows = tableRows.value
  if (!rows) {
    return {
      header: [] as string[],
      body: [] as Array<{ t: number; cells: Array<number | null>; cursor: boolean }>,
      total: 0,
    }
  }
  const size = Math.max(1, tablePageSize.value)
  const start = (Math.min(tablePage.value, tablePages.value) - 1) * size
  const body = rows.times.slice(start, start + size).map((t, k) => {
    const i = start + k
    return {
      t: t as number,
      cells: rows.tagIds.map((tagId) => {
        const col = rows.values[rows.tagIds.indexOf(tagId)]
        return col?.[i] ?? null
      }),
      cursor: cursorAt.value != null && rows.times[i] === cursorAt.value,
    }
  })
  return { header: rows.tagIds, body, total: rows.times.length }
})

/**
 * 把游标那一行滚进可视区（翻页 / 游标移动后都要做）。
 * 只滚表格自己的 scrollTop —— 用 scrollIntoView 会把整个画面/页面容器一起带走。
 */
function scrollCursorIntoView(): void {
  void nextTick(() => {
    const wrap = tableWrap.value
    if (!wrap) return
    const row = wrap.querySelector('[data-cursor="1"]') as HTMLElement | null
    if (!row) return
    const target = row.offsetTop - (wrap.clientHeight - row.offsetHeight) / 2
    wrap.scrollTop = Math.max(0, target)
  })
}

/** 跳到游标所在页（工具栏"定位游标"按钮，游标移动时也自动跟） */
function gotoCursorPage(): void {
  const idx = cursorRowIndex.value
  if (idx < 0) return
  const size = Math.max(1, tablePageSize.value)
  tablePage.value = Math.min(tablePages.value, Math.floor(idx / size) + 1)
  scrollCursorIntoView()
}

function changePage(page: number): void {
  tablePage.value = Math.min(tablePages.value, Math.max(1, page))
  scrollCursorIntoView()
}

function changePageSize(size: number): void {
  tablePageSize.value = Math.max(1, Number(size) || 11)
  gotoCursorPage()
}

function fmtRowTime(ms: number): string {
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
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
const cursorRows = ref<CursorRow[]>([])
const cursorTimeText = ref('')

function fmtClock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 游标读数：时间 + 每条曲线吸附到的值 + 质量点 */
function syncCursor(): void {
  const at = trendHistoryCursorOf(props.widgetId)
  const moved = at !== cursorAt.value
  cursorAt.value = at
  // 「时刻」控件跟着游标（游标没变时不回写，避免打断正在手输的用户）
  if (at == null) {
    if (jumpAt.value) jumpAt.value = null
  } else if (jumpAt.value?.getTime() !== at) {
    jumpAt.value = new Date(at)
  }
  if (at == null) {
    cursorRows.value = []
    cursorTimeText.value = ''
    return
  }
  const readout = trendHistoryCursorReadout(props.widgetId, props.tagIds)
  cursorRows.value = readout?.rows ?? []
  cursorTimeText.value = fmtClock(at)
  // 游标动了 → 点表跟着翻到它所在的那一页（"表与游标联动"）
  if (moved && showTable.value) gotoCursorPage()
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

async function copyCursor(): Promise<void> {
  const text = trendHistoryCursorText(props.widgetId, props.tagIds, (tagId, value) =>
    fmtNumber(tagId, value),
  )
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('读数已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

function sync(): void {
  preset.value = props.preset || '-1h'
  interval.value = trendHistoryIntervalOf(props.widgetId)
  follow.value = trendHistoryFollowOf(props.widgetId)
  notice.value = trendHistoryNoticeOf(props.widgetId)
  aggWindow.value = trendHistoryStatusOf(props.widgetId)?.aggWindow ?? null
  const win = trendHistoryWindowOf(props.widgetId)
  if (win && !editingRange.value) {
    if (fromAt.value?.getTime() !== win.from) fromAt.value = new Date(win.from)
    if (toAt.value?.getTime() !== win.to) toAt.value = new Date(win.to)
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
onMounted(() => {
  sync()
  offLoaded = onTrendHistoryLoaded(sync)
  offCursor = onTrendHistoryCursor(sync)
  offAlarms = onTrendAlarmBandsChanged(syncAlarms)
  window.addEventListener('keydown', onKeydown)
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0
      if (w > 0) measured.value = w
    })
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => {
  offLoaded?.()
  offLoaded = null
  offCursor?.()
  offCursor = null
  offAlarms?.()
  offAlarms = null
  window.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
  observer = null
  forgetTrendToolbar(props.widgetId)
})

watch(
  () => props.width,
  (w) => {
    if (typeof w === 'number' && w > 0 && !observer) measured.value = w
  },
)

watch(
  () => props.tagIds.join(','),
  () => syncCursor(),
)

function after(): void {
  emit('change')
}

function applyPreset(): void {
  setTrendHistoryPreset(props.widgetId, preset.value)
  after()
}

/**
 * 按"开始 ~ 结束"查询。
 * search=true（点「搜索」或回车）= 这一对起止时间重查一遍；否则是改完自动应用。
 * 起止时间是用户明确指定的绝对区间 → 先关跟随，刷新时也保持这一段（不跳回最新）。
 */
function applyRange(search = false): void {
  const f = fromAt.value?.getTime()
  const t = toAt.value?.getTime()
  if (!Number.isFinite(f) || !Number.isFinite(t) || (t as number) <= (f as number)) {
    if (search) ElMessage.warning('开始时间要早于结束时间')
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

function toggleFollow(v: boolean | string | number): void {
  setTrendHistoryFollow(props.widgetId, Boolean(v))
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
  { key: '时刻', text: '看某一个瞬间 → 游标跳过去（不在起止区间里会自动把窗口挪过去）' },
  { key: '跟随', text: '默认关闭：区间是一次查询的快照；勾上才随时间滚动并按 10s 刷新' },
  { key: '← / →', text: '游标按采样点前后移动' },
  { key: '+ / -', text: '以游标为中心放大 / 缩小时间窗' },
  { key: 'Esc', text: '清除游标（最大化时退出最大化）' },
  { key: '单击图内', text: '落游标（吸附最近的采样点）' },
  { key: '拖动竖线', text: '移动游标，读数实时更新' },
  { key: '滚轮 / 框选', text: '缩放时间窗；双击还原' },
]
</script>

<template>
  <div ref="root" class="trend-toolbar" @pointerenter="markActive">
    <div
      class="trend-bar"
      :class="{ 'is-narrow': narrow, 'is-compact': compact }"
      @pointerdown.stop
      @mousedown.stop
      @click.stop="markActive"
      @dblclick.stop
      @wheel.stop
    >
      <el-select
        v-model="preset"
        size="small"
        class="w-preset"
        :teleported="false"
        :disabled="!canEdit()"
        @change="applyPreset"
      >
        <el-option v-for="item in TREND_RANGES" :key="item.id" :label="item.label" :value="item.id" />
      </el-select>

      <!-- 起止时间：两个独立输入框 + 搜索（现场"选开始、选结束、查一下"的习惯） -->
      <template v-if="!narrow">
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
          @focus="editingRange = true"
          @blur="editingRange = false"
          @change="applyRange()"
        />
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
          @focus="editingRange = true"
          @blur="editingRange = false"
          @change="applyRange()"
        />
        <el-button
          size="small"
          :disabled="!canEdit()"
          title="按这对起止时间查询（重新拉一次数据）"
          @click="applyRange(true)"
        >搜索</el-button>
      </template>

      <!-- 「时刻」：看某一个瞬间（不在起止区间里会自动把窗口挪过去） -->
      <el-date-picker
        v-if="!compact"
        v-model="jumpAt"
        type="datetime"
        size="small"
        class="w-jump"
        format="MM-DD HH:mm:ss"
        placeholder="跳到时刻"
        :clearable="false"
        :teleported="false"
        :disabled="!canEdit()"
        @change="jumpToTime"
      />

      <el-button-group>
        <el-button size="small" :disabled="!canEdit()" title="前移一个窗口" @click="shift(-1)">◀</el-button>
        <el-button size="small" :disabled="!canEdit()" title="后移一个窗口" @click="shift(1)">▶</el-button>
      </el-button-group>
      <el-button-group v-if="!narrow">
        <el-button size="small" :disabled="!canEdit()" title="放大时间窗（键盘 -）" @click="zoom(2)">－</el-button>
        <el-button size="small" :disabled="!canEdit()" title="缩小时间窗（键盘 +）" @click="zoom(0.5)">＋</el-button>
      </el-button-group>

      <template v-if="!compact">
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
        <el-checkbox
          :model-value="follow"
          size="small"
          :disabled="!canEdit()"
          @update:model-value="toggleFollow"
        >跟随</el-checkbox>
        <el-button
          size="small"
          :title="follow ? '重新查询当前窗口' : '重新查询（回到最新）'"
          @click="refresh"
        >刷新</el-button>
        <el-button size="small" :type="showTable ? 'primary' : 'default'" @click="toggleTable">表</el-button>
      </template>

      <el-button
        v-if="alarmBands.length && !narrow"
        size="small"
        type="danger"
        plain
        @click="jumpToFirstAlarm"
      >
        报警 {{ alarmBands.length }}
      </el-button>

      <!-- 窄档：其余控件收进"更多"，不再被裁掉 -->
      <el-popover
        v-model:visible="showMore"
        :teleported="false"
        :width="340"
        trigger="click"
        placement="bottom-start"
        popper-class="trend-more-popper"
      >
        <template #reference>
          <el-button size="small" :type="showMore ? 'primary' : 'default'" title="更多控件">⋯</el-button>
        </template>
        <div class="more-panel">
          <label class="more-row top">
            <span>跳到时刻（手动选时间）</span>
            <el-date-picker
              v-model="jumpAt"
              type="datetime"
              size="small"
              style="width: 100%"
              format="MM-DD HH:mm:ss"
              placeholder="选择 / 输入一个时刻"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @change="jumpToTime"
            />
          </label>
          <label class="more-row">
            <span>开始</span>
            <el-date-picker
              v-model="fromAt"
              type="datetime"
              size="small"
              style="width: 100%"
              format="MM-DD HH:mm:ss"
              placeholder="开始时间"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @focus="editingRange = true"
              @blur="editingRange = false"
              @change="applyRange()"
            />
          </label>
          <label class="more-row">
            <span>结束</span>
            <el-date-picker
              v-model="toAt"
              type="datetime"
              size="small"
              style="width: 100%"
              format="MM-DD HH:mm:ss"
              placeholder="结束时间"
              :clearable="false"
              :teleported="false"
              :disabled="!canEdit()"
              @focus="editingRange = true"
              @blur="editingRange = false"
              @change="applyRange()"
            />
          </label>
          <label class="more-row">
            <span>采样间隔</span>
            <el-select v-model="interval" size="small" :teleported="false" :disabled="!canEdit()" @change="applyInterval">
              <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
            </el-select>
          </label>
          <div class="more-row">
            <el-checkbox
              :model-value="follow"
              size="small"
              :disabled="!canEdit()"
              @update:model-value="toggleFollow"
            >跟随最新</el-checkbox>
          </div>
          <div class="more-btns">
            <el-button size="small" :disabled="!canEdit()" title="放大时间窗" @click="zoom(2)">－ 缩小范围</el-button>
            <el-button size="small" :disabled="!canEdit()" title="缩小时间窗" @click="zoom(0.5)">＋ 放大范围</el-button>
            <el-button size="small" :disabled="!canEdit()" @click="applyRange(true)">按起止查询</el-button>
            <el-button
              size="small"
              :title="follow ? '重新查询当前窗口' : '重新查询（回到最新）'"
              @click="refresh"
            >刷新</el-button>
            <el-button size="small" :type="showTable ? 'primary' : 'default'" @click="toggleTable">点表</el-button>
            <el-button v-if="alarmBands.length" size="small" type="danger" plain @click="jumpToFirstAlarm">
              报警 {{ alarmBands.length }}
            </el-button>
            <el-button size="small" @click="exportCsv">CSV</el-button>
          </div>
        </div>
      </el-popover>

      <template v-if="!narrow">
        <el-button size="small" @click="exportCsv">CSV</el-button>
      </template>

      <span v-if="!narrow" class="spacer" />

      <el-button
        v-if="fullscreenSupported !== false"
        size="small"
        class="btn-icon"
        :title="fullscreen ? '退出最大化（Esc）' : '最大化查看'"
        @click="emit('toggleFullscreen')"
      >{{ fullscreen ? '⤡' : '⛶' }}</el-button>
      <el-button
        size="small"
        class="btn-icon"
        :type="showHelp ? 'primary' : 'default'"
        title="快捷键提示"
        @click="showHelp = !showHelp"
      >?</el-button>

      <span v-if="aggWindow && interval === 'auto'" class="hint">按 {{ aggWindow }} 平均</span>
      <span v-if="!narrow && cursorAt == null" class="hint">
        {{ follow ? '图内单击落游标读数' : '起止时间可手输/日历选（秒精度）· 刷新取最新' }}
      </span>
      <span v-if="cursorAt != null" class="cursor">
        <el-button size="small" text @click="stepCursor(-1)">◀</el-button>
        <span class="cursor-time">{{ cursorTimeText }}</span>
        <span v-for="row in cursorRows" :key="row.tagId" class="cursor-row">
          <i class="dot" :class="row.quality === 'Good' || row.quality == null ? 'ok' : 'bad'" />
          {{ row.tagId }} {{ fmtNumber(row.tagId, row.value) }}
        </span>
        <el-button size="small" text @click="stepCursor(1)">▶</el-button>
        <el-button v-if="!narrow" size="small" text @click="copyCursor">复制</el-button>
        <el-button size="small" text @click="clearCursor">✕</el-button>
      </span>
      <span v-if="notice" class="notice" :class="notice.kind">{{ notice.text }}</span>
    </div>

    <!-- 快捷键提示：工具条右侧 "?" 打开，Esc 关闭 -->
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

    <div v-if="showTable" ref="tableWrap" class="table-wrap" @pointerdown.stop @wheel.stop>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th v-for="tagId in tableData.header" :key="tagId">{{ headerOf(tagId) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in tableData.body"
            :key="row.t"
            :class="{ 'row-cursor': row.cursor }"
            :data-cursor="row.cursor ? '1' : undefined"
          >
            <td class="t">{{ fmtRowTime(row.t) }}</td>
            <td v-for="(cell, k) in row.cells" :key="k">{{ fmtNumber(tableData.header[k] ?? '', cell) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="table-foot">
        <span>
          共 {{ tableData.total }} 行 · 第 {{ Math.min(tablePage, tablePages) }}/{{ tablePages }} 页
          <span v-if="cursorAt != null">（蓝底 = 游标行）</span>
        </span>
        <span class="table-page">
          <el-button size="small" text :disabled="tablePage <= 1" @click="changePage(1)">⏮</el-button>
          <el-button size="small" text :disabled="tablePage <= 1" @click="changePage(tablePage - 1)">◀</el-button>
          <el-button size="small" text :disabled="tablePage >= tablePages" @click="changePage(tablePage + 1)">▶</el-button>
          <el-button size="small" text :disabled="tablePage >= tablePages" @click="changePage(tablePages)">⏭</el-button>
          <el-select
            :model-value="tablePageSize"
            size="small"
            class="w-pagesize"
            :teleported="false"
            @change="changePageSize"
          >
            <el-option v-for="size in TABLE_PAGE_SIZES" :key="size" :label="`${size} 行/页`" :value="size" />
          </el-select>
          <el-button size="small" text :disabled="cursorRowIndex < 0" @click="gotoCursorPage">定位游标</el-button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trend-toolbar {
  position: relative;
  width: 100%;
  height: 100%;
}

.trend-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 1px 4px;
  overflow: visible;
  pointer-events: auto;
  background: rgba(11, 18, 32, 0.92);
  border-bottom: 1px solid #1e3a5f;
}
.trend-bar :deep(.el-input__wrapper),
.trend-bar :deep(.el-range-editor) {
  --el-input-bg-color: #0b1220;
  --el-input-text-color: #e2e8f0;
  --el-input-border-color: #334155;
  --el-fill-color-blank: #0b1220;
  height: 22px;
  font-size: 12px;
}
.trend-bar :deep(.el-range-input) {
  color: #e2e8f0;
  font-size: 11px;
}
.trend-bar :deep(.el-button + .el-button) {
  margin-left: 0;
}
.w-preset {
  width: 104px;
  flex: 0 0 auto;
}
.trend-bar.is-narrow .w-preset,
.trend-bar.is-compact .w-preset {
  width: 84px;
}
.trend-bar.is-compact .w-jump {
  width: 132px;
}
.w-datetime {
  /* 起止各一个：MM-DD HH:mm:ss 要放得下（含日历图标） */
  width: 138px;
  flex: 0 0 auto;
}
.time-label {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
}
.trend-bar.is-compact .w-datetime {
  width: 130px;
}
.w-jump {
  /* 手动选一个时刻（秒精度） */
  width: 148px;
  flex: 0 0 auto;
}
.w-interval {
  width: 88px;
  flex: 0 0 auto;
}
.w-pagesize {
  width: 92px;
  flex: 0 0 auto;
}
.btn-icon {
  flex: 0 0 auto;
  padding: 0 6px;
}
.spacer {
  flex: 1 1 0;
  min-width: 0;
}
.cursor {
  display: flex;
  align-items: center;
  gap: 4px;
  /* 可收缩：控件多了先压读数，别把按钮挤出图元 */
  flex: 0 1 auto;
  min-width: 0;
  font-size: 11px;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
}

.cursor-time {
  font-family: ui-monospace, Consolas, monospace;
  color: #93c5fd;
}
.cursor-row {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.dot.ok {
  background: #34d399;
}
.dot.bad {
  background: #f87171;
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
.more-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.more-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
}
.more-row.top {
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}
.more-row :deep(.el-select) {
  width: 118px;
}

.more-row :deep(.el-date-editor) {
  width: 100%;
  max-width: 100%;
}
.more-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.table-wrap {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  /* 与 trendHistoryTable 里给图表让出的高度（TREND_TABLE_H）对齐，别盖住曲线 */
  max-height: 148px;
  overflow: auto;
  z-index: 3;
  background: rgba(11, 18, 32, 0.97);
  border: 1px solid #1e3a5f;
  border-top: none;
  font-size: 11px;
  color: #cbd5e1;
  pointer-events: auto;
}
.table-wrap table {
  width: 100%;
  border-collapse: collapse;
}
.table-wrap th,
.table-wrap td {
  padding: 2px 6px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid #16223a;
}
.table-wrap th {
  position: sticky;
  top: 0;
  background: #0f1a2c;
  color: #94a3b8;
  font-weight: normal;
}
.table-wrap td.t {
  font-family: ui-monospace, Consolas, monospace;
  color: #93c5fd;
}
.row-cursor {
  background: rgba(61, 139, 253, 0.18);
}
.table-foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px;
  color: #64748b;
  background: rgba(11, 18, 32, 0.97);
}
.table-page {
  display: flex;
  align-items: center;
  gap: 2px;
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
