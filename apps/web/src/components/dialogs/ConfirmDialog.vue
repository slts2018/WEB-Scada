<script setup lang="ts">
let confirmed = false

defineProps<{
  modelValue: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: []
  cancel: []
}>()

function close() {
  confirmed = false
  emit('update:modelValue', false)
}

function ok() {
  confirmed = true
  emit('confirm')
  emit('update:modelValue', false)
}

function onClosed() {
  if (!confirmed) emit('cancel')
  confirmed = false
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title || '确认'"
    width="420px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="onClosed"
  >
    <p class="msg">{{ message }}</p>
    <template #footer>
      <el-button @click="close">{{ cancelText || '取消' }}</el-button>
      <el-button :type="danger ? 'danger' : 'primary'" @click="ok">
        {{ confirmText || '确定' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--scada-text);
}
</style>
