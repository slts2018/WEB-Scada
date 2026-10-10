<script setup lang="ts">
/**
 * 跟镜头面板 · 2D 内容弹窗编辑器
 * 复用 Canvas2DBoard / 图元库 / 属性面板；返回还原快照，保存后回到 3D 页。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { normalizeObject3DPanel, type Page2D } from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import Canvas2DBoard from '@/components/designer/Canvas2DBoard.vue'
import WidgetPalette from '@/components/designer/WidgetPalette.vue'
import PropertyPanel from '@/components/designer/PropertyPanel.vue'
import LayerPanel from '@/components/designer/LayerPanel.vue'
import AlignToolbar from '@/components/designer/AlignToolbar.vue'

const project = useProjectStore()
const bgInput = ref<HTMLInputElement | null>(null)

const visible = computed({
  get: () => project.object3dPanelEditorOpen,
  set: (v: boolean) => {
    if (!v) project.discardObject3dPanelEditor()
  },
})

const panelObj = computed(() => project.getPanelEditObject())

const panelPage = computed((): Page2D | null => {
  const id = project.panelEditObjectId
  if (!id) return null
  return project.getPanelPage2d(id) ?? project.activePage2d
})

/** 跟镜头面板背景图仍挂在 Object3DPanel.backgroundResourceId，需单独传给画布 */
const backgroundImageUrl = computed(() => {
  const id = panelObj.value?.panel?.backgroundResourceId?.trim()
  if (!id) return undefined
  return project.getResourceUrl(id)
})

const hasBackgroundImage = computed(() =>
  Boolean(panelObj.value?.panel?.backgroundResourceId?.trim()),
)

const title = computed(() => {
  const name = panelObj.value?.name?.trim() || '面板'
  const size = panelPage.value
    ? `${panelPage.value.width}×${panelPage.value.height}`
    : ''
  return size ? `编辑面板 · ${name}（${size}）` : `编辑面板 · ${name}`
})

function onSave() {
  project.saveObject3dPanelEditor()
  ElMessage.success('面板内容已保存')
}

function onReturn() {
  project.discardObject3dPanelEditor()
}

async function onBgUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const obj = panelObj.value
  if (!file || !obj?.panel) return
  try {
    const resource = await project.addImageResource(file)
    project.updateObject3d(obj.id, {
      panel: normalizeObject3DPanel({
        ...obj.panel,
        backgroundResourceId: resource.id,
      }),
    })
    ElMessage.success('背景已更新')
  } catch {
    ElMessage.error('背景上传失败')
  }
}

function clearBackground() {
  const obj = panelObj.value
  if (!obj?.panel) return
  const next = normalizeObject3DPanel(obj.panel)
  delete next.backgroundResourceId
  project.updateObject3d(obj.id, { panel: next })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    fullscreen
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    destroy-on-close
    append-to-body
    align-center
    class="panel-page-editor-dialog"
    modal-class="panel-page-editor-modal"
  >
    <template #header>
      <div class="hdr">
        <span class="hdr-title">{{ title }}</span>
        <div class="hdr-actions">
          <el-button size="small" @click="bgInput?.click()">背景图</el-button>
          <el-button
            v-if="hasBackgroundImage"
            size="small"
            plain
            @click="clearBackground"
          >
            清除背景
          </el-button>
          <el-button size="small" @click="onReturn">返回</el-button>
          <el-button size="small" type="primary" @click="onSave">保存</el-button>
          <input
            ref="bgInput"
            class="hidden-file"
            type="file"
            accept="image/*,.svg"
            @change="onBgUpload"
          />
        </div>
      </div>
    </template>

    <div v-if="panelPage" class="editor-body">
      <aside class="col left">
        <div class="col-title">图层</div>
        <div class="col-block">
          <LayerPanel />
        </div>
        <div class="col-title">属性</div>
        <div class="col-scroll">
          <PropertyPanel />
        </div>
      </aside>

      <section class="col center">
        <div class="toolbar-row">
          <AlignToolbar />
        </div>
        <div class="canvas-wrap">
          <Canvas2DBoard :page="panelPage" :background-image-url="backgroundImageUrl" />
        </div>
      </section>

      <aside class="col right">
        <div class="col-title">图元</div>
        <div class="col-scroll">
          <WidgetPalette />
        </div>
      </aside>
    </div>
    <div v-else class="empty">无法加载面板页面</div>
  </el-dialog>
</template>

<style scoped>
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.hdr-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--scada-text, #e8eaed);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.hdr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.editor-body {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(200px, 260px);
  background: var(--scada-bg, #0f1115);
}

.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.col.left,
.col.right {
  background: var(--scada-panel, #171a21);
}

.col.left {
  border-right: 1px solid var(--scada-border, #2a2f3a);
}

.col.right {
  border-left: 1px solid var(--scada-border, #2a2f3a);
}

.col-title {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--scada-muted, #9aa3b2);
  border-bottom: 1px solid var(--scada-border, #2a2f3a);
}

.col-block {
  flex-shrink: 0;
  padding: 8px;
  border-bottom: 1px solid var(--scada-border, #2a2f3a);
}

.col-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.col.center {
  background: var(--scada-bg, #0f1115);
}

.toolbar-row {
  flex-shrink: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--scada-border, #2a2f3a);
  background: var(--scada-panel, #171a21);
}

.canvas-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--scada-muted, #9aa3b2);
}

.hidden-file {
  display: none;
}
</style>

<style>
/* 全屏铺满视口，避免默认 margin / max-height 裁切四边 */
.panel-page-editor-modal.el-overlay {
  overflow: hidden;
}

.panel-page-editor-dialog.el-dialog.is-fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
  margin: 0 !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  display: flex !important;
  flex-direction: column;
  border-radius: 0;
  overflow: hidden;
  background: var(--scada-bg, #0f1115);
}

.panel-page-editor-dialog .el-dialog__header {
  flex-shrink: 0;
  margin: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--scada-border, #2a2f3a);
  background: var(--scada-panel, #171a21);
}

.panel-page-editor-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 !important;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
