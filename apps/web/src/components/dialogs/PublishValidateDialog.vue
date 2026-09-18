<script setup lang="ts">
import { computed } from 'vue'
import type { PublishValidationResult } from '@/shared/project/publishValidate'

const props = defineProps<{
  modelValue: boolean
  result: PublishValidationResult | null
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: []
  cancel: []
}>()

const canPublish = computed(() => Boolean(props.result?.ok))

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function ok() {
  if (!canPublish.value) return
  emit('confirm')
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="发布校验"
    width="640px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="result" class="body">
      <div class="summary">
        <el-tag :type="result.ok ? 'success' : 'danger'" size="small">
          {{ result.ok ? '可通过' : '存在错误' }}
        </el-tag>
        <span>错误 {{ result.errors.length }}</span>
        <span>警告 {{ result.warnings.length }}</span>
      </div>

      <el-table v-if="result.issues.length" :data="result.issues" size="small" max-height="360" stripe>
        <el-table-column label="级别" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.level === 'error' ? 'danger' : 'warning'">
              {{ row.level === 'error' ? '错误' : '警告' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="说明" min-width="280" show-overflow-tooltip />
        <el-table-column prop="pageName" label="页面" width="120" show-overflow-tooltip />
      </el-table>

      <div v-else class="ok-msg">未发现问题，可以发布。</div>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!canPublish" @click="ok">
        {{ result?.warnings.length && result.ok ? '仍要发布' : '确认发布' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--scada-muted);
}

.ok-msg {
  padding: 16px 0;
  color: #86efac;
  font-size: 13px;
}
</style>
