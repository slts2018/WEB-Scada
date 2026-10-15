<script setup lang="ts">
/**
 * 历史趋势的工具栏（挂在图元顶部一行）。
 *
 * 为什么是 HTML 叠层：趋势图本身画在 Konva 位图 / ECharts 原生叠层里，
 * 用 Element Plus 的日期选择器比在画布上自绘省事得多；与"历史报警"的搜索条同一套做法
 * （按图元矩形定位，见 trendToolbarClientRect）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

/** 点表（图下方弹出的数据表，与游标联动） */
const showTable = ref(false)
const TABLE_ROWS = 11

const tableData = computed(() => {
  const rows = trendHistoryExportRows(props.widgetId)
  if (!rows) return { header: [] as string[], body: [] as Array<{ t: number; cells: Array<number | null>; cursor: boolean }>, total: 0 }
  const at = cursorAt.value
  let start = Math.max(0, rows.times.length - TABLE_ROWS)
  if (at != null) {
    let idx = 0
    for (let i = 0; i < rows.times.length; i++) if ((rows.times[i] as number) <= at) idx = i
    start = Math.min(Math.max(0, idx - Math.floor(TABLE_ROWS / 2)), Math.max(0, rows.times.length - TABLE_ROWS))
  }
  const body = rows.times.slice(start, start + TABLE_ROWS).map((t, k) => {
    const i = start + k
    return {
      t: t as number,
      cells: rows.values.map((col) => col[i] ?? null),
      cursor: at != null && rows.times[i] === at,
    }
  })
  return { header: rows.tagIds, body, total: rows.times.length }
})

function fmtRowTime(ms: number): string {
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
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
  <div class="trend-toolbar">
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
    <el-button size="small" :type="showTable ? 'primary' : 'default'" @click="showTable = !showTable">表</el-button>
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

  <div v-if="showTable" class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th v-for="tagId in tableData.header" :key="tagId">{{ tagId }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in tableData.body" :key="row.t" :class="{ 'row-cursor': row.cursor }">
          <td class="t">{{ fmtRowTime(row.t) }}</td>
          <td v-for="(cell, k) in row.cells" :key="k">{{ cell == null ? '—' : cell.toFixed(2) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="table-foot">
      共 {{ tableData.total }} 行<span v-if="cursorAt != null">（蓝底 = 游标行）</span>；导出请用 CSV
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
.table-wrap {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  max-height: 190px;
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
  padding: 2px 6px;
  color: #64748b;
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