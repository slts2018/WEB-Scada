<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { getStorageMode } from '@/shared/storage/repository'

const props = defineProps<{
  modelValue: boolean
  name: string
  description?: string
  projectId?: string
  runtimePageId?: string
  pages?: Array<{ id: string; name: string; type: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [payload: { name: string; description: string; runtimePageId?: string }]
}>()

const form = reactive({
  name: props.name,
  description: props.description || '',
  runtimePageId: props.runtimePageId || '',
})

const pageOptions = computed(() => {
  const list = (props.pages || []).map((p) => ({ ...p }))
  const id = form.runtimePageId
  if (id && !list.some((p) => p.id === id)) {
    list.push({ id, name: '（页面已不存在）', type: '' })
  }
  return list
})

function pageOptionLabel(p: { name: string; type: string }) {
  if (p.type === '3d') return `${p.name}（3D）`
  if (p.type === '2d') return `${p.name}（2D）`
  return p.name
}

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
      form.runtimePageId = props.runtimePageId || ''
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function ok() {
  const name = form.name.trim()
  if (!name) return
  emit('confirm', {
    name,
    description: form.description.trim(),
    runtimePageId: form.runtimePageId.trim() || undefined,
  })
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
      <label>
        <span>运行时显示页面：</span>
        <el-select
          v-model="form.runtimePageId"
          clearable
          filterable
          placeholder="默认（当前编辑页）"
          style="width: 100%"
        >
          <el-option
            v-for="item in pageOptions"
            :key="item.id"
            :label="pageOptionLabel(item)"
            :value="item.id"
          />
        </el-select>
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
  grid-template-columns: 7.5em 1fr;
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
