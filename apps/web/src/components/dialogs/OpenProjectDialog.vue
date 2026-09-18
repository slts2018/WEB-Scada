<script setup lang="ts">
import type { ProjectIndexItem } from '@/shared/storage/projectStorage'

defineProps<{
  modelValue: boolean
  projects: ProjectIndexItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  open: [id: string]
  remove: [id: string]
}>()

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="打开工程"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-empty v-if="!projects.length" description="还没有已保存工程" />
    <ul v-else class="list">
      <li v-for="item in projects" :key="item.id">
        <button type="button" class="meta" @click="emit('open', item.id)">
          <strong>{{ item.name }}</strong>
          <span>v{{ item.version }} · {{ new Date(item.updatedAt).toLocaleString() }}</span>
        </button>
        <el-button size="small" text type="danger" @click="emit('remove', item.id)">
          删除
        </el-button>
      </li>
    </ul>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
}

.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--scada-border);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  flex: 1;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 0;
}

.meta:hover strong {
  color: var(--scada-accent);
}

.meta span {
  font-size: 12px;
  color: var(--scada-muted);
}
</style>
