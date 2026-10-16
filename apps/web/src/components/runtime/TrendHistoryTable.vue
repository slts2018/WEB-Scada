<script setup lang="ts">
/**
 * 历史趋势的点表（图元底部那一条，与游标联动、可翻页/定位/导出）。
 *
 * 为什么从工具栏里拆出来：它必须贴在**图元底部**、占的高度正好等于图表让出的 `chromeBottom`，
 * 而工具栏那一层只有顶部一条窄框。所以由挂载方（2D 运行端 / 3D 面板）按图元矩形定位渲染，
 * 与"历史报警"的分页条同一套做法（搜索条与分页条分开）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatTrendValue, type TrendValueFormat } from '@web-scada/core'
import { onTrendHistoryCursor, trendHistoryCursorOf } from '@/shared/runtime/trendHistoryCursor'
import {
  TREND_TABLE_PAGE_SIZES,
  onTrendHistoryTableChange,
  setTrendHistoryTablePage,
  trendHistoryTablePageOf,
} from '@/shared/runtime/trendHistoryTable'
import {
  onTrendHistoryLoaded,
  trendHistoryExportRows,
} from '@/shared/runtime/trendHistoryQuery'

export interface TrendTableCurve {
  tagId: string
  label?: string
  unit?: string
  decimals?: number
}

const props = defineProps<{
  widgetId: string
  /** 曲线的单位 / 小数位（表头与数值按它显示） */
  curves?: TrendTableCurve[]
}>()

const rows = ref(trendHistoryExportRows(props.widgetId))
const cursorAt = ref<number | null>(trendHistoryCursorOf(props.widgetId))
const state = trendHistoryTablePageOf(props.widgetId)
const wrap = ref<HTMLDivElement | null>(null)

const formatOf = computed(() => {
  const map = new Map<string, TrendValueFormat>()
  for (const curve of props.curves ?? []) {
    map.set(curve.tagId, { unit: curve.unit, decimals: curve.decimals })
  }
  return map
})

function fmtNumber(tagId: string, value: number | null): string {
  return formatTrendValue(value, formatOf.value.get(tagId))
}

/** 表头：变量名后补单位，现场看表不用猜量纲 */
function headerOf(tagId: string): string {
  const unit = formatOf.value.get(tagId)?.unit?.trim()
  return unit ? `${tagId} (${unit})` : tagId
}

const total = computed(() => rows.value?.times.length ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, state.size))))

/** 游标所在行号（没有游标 = -1） */
const cursorRowIndex = computed(() => {
  const data = rows.value
  const at = cursorAt.value
  if (!data || at == null) return -1
  let idx = -1
  for (let i = 0; i < data.times.length; i++) {
    if ((data.times[i] as number) <= at) idx = i
    else break
  }
  return idx
})

const body = computed(() => {
  const data = rows.value
  if (!data) return [] as Array<{ t: number; cells: Array<number | null>; cursor: boolean }>
  const size = Math.max(1, state.size)
  const start = (Math.min(state.page, pages.value) - 1) * size
  return data.times.slice(start, start + size).map((t, k) => {
    const i = start + k
    return {
      t: t as number,
      cells: data.tagIds.map((_, col) => data.values[col]?.[i] ?? null),
      cursor: cursorAt.value != null && data.times[i] === cursorAt.value,
    }
  })
})

const header = computed(() => rows.value?.tagIds ?? [])

/** 只滚表格自己的 scrollTop —— 用 scrollIntoView 会把整个画面容器一起带走 */
function scrollCursorIntoView(): void {
  void nextTick(() => {
    const el = wrap.value
    if (!el) return
    const row = el.querySelector('[data-cursor="1"]') as HTMLElement | null
    if (!row) return
    el.scrollTop = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2)
  })
}

/** 跳到游标所在页（游标一动就自动跟，保持"表与游标联动"） */
function gotoCursorPage(): void {
  const idx = cursorRowIndex.value
  if (idx < 0) return
  setTrendHistoryTablePage(
    props.widgetId,
    Math.min(pages.value, Math.floor(idx / Math.max(1, state.size)) + 1),
  )
  scrollCursorIntoView()
}

function changePage(page: number): void {
  setTrendHistoryTablePage(props.widgetId, Math.min(pages.value, Math.max(1, page)))
  scrollCursorIntoView()
}

function changePageSize(size: number): void {
  setTrendHistoryTablePage(props.widgetId, 1, Number(size) || state.size)
  gotoCursorPage()
}

function fmtRowTime(ms: number): string {
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

function refresh(): void {
  rows.value = trendHistoryExportRows(props.widgetId)
}

let offCursor: (() => void) | null = null
let offLoaded: (() => void) | null = null
let offTable: (() => void) | null = null

onMounted(() => {
  // 游标一动就跟到它那一页（"表与游标联动"）
  offCursor = onTrendHistoryCursor(() => {
    const at = trendHistoryCursorOf(props.widgetId)
    const moved = at !== cursorAt.value
    cursorAt.value = at
    if (moved) gotoCursorPage()
  })
  // 数据/窗口变了 → 表内容跟着变
  offLoaded = onTrendHistoryLoaded(refresh)
  // 打开时如果已经有游标，直接翻到游标那一页（"表与游标联动"）
  if (cursorAt.value != null) gotoCursorPage()
  offTable = onTrendHistoryTableChange(() => {
    refresh()
    scrollCursorIntoView()
  })
})

onBeforeUnmount(() => {
  offCursor?.()
  offCursor = null
  offLoaded?.()
  offLoaded = null
  offTable?.()
  offTable = null
})

// 表被关掉时清掉翻页状态（下次打开还是第 1 页），数据变了跟着刷新
watch(
  () => props.widgetId,
  () => {
    refresh()
    cursorAt.value = trendHistoryCursorOf(props.widgetId)
  },
)


</script>

<template>
  <div ref="wrap" class="table-wrap" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop>
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th v-for="tagId in header" :key="tagId">{{ headerOf(tagId) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in body"
          :key="row.t"
          :class="{ 'row-cursor': row.cursor }"
          :data-cursor="row.cursor ? '1' : undefined"
        >
          <td class="t">{{ fmtRowTime(row.t) }}</td>
          <td v-for="(cell, k) in row.cells" :key="k">{{ fmtNumber(header[k] ?? '', cell) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="table-foot">
      <span>
        共 {{ total }} 行 · 第 {{ Math.min(state.page, pages) }}/{{ pages }} 页
        <span v-if="cursorAt != null">（蓝底 = 游标行）</span>
      </span>
      <span class="table-page">
        <el-button size="small" text :disabled="state.page <= 1" @click="changePage(1)">⏮</el-button>
        <el-button size="small" text :disabled="state.page <= 1" @click="changePage(state.page - 1)">◀</el-button>
        <el-button size="small" text :disabled="state.page >= pages" @click="changePage(state.page + 1)">▶</el-button>
        <el-button size="small" text :disabled="state.page >= pages" @click="changePage(pages)">⏭</el-button>
        <el-select
          :model-value="state.size"
          size="small"
          class="w-pagesize"
          :teleported="false"
          @change="changePageSize"
        >
          <el-option v-for="size in TREND_TABLE_PAGE_SIZES" :key="size" :label="`${size} 行/页`" :value="size" />
        </el-select>
        <el-button size="small" text :disabled="cursorRowIndex < 0" @click="gotoCursorPage">定位游标</el-button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  background: rgba(11, 18, 32, 0.97);
  border-top: 1px solid #1e3a5f;
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
  border-top: 1px solid #16223a;
}
.table-foot :deep(.el-button + .el-button) {
  margin-left: 0;
}
.table-page {
  display: flex;
  align-items: center;
  gap: 2px;
}
.w-pagesize {
  width: 92px;
  flex: 0 0 auto;
}
.w-pagesize :deep(.el-select__wrapper) {
  min-height: 22px;
  background: #0b1220;
  box-shadow: 0 0 0 1px #334155 inset;
}
</style>
