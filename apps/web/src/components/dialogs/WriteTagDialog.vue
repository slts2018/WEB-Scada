<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  tagId: string
  value: string | number | boolean
  /** confirm=仅确认；edit=可改值后写入 */
  mode?: 'confirm' | 'edit'
  valueType?: 'number' | 'boolean' | 'string'
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [value: string | number | boolean]
  cancel: []
}>()

let confirmed = false
const editValue = ref('')

watch(
  () => [props.modelValue, props.value] as const,
  ([open]) => {
    if (open) editValue.value = String(props.value ?? '')
  },
)

const title = computed(() => (props.mode === 'edit' ? '写入变量' : '写值确认'))

function parseEdit(): string | number | boolean {
  if (props.valueType === 'boolean') {
    const v = editValue.value.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'on'
  }
  if (props.valueType === 'number') {
    const n = Number(editValue.value)
    return Number.isFinite(n) ? n : 0
  }
  return editValue.value
}

function close() {
  confirmed = false
  emit('update:modelValue', false)
}

function ok() {
  confirmed = true
  const value = props.mode === 'edit' ? parseEdit() : props.value
  emit('confirm', value)
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
    :title="title"
    width="440px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="onClosed"
  >
    <div class="body">
      <p>{{ mode === 'edit' ? '请输入要写入的值：' : '确认写入以下变量？' }}</p>
      <div class="kv">
        <span>Tag</span>
        <strong>{{ tagId }}</strong>
      </div>
      <div v-if="mode === 'edit'" class="edit">
        <el-input v-if="valueType !== 'boolean'" v-model="editValue" size="default" />
        <el-select v-else v-model="editValue" style="width: 100%">
          <el-option label="true / ON" value="true" />
          <el-option label="false / OFF" value="false" />
        </el-select>
      </div>
      <div v-else class="kv">
        <span>值</span>
        <strong>{{ String(value) }}</strong>
      </div>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="warning" @click="ok">确认写入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body p {
  margin: 0 0 12px;
  font-size: 14px;
}

.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--scada-border);
  font-size: 13px;
  color: var(--scada-muted);
}

.kv strong {
  color: var(--scada-text);
  word-break: break-all;
  text-align: right;
}

.edit {
  margin-top: 10px;
}
</style>
