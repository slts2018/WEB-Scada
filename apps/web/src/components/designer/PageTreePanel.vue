<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '@/stores/project'
import type { Page, Page2D } from '@web-scada/core'
import PageSettingDialog from '@/components/dialogs/PageSettingDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'

const project = useProjectStore()

const createVisible = ref(false)
const createDefaultType = ref<'2d' | '3d'>('2d')
const settingVisible = ref(false)
const settingPage = ref<Page | null>(null)
const deleteVisible = ref(false)
const pendingDelete = ref<Page | null>(null)
const fromTemplateId = ref<string | null>(null)

const templates = computed(() => project.document.pageTemplates ?? [])

const settingDefaults = computed(() => {
  const page = settingPage.value
  if (!page) {
    return {
      name: '新页面',
      defaultType: '2d' as const,
      width: 1920,
      height: 1080,
      background: '#1a1d24',
    }
  }
  if (page.type === '2d') {
    const p = page as Page2D
    return {
      name: p.name,
      defaultType: '2d' as const,
      width: p.width,
      height: p.height,
      background: p.background || '#1a1d24',
    }
  }
  return {
    name: page.name,
    defaultType: '3d' as const,
    width: 1920,
    height: 1080,
    background: '#1a1d24',
  }
})

function selectPage(page: Page) {
  project.setActivePage(page.id)
}

function openCreate(type: '2d' | '3d') {
  fromTemplateId.value = null
  createDefaultType.value = type
  createVisible.value = true
}

function onCreateConfirm(payload: {
  name: string
  type: '2d' | '3d'
  width: number
  height: number
  background: string
}) {
  if (fromTemplateId.value) {
    project.createPageFromTemplate(fromTemplateId.value, payload.name)
    fromTemplateId.value = null
    ElMessage.success('已从模板创建页面')
    return
  }
  project.createAndAddPage(payload.type, {
    name: payload.name,
    width: payload.width,
    height: payload.height,
    background: payload.background,
  })
}

function openSettings(page: Page) {
  settingPage.value = page
  settingVisible.value = true
}

function onSettingsConfirm(payload: {
  name: string
  type: '2d' | '3d'
  width: number
  height: number
  background: string
}) {
  if (!settingPage.value) return
  project.updatePageSettings(settingPage.value.id, {
    name: payload.name,
    width: payload.width,
    height: payload.height,
    background: payload.background,
  })
  settingPage.value = null
}

function requestRemove(page: Page) {
  if (project.document.pages.length <= 1) {
    ElMessage.warning('至少保留一个页面')
    return
  }
  pendingDelete.value = page
  deleteVisible.value = true
}

function confirmRemove() {
  if (!pendingDelete.value) return
  project.removePage(pendingDelete.value.id)
  pendingDelete.value = null
}

function saveAsTemplate(page: Page) {
  project.savePageAsTemplate(page.id)
  ElMessage.success(`已存为模板：${page.name}`)
}

function createFromTemplate(templateId: string, pageType: '2d' | '3d') {
  fromTemplateId.value = templateId
  createDefaultType.value = pageType
  createVisible.value = true
}

function removeTemplate(templateId: string) {
  project.removePageTemplate(templateId)
  ElMessage.success('已删除模板')
}

function setHome(page: Page) {
  project.setHomePage(page.id)
  ElMessage.success(`首页设为：${page.name}`)
}
</script>

<template>
  <div class="page-tree">
    <div class="panel-title row">
      <span>页面</span>
      <div class="ops">
        <el-button size="small" text @click="openCreate('2d')">+2D</el-button>
        <el-button size="small" text @click="openCreate('3d')">+3D</el-button>
      </div>
    </div>
    <ul class="page-list">
      <li
        v-for="page in project.document.pages"
        :key="page.id"
        :class="{ active: page.id === project.activePageId }"
      >
        <div class="main" @click="selectPage(page)">
          <span class="badge">{{ page.type.toUpperCase() }}</span>
          <span v-if="page.id === project.document.homePageId" class="home">首页</span>
          <span class="name">{{ page.name }}</span>
        </div>
        <div class="actions">
          <button type="button" title="设为首页" @click="setHome(page)">⌂</button>
          <button type="button" title="上移" @click="project.movePage(page.id, -1)">↑</button>
          <button type="button" title="下移" @click="project.movePage(page.id, 1)">↓</button>
          <button type="button" title="存为模板" @click="saveAsTemplate(page)">☆</button>
          <button type="button" title="页面设置" @click="openSettings(page)">✎</button>
          <button type="button" title="复制" @click="project.duplicatePage(page.id)">⧉</button>
          <button type="button" title="删除" @click="requestRemove(page)">×</button>
        </div>
      </li>
    </ul>

    <div class="panel-title row">
      <span>页面模板</span>
    </div>
    <ul v-if="templates.length" class="page-list">
      <li v-for="tpl in templates" :key="tpl.id">
        <div class="main">
          <span class="badge">{{ tpl.pageType.toUpperCase() }}</span>
          <span class="name">{{ tpl.name }}</span>
        </div>
        <div class="actions">
          <button type="button" title="从模板新建" @click="createFromTemplate(tpl.id, tpl.pageType)">
            +
          </button>
          <button type="button" title="删除模板" @click="removeTemplate(tpl.id)">×</button>
        </div>
      </li>
    </ul>
    <div v-else class="empty">暂无模板，可在页面对「☆」另存</div>

    <PageSettingDialog
      v-model="createVisible"
      mode="create"
      :default-type="createDefaultType"
      :name="
        fromTemplateId
          ? templates.find((t) => t.id === fromTemplateId)?.name || '新页面'
          : createDefaultType === '2d'
            ? '新页面'
            : '三维场景'
      "
      @confirm="onCreateConfirm"
    />
    <PageSettingDialog
      v-model="settingVisible"
      mode="edit"
      :default-type="settingDefaults.defaultType"
      :name="settingDefaults.name"
      :width="settingDefaults.width"
      :height="settingDefaults.height"
      :background="settingDefaults.background"
      @confirm="onSettingsConfirm"
    />
    <ConfirmDialog
      v-model="deleteVisible"
      title="删除页面"
      :message="`确定删除页面「${pendingDelete?.name ?? ''}」？`"
      confirm-text="删除"
      danger
      @confirm="confirmRemove"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.panel-title {
  margin: 8px 0;
  font-size: 12px;
  color: var(--scada-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.page-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 8px 6px;
  border-radius: 6px;
  margin-bottom: 4px;
}

.page-list li.active,
.page-list li:hover {
  background: rgba(61, 139, 253, 0.14);
}

.main {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
}

.badge {
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  background: #2a3140;
  color: var(--scada-muted);
}

.home {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 2px;
  padding-left: 2px;
  flex-wrap: wrap;
}

.actions button {
  border: none;
  background: transparent;
  color: var(--scada-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
}

.actions button:hover {
  color: var(--scada-text);
  background: rgba(255, 255, 255, 0.06);
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
  padding: 4px 8px 10px;
}
</style>
