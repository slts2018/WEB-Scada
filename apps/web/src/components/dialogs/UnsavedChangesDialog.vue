<script setup lang="ts">
let closedByAction: 'save' | 'discard' | 'cancel' | null = null

defineProps<{
  modelValue: boolean
  title?: string
  message?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  save: []
  discard: []
  cancel: []
}>()

function finish(action: 'save' | 'discard' | 'cancel') {
  closedByAction = action
  if (action === 'save') emit('save')
  else if (action === 'discard') emit('discard')
  else emit('cancel')
  emit('update:modelValue', false)
}

function onClosed() {
  if (!closedByAction) emit('cancel')
  closedByAction = null
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title || '未保存的更改'"
    width="440px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="onClosed"
  >
    <p class="msg">{{ message || '当前工程未保存，是否先保存？' }}</p>
    <template #footer>
      <el-button @click="finish('cancel')">取消</el-button>
      <el-button @click="finish('discard')">不保存</el-button>
      <el-button type="primary" @click="finish('save')">保存并继续</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}
</style>
