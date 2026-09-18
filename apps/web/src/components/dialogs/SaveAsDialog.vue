<script setup lang="ts">
import { reactive, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  defaultName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [name: string]
}>()

const form = reactive({ name: props.defaultName })

watch(
  () => props.modelValue,
  (open) => {
    if (open) form.name = props.defaultName
  },
)

function close() {
  emit('update:modelValue', false)
}

function ok() {
  const name = form.name.trim()
  if (!name) return
  emit('confirm', name)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="另存为"
    width="480px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form">
      <label>
        <span>名称：</span>
        <el-input v-model="form.name" maxlength="99" />
      </label>
      <p class="hint">将复制当前工程为新的本地工程并保存。</p>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!form.name.trim()" @click="ok">另存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

label {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  color: var(--scada-muted);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--scada-muted);
}
</style>
