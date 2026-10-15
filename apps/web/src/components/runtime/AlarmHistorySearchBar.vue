<script setup lang="ts">
import { ref } from 'vue'
import { alarmHistoryQuery } from '@/shared/runtime/alarmHistoryQuery'

const props = defineProps<{ widgetId: string }>()
const emit = defineEmits<{ change: [] }>()

const query = alarmHistoryQuery(props.widgetId)
const defaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 23, 59, 59),
]
const text = ref(query.text)
const event = ref<'all' | 'raise' | 'clear' | 'ack'>(query.event || 'all')
const level = ref<'all' | 'info' | 'alarm' | 'fault'>(query.level || 'all')
const range = ref<[Date, Date]>([new Date(query.from), new Date(query.to)])

function search() {
  const [start, end] = range.value
  const from = start?.getTime()
  const to = end?.getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return
  query.text = text.value.trim()
  query.event = event.value === 'all' ? '' : event.value
  query.level = level.value === 'all' ? '' : level.value
  query.from = from
  query.to = to
  query.page = 1
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
    <el-input
      v-model="text"
      class="keyword"
      size="small"
      placeholder="搜索"
      @keydown.enter.prevent="search"
    />
    <el-select v-model="event" class="choice" size="small" popper-class="alarm-history-popper">
      <el-option label="事件" value="all" />
      <el-option label="触发" value="raise" />
      <el-option label="恢复" value="clear" />
      <el-option label="确认" value="ack" />
    </el-select>
    <el-select v-model="level" class="choice" size="small" popper-class="alarm-history-popper">
      <el-option label="级别" value="all" />
      <el-option label="提示" value="info" />
      <el-option label="报警" value="alarm" />
      <el-option label="故障" value="fault" />
    </el-select>
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
}

.bar :deep(.el-date-editor) {
  flex: 1.4 1 180px;
  width: auto;
  min-width: 0;
  height: 100%;
  --el-input-bg-color: #0b1220;
  --el-input-text-color: #e2e8f0;
  --el-input-border-color: #334155;
  --el-input-hover-border-color: #3d8bfd;
  --el-text-color-regular: #e2e8f0;
  --el-text-color-primary: #e2e8f0;
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

.keyword {
  flex: 1 1 88px;
  min-width: 0;
}

.choice {
  flex: 0 0 84px;
  width: 84px;
}

.bar :deep(.el-input),
.bar :deep(.el-select),
.bar :deep(.el-button) {
  height: 100%;
}

.bar :deep(.el-input__wrapper),
.bar :deep(.el-select__wrapper) {
  min-height: 0;
  height: 100%;
  background: #0b1220;
  box-shadow: 0 0 0 1px #334155 inset;
}

.bar :deep(.el-input__inner),
.bar :deep(.el-select__placeholder),
.bar :deep(.el-select__selected-item) {
  color: #e2e8f0;
  font-size: 12px;
}

.bar :deep(.el-button) {
  padding: 0 8px;
}
</style>

<style>
.alarm-history-popper.el-popper {
  z-index: 30000 !important;
}

.alarm-history-popper .el-date-range-picker {
  width: 520px;
}

.alarm-history-popper .el-date-range-picker__time-header {
  padding: 4px 6px 0;
}

.alarm-history-popper .el-date-range-picker__content {
  padding: 8px 6px 6px;
}

.alarm-history-popper .el-date-range-picker__header {
  height: 24px;
}

.alarm-history-popper .el-date-table th {
  padding: 2px 0;
}

.alarm-history-popper .el-date-table td {
  width: 26px;
  height: 22px;
  padding: 0;
}

.alarm-history-popper .el-date-table td .el-date-table-cell {
  height: 22px;
  padding: 0;
}

.alarm-history-popper .el-date-table td .el-date-table-cell__text {
  width: 20px;
  height: 20px;
  line-height: 20px;
}
</style>
