<script setup lang="ts">
/**
 * 时间范围：数字 + 单位（秒 / 分钟 / 小时 / 天）。
 * 值仍按相对区间字符串存储（如 -15s、-15m、-1h），查询侧沿用现有解析。
 */
import { computed } from 'vue'
import {
  TREND_DURATION_UNITS,
  formatTrendDuration,
  parseTrendDuration,
  type TrendDurationUnit,
} from '@/shared/runtime/trendHistoryQuery'

const props = withDefaults(
  defineProps<{
    modelValue: string
    compact?: boolean
    disabled?: boolean
  }>(),
  { compact: false, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const parsed = computed(() => parseTrendDuration(props.modelValue) ?? { value: 1, unit: 'h' as TrendDurationUnit })
const amount = computed(() => parsed.value.value)
const unit = computed(() => parsed.value.unit)

function commit(value: number, nextUnit: TrendDurationUnit): void {
  const n = Math.max(1, Math.min(9999, Math.floor(Number(value) || 1)))
  emit('update:modelValue', formatTrendDuration(n, nextUnit))
}
</script>

<template>
  <div class="trend-range" :class="{ compact }">
    <el-input-number
      class="trend-range-num"
      size="small"
      :model-value="amount"
      :min="1"
      :max="9999"
      :step="1"
      :controls="!compact"
      controls-position="right"
      :disabled="disabled"
      @update:model-value="(v: number | undefined) => commit(Number(v), unit)"
    />
    <el-select
      class="trend-range-unit"
      size="small"
      :model-value="unit"
      :disabled="disabled"
      :teleported="!compact"
      @change="(v: string) => commit(amount, v as TrendDurationUnit)"
    >
      <el-option v-for="item in TREND_DURATION_UNITS" :key="item.id" :label="item.label" :value="item.id" />
    </el-select>
  </div>
</template>

<style scoped>
.trend-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.trend-range-num {
  width: 110px;
}
.trend-range-unit {
  width: 84px;
}
.trend-range.compact {
  gap: 4px;
}
.trend-range.compact .trend-range-num {
  width: 64px;
}
.trend-range.compact .trend-range-unit {
  width: 72px;
}
.trend-range.compact :deep(.el-input-number .el-input__wrapper) {
  padding-left: 6px;
  padding-right: 6px;
}
</style>
