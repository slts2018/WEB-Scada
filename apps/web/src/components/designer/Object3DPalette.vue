<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BuiltinPrimitive3D } from '@web-scada/core'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from '@/stores/project'
import ModelResourceThumb from '@/components/designer/ModelResourceThumb.vue'
import { countRefsByResource } from '@/shared/project/resourceRefs'
import { invalidateModelThumbnail } from '@/shared/three/modelThumbnail'

const project = useProjectStore()
const fileInput = ref<HTMLInputElement | null>(null)

const primitives: Array<{ type: BuiltinPrimitive3D; label: string }> = [
  { type: 'box', label: '立方体' },
  { type: 'sphere', label: '球体' },
  { type: 'cylinder', label: '圆柱' },
  { type: 'arrow', label: '箭头' },
]

const modelResources = computed(() =>
  project.document.resources.filter((r) => r.kind === 'model'),
)

function modelUrl(id: string) {
  return project.getResourceUrl(id) || ''
}

function addPrimitive(type: BuiltinPrimitive3D) {
  if (!project.activePage3d) {
    ElMessage.warning('请先选择 3D 页面')
    return
  }
  project.addObject3d({ primitive: type })
  if (type === 'arrow') {
    ElMessage.success('已添加箭头（默认可指向下方，旋转手柄可改方向）')
  }
}

function addPanel() {
  if (!project.activePage3d) {
    ElMessage.warning('请先选择 3D 页面')
    return
  }
  void project.addObject3d({ panel: true, name: '面板' })
  ElMessage.success('已添加跟镜头面板（属性或双击打开编辑弹窗）')
}

function placeModel(resourceId: string, name?: string) {
  if (!project.activePage3d) {
    ElMessage.warning('请先选择 3D 页面')
    return
  }
  void (async () => {
    await project.addObject3d({ modelResourceId: resourceId, name: name || '模型' })
    ElMessage.success('已放置模型（已按尺寸自动缩放）')
  })()
}

async function removeModel(res: { id: string; name: string }, ev: Event) {
  ev.stopPropagation()
  ev.preventDefault()
  const refs = countRefsByResource(project.document).get(res.id) ?? 0
  try {
    if (refs > 0) {
      await ElMessageBox.confirm(
        `「${res.name}」在场景中有 ${refs} 处引用。删除后将一并移除这些对象，是否继续？`,
        '删除模型',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } else {
      await ElMessageBox.confirm(`确定删除模型「${res.name}」？`, '删除模型', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    }
  } catch {
    return
  }

  const result = project.deleteModelResource(res.id)
  if (!result.ok) {
    ElMessage.error('删除失败')
    return
  }
  invalidateModelThumbnail(res.id)
  ElMessage.success(
    result.removedObjects > 0
      ? `已删除模型，并移除场景中 ${result.removedObjects} 个对象`
      : '已删除模型',
  )
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/\.(glb|gltf|obj|fbx|stl)$/i.test(file.name)) {
    ElMessage.warning('请选择 .glb / .gltf / .obj / .fbx / .stl 模型文件')
    return
  }
  try {
    await project.addModelObjectFromFile(file)
    ElMessage.success('已导入模型（已按尺寸自动缩放）')
  } catch (err) {
    if (err instanceof Error && err.message === 'duplicate_model') {
      ElMessage.warning(`已存在同名模型「${file.name}」，请勿重复导入`)
      return
    }
    ElMessage.error('模型读取失败')
  }
}
</script>

<template>
  <div class="palette3d">
    <input
      ref="fileInput"
      type="file"
      accept=".glb,.gltf,.obj,.fbx,.stl,model/gltf-binary,model/gltf+json"
      class="hidden"
      @change="onFile"
    />
    <div class="panel-title">基础图元</div>
    <div class="grid">
      <button
        v-for="item in primitives"
        :key="item.type"
        type="button"
        class="item"
        @click="addPrimitive(item.type)"
      >
        <span class="icon" :data-type="item.type" />
        <span>{{ item.label }}</span>
      </button>
      <button type="button" class="item" @click="addPanel">
        <span class="icon panel" />
        <span>面板</span>
      </button>
    </div>
    <div class="panel-title">模型</div>
    <el-button size="small" class="full" @click="fileInput?.click()">
      导入 GLB / GLTF / OBJ / FBX / STL
    </el-button>
    <div v-if="modelResources.length" class="model-list">
      <div v-for="res in modelResources" :key="res.id" class="model-item">
        <button
          type="button"
          class="model-place"
          :title="`放置：${res.name}`"
          @click="placeModel(res.id, res.name)"
        >
          <ModelResourceThumb
            class="preview"
            :resource-id="res.id"
            :url="modelUrl(res.id)"
            :bust="res.path"
            :size="72"
          />
          <span class="name">{{ res.name }}</span>
        </button>
        <button
          type="button"
          class="model-del"
          title="删除模型"
          @click="removeModel(res, $event)"
        >
          删
        </button>
      </div>
    </div>
    <div v-else class="hint">暂无已上传模型，可先导入</div>
  </div>
</template>

<style scoped>
.palette3d {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.hidden {
  display: none;
}

.panel-title {
  margin: 4px 0;
  font-size: 12px;
  color: var(--scada-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  background: #12151c;
  color: var(--scada-text);
  cursor: pointer;
  font-size: 12px;
}

.item:hover {
  border-color: var(--scada-accent);
}

.icon {
  width: 28px;
  height: 22px;
  background: #3d8bfd;
  border-radius: 3px;
}

.icon[data-type='sphere'] {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #22c55e;
}

.icon[data-type='cylinder'] {
  width: 18px;
  height: 24px;
  border-radius: 8px;
  background: #f59e0b;
}

.icon[data-type='arrow'] {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 16px solid #38bdf8;
  background: transparent;
  border-radius: 0;
}

.icon.panel {
  width: 28px;
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(180deg, #0e7490 0%, #38bdf8 100%);
  border: 1px solid rgba(125, 211, 252, 0.5);
  box-shadow: inset 0 -8px 0 rgba(15, 18, 26, 0.35);
}

.full {
  width: 100%;
}

.model-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  /* 高度交给外层控件库 .scroll，避免双重裁切导致滚不动 */
  padding-right: 2px;
}

.model-item {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  background: #12151c;
  min-width: 0;
  overflow: hidden;
}

.model-item:hover {
  border-color: var(--scada-accent);
}

.model-place {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
  border: 0;
  background: transparent;
  color: var(--scada-text);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  min-width: 0;
}

.model-place :deep(.thumb) {
  width: 100% !important;
  height: 72px !important;
}

.model-del {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(248, 113, 113, 0.45);
  border-radius: 4px;
  background: rgba(127, 29, 29, 0.85);
  color: #fecaca;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.model-del:hover {
  background: #b91c1c;
  color: #fff;
}

.name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--scada-text);
  font-size: 11px;
  line-height: 1.3;
  padding: 0 2px 2px;
}

.hint {
  font-size: 11px;
  color: var(--scada-muted);
}
</style>
