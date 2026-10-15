<script setup lang="ts">
import { ref } from 'vue'
import { setTrendHistorySearch, trendHistorySearchOf } from '@/shared/runtime/trendHistoryQuery'

const props = defineProps<{ widgetId: string; preset?: string }>()
const emit = defineEmits<{ change: [] }>()

const presetMs: Record<string, number> = {
  '-15m': 15 * 60 * 1000,
  '-1h': 60 * 60 * 1000,
  '-8h': 8 * 60 * 60 * 1000,
  '-24h': 24 * 60 * 60 * 1000,
  '-7d': 7 * 24 * 60 * 60 * 1000,
}

function initialRange(): [Date, Date] {
  const saved = trendHistorySearchOf(props.widgetId)
  if (saved) return [new Date(saved.from), new Date(saved.to)]
  const span = presetMs[props.preset ?? '-1h'] ?? presetMs['-1h']
  const end = Date.now()
  return [new Date(end - span), new Date(end)]
}

const defaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 23, 59, 59),
]
const range = ref<[Date, Date]>(initialRange())

function search() {
  const [start, end] = range.value
  const from = start?.getTime()
  const to = end?.getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return
  setTrendHistorySearch(props.widgetId, from, to)
  emit('change')
}
</script>

<template>
  <div class="bar" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop>
    <el-date-picker
      v-model="range"
      type="datetimerange"
      size="small"
      format="YYYY-MM-DD HH:mm:ss"
      range-separator="~"
      start-placeholder="开始"
      end-placeholder="结束"
      :clearable="false"
      :default-time="defaultTime"
      unlink-panels
      popper-class="alarm-history-popper"
    />
    <el-button size="small" type="primary" @click="search">搜索</el-button>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: auto;
  overflow: hidden;
  padding: 2px 4px;
  background: rgba(11, 18, 32, 0.92);
}

.bar :deep(.el-date-editor) {
  flex: 1 1 160px;
  width: auto;
  min-width: 0;
  height: 100%;
  --el-input-bg-color: #0b1220;
  --el-input-text-color: #e2e8f0;
  --el-input-border-color: #334155;
  --el-input-hover-border-color: #3d8bfd;
  --el-text-color-regular: #e2e8f0;
  --el-fill-color-blank: #0b1220;
  --el-input-height: 22px;
}

.bar :deep(.el-range-editor.el-input__wrapper) {
  background: #0b1220;
  box-shadow: 0 0 0 1px #334155 inset;
  padding: 0 4px;
}

.bar :deep(.el-range-input) {
  color: #e2e8f0;
  font-size: 12px;
}

.bar :deep(.el-range-separator) {
  color: #94a3b8;
  padding: 0 2px;
}
</style>
