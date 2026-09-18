<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { getStorageMode } from '@/shared/storage/repository'

const props = defineProps<{
  modelValue: boolean
  name: string
  description?: string
  projectId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [payload: { name: string; description: string }]
}>()

const form = reactive({
  name: props.name,
  description: props.description || '',
})

const pathLabel = computed(() => {
  const id = props.projectId || '(未保存)'
  return getStorageMode() === 'api' ? `server://${id}` : `localStorage://${id}`
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.name = props.name
      form.description = props.description || ''
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function ok() {
  const name = form.name.trim()
  if (!name) return
  emit('confirm', { name, description: form.description.trim() })
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="工程属性"
    width="520px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form">
      <label>
        <span>名称：</span>
        <el-input v-model="form.name" maxlength="99" />
      </label>
      <label>
        <span>路径：</span>
        <el-input :model-value="pathLabel" readonly />
      </label>
      <label class="top">
        <span>描述：</span>
        <el-input v-model="form.description" type="textarea" :rows="3" />
      </label>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!form.name.trim()" @click="ok">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

label {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  color: var(--scada-muted);
}

label.top {
  align-items: start;
}

label.top span {
  padding-top: 6px;
}
</style>
