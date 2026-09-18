<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()

const layers = computed(() => project.activePage2d?.layers ?? [])

function isActive(id: string) {
  return project.activeLayerId === id
}

function selectLayer(id: string) {
  project.setActiveLayer(id)
}

async function onAdd() {
  const layer = project.addLayer()
  if (layer) ElMessage.success(`已添加 ${layer.name}`)
}

async function onRename(id: string, current: string) {
  try {
    const { value } = await ElMessageBox.prompt('图层名称', '重命名图层', {
      inputValue: current,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
    const name = String(value ?? '').trim()
    if (name) project.renameLayer(id, name)
  } catch {
    /* cancel */
  }
}

function onRemove(id: string) {
  if (!project.removeLayer(id)) {
    ElMessage.warning('无法删除：至少保留一层，或先移走图元')
  }
}
</script>

<template>
  <div class="layers">
    <div class="head">
      <span>图层</span>
      <el-button size="small" text type="primary" :disabled="!project.activePage2d" @click="onAdd">
        +
      </el-button>
    </div>
    <div v-if="!layers.length" class="empty">无图层</div>
    <ul v-else class="list">
      <li
        v-for="layer in layers"
        :key="layer.id"
        class="row"
        :class="{ active: isActive(layer.id) }"
        @click="selectLayer(layer.id)"
      >
        <button
          type="button"
          class="flag"
          :title="layer.visible ? '隐藏' : '显示'"
          @click.stop="project.setLayerFlag(layer.id, 'visible', !layer.visible)"
        >
          {{ layer.visible ? '显' : '隐' }}
        </button>
        <button
          type="button"
          class="flag"
          :title="layer.locked ? '解锁' : '锁定'"
          @click.stop="project.setLayerFlag(layer.id, 'locked', !layer.locked)"
        >
          {{ layer.locked ? '锁' : '开' }}
        </button>
        <span class="name" :title="layer.name">{{ layer.name }}</span>
        <span class="count">{{ layer.widgets.length }}</span>
        <button type="button" class="mini" title="上移" @click.stop="project.moveLayer(layer.id, 'up')">
          ↑
        </button>
        <button type="button" class="mini" title="下移" @click.stop="project.moveLayer(layer.id, 'down')">
          ↓
        </button>
        <button type="button" class="mini" title="重命名" @click.stop="onRename(layer.id, layer.name)">
          名
        </button>
        <button type="button" class="mini danger" title="删除" @click.stop="onRemove(layer.id)">
          ×
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.layers {
  border-bottom: 1px solid var(--scada-border);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--scada-muted);
  margin-bottom: 6px;
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
  padding: 4px 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow: auto;
}

.row {
  display: grid;
  grid-template-columns: 22px 22px 1fr auto repeat(4, 18px);
  align-items: center;
  gap: 2px;
  padding: 4px 4px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--scada-text);
}

.row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.row.active {
  background: rgba(61, 139, 253, 0.16);
  outline: 1px solid rgba(61, 139, 253, 0.35);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  color: var(--scada-muted);
  font-size: 11px;
  min-width: 1.2em;
  text-align: right;
}

.flag,
.mini {
  border: none;
  background: transparent;
  color: var(--scada-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  font-size: 12px;
}

.flag:hover,
.mini:hover {
  color: var(--scada-text);
}

.mini.danger:hover {
  color: #f87171;
}
</style>
