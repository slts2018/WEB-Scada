<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import type { AlignMode } from '@/shared/designer/geometry'
import { ElMessage } from 'element-plus'
import { findObject3dDeep } from '@/shared/project/object3dTree'
import {
  Aim,
  ArrowDownBold,
  ArrowLeftBold,
  ArrowRightBold,
  ArrowUpBold,
  DArrowRight,
  Expand,
  Fold,
  FullScreen,
  Hide,
  Lock,
  Monitor,
  Rank,
  RefreshLeft,
  RefreshRight,
  ScaleToOriginal,
  SemiSelect,
  SortUp,
  VideoPlay,
  View,
  ZoomIn,
} from '@element-plus/icons-vue'

const emit = defineEmits<{
  fitAll: []
  fitSelection: []
  normalizeSelection: []
  run: []
}>()

const project = useProjectStore()

const panelOnlySelection = computed(() => {
  const ids = project.selectedObject3dIds
  if (!ids.length) return false
  if (ids.length === 1) {
    const o = project.selectedObject3d
    return Boolean(o?.panel) && !o?.modelResourceId
  }
  const page = project.activePage3d
  if (!page) return false
  return ids.every((id) => {
    const o = findObject3dDeep(page.objects, id)
    return Boolean(o?.panel) && !o?.modelResourceId
  })
})

function align(mode: AlignMode) {
  project.alignSelectedObject3ds(mode)
}

function setGizmo(mode: 'translate' | 'rotate' | 'scale') {
  if (panelOnlySelection.value && (mode === 'rotate' || mode === 'scale')) {
    ElMessage.info('面板对象只能平移，请在面板编辑器中调整大小')
    return
  }
  project.setGizmoMode3d(mode)
  if (!project.selectedObject3dId) {
    ElMessage.info('请先在场景中点击选中对象，再拖红/绿/蓝手柄平移')
  }
}

function doGroup() {
  if (project.selectedObject3dIds.length < 2) {
    ElMessage.warning('请先多选至少 2 个对象（Ctrl/Shift + 左键）')
    return
  }
  const g = project.groupSelectedObject3ds()
  if (!g) ElMessage.warning('只能组合同一层级下的对象')
  else ElMessage.success(`已组合为「${g.name}」`)
}

function doUngroup() {
  const ids = project.ungroupSelectedObject3ds()
  if (!ids.length) ElMessage.warning('请先选中已组合的对象')
  else ElMessage.success(`已解组（${ids.length} 个对象）`)
}

const hasSel = () => project.selectedObject3dIds.length > 0
const canAlign = () => project.selectedObject3dIds.length >= 2
const canDistribute = () => project.selectedObject3dIds.length >= 3
const canGroup = () => project.selectedObject3dIds.length >= 2
const canUngroup = () => project.selectedObjects3d.some((o) => Boolean(o.children?.length))
</script>

<template>
  <div class="toolbar">
    <el-button-group>
      <el-button
        size="small"
        title="撤销"
        :disabled="!project.canUndo"
        :icon="RefreshLeft"
        @click="project.undo()"
      />
      <el-button
        size="small"
        title="重做"
        :disabled="!project.canRedo"
        :icon="RefreshRight"
        @click="project.redo()"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="平移手柄 (W)"
        type="primary"
        :plain="project.gizmoMode3d !== 'translate'"
        :icon="Rank"
        @click="setGizmo('translate')"
      />
      <el-button
        size="small"
        title="旋转手柄 (E)"
        type="primary"
        :plain="project.gizmoMode3d !== 'rotate'"
        :icon="RefreshRight"
        :disabled="panelOnlySelection"
        @click="setGizmo('rotate')"
      />
      <el-button
        size="small"
        title="缩放手柄 (R)"
        type="primary"
        :plain="project.gizmoMode3d !== 'scale'"
        :icon="ZoomIn"
        :disabled="panelOnlySelection"
        @click="setGizmo('scale')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="对齐最小 X"
        :disabled="!canAlign()"
        :icon="ArrowLeftBold"
        @click="align('left')"
      />
      <el-button
        size="small"
        title="对齐 X 中心"
        :disabled="!canAlign()"
        :icon="SemiSelect"
        @click="align('center')"
      />
      <el-button
        size="small"
        title="对齐最大 X"
        :disabled="!canAlign()"
        :icon="ArrowRightBold"
        @click="align('right')"
      />
      <el-button
        size="small"
        title="对齐最大 Y（顶）"
        :disabled="!canAlign()"
        :icon="ArrowUpBold"
        @click="align('top')"
      />
      <el-button
        size="small"
        title="对齐 Y 中心"
        :disabled="!canAlign()"
        :icon="SemiSelect"
        class="icon-rotate-90"
        @click="align('middle')"
      />
      <el-button
        size="small"
        title="对齐最小 Y（底）"
        :disabled="!canAlign()"
        :icon="ArrowDownBold"
        @click="align('bottom')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="沿 X 均匀分布"
        :disabled="!canDistribute()"
        :icon="DArrowRight"
        @click="align('distributeH')"
      />
      <el-button
        size="small"
        title="沿 Z 均匀分布"
        :disabled="!canDistribute()"
        :icon="SortUp"
        @click="align('distributeV')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="组合"
        :disabled="!canGroup()"
        :icon="Fold"
        @click="doGroup()"
      />
      <el-button
        size="small"
        title="解组"
        :disabled="!canUngroup()"
        :icon="Expand"
        @click="doUngroup()"
      />
      <el-button
        size="small"
        title="锁定"
        :disabled="!hasSel()"
        :icon="Lock"
        @click="project.setSelectedObject3dFlags('locked')"
      />
      <el-button
        size="small"
        title="显隐"
        :disabled="!hasSel()"
        :icon="project.selectedObject3d?.visible === false ? Hide : View"
        @click="project.setSelectedObject3dFlags('visible')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="实时预览"
        :type="project.previewLive ? 'primary' : 'default'"
        :icon="Monitor"
        @click="project.setPreviewLive(!project.previewLive)"
      />
    </el-button-group>

    <el-button-group>
      <el-button size="small" title="适配场景" :icon="FullScreen" @click="emit('fitAll')" />
      <el-button
        size="small"
        title="看选中"
        :disabled="!hasSel()"
        :icon="Aim"
        @click="emit('fitSelection')"
      />
      <el-button
        size="small"
        title="适配尺寸"
        :disabled="!hasSel()"
        :icon="ScaleToOriginal"
        @click="emit('normalizeSelection')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        type="warning"
        title="运行"
        :icon="VideoPlay"
        @click="emit('run')"
      />
    </el-button-group>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
}

.icon-rotate-90 :deep(.el-icon) {
  transform: rotate(90deg);
}
</style>
