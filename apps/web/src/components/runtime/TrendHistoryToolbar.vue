<script setup lang="ts">
/**
 * 历史趋势的工具栏（挂在图元顶部一行）。
 *
 * 为什么是 HTML 叠层：趋势图本身画在 Konva 位图 / ECharts 原生叠层里，
 * 用 Element Plus 的日期选择器比在画布上自绘省事得多；与"历史报警"的搜索条同一套做法
 * （按图元矩形定位，见 trendToolbarClientRect）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  clearTrendHistoryCursor,
  onTrendHistoryCursor,
  stepTrendHistoryCursor,
  trendHistoryCursorOf,
  trendHistoryCursorReadout,
  trendHistoryCursorText,
  type CursorRow,
} from '@/shared/runtime/trendHistoryCursor'
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

const props = defineProps<{
  widgetId: string
  preset: string
  tagIds: string[]
  /** 运行端是否允许改时间区间/缩放/采样间隔（发布端可锁死） */
  allowEdit?: boolean
}>()

const canEdit = () => props.allowEdit !== false
const emit = defineEmits<{ change: [] }>()

const preset = ref(props.preset || '-1h')
const interval = ref('auto')
const follow = ref(true)
const aggWindow = ref<string | null>(null)
const notice = ref<{ kind: 'error' | 'empty'; text: string } | null>(null)
const range = ref<[Date, Date]>([new Date(Date.now() - 3600_000), new Date()])

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
  cursorAt.value = at
  if (at == null) {
    cursorRows.value = []
    cursorTimeText.value = ''
    return
  }
  const readout = trendHistoryCursorReadout(props.widgetId, props.tagIds)
  cursorRows.value = readout?.rows ?? []
  cursorTimeText.value = fmtClock(at)
}

function stepCursor(dir: -1 | 1): void {
  stepTrendHistoryCursor(props.widgetId, dir, props.tagIds)
  after()
}

function clearCursor(): void {
  clearTrendHistoryCursor(props.widgetId)
  after()
}

async function copyCursor(): Promise<void> {
  const text = trendHistoryCursorText(props.widgetId, props.tagIds)
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
  if (win) range.value = [new Date(win.from), new Date(win.to)]
  syncCursor()
}

let offLoaded: (() => void) | null = null
let offCursor: (() => void) | null = null
onMounted(() => {
  sync()
  offLoaded = onTrendHistoryLoaded(sync)
  offCursor = onTrendHistoryCursor(sync)
})
onBeforeUnmount(() => {
  offLoaded?.()
  offLoaded = null
  offCursor?.()
  offCursor = null
})

function after(): void {
  emit('change')
}

function applyPreset(): void {
  setTrendHistoryPreset(props.widgetId, preset.value)
  after()
}

function applyRange(): void {
  const [from, to] = range.value
  const f = from?.getTime()
  const t = to?.getTime()
  if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) return
  setTrendHistoryWindow(props.widgetId, f, t)
  after()
}

function shift(dir: -1 | 1): void {
  shiftTrendHistoryWindow(props.widgetId, dir)
  after()
}

function zoom(factor: number): void {
  zoomTrendHistoryWindow(props.widgetId, factor)
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
  const head = ['time', ...rows.tagIds].join(',')
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
</script>

<template>
  <div class="trend-bar" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop>
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
    <el-date-picker
      v-model="range"
      type="datetimerange"
      size="small"
      class="w-range"
      format="MM-DD HH:mm"
      range-separator="~"
      :clearable="false"
      :teleported="false"
      :disabled="!canEdit()"
    />
    <el-button size="small" type="primary" :disabled="!canEdit()" @click="applyRange">查</el-button>
    <el-button-group>
      <el-button size="small" :disabled="!canEdit()" @click="shift(-1)">◀</el-button>
      <el-button size="small" :disabled="!canEdit()" @click="shift(1)">▶</el-button>
      <el-button size="small" :disabled="!canEdit()" @click="zoom(2)">－</el-button>
      <el-button size="small" :disabled="!canEdit()" @click="zoom(0.5)">＋</el-button>
    </el-button-group>
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
    <el-button size="small" @click="refresh">刷新</el-button>
    <el-button size="small" @click="exportCsv">CSV</el-button>
    <span v-if="aggWindow && interval === 'auto'" class="hint">按 {{ aggWindow }} 平均</span>
    <span v-if="cursorAt == null" class="hint">图内单击落游标读数</span>
    <span v-else class="cursor">
      <el-button size="small" text @click="stepCursor(-1)">◀</el-button>
      <span class="cursor-time">{{ cursorTimeText }}</span>
      <span v-for="row in cursorRows" :key="row.tagId" class="cursor-row">
        <i class="dot" :class="row.quality === 'Good' || row.quality == null ? 'ok' : 'bad'" />
        {{ row.tagId }} {{ row.value == null ? '—' : row.value.toFixed(2) }}
      </span>
      <el-button size="small" text @click="stepCursor(1)">▶</el-button>
      <el-button size="small" text @click="copyCursor">复制</el-button>
      <el-button size="small" text @click="clearCursor">✕</el-button>
    </span>
    <span v-if="notice" class="notice" :class="notice.kind">{{ notice.text }}</span>
  </div>
</template>

<style scoped>
.trend-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 1px 4px;
  overflow: hidden;
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
.w-preset {
  width: 104px;
  flex: 0 0 auto;
}
.w-range {
  width: 210px;
  flex: 0 0 auto;
}
.w-interval {
  width: 88px;
  flex: 0 0 auto;
}
.cursor {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #e2e8f0;
  white-space: nowrap;
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
.hint {
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
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