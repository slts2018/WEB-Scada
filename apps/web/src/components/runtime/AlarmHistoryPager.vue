<script setup lang="ts">
import { computed } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {
  HISTORY_PAGE_SIZES,
  alarmHistoryPageInfo,
  alarmHistoryQuery,
} from '@/shared/runtime/alarmHistoryQuery'

const props = defineProps<{ widgetId: string }>()
const emit = defineEmits<{ change: [] }>()

const query = alarmHistoryQuery(props.widgetId)
const info = computed(() => alarmHistoryPageInfo(props.widgetId))

function onPage(page: number) {
  if (page === query.page) return
  query.page = page
  emit('change')
}

function onSize(size: number) {
  if (size === query.pageSize) return
  query.pageSize = size
  query.page = 1
  emit('change')
}
</script>

<template>
  <div class="pager" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop>
    <el-config-provider :locale="zhCn">
      <el-pagination
        size="small"
        layout="sizes, prev, pager, next"
        :page-sizes="HISTORY_PAGE_SIZES"
        :pager-count="5"
        :total="info.total"
        :page-size="query.pageSize || HISTORY_PAGE_SIZES[0]"
        :current-page="query.page || 1"
        popper-class="alarm-history-popper"
        @size-change="onSize"
        @current-change="onPage"
      />
    </el-config-provider>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: auto;
  overflow: hidden;
}

.pager :deep(.el-pagination) {
  --el-pagination-button-width: 22px;
  --el-pagination-button-height: 22px;
  --el-pagination-bg-color: transparent;
  --el-pagination-button-color: #e2e8f0;
  --el-pagination-hover-color: #93c5fd;
  --el-pagination-font-size: 12px;
  --el-fill-color-blank: #0b1220;
  --el-text-color-regular: #e2e8f0;
  --el-border-color: #334155;
}

.pager :deep(.el-pagination button),
.pager :deep(.el-pager li) {
  background: transparent;
  min-width: 22px;
}

.pager :deep(.el-pagination__sizes) {
  margin-right: 4px;
}

.pager :deep(.el-select) {
  width: 108px;
}

.pager :deep(.el-select__wrapper) {
  min-height: 22px;
  background: #0b1220;
  box-shadow: 0 0 0 1px #334155 inset;
}
</style>
