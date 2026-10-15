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

const props = defineProps<{ widgetId: string; preset: string; tagIds: string[] }>()
const emit = defineEmits<{ change: [] }>()

const preset = ref(props.preset || '-1h')
const interval = ref('auto')
const follow = ref(true)
const aggWindow = ref<string | null>(null)
const notice = ref<{ kind: 'error' | 'empty'; text: string } | null>(null)
const range = ref<[Date, Date]>([new Date(Date.now() - 3600_000), new Date()])

function sync(): void {
  preset.value = props.preset || '-1h'
  interval.value = trendHistoryIntervalOf(props.widgetId)
  follow.value = trendHistoryFollowOf(props.widgetId)
  notice.value = trendHistoryNoticeOf(props.widgetId)
  aggWindow.value = trendHistoryStatusOf(props.widgetId)?.aggWindow ?? null
  const win = trendHistoryWindowOf(props.widgetId)
  if (win) range.value = [new Date(win.from), new Date(win.to)]
}

let offLoaded: (() => void) | null = null
onMounted(() => {
  sync()
  offLoaded = onTrendHistoryLoaded(sync)
})
onBeforeUnmount(() => {
  offLoaded?.()
  offLoaded = null
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
    />
    <el-button size="small" type="primary" @click="applyRange">查</el-button>
    <el-button-group>
      <el-button size="small" @click="shift(-1)">◀</el-button>
      <el-button size="small" @click="shift(1)">▶</el-button>
      <el-button size="small" @click="zoom(2)">－</el-button>
      <el-button size="small" @click="zoom(0.5)">＋</el-button>
    </el-button-group>
    <el-select
      v-model="interval"
      size="small"
      class="w-interval"
      :teleported="false"
      @change="applyInterval"
    >
      <el-option v-for="item in TREND_INTERVALS" :key="item.id" :label="item.label" :value="item.id" />
    </el-select>
    <el-checkbox :model-value="follow" size="small" @update:model-value="toggleFollow">跟随</el-checkbox>
    <el-button size="small" @click="refresh">刷新</el-button>
    <el-button size="small" @click="exportCsv">CSV</el-button>
    <span v-if="aggWindow && interval === 'auto'" class="hint">按 {{ aggWindow }} 平均</span>
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