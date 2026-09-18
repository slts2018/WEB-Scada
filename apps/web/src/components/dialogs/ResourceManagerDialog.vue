<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '@/stores/project'
import { countRefsByResource, findOrphanResourceIds } from '@/shared/project/resourceRefs'
import ModelResourceThumb from '@/components/designer/ModelResourceThumb.vue'
import { invalidateModelThumbnail } from '@/shared/three/modelThumbnail'

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
}>()

const project = useProjectStore()
const replaceInput = ref<HTMLInputElement | null>(null)
const pendingReplaceId = ref<string | null>(null)

const refCounts = computed(() => countRefsByResource(project.document))
const orphanCount = computed(() => findOrphanResourceIds(project.document).length)

function close() {
  emit('update:modelValue', false)
}

function previewUrl(path: string) {
  return project.resolveResourceUrl(path)
}

function onRemove(id: string) {
  const res = project.removeResource(id)
  if (!res.ok) {
    ElMessage.warning(`仍有 ${res.refs} 处引用。将强制删除并清空引用。`)
    const forced = project.removeResource(id, { force: true })
    if (forced.ok) {
      invalidateModelThumbnail(id)
      ElMessage.success('已强制删除并清除引用')
    }
    return
  }
  invalidateModelThumbnail(id)
  ElMessage.success('已删除资源')
}

function onCleanup() {
  const n = project.cleanupOrphanResources()
  ElMessage[n ? 'success' : 'info'](n ? `已清理 ${n} 个未引用资源` : '没有可清理资源')
}

function triggerReplace(id: string) {
  pendingReplaceId.value = id
  replaceInput.value?.click()
}

async function onReplaceFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  const id = pendingReplaceId.value
  input.value = ''
  pendingReplaceId.value = null
  if (!file || !id) return
  try {
    await project.replaceResourceFile(id, file)
    invalidateModelThumbnail(id)
    ElMessage.success('资源已替换')
  } catch (err) {
    if (err instanceof Error && err.message === 'duplicate_model') {
      ElMessage.warning(`已存在同名模型「${file.name}」`)
      return
    }
    ElMessage.error('替换失败')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="资源管理"
    width="820px"
    align-center
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="toolbar">
      <span class="hint">共 {{ project.document.resources.length }} 项 · 未引用 {{ orphanCount }}</span>
      <div class="spacer" />
      <el-button size="small" :disabled="!orphanCount" @click="onCleanup">清理未引用</el-button>
    </div>

    <el-table :data="project.document.resources" stripe height="380" size="small">
      <el-table-column label="预览" width="72">
        <template #default="{ row }">
          <img
            v-if="row.kind === 'image' || row.kind === 'svg'"
            class="thumb"
            :src="previewUrl(row.path)"
            alt=""
          />
          <ModelResourceThumb
            v-else-if="row.kind === 'model'"
            :resource-id="row.id"
            :url="previewUrl(row.path)"
            :bust="row.path"
            :size="48"
          />
          <span v-else class="model">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="kind" label="类型" width="80" />
      <el-table-column label="引用" width="70">
        <template #default="{ row }">{{ refCounts.get(row.id) ?? 0 }}</template>
      </el-table-column>
      <el-table-column prop="id" label="ID" min-width="120" show-overflow-tooltip />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="triggerReplace(row.id)">替换</el-button>
          <el-button size="small" text type="danger" @click="onRemove(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <input
      ref="replaceInput"
      type="file"
      class="hidden"
      accept="image/*,.svg,.glb,.gltf,.obj,.fbx,.stl,model/gltf-binary"
      @change="onReplaceFile"
    />

    <template #footer>
      <el-button type="primary" @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 12px;
  color: var(--scada-muted);
}

.thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  background: #0b0d11;
}

.model {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #1e293b;
  color: #94a3b8;
  font-size: 11px;
}

.hidden {
  display: none;
}
</style>
