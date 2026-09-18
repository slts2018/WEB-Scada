<script setup lang="ts">
import { useProjectStore } from '@/stores/project'
import type { AlignMode } from '@/shared/designer/geometry'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDownBold,
  ArrowLeftBold,
  ArrowRightBold,
  ArrowUpBold,
  CollectionTag,
  DArrowRight,
  Download,
  Expand,
  Fold,
  Grid,
  Magnet,
  Monitor,
  RefreshLeft,
  RefreshRight,
  SemiSelect,
  SortDown,
  SortUp,
  Upload,
  VideoPlay,
} from '@element-plus/icons-vue'

const emit = defineEmits<{
  run: []
}>()

const project = useProjectStore()

function align(mode: AlignMode) {
  project.alignSelected(mode)
}

const hasSel = () => project.selectedWidgetIds.length > 0
const canAlign = () => project.selectedWidgetIds.length >= 2
const canDistribute = () => project.selectedWidgetIds.length >= 3
const canGroup = () => project.selectedWidgetIds.length >= 2
const canUngroup = () => project.selectedWidgets.some((w) => w.type === 'group')
const canSaveSymbol = () => project.selectedWidgetIds.length >= 1

async function saveSymbol() {
  if (!canSaveSymbol()) {
    ElMessage.warning('请先选中图元')
    return
  }
  try {
    const def =
      project.selectedWidgetIds.length > 1
        ? '组合符号'
        : project.selectedWidget?.name || '符号'
    const { value } = await ElMessageBox.prompt('符号名称（多选将先自动组合）', '存为符号', {
      inputValue: def,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    const name = String(value ?? '').trim()
    if (!name) return
    const sym = project.saveSymbolFromSelection(name)
    if (sym) ElMessage.success(`已保存符号：${sym.name}`)
    else ElMessage.warning('保存失败')
  } catch {
    /* cancel */
  }
}
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
        title="左齐"
        :disabled="!canAlign()"
        :icon="ArrowLeftBold"
        @click="align('left')"
      />
      <el-button
        size="small"
        title="水平居中"
        :disabled="!canAlign()"
        :icon="SemiSelect"
        @click="align('center')"
      />
      <el-button
        size="small"
        title="右齐"
        :disabled="!canAlign()"
        :icon="ArrowRightBold"
        @click="align('right')"
      />
      <el-button
        size="small"
        title="顶齐"
        :disabled="!canAlign()"
        :icon="ArrowUpBold"
        @click="align('top')"
      />
      <el-button
        size="small"
        title="垂直居中"
        :disabled="!canAlign()"
        :icon="SemiSelect"
        class="icon-rotate-90"
        @click="align('middle')"
      />
      <el-button
        size="small"
        title="底齐"
        :disabled="!canAlign()"
        :icon="ArrowDownBold"
        @click="align('bottom')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="水平分布"
        :disabled="!canDistribute()"
        :icon="DArrowRight"
        @click="align('distributeH')"
      />
      <el-button
        size="small"
        title="垂直分布"
        :disabled="!canDistribute()"
        :icon="SortUp"
        @click="align('distributeV')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="置顶"
        :disabled="!hasSel()"
        :icon="Upload"
        @click="project.reorderSelected('front')"
      />
      <el-button
        size="small"
        title="上移"
        :disabled="!hasSel()"
        :icon="SortUp"
        @click="project.reorderSelected('forward')"
      />
      <el-button
        size="small"
        title="下移"
        :disabled="!hasSel()"
        :icon="SortDown"
        @click="project.reorderSelected('backward')"
      />
      <el-button
        size="small"
        title="置底"
        :disabled="!hasSel()"
        :icon="Download"
        @click="project.reorderSelected('back')"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="左转 90°"
        :disabled="!hasSel()"
        :icon="RefreshLeft"
        @click="project.rotateSelected(-90)"
      />
      <el-button
        size="small"
        title="右转 90°"
        :disabled="!hasSel()"
        :icon="RefreshRight"
        @click="project.rotateSelected(90)"
      />
    </el-button-group>

    <el-button-group>
      <el-button
        size="small"
        title="组合"
        :disabled="!canGroup()"
        :icon="Fold"
        @click="project.groupSelected()"
      />
      <el-button
        size="small"
        title="解组"
        :disabled="!canUngroup()"
        :icon="Expand"
        @click="project.ungroupSelected()"
      />
      <el-button
        size="small"
        title="存为符号"
        :disabled="!canSaveSymbol()"
        :icon="CollectionTag"
        @click="saveSymbol"
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
      <el-button
        size="small"
        title="网格吸附"
        :type="project.snapEnabled ? 'primary' : 'default'"
        :icon="Magnet"
        @click="project.snapEnabled = !project.snapEnabled"
      />
      <el-button
        size="small"
        title="显示网格"
        :type="project.gridVisible ? 'primary' : 'default'"
        :icon="Grid"
        @click="project.gridVisible = !project.gridVisible"
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
