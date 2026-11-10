<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { scadaConfirm } from '@/shared/ui/scadaMessageBox'
import WorkbenchShell from '@/layouts/WorkbenchShell.vue'
import Canvas2DBoard from '@/components/designer/Canvas2DBoard.vue'
import Canvas3DBoard from '@/components/designer/Canvas3DBoard.vue'
import WidgetPalette from '@/components/designer/WidgetPalette.vue'
import Object3DPalette from '@/components/designer/Object3DPalette.vue'
import PropertyPanel from '@/components/designer/PropertyPanel.vue'
import Object3DPropertyPanel from '@/components/designer/Object3DPropertyPanel.vue'
import AlignToolbar from '@/components/designer/AlignToolbar.vue'
import AlignToolbar3D from '@/components/designer/AlignToolbar3D.vue'
import ObjectExplorerPanel from '@/components/designer/ObjectExplorerPanel.vue'
import LayerPanel from '@/components/designer/LayerPanel.vue'
import ScriptEditorPanel from '@/components/designer/ScriptEditorPanel.vue'
import OutputPanel from '@/components/shared/OutputPanel.vue'
import NewProjectDialog from '@/components/dialogs/NewProjectDialog.vue'
import OpenProjectDialog from '@/components/dialogs/OpenProjectDialog.vue'
import SaveAsDialog from '@/components/dialogs/SaveAsDialog.vue'
import ProjectPropertyDialog from '@/components/dialogs/ProjectPropertyDialog.vue'
import UnsavedChangesDialog from '@/components/dialogs/UnsavedChangesDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import DatabaseSettingsDialog from '@/components/dialogs/DatabaseSettingsDialog.vue'
import PageTreePanel from '@/components/designer/PageTreePanel.vue'
import VariableManageDialog from '@/components/dialogs/VariableManageDialog.vue'
import ResourceManagerDialog from '@/components/dialogs/ResourceManagerDialog.vue'
import AnimationConnectionDialog from '@/components/designer/AnimationConnectionDialog.vue'
import Object3DModelEditorDialog from '@/components/designer/Object3DModelEditorDialog.vue'
import Object3DPanelPageEditorDialog from '@/components/designer/Object3DPanelPageEditorDialog.vue'
import Object3DLiquidDialog from '@/components/designer/Object3DLiquidDialog.vue'
import Object3DFlowDialog from '@/components/designer/Object3DFlowDialog.vue'
import { useProjectStore, type ProjectImportPhase, type SiteExportPhase } from '@/stores/project'
import { useOutputLogStore } from '@/stores/outputLog'
import { useTagStore } from '@/stores/tag'
import { useProjectAutoSave } from '@/shared/project/useProjectAutoSave'
import { syncCurrentProjectAndOpenRuntime } from '@/shared/runtime/openRuntime'
import { retainLiveTrendSampling } from '@/shared/runtime/liveTrendSampler'
import { ApiError } from '@/shared/api/client'
import {
  blurTypingTarget,
  hasMod,
  isDesignerCanvasContext,
} from '@/shared/designer/designerHotkeys'
import type { Page2D, Page3D } from '@web-scada/core'

const router = useRouter()
const project = useProjectStore()
const log = useOutputLogStore()
const tags = useTagStore()
const {
  status: autoSaveStatus,
  lastSavedAt,
  lastError: autoSaveError,
  cancelPending: cancelAutoSave,
} = useProjectAutoSave({ delayMs: 3000 })

const autoSaveLabel = computed(() => {
  switch (autoSaveStatus.value) {
    case 'waiting':
      return '待自动保存…'
    case 'saving':
      return '自动保存中…'
    case 'saved': {
      if (!lastSavedAt.value) return '已自动保存'
      const t = new Date(lastSavedAt.value)
      const hh = String(t.getHours()).padStart(2, '0')
      const mm = String(t.getMinutes()).padStart(2, '0')
      const ss = String(t.getSeconds()).padStart(2, '0')
      return `已自动保存 ${hh}:${mm}:${ss}`
    }
    case 'error':
      return autoSaveError.value ? `自动保存失败：${autoSaveError.value}` : '自动保存失败'
    default:
      return ''
  }
})
const previewBusy = ref(false)
const board3dRef = ref<{
  fitAll: () => void
  fitSelection: () => void
  focusObject: (objectId: string) => void
  normalizeSelection: () => void
  syncSceneFromPage: () => Promise<void>
  pasteAndShow: () => Promise<boolean>
  copySelectedAndNotify: () => Promise<boolean>
  syncStoreSelectionFromScene: () => void
  getSceneSelectedCount: () => number
  unmountByIds: (ids: string[]) => void
} | null>(null)
const shellRef = ref<{
  setLeftTab: (tab: 'nav' | 'object' | 'property') => void
} | null>(null)

const leftVisible = ref(true)
const rightVisible = ref(true)
const outputVisible = ref(true)

/** 选中 3D 模型后左侧自动切到属性 */
watch(
  () => project.selectedObject3dIds.slice(),
  (ids) => {
    if (ids.length === 0) return
    leftVisible.value = true
    shellRef.value?.setLeftTab('property')
  },
)

const newVisible = ref(false)
const openVisible = ref(false)
const saveAsVisible = ref(false)
const propertyVisible = ref(false)
const unsavedVisible = ref(false)
const deleteVisible = ref(false)
const scriptVisible = ref(false)
const dbSettingsVisible = ref(false)
const variableManageVisible = ref(false)
const resourceManageVisible = ref(false)
const siteExportVisible = ref(false)
const siteExporting = ref(false)
const siteExportDone = ref(false)
const siteExportError = ref('')
const siteExportPhase = ref<SiteExportPhase>('save')
const siteExportPercent = ref<number | null>(null)
const siteExportReceived = ref(0)
const siteExportTotal = ref(0)
const siteExportElapsed = ref(0)
const siteExportSteps = ['保存工程', '发布画面', '打包网站', '下载文件']
const pendingDeleteId = ref<string | null>(null)
const unsavedAction = ref<'new' | 'open' | null>(null)

const active2dPage = computed(() => {
  const page = project.activePage
  return page?.type === '2d' ? (page as Page2D) : null
})

const active3dPage = computed(() => {
  const page = project.activePage
  return page?.type === '3d' ? (page as Page3D) : null
})

async function onSave() {
  cancelAutoSave()
  await project.save()
  const where = project.getStorageMode() === 'api' ? '服务端' : '本地'
  ElMessage.success(`工程已保存到${where}`)
  log.success(`工程已保存（${where}）：${project.document.meta.name}`, '设计端')
}

function onSaveAs() {
  saveAsVisible.value = true
}

async function onSaveAsConfirm(name: string) {
  await project.saveAs(name)
  const where = project.getStorageMode() === 'api' ? '服务端' : '本地'
  ElMessage.success(`已另存为新工程（${where}）`)
  log.success(`另存为：${project.document.meta.name}`, '设计端')
}

async function onExportProject() {
  try {
    cancelAutoSave()
    const { fileName } = await project.exportProjectPackage()
    ElMessage.success(`已导出 ${fileName}（含页面/脚本/资源/设备/变量）`)
    log.success(`导出工程：${fileName}`, '设计端')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'export_requires_api') {
      ElMessage.warning('导出需要连接服务端（含模型资源与设备变量）')
    } else {
      ElMessage.error('导出失败')
      log.error(`导出失败：${msg}`, '设计端')
    }
  }
}

async function onExportSite() {
  if (siteExporting.value) return
  let timer = 0
  const started = Date.now()
  siteExportVisible.value = true
  siteExporting.value = true
  siteExportDone.value = false
  siteExportError.value = ''
  siteExportPhase.value = 'save'
  siteExportPercent.value = null
  siteExportReceived.value = 0
  siteExportTotal.value = 0
  siteExportElapsed.value = 0
  timer = window.setInterval(() => {
    siteExportElapsed.value = Math.floor((Date.now() - started) / 1000)
  }, 500)
  try {
    cancelAutoSave()
    log.info('开始导出网站包', '设计端')
    const { fileName } = await project.exportSitePackage((progress) => {
      siteExportPhase.value = progress.phase
      siteExportPercent.value = progress.percent
      siteExportReceived.value = progress.received
      siteExportTotal.value = progress.total
    })
    siteExportDone.value = true
    siteExportPercent.value = 100
    ElMessage.success(`已导出网站包 ${fileName}（解压后运行 start.bat，他人访问 IP:8787/runtime）`)
    log.success(`导出网站包：${fileName}`, '设计端')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'export_requires_api') {
      siteExportError.value = '导出网站需要连接服务端'
      ElMessage.warning(siteExportError.value)
    } else if (err instanceof ApiError && err.body && typeof err.body === 'object') {
      const body = err.body as { error?: string; message?: string }
      if (body.error === 'site_template_missing') {
        siteExportError.value =
          body.message || '缺少网站模板：请先在仓库执行 pnpm pack:win，或设置 SCADA_SITE_TEMPLATE'
        ElMessage.warning(siteExportError.value)
        log.warn('导出网站失败：site_template_missing', '设计端')
      } else {
        siteExportError.value = '导出网站包失败'
        ElMessage.error(siteExportError.value)
        log.error(`导出网站失败：${msg}`, '设计端')
      }
    } else {
      siteExportError.value = '导出网站包失败'
      ElMessage.error(siteExportError.value)
      log.error(`导出网站失败：${msg}`, '设计端')
    }
  } finally {
    window.clearInterval(timer)
    siteExporting.value = false
  }
}

function siteExportStepIndex(phase: SiteExportPhase) {
  if (phase === 'publish') return 1
  if (phase === 'pack') return 2
  if (phase === 'download') return 3
  return 0
}

function siteExportMark(index: number) {
  const current = siteExportStepIndex(siteExportPhase.value)
  if (siteExportDone.value || index < current) return '完成'
  if (siteExportError.value && index === current) return '失败'
  if (siteExporting.value && index === current) return '进行中'
  return '等待'
}

function formatExportSize(bytes: number) {
  if (!bytes) return '0 MB'
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 整段导出共用一条进度。打包在服务端完成前没有字节数，按已用时间往前走，到下载再收到尾。 */
const siteExportShownPercent = computed(() => {
  if (siteExportDone.value) return 100
  const elapsed = siteExportElapsed.value
  const packCap = 88
  const packed = Math.min(packCap, 20 + Math.round(68 * (1 - Math.exp(-elapsed / 22))))
  if (siteExportPhase.value === 'save') return 6
  if (siteExportPhase.value === 'publish') return 14
  if (siteExportPhase.value === 'pack') return Math.max(20, packed)
  const filePct = siteExportPercent.value ?? 0
  return Math.min(99, packed + Math.round(((100 - packed) * filePct) / 100))
})

const siteExportDetail = computed(() => {
  const sec = siteExportElapsed.value
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const pct = siteExportShownPercent.value
  if (siteExportError.value) return siteExportError.value
  if (siteExportDone.value) return `已完成 ${pct}%，用时 ${clock}。文件已开始下载。`
  if (siteExportPhase.value === 'save') return `正在保存工程… ${pct}% ，已用时 ${clock}`
  if (siteExportPhase.value === 'publish') return `正在发布运行画面… ${pct}% ，已用时 ${clock}`
  if (siteExportPhase.value === 'pack') return `正在复制运行环境并压缩… ${pct}% ，已用时 ${clock}`
  const got = formatExportSize(siteExportReceived.value)
  if (siteExportTotal.value > 0) {
    return `正在下载 ${got} / ${formatExportSize(siteExportTotal.value)}… ${pct}% ，已用时 ${clock}`
  }
  return `正在下载 ${got}… ${pct}% ，已用时 ${clock}`
})

function beforeSiteExportClose(done: () => void) {
  if (siteExporting.value) return
  done()
}

const importVisible = ref(false)
const importing = ref(false)
const importDone = ref(false)
const importError = ref('')
const importPhase = ref<ProjectImportPhase>('upload')
const importReceived = ref(0)
const importTotal = ref(0)
const importElapsed = ref(0)
const importUnpackWait = ref(0)
const importName = ref('')
const importSteps = ['上传工程包', '解压资源', '打开工程']

function importStepIndex(phase: ProjectImportPhase) {
  if (phase === 'upload') return 0
  if (phase === 'unpack') return 1
  return 2
}

function importMark(index: number) {
  const current = importStepIndex(importPhase.value)
  if (importDone.value || index < current) return '完成'
  if (importError.value && index === current) return '失败'
  if (importing.value && index === current) return '进行中'
  return '等待'
}

/** 上传按字节；解压发生在服务端，没有逐文件回调，按已等待时间往前走 */
const importShownPercent = computed(() => {
  if (importDone.value) return 100
  if (importPhase.value === 'upload') {
    if (importTotal.value > 0) {
      return Math.min(78, Math.round((importReceived.value / importTotal.value) * 78))
    }
    return Math.min(12, importElapsed.value)
  }
  if (importPhase.value === 'unpack') {
    return Math.min(96, 80 + Math.round(16 * (1 - Math.exp(-importUnpackWait.value / 12))))
  }
  return 98
})

const importDetail = computed(() => {
  const sec = importElapsed.value
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const pct = importShownPercent.value
  if (importError.value) return importError.value
  if (importDone.value) return `已完成 ${pct}%，用时 ${clock}。已打开「${importName.value}」。`
  if (importPhase.value === 'upload') {
    const got = formatExportSize(importReceived.value)
    if (importTotal.value > 0) {
      return `正在上传 ${got} / ${formatExportSize(importTotal.value)}… ${pct}% ，已用时 ${clock}`
    }
    return `正在上传 ${got}… ${pct}% ，已用时 ${clock}`
  }
  if (importPhase.value === 'unpack') return `正在解压并写入模型资源… ${pct}% ，已用时 ${clock}`
  return `正在打开工程… ${pct}% ，已用时 ${clock}`
})

function beforeImportClose(done: () => void) {
  if (importing.value) return
  done()
}

/** 导入前自动备份下载名：演示工程_2026-11-10_1559.webscada.zip */
function importBackupDownloadName(projectName: string): string {
  const safe =
    projectName.replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 80).replace(/^_+|_+$/g, '') ||
    'project'
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${safe}_${stamp}.webscada.zip`
}

async function onImportProject(file?: File | null) {
  if (!file || importing.value) return
  try {
    await scadaConfirm(
      '导入前会先把当前工程（含设备/变量）自动下载备份到浏览器的「下载」文件夹。\n\n注意：这会覆盖目标电脑上的设备/变量配置，导入前请确认。\n\n将用工程包内的设备、变量、报警整表替换本机配置，本机原有项会被删除。',
      '导入工程包',
      { confirmButtonText: '备份并导入', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  // 浏览器下载到「下载」目录（跟随浏览器设置，不写死磁盘路径）
  try {
    const backupName = importBackupDownloadName(project.document.meta.name || 'project')
    const { fileName } = await project.exportProjectPackage({ downloadName: backupName })
    ElMessage.success(`已备份到下载：${fileName}`)
    log.success(`导入前自动备份：${fileName}`, '设计端')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`导入前自动备份失败：${msg}`, '设计端')
    try {
      await scadaConfirm(
        '当前工程自动备份失败，是否仍继续导入？\n继续将覆盖本机设备/变量且可能无法恢复。',
        '备份失败',
        { confirmButtonText: '仍继续导入', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return
    }
  }

  let timer = 0
  const started = Date.now()
  let unpackAt = 0
  importVisible.value = true
  importing.value = true
  importDone.value = false
  importError.value = ''
  importPhase.value = 'upload'
  importReceived.value = 0
  importTotal.value = file.size
  importElapsed.value = 0
  importUnpackWait.value = 0
  importName.value = file.name
  timer = window.setInterval(() => {
    const now = Date.now()
    importElapsed.value = Math.floor((now - started) / 1000)
    if (unpackAt > 0) importUnpackWait.value = Math.floor((now - unpackAt) / 1000)
  }, 500)
  try {
    cancelAutoSave()
    log.info(`开始导入工程：${file.name}`, '设计端')
    const doc = await project.importProjectPackage(file, (progress) => {
      if (progress.phase === 'unpack' && importPhase.value !== 'unpack') unpackAt = Date.now()
      importPhase.value = progress.phase
      importReceived.value = progress.loaded
      importTotal.value = progress.total
    })
    // 工程包可能含 devices/tags：刷新变量表与实时连接
    await tags.hydrateFromServer()
    tags.connectRealtime()
    importName.value = doc.meta.name
    importDone.value = true
    ElMessage.success(`已导入为新工程：${doc.meta.name}（已用包内设备/变量替换本机）`)
    log.success(`导入工程：${doc.meta.name}`, '设计端')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'import_requires_api') {
      importError.value = '导入需要连接服务端'
      ElMessage.warning(importError.value)
    } else {
      importError.value = '导入失败，请确认是 .webscada.zip 工程包'
      ElMessage.error(importError.value)
      log.error(`导入失败：${msg}`, '设计端')
    }
  } finally {
    window.clearInterval(timer)
    importing.value = false
  }
}

function pickImportFile() {
  const input = window.document.createElement('input')
  input.type = 'file'
  input.accept = '.zip,.webscada.zip,application/zip'
  input.onchange = () => {
    const file = input.files?.[0]
    void onImportProject(file)
  }
  input.click()
}

function requestNew() {
  if (project.dirty) {
    unsavedAction.value = 'new'
    unsavedVisible.value = true
    return
  }
  newVisible.value = true
}

async function onUnsavedSave() {
  cancelAutoSave()
  await project.save()
  log.success('已保存当前工程', '设计端')
  if (unsavedAction.value === 'new') newVisible.value = true
  else if (unsavedAction.value === 'open') {
    await project.refreshList()
    openVisible.value = true
  }
  unsavedAction.value = null
}

function onUnsavedDiscard() {
  if (unsavedAction.value === 'new') newVisible.value = true
  else if (unsavedAction.value === 'open') {
    void project.refreshList()
    openVisible.value = true
  }
  unsavedAction.value = null
}

function onNewConfirm(payload: { name: string; description: string }) {
  project.newProject(payload.name, payload.description)
  ElMessage.success('已新建工程（记得保存）')
  log.info(`新建工程：${project.document.meta.name}`, '设计端')
}

async function onOpenList() {
  if (project.dirty) {
    unsavedAction.value = 'open'
    unsavedVisible.value = true
    return
  }
  await project.refreshList()
  openVisible.value = true
}

async function openExisting(id: string) {
  if (!(await project.openProject(id))) {
    ElMessage.error('打开失败')
    log.error('打开工程失败', '设计端')
    return
  }
  openVisible.value = false
  ElMessage.success('已打开工程')
  log.success(`已打开工程：${project.document.meta.name}`, '设计端')
}

function requestRemoveExisting(id: string) {
  pendingDeleteId.value = id
  deleteVisible.value = true
}

async function confirmRemoveExisting() {
  if (!pendingDeleteId.value) return
  await project.removeProject(pendingDeleteId.value)
  pendingDeleteId.value = null
  ElMessage.success('已删除')
  log.warn('已删除工程', '设计端')
  await project.refreshList()
}

/** 进入运行端 */
async function onOpenRuntime() {
  if (previewBusy.value) return
  let showGrid = false
  try {
    await scadaConfirm('运行时是否显示地面网格？', '进入运行', {
      confirmButtonText: '显示网格',
      cancelButtonText: '不显示',
      distinguishCancelAndClose: true,
      type: 'info',
    })
    showGrid = true
  } catch (action) {
    if (action === 'cancel') {
      showGrid = false
    } else {
      return
    }
  }
  previewBusy.value = true
  try {
    const info = await syncCurrentProjectAndOpenRuntime(router, 'designer', { showGrid })
    ElMessage.success(`已进入运行 v${info.publishVersion}`)
    log.success(
      `进入运行 ${info.projectName} v${info.publishVersion}${showGrid ? '（显示网格）' : ''}`,
      '设计端',
    )
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '进入运行失败')
    log.error(err instanceof Error ? err.message : '进入运行失败', '设计端')
  } finally {
    previewBusy.value = false
  }
}

function onProjectPropertyConfirm(payload: { name: string; description: string }) {
  project.renameProject(payload.name, payload.description)
  ElMessage.success('工程属性已更新')
  log.info('已更新工程属性', '设计端')
}

const canGroup = () =>
  active3dPage.value
    ? project.selectedObject3dIds.length >= 2
    : project.selectedWidgetIds.length >= 2
const canUngroup = () =>
  active3dPage.value
    ? project.selectedObjects3d.some((o) => Boolean(o.children?.length))
    : project.selectedWidgets.some((w) => w.type === 'group')

function onEditDuplicate() {
  if (active3dPage.value) {
    const created = project.duplicateObject3ds(project.selectedObject3dIds)
    if (created.length) {
      ElMessage.success(`已复制副本 ${created.length} 个`)
      void board3dRef.value?.syncSceneFromPage()
    }
  } else project.duplicateWidgets(project.selectedWidgetIds)
}

function onEditCopy() {
  if (active3dPage.value) {
    void board3dRef.value?.copySelectedAndNotify()
  } else if (project.selectedWidgetIds.length) {
    project.copySelected()
    ElMessage.success('已复制')
  } else {
    ElMessage.warning('请先选中图元再复制')
  }
}

function onEditCut() {
  if (active3dPage.value) {
    board3dRef.value?.syncStoreSelectionFromScene()
    const ids = [...project.selectedObject3dIds]
    if (project.cutSelectedObject3ds()) {
      ElMessage.success('已剪切')
      board3dRef.value?.unmountByIds(ids)
      void board3dRef.value?.syncSceneFromPage()
    } else ElMessage.warning('请先在场景中点选对象再剪切')
  } else if (project.selectedWidgetIds.length) {
    project.cutSelected()
    ElMessage.success('已剪切')
  } else {
    ElMessage.warning('请先选中图元再剪切')
  }
}

function onEditPaste() {
  if (active3dPage.value) {
    void board3dRef.value?.pasteAndShow()
  } else if (project.clipboard.length) {
    project.pasteClipboard()
    ElMessage.success('已粘贴')
  } else {
    ElMessage.warning('剪贴板为空，请先 Ctrl+C 复制')
  }
}

function onEditDelete() {
  if (active3dPage.value) {
    board3dRef.value?.syncStoreSelectionFromScene()
    const ids = [...project.selectedObject3dIds]
    if (!ids.length) {
      ElMessage.warning('请先在场景中点选要删除的对象')
      return
    }
    project.removeObject3ds(ids)
    // 先按 id 从 Three 场景卸掉，再增量同步（避免只脱手柄、模型残留）
    board3dRef.value?.unmountByIds(ids)
    void board3dRef.value?.syncSceneFromPage()
    ElMessage.success(`已删除 ${ids.length} 个对象`)
  } else {
    const ids = [...project.selectedWidgetIds]
    if (!ids.length) {
      ElMessage.warning('请先选中要删除的图元')
      return
    }
    project.removeWidgets(ids)
  }
}

function onEditSelectAll() {
  if (active3dPage.value) project.selectAllObject3ds()
  else project.setSelection(project.getActiveWidgets().map((w) => w.id))
}

function onEditLock() {
  if (active3dPage.value) project.setSelectedObject3dFlags('locked')
  else project.setSelectedFlags('locked')
}

function onEditGroup() {
  if (active3dPage.value) {
    board3dRef.value?.syncStoreSelectionFromScene()
    if (project.selectedObject3dIds.length < 2) {
      ElMessage.warning('请先多选至少 2 个对象（Ctrl/Shift + 左键）')
      return
    }
    const g = project.groupSelectedObject3ds()
    if (!g) {
      ElMessage.warning('只能组合同一层级下的对象')
      return
    }
    void board3dRef.value?.syncSceneFromPage()
    ElMessage.success(`已组合为「${g.name}」`)
  } else {
    if (project.selectedWidgetIds.length < 2) {
      ElMessage.warning('请先多选至少 2 个图元')
      return
    }
    project.groupSelected()
    ElMessage.success('已组合')
  }
}

function onEditUngroup() {
  if (active3dPage.value) {
    board3dRef.value?.syncStoreSelectionFromScene()
    const ids = project.ungroupSelectedObject3ds()
    if (!ids.length) {
      ElMessage.warning('请先选中已组合的对象')
      return
    }
    void board3dRef.value?.syncSceneFromPage()
    ElMessage.success(`已解组（${ids.length} 个对象）`)
  } else {
    const before = project.selectedWidgets.filter((w) => w.type === 'group').length
    project.ungroupSelected()
    if (!before) ElMessage.warning('请先选中组合')
    else ElMessage.success('已解组')
  }
}

const hasEditSelection = () =>
  active3dPage.value
    ? project.selectedObject3dIds.length > 0
    : project.selectedWidgetIds.length > 0

const canSelectAll = () =>
  active3dPage.value
    ? Boolean(project.activePage3d?.objects.length)
    : project.getActiveWidgets().length > 0

const anyDialogOpen = computed(
  () =>
    newVisible.value ||
    openVisible.value ||
    saveAsVisible.value ||
    propertyVisible.value ||
    unsavedVisible.value ||
    deleteVisible.value ||
    scriptVisible.value ||
    dbSettingsVisible.value ||
    variableManageVisible.value ||
    resourceManageVisible.value ||
    project.animationConnectionOpen,
)

function onDesignerKeyDown(e: KeyboardEvent) {
  if (anyDialogOpen.value) return
  if (!active2dPage.value && !active3dPage.value) return
  if (e.isComposing) return

  const is3d = Boolean(active3dPage.value)
  const hasSel = is3d
    ? project.selectedObject3dIds.length > 0 ||
      (board3dRef.value?.getSceneSelectedCount() ?? 0) > 0
    : project.selectedWidgetIds.length > 0

  const mod = hasMod(e)
  const code = e.code
  const shift = e.shiftKey

  // 保存 / 撤销 / 重做：全局生效（不必先点画布）；输入框内也会撤工程历史
  if (mod && code === 'KeyS') {
    e.preventDefault()
    e.stopPropagation()
    void onSave()
    return
  }
  if (mod && code === 'KeyZ' && !shift) {
    e.preventDefault()
    e.stopPropagation()
    blurTypingTarget()
    project.undo()
    if (is3d) void board3dRef.value?.syncSceneFromPage()
    return
  }
  if ((mod && code === 'KeyY') || (mod && shift && code === 'KeyZ')) {
    e.preventDefault()
    e.stopPropagation()
    blurTypingTarget()
    project.redo()
    if (is3d) void board3dRef.value?.syncSceneFromPage()
    return
  }

  if (!isDesignerCanvasContext(e.target)) return

  // Delete 前先把场景选中写回 store
  if (e.code === 'Delete' && is3d) {
    board3dRef.value?.syncStoreSelectionFromScene()
  }

  // —— 通用编辑（仅画布） ——
  if (mod && code === 'KeyA') {
    e.preventDefault()
    e.stopPropagation()
    onEditSelectAll()
    return
  }
  if (mod && code === 'KeyC') {
    e.preventDefault()
    e.stopPropagation()
    onEditCopy()
    return
  }
  if (mod && code === 'KeyX') {
    e.preventDefault()
    e.stopPropagation()
    onEditCut()
    return
  }
  if (mod && code === 'KeyV') {
    e.preventDefault()
    e.stopPropagation()
    onEditPaste()
    return
  }
  if (mod && code === 'KeyD') {
    e.preventDefault()
    e.stopPropagation()
    onEditDuplicate()
    return
  }
  if (mod && code === 'KeyG' && !shift) {
    e.preventDefault()
    e.stopPropagation()
    onEditGroup()
    return
  }
  if (mod && shift && code === 'KeyG') {
    e.preventDefault()
    e.stopPropagation()
    onEditUngroup()
    return
  }
  if (mod && code === 'KeyL') {
    e.preventDefault()
    e.stopPropagation()
    onEditLock()
    return
  }
  if (mod && code === 'KeyH') {
    e.preventDefault()
    e.stopPropagation()
    if (is3d) project.setSelectedObject3dFlags('visible')
    else project.setSelectedFlags('visible')
    return
  }

  if (code === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (!is3d && project.drawTool) {
      project.cancelDrawTool()
      return
    }
    if (is3d) project.selectObject3d(null)
    else project.selectWidget(null)
    return
  }

  if (!hasSel) return

  if (code === 'Delete') {
    e.preventDefault()
    e.stopPropagation()
    onEditDelete()
    return
  }

  const step2d = shift ? 10 : 1
  const step3d = shift ? 0.5 : 0.001
  if (code === 'ArrowLeft') {
    e.preventDefault()
    e.stopPropagation()
    if (is3d) project.nudgeSelectedObject3ds(-step3d, 0, 0)
    else project.nudgeSelected(-step2d, 0)
    return
  }
  if (code === 'ArrowRight') {
    e.preventDefault()
    e.stopPropagation()
    if (is3d) project.nudgeSelectedObject3ds(step3d, 0, 0)
    else project.nudgeSelected(step2d, 0)
    return
  }
  if (code === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    if (is3d) {
      if (e.altKey) project.nudgeSelectedObject3ds(0, step3d, 0)
      else project.nudgeSelectedObject3ds(0, 0, -step3d)
    } else project.nudgeSelected(0, -step2d)
    return
  }
  if (code === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    if (is3d) {
      if (e.altKey) project.nudgeSelectedObject3ds(0, -step3d, 0)
      else project.nudgeSelectedObject3ds(0, 0, step3d)
    } else project.nudgeSelected(0, step2d)
  }
}

let stopLiveTrendSampling: (() => void) | null = null

onMounted(async () => {
  window.addEventListener('keydown', onDesignerKeyDown, true)
  await project.hydrateFromStorage()
  await tags.hydrateFromServer()
  tags.connectRealtime()
  stopLiveTrendSampling = retainLiveTrendSampling()
  const mode = project.getStorageMode()
  log.info(
    `加载工程：${project.document.meta.name}（存储：${mode === 'api' ? '服务端' : '本地'}；变量：${tags.mode === 'live' ? '服务端' : 'Mock'}）`,
    '设计端',
  )
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDesignerKeyDown, true)
  stopLiveTrendSampling?.()
  stopLiveTrendSampling = null
})
</script>

<template>
  <WorkbenchShell
    ref="shellRef"
    mode="designer"
    title="设计端"
    v-model:left-visible="leftVisible"
    v-model:right-visible="rightVisible"
    v-model:output-visible="outputVisible"
  >
    <template #menu>
      <el-dropdown trigger="click">
        <span class="menu-item">文件</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="requestNew">新建工程</el-dropdown-item>
            <el-dropdown-item @click="onOpenList">打开工程</el-dropdown-item>
            <el-dropdown-item divided @click="onSave">
              保存{{ project.dirty ? ' *' : '' }}
            </el-dropdown-item>
            <el-dropdown-item @click="onSaveAs">另存为</el-dropdown-item>
            <el-dropdown-item divided @click="onExportProject">导出工程包</el-dropdown-item>
            <el-dropdown-item @click="onExportSite">导出网站包</el-dropdown-item>
            <el-dropdown-item @click="pickImportFile">导入工程包</el-dropdown-item>
            <el-dropdown-item @click="propertyVisible = true">工程属性</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click">
        <span class="menu-item">编辑</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :disabled="!project.canUndo" @click="project.undo()">
              撤销 Ctrl+Z
            </el-dropdown-item>
            <el-dropdown-item :disabled="!project.canRedo" @click="project.redo()">
              重做 Ctrl+Y / Ctrl+Shift+Z
            </el-dropdown-item>
            <el-dropdown-item
              divided
              :disabled="active3dPage ? !project.selectedObject3dIds.length : !project.selectedWidgetIds.length"
              @click="onEditCopy"
            >
              复制 Ctrl+C
            </el-dropdown-item>
            <el-dropdown-item
              :disabled="active3dPage ? !project.selectedObject3dIds.length : !project.selectedWidgetIds.length"
              @click="onEditCut"
            >
              剪切 Ctrl+X
            </el-dropdown-item>
            <el-dropdown-item
              :disabled="active3dPage ? !project.clipboard3d.length : !project.clipboard.length"
              @click="onEditPaste"
            >
              粘贴 Ctrl+V
            </el-dropdown-item>
            <el-dropdown-item :disabled="!hasEditSelection()" @click="onEditDuplicate">
              复制副本 Ctrl+D
            </el-dropdown-item>
            <el-dropdown-item :disabled="!hasEditSelection()" @click="onEditDelete">
              删除 Del
            </el-dropdown-item>
            <el-dropdown-item divided :disabled="!canSelectAll()" @click="onEditSelectAll">
              全选 Ctrl+A
            </el-dropdown-item>
            <el-dropdown-item :disabled="!hasEditSelection()" @click="onEditLock">
              锁定/解锁 Ctrl+L
            </el-dropdown-item>
            <el-dropdown-item divided :disabled="!canGroup()" @click="onEditGroup">
              组合 Ctrl+G
            </el-dropdown-item>
            <el-dropdown-item :disabled="!canUngroup()" @click="onEditUngroup">
              解组 Ctrl+Shift+G
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click">
        <span class="menu-item">视图</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="leftVisible = !leftVisible">
              {{ leftVisible ? '隐藏' : '显示' }}左栏
            </el-dropdown-item>
            <el-dropdown-item @click="rightVisible = !rightVisible">
              {{ rightVisible ? '隐藏' : '显示' }}右栏
            </el-dropdown-item>
            <el-dropdown-item @click="outputVisible = !outputVisible">
              {{ outputVisible ? '隐藏' : '显示' }}输出栏
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="menu-item" @click="variableManageVisible = true">变量/设备</span>
      <span class="menu-item" @click="resourceManageVisible = true">资源</span>
      <span class="menu-item" @click="scriptVisible = true">脚本</span>
      <el-dropdown trigger="click">
        <span class="menu-item">系统</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="dbSettingsVisible = true">数据库配置</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>

    <template #toolbar>
      <AlignToolbar3D
        v-if="active3dPage"
        @fit-all="board3dRef?.fitAll()"
        @fit-selection="board3dRef?.fitSelection()"
        @normalize-selection="board3dRef?.normalizeSelection()"
        @run="onOpenRuntime"
      />
      <AlignToolbar v-else-if="active2dPage" @run="onOpenRuntime" />
    </template>

    <template #left-nav>
      <PageTreePanel />
    </template>

    <template #left-object>
      <LayerPanel v-if="active2dPage" />
      <ObjectExplorerPanel />
    </template>

    <template #left-property>
      <Object3DPropertyPanel
        v-if="active3dPage"
        :key="project.selectedObject3dId || 'none'"
      />
      <PropertyPanel v-else />
    </template>

    <template #center>
      <div class="center-body">
        <Canvas2DBoard
          v-if="active2dPage && !project.object3dPanelEditorOpen"
          :page="active2dPage"
        />
        <Canvas3DBoard
          v-else-if="active3dPage && !project.object3dPanelEditorOpen"
          ref="board3dRef"
          :page="active3dPage"
        />
        <div v-else class="empty">
          <p>{{ project.object3dPanelEditorOpen ? '正在编辑面板…' : '请选择页面' }}</p>
        </div>
      </div>
    </template>

    <template #right>
      <Object3DPalette v-if="active3dPage" />
      <WidgetPalette v-else />
    </template>

    <template #output>
      <OutputPanel />
    </template>

    <template #status>
      <span>{{ project.document.meta.name }}</span>
      <span v-if="project.dirty" class="dirty">未保存</span>
      <span
        v-if="autoSaveLabel"
        class="autosave"
        :class="{ error: autoSaveStatus === 'error', ok: autoSaveStatus === 'saved' }"
      >
        {{ autoSaveLabel }}
      </span>
      <span>页面：{{ project.activePage?.name ?? '-' }}</span>
      <span v-if="active2dPage">选中图元：{{ project.selectedWidgetIds.length }}</span>
      <span v-else-if="active3dPage">
        选中对象：{{ project.selectedObject3dIds.length }}
      </span>
      <span>脚本：{{ project.document.scripts.length }}</span>
      <span>v{{ project.document.meta.version }}</span>
    </template>
  </WorkbenchShell>

  <NewProjectDialog v-model="newVisible" @confirm="onNewConfirm" />
  <OpenProjectDialog
    v-model="openVisible"
    :projects="project.projectList"
    @open="openExisting"
    @remove="requestRemoveExisting"
  />
  <SaveAsDialog
    v-model="saveAsVisible"
    :default-name="`${project.document.meta.name} 副本`"
    @confirm="onSaveAsConfirm"
  />
  <ProjectPropertyDialog
    v-model="propertyVisible"
    :name="project.document.meta.name"
    :description="project.document.meta.description"
    :project-id="project.document.meta.id"
    @confirm="onProjectPropertyConfirm"
  />
  <UnsavedChangesDialog
    v-model="unsavedVisible"
    @save="onUnsavedSave"
    @discard="onUnsavedDiscard"
    @cancel="unsavedAction = null"
  />
  <ConfirmDialog
    v-model="deleteVisible"
    title="删除工程"
    message="确定删除该本地工程？此操作不可恢复。"
    confirm-text="删除"
    danger
    @confirm="confirmRemoveExisting"
    @cancel="pendingDeleteId = null"
  />
  <DatabaseSettingsDialog v-model="dbSettingsVisible" />
  <VariableManageDialog v-model="variableManageVisible" />
  <ResourceManagerDialog v-model="resourceManageVisible" />
  <AnimationConnectionDialog />
  <Object3DModelEditorDialog />
  <Object3DPanelPageEditorDialog />
  <Object3DLiquidDialog />
  <Object3DFlowDialog />

  <el-dialog
    v-model="scriptVisible"
    title="脚本编辑"
    width="860px"
    align-center
    :close-on-click-modal="false"
    destroy-on-close
  >
    <ScriptEditorPanel />
  </el-dialog>

  <el-dialog
    v-model="siteExportVisible"
    title="导出网站包"
    width="460px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!siteExporting"
    :show-close="!siteExporting"
    :before-close="beforeSiteExportClose"
  >
    <p class="site-export-lead">正在准备可在其他电脑上打开的运行包。打包时请留在此窗口。</p>
    <ol class="site-export-steps">
      <li
        v-for="(label, index) in siteExportSteps"
        :key="label"
        :class="{
          on: siteExporting && siteExportStepIndex(siteExportPhase) === index,
          ok: siteExportDone || siteExportStepIndex(siteExportPhase) > index,
        }"
      >
        <span>{{ label }}</span>
        <span>{{ siteExportMark(index) }}</span>
      </li>
    </ol>
    <el-progress
      :percentage="siteExportShownPercent"
      :status="siteExportError ? 'exception' : siteExportDone ? 'success' : undefined"
      :stroke-width="8"
    />
    <p class="site-export-detail">{{ siteExportDetail }}</p>
    <template #footer>
      <el-button type="primary" :disabled="siteExporting" @click="siteExportVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="importVisible"
    title="导入工程包"
    width="460px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!importing"
    :show-close="!importing"
    :before-close="beforeImportClose"
  >
    <p class="site-export-lead">正在把工程包传到服务端并写入模型资源。导入时请留在此窗口。</p>
    <p class="site-export-lead import-warn">导入前已尝试把当前工程备份下载到「下载」文件夹。注意：导入会覆盖本机设备/变量配置。</p>
    <ol class="site-export-steps">
      <li
        v-for="(label, index) in importSteps"
        :key="label"
        :class="{
          on: importing && importStepIndex(importPhase) === index,
          ok: importDone || importStepIndex(importPhase) > index,
        }"
      >
        <span>{{ label }}</span>
        <span>{{ importMark(index) }}</span>
      </li>
    </ol>
    <el-progress
      :percentage="importShownPercent"
      :status="importError ? 'exception' : importDone ? 'success' : undefined"
      :stroke-width="8"
    />
    <p class="site-export-detail">{{ importDetail }}</p>
    <template #footer>
      <el-button type="primary" :disabled="importing" @click="importVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.menu-item {
  display: inline-block;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--scada-muted);
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
}

.menu-item:hover {
  color: var(--scada-text);
  background: rgba(255, 255, 255, 0.04);
}

.menu-item.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.dirty {
  font-size: 11px;
  font-weight: 500;
  color: #fbbf24;
}

.autosave {
  font-size: 11px;
  color: var(--scada-muted);
}

.autosave.ok {
  color: #86efac;
}

.site-export-lead,
.site-export-detail {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--scada-muted);
}
.import-warn {
  margin-top: 8px;
  color: var(--el-color-warning);
}

.site-export-steps {
  margin: 12px 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.site-export-steps li {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--scada-muted);
}

.site-export-steps li.on {
  color: var(--scada-text);
}

.site-export-steps li.ok {
  color: #86efac;
}

.site-export-detail {
  margin-top: 10px;
}

.autosave.error {
  color: #fca5a5;
}

.center-body {
  flex: 1;
  min-height: 0;
  position: relative;
  height: 100%;
}

.empty {
  height: 100%;
  display: grid;
  place-content: center;
  color: var(--scada-muted);
}
</style>
