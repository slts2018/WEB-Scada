import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AnimationLinkFlow } from '@web-scada/core'
import {
  clonePageWithNewIds,
  createDefaultObject3DPanel,
  createEmptyProject,
  createGuideLine,
  createLayer2D,
  createLiquidLevelNode,
  LIQUID_DEFAULT_COLOR,
  PRIMITIVE_SOURCE_SIZE_M,
  createObject3D,
  createPage2D,
  createPage3D,
  createPageTemplate,
  createSymbolDefinition,
  createWidget2D,
  isObject3dPanelPage,
  listNavigationPages,
  normalizeObject3DPanel,
  normalizeProjectDocument,
  resolvePanelWidgets,
  syncLiquidLevelNode,
  type BuiltinPrimitive3D,
  type BuiltinWidgetType,
  type DrawToolType,
  type Layer2D,
  type LiquidLevelOptions,
  type Object3DNode,
  type Object3DMaterial,
  type Page,
  type Page2D,
  type Page3D,
  type ProjectDocument,
  type ProjectResource,
  type PublishPackage,
  type SymbolDefinition,
  type Widget2D,
} from '@web-scada/core'
import {
  deleteProjectDocument,
  getLastProjectId,
  getStorageMode,
  listProjectIndex,
  loadProjectDocument,
  loadPublishPackage,
  probeStorage,
  saveProjectDocument,
  savePublishPackage,
  type ProjectIndexItem,
} from '@/shared/storage/repository'
import { apiExportProject, apiExportSite, apiImportProject, apiUploadResource } from '@/shared/api/client'
import { computeAlignPatches, type AlignMode } from '@/shared/designer/geometry'
import { computeAlignPatches3d } from '@/shared/designer/geometry3d'
import { clearResourceRefs, countRefsByResource, replaceResourceRefs } from '@/shared/project/resourceRefs'
import {
  cloneObject3dWithNewIds,
  findObject3dDeep,
  isDescendantOf,
  locateObject3d,
  walkObject3dTree,
} from '@/shared/project/object3dTree'
import { clonePlain } from '@/shared/utils/clonePlain'

const HISTORY_LIMIT = 50

export const useProjectStore = defineStore('project', () => {
  const document = ref<ProjectDocument>(normalizeProjectDocument(createEmptyProject('演示工程')))
  const activePageId = ref<string | undefined>(document.value.homePageId)
  const activeLayerId = ref<string | null>(
    document.value.pages.find((p) => p.type === '2d')?.layers[0]?.id ?? null,
  )
  const published = ref<PublishPackage | null>(null)
  const dirty = ref(false)
  const projectList = ref<ProjectIndexItem[]>([])
  const selectedWidgetIds = ref<string[]>([])
  const snapEnabled = ref(true)
  const gridVisible = ref(true)
  /** 打开 Flight 风格「动画连接」对话框 */
  const animationConnectionOpen = ref(false)
  const animationConnectionTab = ref<'default' | 'property' | 'event'>('default')
  /** 打开 3D「液位」配置对话框 */
  const liquidConfigOpen = ref(false)
  /** 打开 3D「管道流动」配置对话框 */
  const flowConfigOpen = ref(false)
  /** 打开 3D「跟镜头面板」2D 内容弹窗编辑器 */
  const object3dPanelEditorOpen = ref(false)
  /** 面板编辑中的 3D 对象 id */
  const panelEditObjectId = ref<string | null>(null)
  /** 打开弹窗前的页面（通常为 3D 页），关闭后返回 */
  const panelEditReturnPageId = ref<string | null>(null)
  /** 打开弹窗时 Page2D 快照（返回时还原） */
  const panelEditPageSnapshot = ref<string | null>(null)
  /** 打开弹窗时面板背景资源 id（null=无背景；返回时还原） */
  const panelEditBgSnapshot = ref<string | null | undefined>(undefined)
  /** 打开 3D「编辑模型」材质/属性对话框 */
  const object3dModelEditorOpen = ref(false)
  /** Flight 风格画布绘制工具：折线 / 多边形 / 管道 */
  const drawTool = ref<DrawToolType | null>(null)
  /** 设计端实时预览（用 Tag 驱动动画连接，不写回工程） */
  const previewLive = ref(false)
  /** 3D 变换手柄模式：平移 / 旋转 / 缩放 */
  const gizmoMode3d = ref<'translate' | 'rotate' | 'scale'>('translate')
  /** 请求相机聚焦到当前 3D 选中（对象浏览器点选等同物体时也能再触发） */
  const focus3dNonce = ref(0)
  /** 对象浏览器等：强制相机看向指定 3D 对象（带时间戳，同对象连点也会触发） */
  const cameraFocus3dCmd = ref<{ id: string; at: number } | null>(null)
  /**
   * 粘贴/复制副本后：等场景树 reload 完成再框选相机。
   * 避免刚写入数据时场景里还没有 mesh 导致「粘贴了但看不见」。
   */
  const frameAfter3dTreeReload = ref(false)
  /** 设计端当前视角焦点（不入库）；新增物体落点用，避免摊到格子外 */
  const spawnHint3d = ref<{ x: number; y: number; z: number } | null>(null)
  /** 3D 对象树变更序号：画布强制增量同步（不依赖 signature watch 是否触发） */
  const scene3dMutateNonce = ref(0)
  const clipboard = ref<Widget2D[]>([])
  /** 3D 对象剪贴板（与 2D clipboard 分离） */
  const clipboard3d = ref<Object3DNode[]>([])

  function bumpScene3d(opts?: { frame?: boolean }) {
    if (opts?.frame) frameAfter3dTreeReload.value = true
    scene3dMutateNonce.value += 1
  }

  function setSpawnHint3d(hint: { x: number; y: number; z: number } | null) {
    spawnHint3d.value = hint
  }

  const historyPast = ref<string[]>([])
  const historyFuture = ref<string[]>([])

  const activePage = computed(() =>
    document.value.pages.find((p) => p.id === activePageId.value),
  )

  const activePage2d = computed(() => {
    const page = activePage.value
    return page?.type === '2d' ? page : null
  })

  const activePage3d = computed(() => {
    const page = activePage.value
    return page?.type === '3d' ? (page as Page3D) : null
  })

  const selectedObject3dIds = ref<string[]>([])

  /** 兼容单选：取多选第一个 */
  const selectedObject3dId = computed(() => selectedObject3dIds.value[0] ?? null)

  const selectedObject3d = computed(() => {
    const page = activePage3d.value
    const id = selectedObject3dId.value
    if (!page || !id) return null
    return findObject3dDeep(page.objects, id)
  })

  const selectedObjects3d = computed(() => {
    const page = activePage3d.value
    if (!page) return [] as Object3DNode[]
    const set = new Set(selectedObject3dIds.value)
    const out: Object3DNode[] = []
    walkObject3dTree(page.objects, (obj) => {
      if (set.has(obj.id)) out.push(obj)
    })
    return out
  })

  /** 兼容单选：取多选第一个 */
  const selectedWidgetId = computed(() => selectedWidgetIds.value[0] ?? null)

  const selectedWidget = computed(() => {
    const id = selectedWidgetId.value
    if (!id) return null
    return getActiveWidgets().find((w) => w.id === id) ?? null
  })

  const selectedWidgets = computed(() => {
    const set = new Set(selectedWidgetIds.value)
    return getActiveWidgets().filter((w) => set.has(w.id))
  })

  const canUndo = computed(() => historyPast.value.length > 0)
  const canRedo = computed(() => historyFuture.value.length > 0)

  function touch() {
    document.value.meta.updatedAt = Date.now()
    dirty.value = true
  }

  function clearHistory() {
    historyPast.value = []
    historyFuture.value = []
  }

  function pushHistory() {
    const page2d = activePage2d.value
    if (page2d) {
      historyPast.value.push(JSON.stringify({ kind: '2d', data: page2d.layers }))
      if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
      historyFuture.value = []
      return
    }
    const page3d = activePage3d.value
    if (page3d) {
      historyPast.value.push(JSON.stringify({ kind: '3d', data: page3d.objects }))
      if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
      historyFuture.value = []
    }
  }

  function undo() {
    if (!historyPast.value.length) return
    const raw = historyPast.value.pop()!
    let parsed: { kind?: string; data?: unknown }
    try {
      parsed = JSON.parse(raw) as { kind?: string; data?: unknown }
    } catch {
      return
    }

    // 兼容旧会话：纯 layers 数组
    if (!parsed?.kind && Array.isArray(parsed)) {
      const page = activePage2d.value
      if (!page) return
      historyFuture.value.push(JSON.stringify({ kind: '2d', data: page.layers }))
      page.layers = parsed as unknown as Page2D['layers']
      selectedWidgetIds.value = []
      touch()
      return
    }

    if (parsed.kind === '2d') {
      const page = activePage2d.value
      if (!page) return
      historyFuture.value.push(JSON.stringify({ kind: '2d', data: page.layers }))
      page.layers = parsed.data as Page2D['layers']
      selectedWidgetIds.value = []
      touch()
      return
    }

    if (parsed.kind === '3d') {
      const page = activePage3d.value
      if (!page) return
      historyFuture.value.push(JSON.stringify({ kind: '3d', data: page.objects }))
      page.objects = parsed.data as Object3DNode[]
      selectedObject3dIds.value = []
      touch()
    }
  }

  function redo() {
    if (!historyFuture.value.length) return
    const raw = historyFuture.value.pop()!
    let parsed: { kind?: string; data?: unknown }
    try {
      parsed = JSON.parse(raw) as { kind?: string; data?: unknown }
    } catch {
      return
    }

    if (parsed.kind === '2d' || (!parsed.kind && Array.isArray(parsed))) {
      const page = activePage2d.value
      if (!page) return
      historyPast.value.push(JSON.stringify({ kind: '2d', data: page.layers }))
      page.layers = (parsed.kind ? parsed.data : parsed) as Page2D['layers']
      selectedWidgetIds.value = []
      touch()
      return
    }

    if (parsed.kind === '3d') {
      const page = activePage3d.value
      if (!page) return
      historyPast.value.push(JSON.stringify({ kind: '3d', data: page.objects }))
      page.objects = parsed.data as Object3DNode[]
      selectedObject3dIds.value = []
      touch()
    }
  }

  async function refreshList() {
    projectList.value = await listProjectIndex()
  }

  function ensureDefaultLayer(page: Page2D): Layer2D {
    if (!page.layers.length) {
      page.layers.push(createLayer2D('默认图层'))
    }
    let layer = activeLayerId.value
      ? page.layers.find((l) => l.id === activeLayerId.value)
      : undefined
    if (!layer) {
      layer = page.layers[0]
    }
    activeLayerId.value = layer.id
    return layer
  }

  function findLayerOfWidget(widgetId: string): Layer2D | null {
    const page = activePage2d.value
    if (!page) return null
    for (const layer of page.layers) {
      if (layer.widgets.some((w) => w.id === widgetId)) return layer
    }
    return null
  }

  function findLayerForSelection(): Layer2D | null {
    const ids = selectedWidgetIds.value
    if (!ids.length) return null
    const layersFound: Layer2D[] = []
    for (const id of ids) {
      const layer = findLayerOfWidget(id)
      if (layer && !layersFound.includes(layer)) layersFound.push(layer)
    }
    if (layersFound.length === 1) return layersFound[0]
    return findLayerOfWidget(ids[0])
  }

  function syncActiveLayerForPage(pageId: string) {
    const page = document.value.pages.find((p) => p.id === pageId)
    if (page?.type === '2d') {
      activeLayerId.value = page.layers[0]?.id ?? null
    } else {
      activeLayerId.value = null
    }
  }

  function setActiveLayer(layerId: string) {
    const page = activePage2d.value
    if (!page) return
    if (page.layers.some((l) => l.id === layerId)) {
      activeLayerId.value = layerId
    }
  }

  function addLayer(name?: string): Layer2D | null {
    const page = activePage2d.value
    if (!page) return null
    pushHistory()
    const layer = createLayer2D(name ?? `图层 ${page.layers.length + 1}`)
    page.layers.push(layer)
    activeLayerId.value = layer.id
    touch()
    return layer
  }

  function removeLayer(layerId: string): boolean {
    const page = activePage2d.value
    if (!page || page.layers.length <= 1) return false
    const idx = page.layers.findIndex((l) => l.id === layerId)
    if (idx < 0) return false
    const layer = page.layers[idx]
    if (layer.widgets.length) return false
    pushHistory()
    page.layers.splice(idx, 1)
    if (activeLayerId.value === layerId) {
      activeLayerId.value = page.layers[0]?.id ?? null
    }
    touch()
    return true
  }

  function renameLayer(layerId: string, name: string) {
    const page = activePage2d.value
    if (!page || !name.trim()) return
    const layer = page.layers.find((l) => l.id === layerId)
    if (!layer) return
    layer.name = name.trim()
    touch()
  }

  function setLayerFlag(layerId: string, key: 'visible' | 'locked', value: boolean) {
    const page = activePage2d.value
    if (!page) return
    const layer = page.layers.find((l) => l.id === layerId)
    if (!layer) return
    layer[key] = value
    touch()
  }

  function moveLayer(layerId: string, direction: 'up' | 'down') {
    const page = activePage2d.value
    if (!page) return
    const idx = page.layers.findIndex((l) => l.id === layerId)
    if (idx < 0) return
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= page.layers.length) return
    pushHistory()
    ;[page.layers[idx], page.layers[target]] = [page.layers[target], page.layers[idx]]
    touch()
  }

  function cloneWidgetWithNewIds(widget: Widget2D): Widget2D {
    const copy = clonePlain(widget)
    copy.id = `w_${copy.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    if (copy.children?.length) {
      copy.children = copy.children.map(cloneWidgetWithNewIds)
    }
    return copy
  }

  /** 面板 2D 弹窗是否打开（内容已在 Page2D，不再走 panel.widgets） */
  function isPanelEditMode() {
    return Boolean(object3dPanelEditorOpen.value && panelEditObjectId.value)
  }

  /** 旧 panel.widgets 编辑路径已废弃 */
  function usesLegacyPanelWidgets() {
    return false
  }

  function findObject3dById(objectId: string, preferPageId?: string | null): Object3DNode | null {
    if (preferPageId) {
      const page = document.value.pages.find((p) => p.id === preferPageId && p.type === '3d')
      if (page && page.type === '3d') {
        const hit = findObject3dDeep(page.objects, objectId)
        if (hit) return hit
      }
    }
    for (const page of document.value.pages) {
      if (page.type !== '3d') continue
      const hit = findObject3dDeep(page.objects, objectId)
      if (hit) return hit
    }
    return null
  }

  function getPanelEditObject(): Object3DNode | null {
    const id = panelEditObjectId.value
    if (!id) return null
    return findObject3dById(id, panelEditReturnPageId.value)
  }

  /** 确保面板存在且有 widgets 数组（规范化后无 items） */
  function ensurePanelWidgetsList(obj: Object3DNode): Widget2D[] {
    if (!obj.panel) {
      obj.panel = {
        width: 400,
        height: 280,
        objectFit: 'none',
        widgets: [],
      }
    }
    if (!obj.panel.widgets) obj.panel.widgets = []
    delete obj.panel.items
    return obj.panel.widgets
  }

  function getActiveWidgets(): Widget2D[] {
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return []
      return ensurePanelWidgetsList(obj)
    }
    const page = activePage2d.value
    if (!page) return []
    return page.layers.flatMap((l) => l.widgets)
  }

  function selectWidget(id: string | null, opts?: { additive?: boolean }) {
    if (!id) {
      selectedWidgetIds.value = []
      return
    }
    if (opts?.additive) {
      const set = new Set(selectedWidgetIds.value)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      selectedWidgetIds.value = [...set]
    } else {
      selectedWidgetIds.value = [id]
    }
  }

  function setSelection(ids: string[]) {
    selectedWidgetIds.value = [...ids]
  }

  function startDrawTool(type: DrawToolType) {
    previewLive.value = false
    drawTool.value = type
    selectedWidgetIds.value = []
  }

  function cancelDrawTool() {
    drawTool.value = null
  }

  function setPreviewLive(on: boolean) {
    previewLive.value = on
    if (on) drawTool.value = null
  }

  function setGizmoMode3d(mode: 'translate' | 'rotate' | 'scale') {
    gizmoMode3d.value = mode
  }

  function addWidget(type: BuiltinWidgetType, at?: { x: number; y: number }): Widget2D | null {
    const page = activePage2d.value
    if (!page) return null
    if (type === 'scene3d' && (page.usage === 'object3d-panel' || isPanelEditMode())) return null
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return null
      pushHistory()
      const list = ensurePanelWidgetsList(obj)
      const widget = createWidget2D(type)
      const pw = obj.panel?.width ?? 400
      const ph = obj.panel?.height ?? 280
      if (at) {
        widget.transform.x = at.x
        widget.transform.y = at.y
      } else {
        widget.transform.x = Math.max(0, pw / 2 - widget.transform.width / 2)
        widget.transform.y = Math.max(0, ph / 2 - widget.transform.height / 2)
      }
      list.push(widget)
      selectedWidgetIds.value = [widget.id]
      drawTool.value = null
      touch()
      bumpScene3d()
      return widget
    }
    pushHistory()
    const layer = ensureDefaultLayer(page)
    if (layer.locked) return null
    const widget = createWidget2D(type)
    if (at) {
      widget.transform.x = at.x
      widget.transform.y = at.y
    } else {
      widget.transform.x = page.width / 2 - widget.transform.width / 2
      widget.transform.y = page.height / 2 - widget.transform.height / 2
    }
    layer.widgets.push(widget)
    selectedWidgetIds.value = [widget.id]
    drawTool.value = null
    touch()
    return widget
  }

  /** 插入已构造好的图元（绘制工具落盘） */
  function insertWidget(widget: Widget2D): Widget2D | null {
    if (usesLegacyPanelWidgets()) {
      if (widget.type === 'scene3d') return null
      const obj = getPanelEditObject()
      if (!obj) return null
      pushHistory()
      ensurePanelWidgetsList(obj).push(widget)
      selectedWidgetIds.value = [widget.id]
      drawTool.value = null
      touch()
      bumpScene3d()
      return widget
    }
    const page = activePage2d.value
    if (!page) return null
    if (widget.type === 'scene3d' && page.usage === 'object3d-panel') return null
    pushHistory()
    const layer = ensureDefaultLayer(page)
    if (layer.locked) return null
    layer.widgets.push(widget)
    selectedWidgetIds.value = [widget.id]
    drawTool.value = null
    touch()
    return widget
  }

  function updateWidget(id: string, patch: Partial<Widget2D>, opts?: { recordHistory?: boolean }) {
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return
      const list = ensurePanelWidgetsList(obj)
      const idx = list.findIndex((w) => w.id === id)
      if (idx < 0) return
      if (opts?.recordHistory !== false) pushHistory()
      const prev = list[idx]!
      list[idx] = {
        ...prev,
        ...patch,
        transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
        style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
        props: patch.props ? { ...prev.props, ...patch.props } : prev.props,
        bindings: patch.bindings ?? prev.bindings,
        animations: patch.animations ?? prev.animations,
        animationLinks: patch.animationLinks ?? prev.animationLinks,
        events: patch.events ?? prev.events,
        scriptIds: patch.scriptIds ?? prev.scriptIds,
        children: patch.children ?? prev.children,
      }
      touch()
      bumpScene3d()
      return
    }
    const page = activePage2d.value
    if (!page) return
    if (opts?.recordHistory !== false) pushHistory()
    for (const layer of page.layers) {
      const idx = layer.widgets.findIndex((w) => w.id === id)
      if (idx >= 0) {
        const prev = layer.widgets[idx]
        layer.widgets[idx] = {
          ...prev,
          ...patch,
          transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
          style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
          props: patch.props ? { ...prev.props, ...patch.props } : prev.props,
        }
        touch()
        return
      }
    }
  }

  /** 拖拽/变换结束批量提交，只记一次历史 */
  function commitWidgetTransforms(
    patches: Record<string, Widget2D['transform']>,
    opts?: { recordHistory?: boolean },
  ) {
    if (!Object.keys(patches).length) return
    if (opts?.recordHistory !== false) pushHistory()
    for (const [id, transform] of Object.entries(patches)) {
      updateWidget(id, { transform }, { recordHistory: false })
    }
  }

  function removeWidget(id: string) {
    removeWidgets([id])
  }

  function removeWidgets(ids: string[]) {
    if (!ids.length) return
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return
      pushHistory()
      const idSet = new Set(ids)
      const list = ensurePanelWidgetsList(obj)
      obj.panel!.widgets = list.filter((w) => !idSet.has(w.id))
      selectedWidgetIds.value = selectedWidgetIds.value.filter((id) => !idSet.has(id))
      touch()
      bumpScene3d()
      return
    }
    const page = activePage2d.value
    if (!page) return
    pushHistory()
    const idSet = new Set(ids)
    for (const layer of page.layers) {
      layer.widgets = layer.widgets.filter((w) => !idSet.has(w.id))
    }
    selectedWidgetIds.value = selectedWidgetIds.value.filter((id) => !idSet.has(id))
    touch()
  }

  function duplicateWidget(id: string): Widget2D | null {
    const copies = duplicateWidgets([id])
    return copies[0] ?? null
  }

  function duplicateWidgets(ids: string[]): Widget2D[] {
    if (!ids.length) return []
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return []
      pushHistory()
      const list = ensurePanelWidgetsList(obj)
      const created: Widget2D[] = []
      for (const src of list.filter((w) => ids.includes(w.id))) {
        const copy: Widget2D = clonePlain(src)
        copy.id = `w_${src.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        copy.name = `${src.name} 副本`
        copy.transform = {
          ...copy.transform,
          x: copy.transform.x + 24,
          y: copy.transform.y + 24,
        }
        list.push(copy)
        created.push(copy)
      }
      if (created.length) {
        selectedWidgetIds.value = created.map((w) => w.id)
        touch()
        bumpScene3d()
      }
      return created
    }
    const page = activePage2d.value
    if (!page) return []
    pushHistory()
    const created: Widget2D[] = []
    for (const layer of page.layers) {
      const sources = layer.widgets.filter((w) => ids.includes(w.id))
      for (const src of sources) {
        const copy: Widget2D = clonePlain(src)
        copy.id = `w_${src.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        copy.name = `${src.name} 副本`
        copy.transform = {
          ...copy.transform,
          x: copy.transform.x + 24,
          y: copy.transform.y + 24,
        }
        layer.widgets.push(copy)
        created.push(copy)
      }
    }
    if (created.length) {
      selectedWidgetIds.value = created.map((w) => w.id)
      touch()
    }
    return created
  }

  function alignSelected(mode: AlignMode) {
    const widgets = selectedWidgets.value
    const patches = computeAlignPatches(widgets, mode)
    if (!Object.keys(patches).length) return
    commitWidgetTransforms(patches)
  }

  type ZOrderMode = 'front' | 'forward' | 'backward' | 'back'

  function reorderSelected(mode: ZOrderMode) {
    if (!selectedWidgetIds.value.length) return
    if (usesLegacyPanelWidgets()) {
      const obj = getPanelEditObject()
      if (!obj) return
      pushHistory()
      const list = ensurePanelWidgetsList(obj)
      const idSet = new Set(selectedWidgetIds.value)
      const selected = list.filter((w) => idSet.has(w.id))
      const others = list.filter((w) => !idSet.has(w.id))
      if (!selected.length) return
      let next: Widget2D[]
      if (mode === 'front') next = [...others, ...selected]
      else if (mode === 'back') next = [...selected, ...others]
      else if (mode === 'forward') {
        next = [...list]
        for (let i = next.length - 2; i >= 0; i--) {
          if (idSet.has(next[i]!.id) && !idSet.has(next[i + 1]!.id)) {
            ;[next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
          }
        }
      } else {
        next = [...list]
        for (let i = 1; i < next.length; i++) {
          if (idSet.has(next[i]!.id) && !idSet.has(next[i - 1]!.id)) {
            ;[next[i], next[i - 1]] = [next[i - 1]!, next[i]!]
          }
        }
      }
      obj.panel!.widgets = next
      touch()
      bumpScene3d()
      return
    }
    const page = activePage2d.value
    if (!page) return
    const layer = findLayerForSelection()
    if (!layer || layer.locked) return
    pushHistory()
    const idSet = new Set(selectedWidgetIds.value)
    const selected = layer.widgets.filter((w) => idSet.has(w.id))
    const others = layer.widgets.filter((w) => !idSet.has(w.id))
    if (!selected.length) return

    if (mode === 'front') {
      layer.widgets = [...others, ...selected]
    } else if (mode === 'back') {
      layer.widgets = [...selected, ...others]
    } else if (mode === 'forward') {
      const next = [...layer.widgets]
      for (let i = next.length - 2; i >= 0; i--) {
        if (idSet.has(next[i].id) && !idSet.has(next[i + 1].id)) {
          ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
        }
      }
      layer.widgets = next
    } else if (mode === 'backward') {
      const next = [...layer.widgets]
      for (let i = 1; i < next.length; i++) {
        if (idSet.has(next[i].id) && !idSet.has(next[i - 1].id)) {
          ;[next[i], next[i - 1]] = [next[i - 1], next[i]]
        }
      }
      layer.widgets = next
    }
    touch()
  }

  function groupSelected() {
    const page = activePage2d.value
    const widgets = selectedWidgets.value
    if (!page || widgets.length < 2) return
    if (widgets.some((w) => w.type === 'group')) {
      // 允许组合含 group，先简单扁平策略：只组合当前选中顶层
    }
    pushHistory()
    const layer = ensureDefaultLayer(page)
    if (layer.locked) return
    const minX = Math.min(...widgets.map((w) => w.transform.x))
    const minY = Math.min(...widgets.map((w) => w.transform.y))
    const maxR = Math.max(...widgets.map((w) => w.transform.x + Math.max(w.transform.width, 1)))
    const maxB = Math.max(...widgets.map((w) => w.transform.y + Math.max(w.transform.height, 1)))
    const group = createWidget2D('group')
    group.name = '组合'
    group.transform = {
      x: minX,
      y: minY,
      width: Math.max(4, maxR - minX),
      height: Math.max(4, maxB - minY),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    }
    group.children = widgets.map((w) => {
      const child = clonePlain(w)
      child.transform = {
        ...child.transform,
        x: child.transform.x - minX,
        y: child.transform.y - minY,
      }
      return child
    })
    const idSet = new Set(widgets.map((w) => w.id))
    for (const srcLayer of page.layers) {
      srcLayer.widgets = srcLayer.widgets.filter((w) => !idSet.has(w.id))
    }
    layer.widgets.push(group)
    selectedWidgetIds.value = [group.id]
    touch()
  }

  function ungroupSelected() {
    const page = activePage2d.value
    if (!page) return
    const groups = selectedWidgets.value.filter((w) => w.type === 'group' && w.children?.length)
    if (!groups.length) return
    pushHistory()
    const allRestored: Widget2D[] = []
    for (const group of groups) {
      const layer = findLayerOfWidget(group.id)
      if (!layer || layer.locked) continue
      const restored: Widget2D[] = []
      for (const child of group.children ?? []) {
        const next = clonePlain(child)
        next.transform = {
          ...next.transform,
          x: next.transform.x + group.transform.x,
          y: next.transform.y + group.transform.y,
        }
        restored.push(next)
      }
      layer.widgets = layer.widgets.filter((w) => w.id !== group.id)
      layer.widgets.push(...restored)
      allRestored.push(...restored)
    }
    if (!allRestored.length) return
    selectedWidgetIds.value = allRestored.map((w) => w.id)
    touch()
  }

  function copySelected() {
    if (!selectedWidgets.value.length) return
    clipboard.value = clonePlain(selectedWidgets.value)
  }

  function cutSelected() {
    if (!selectedWidgets.value.length) return
    copySelected()
    removeWidgets(selectedWidgetIds.value)
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selectedWidgetIds.value.length) return
    if (!activePage2d.value && !usesLegacyPanelWidgets()) return
    const patches: Record<string, Widget2D['transform']> = {}
    for (const w of selectedWidgets.value) {
      if (w.locked) continue
      patches[w.id] = {
        ...w.transform,
        x: w.transform.x + dx,
        y: w.transform.y + dy,
      }
    }
    if (!Object.keys(patches).length) return
    commitWidgetTransforms(patches)
  }

  /** 对齐 Flight 工具栏：向左/向右旋转（默认 ±90°） */
  function rotateSelected(deltaDeg: number) {
    if (!selectedWidgetIds.value.length) return
    const patches: Record<string, Widget2D['transform']> = {}
    for (const w of selectedWidgets.value) {
      if (w.locked) continue
      patches[w.id] = {
        ...w.transform,
        rotation: w.transform.rotation + deltaDeg,
      }
    }
    if (!Object.keys(patches).length) return
    commitWidgetTransforms(patches)
  }

  /** 批量设置选中图元的 visible / locked；value 省略则按首个取反 */
  function setSelectedFlags(key: 'visible' | 'locked', value?: boolean) {
    const widgets = selectedWidgets.value
    if (!widgets.length) return
    const current =
      key === 'visible' ? widgets[0].visible !== false : Boolean(widgets[0].locked)
    const next = value ?? !current
    pushHistory()
    for (const w of widgets) {
      updateWidget(w.id, { [key]: next }, { recordHistory: false })
    }
  }

  function openAnimationConnection(tab: 'default' | 'property' | 'event' = 'default') {
    // 3D 页：按选中对象打开（与 2D 图元共用同一弹窗）
    if (activePage3d.value && selectedObject3dIds.value.length) {
      if (selectedObject3dIds.value.length > 1) {
        selectedObject3dIds.value = [selectedObject3dIds.value[0]]
      }
      animationConnectionTab.value = tab
      animationConnectionOpen.value = true
      return
    }
    if (!selectedWidgetIds.value.length) return
    // 动画连接按单图元编辑（Flight 习惯）
    if (selectedWidgetIds.value.length > 1) {
      selectedWidgetIds.value = [selectedWidgetIds.value[0]]
    }
    animationConnectionTab.value = tab
    animationConnectionOpen.value = true
  }

  function closeAnimationConnection() {
    animationConnectionOpen.value = false
  }

  /** 打开「液位」配置对话框（选中罐体 = 新建；选中液位层 = 改配置） */
  function openLiquidConfig() {
    if (!activePage3d.value || !selectedObject3d.value) return
    liquidConfigOpen.value = true
  }

  function closeLiquidConfig() {
    liquidConfigOpen.value = false
  }

  /** 打开「管道流动」配置对话框（多选时对全部选中对象批量生效） */
  function openFlowConfig() {
    if (!activePage3d.value || !selectedObject3d.value) return
    flowConfigOpen.value = true
  }

  function closeFlowConfig() {
    flowConfigOpen.value = false
  }

  /**
   * 打开跟镜头面板 2D 内容弹窗（真 Canvas2D，带返回/保存）。
   * 返回时还原快照；保存后同步面板宽高并回到原 3D 页。
   */
  function openObject3dPanelEditor(objectId?: string) {
    const id = objectId || selectedObject3d.value?.id
    if (!id) return

    // 确保当前活动页是包含该对象的 3D 页（ensurePanelPage2d 依赖 activePage3d）
    let host3d = activePage3d.value
    if (!host3d || !findObject3dDeep(host3d.objects, id)) {
      host3d = null
      for (const p of document.value.pages) {
        if (p.type !== '3d') continue
        if (findObject3dDeep(p.objects, id)) {
          host3d = p
          break
        }
      }
      if (!host3d) return
      activePageId.value = host3d.id
      syncActiveLayerForPage(host3d.id)
    }

    const target = findObject3dDeep(host3d.objects, id)
    // 跟镜头面板仅用于纯面板对象（无模型）
    if (!target?.panel || target.modelResourceId) return

    selectedObject3dIds.value = [id]
    const page = ensurePanelPage2d(id)
    if (!page) return

    const objForSnap = target
    panelEditReturnPageId.value = host3d.id
    panelEditObjectId.value = id
    panelEditPageSnapshot.value = JSON.stringify(clonePlain(page))
    panelEditBgSnapshot.value = objForSnap?.panel?.backgroundResourceId?.trim() || null
    object3dPanelEditorOpen.value = true
    setActivePage(page.id)
  }

  function finishPanelPageEditor(opts: { restoreSnapshot: boolean }) {
    const objectId = panelEditObjectId.value
    const returnPageId = panelEditReturnPageId.value
    const snap = panelEditPageSnapshot.value
    const bgSnap = panelEditBgSnapshot.value

    if (opts.restoreSnapshot && snap) {
      try {
        const restored = JSON.parse(snap) as Page2D
        const idx = document.value.pages.findIndex((p) => p.id === restored.id)
        if (idx >= 0) {
          document.value.pages[idx] = restored
          touch()
        }
      } catch {
        /* 快照损坏则保留当前编辑结果 */
      }
      if (objectId && bgSnap !== undefined) {
        const obj = findObject3dById(objectId, returnPageId)
        if (obj?.panel) {
          const next = normalizeObject3DPanel(obj.panel)
          if (bgSnap) next.backgroundResourceId = bgSnap
          else delete next.backgroundResourceId
          obj.panel = next
          touch()
        }
      }
    } else if (objectId) {
      const obj = findObject3dById(objectId, returnPageId)
      const pageId = obj?.panel?.page2dId?.trim()
      const page = pageId
        ? document.value.pages.find((p) => p.id === pageId && p.type === '2d')
        : null
      if (obj?.panel && page && page.type === '2d') {
        obj.panel = normalizeObject3DPanel({
          ...obj.panel,
          width: page.width,
          height: page.height,
        })
        touch()
        bumpScene3d()
      }
    }

    object3dPanelEditorOpen.value = false
    panelEditObjectId.value = null
    panelEditPageSnapshot.value = null
    panelEditBgSnapshot.value = undefined
    panelEditReturnPageId.value = null

    if (returnPageId) {
      setActivePage(returnPageId)
      if (objectId) selectedObject3dIds.value = [objectId]
    }
  }

  function saveObject3dPanelEditor() {
    if (!object3dPanelEditorOpen.value) return
    finishPanelPageEditor({ restoreSnapshot: false })
  }

  function discardObject3dPanelEditor() {
    if (!object3dPanelEditorOpen.value) return
    finishPanelPageEditor({ restoreSnapshot: true })
  }

  function closeObject3dPanelEditor() {
    discardObject3dPanelEditor()
  }

  /** 查找引用了指定 2D 页的面板对象名 */
  function findObjectsUsingPanelPage2d(page2dId: string): string[] {
    const names: string[] = []
    for (const page of document.value.pages) {
      if (page.type !== '3d') continue
      walkObject3dTree(page.objects, (obj) => {
        if (obj.panel?.page2dId === page2dId) {
          names.push(obj.name || obj.id)
        }
      })
    }
    return names
  }

  /**
   * 确保对象面板绑定一张 Page2D（无则从旧 widgets 迁移或新建空白页）。
   */
  function ensurePanelPage2d(objectId: string): Page2D | null {
    const page3d = activePage3d.value
    if (!page3d) return null
    const obj = findObject3dDeep(page3d.objects, objectId)
    if (!obj) return null

    if (!obj.panel) {
      obj.panel = createDefaultObject3DPanel(obj.name || '操作面板')
    } else {
      obj.panel = normalizeObject3DPanel(obj.panel)
    }

    const existingId = obj.panel.page2dId?.trim()
    if (existingId) {
      const existing = document.value.pages.find((p) => p.id === existingId && p.type === '2d')
      if (existing && existing.type === '2d') {
        // 历史自动创建的面板页补标记
        if (!existing.usage && existing.name.startsWith('面板/')) {
          existing.usage = 'object3d-panel'
        }
        delete obj.panel.widgets
        delete obj.panel.items
        touch()
        return existing
      }
    }

    const widgets = resolvePanelWidgets(obj.panel).filter((w) => w.type !== 'scene3d')
    const width = obj.panel.width ?? 400
    const height = obj.panel.height ?? 280
    const page = createPage2D(`面板/${obj.name || objectId.slice(-6)}`, {
      usage: 'object3d-panel',
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    })
    page.background = '#1a1d24'
    if (!page.layers.length) page.layers.push(createLayer2D('默认图层'))
    page.layers[0]!.widgets = widgets
    document.value.pages.push(page)

    obj.panel = normalizeObject3DPanel({
      ...obj.panel,
      width,
      height,
      page2dId: page.id,
      widgets: undefined,
    })
    delete obj.panel.widgets
    delete obj.panel.items
    touch()
    bumpScene3d()
    return page
  }

  function bindPanelPage2d(objectId: string, page2dId: string | null): boolean {
    const page3d = activePage3d.value
    if (!page3d) return false
    const obj = findObject3dDeep(page3d.objects, objectId)
    if (!obj?.panel) return false
    if (page2dId) {
      const page = document.value.pages.find((p) => p.id === page2dId && p.type === '2d')
      if (!page) return false
      obj.panel = normalizeObject3DPanel({
        ...obj.panel,
        page2dId,
        width: obj.panel.width ?? (page as Page2D).width,
        height: obj.panel.height ?? (page as Page2D).height,
      })
      delete obj.panel.widgets
      delete obj.panel.items
    } else {
      delete obj.panel.page2dId
    }
    touch()
    bumpScene3d()
    return true
  }

  /** @deprecated 请用 openObject3dPanelEditor；保留兼容双击/旧入口 */
  function openPanelPageInDesigner(objectId?: string): Page2D | null {
    const id = objectId || panelEditObjectId.value || selectedObject3d.value?.id
    if (!id) return null
    openObject3dPanelEditor(id)
    return getPanelPage2d(id)
  }

  function getPanelPage2d(objectId: string): Page2D | null {
    const obj = findObject3dById(objectId, panelEditReturnPageId.value)
    const pid = obj?.panel?.page2dId?.trim()
    if (!pid) return null
    const page = document.value.pages.find((p) => p.id === pid && p.type === '2d')
    return page && page.type === '2d' ? page : null
  }

  function openObject3dModelEditor() {
    if (!selectedObject3dIds.value.length) return
    if (selectedObject3dIds.value.length > 1) {
      selectedObject3dIds.value = [selectedObject3dIds.value[0]]
    }
    const obj = selectedObject3d.value
    // 纯面板锚点无外观可编
    if (obj?.panel && !obj.modelResourceId) return
    object3dModelEditorOpen.value = true
  }

  function closeObject3dModelEditor() {
    object3dModelEditorOpen.value = false
  }

  /** 对象树拖拽改层级：fromIndex/toIndex 为图层 widgets 数组下标 */
  function moveWidgetIndex(fromIndex: number, toIndex: number) {
    const page = activePage2d.value
    if (!page || fromIndex === toIndex) return
    const layer = selectedWidgetIds.value.length
      ? findLayerForSelection()
      : ensureDefaultLayer(page)
    if (!layer || layer.locked) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= layer.widgets.length || toIndex >= layer.widgets.length)
      return
    pushHistory()
    const next = [...layer.widgets]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    layer.widgets = next
    touch()
  }

  function pasteClipboard() {
    if (!clipboard.value.length || !activePage2d.value) return
    pushHistory()
    const layer = ensureDefaultLayer(activePage2d.value)
    if (layer.locked) return
    const created: Widget2D[] = []
    for (const src of clipboard.value) {
      const copy = clonePlain(src)
      copy.id = `w_${src.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      copy.transform = {
        ...copy.transform,
        x: copy.transform.x + 24,
        y: copy.transform.y + 24,
      }
      // 递归刷新 group 子 id，避免冲突
      if (copy.children?.length) {
        copy.children = copy.children.map((c) => ({
          ...c,
          id: `w_${c.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        }))
      }
      layer.widgets.push(copy)
      created.push(copy)
    }
    // 再次粘贴继续偏移
    clipboard.value = created.map((w) => clonePlain(w))
    selectedWidgetIds.value = created.map((w) => w.id)
    touch()
  }

  function addGuide(orientation: 'h' | 'v', pos: number) {
    const page = activePage2d.value
    if (!page) return
    if (!Array.isArray(page.guides)) page.guides = []
    pushHistory()
    page.guides.push(createGuideLine(orientation, pos))
    touch()
  }

  function updateGuide(id: string, pos: number) {
    const page = activePage2d.value
    if (!page?.guides?.length) return
    const guide = page.guides.find((g) => g.id === id)
    if (!guide) return
    pushHistory()
    guide.pos = pos
    touch()
  }

  function removeGuide(id: string) {
    const page = activePage2d.value
    if (!page?.guides?.length) return
    pushHistory()
    page.guides = page.guides.filter((g) => g.id !== id)
    touch()
  }

  function saveSymbolFromSelection(name: string): SymbolDefinition | null {
    if (!name.trim()) return null
    if (selectedWidgetIds.value.length > 1) {
      groupSelected()
    }
    const widgets = selectedWidgets.value
    if (widgets.length !== 1) return null
    if (!document.value.symbols) document.value.symbols = []
    const sym = createSymbolDefinition(name.trim(), widgets[0])
    document.value.symbols.push(sym)
    touch()
    return sym
  }

  function placeSymbol(symbolId: string, at?: { x: number; y: number }): Widget2D | null {
    const sym = document.value.symbols?.find((s) => s.id === symbolId)
    if (!sym) return null
    const widget = cloneWidgetWithNewIds(sym.root)
    if (at) {
      widget.transform.x = at.x
      widget.transform.y = at.y
    }
    return insertWidget(widget)
  }

  function removeSymbol(symbolId: string) {
    if (!document.value.symbols) return
    document.value.symbols = document.value.symbols.filter((s) => s.id !== symbolId)
    touch()
  }

  function createAndAddPage(
    type: '2d' | '3d',
    opts?: {
      name?: string
      width?: number
      height?: number
      background?: string
    },
  ) {
    const name = opts?.name
    const page = type === '2d' ? createPage2D(name ?? '新页面') : createPage3D(name ?? '三维场景')
    if (page.type === '2d') {
      if (opts?.width && opts.width > 0) page.width = opts.width
      if (opts?.height && opts.height > 0) page.height = opts.height
      if (opts?.background) page.background = opts.background
    }
    document.value.pages.push(page)
    activePageId.value = page.id
    syncActiveLayerForPage(page.id)
    selectedWidgetIds.value = []
    clearHistory()
    touch()
    return page
  }

  function renamePage(pageId: string, name: string) {
    const page = document.value.pages.find((p) => p.id === pageId)
    if (!page || !name.trim()) return
    page.name = name.trim()
    touch()
  }

  function updatePageSettings(
    pageId: string,
    patch: Partial<Pick<Page2D, 'name' | 'width' | 'height' | 'background'>>,
  ) {
    const page = document.value.pages.find((p) => p.id === pageId)
    if (!page) return
    if (patch.name?.trim()) page.name = patch.name.trim()
    if (page.type === '2d') {
      if (patch.width && patch.width > 0) page.width = patch.width
      if (patch.height && patch.height > 0) page.height = patch.height
      if (patch.background !== undefined) page.background = patch.background
    }
    touch()
  }

  function removePage(pageId: string): { ok: boolean; reason?: string } {
    const navPages = listNavigationPages(document.value)
    const target = document.value.pages.find((p) => p.id === pageId)
    // 普通页至少保留一个；面板内容页可删（仍受引用检查）
    if (target && !isObject3dPanelPage(target) && navPages.length <= 1) {
      return { ok: false, reason: '至少保留一个页面' }
    }
    const refs = findObjectsUsingPanelPage2d(pageId)
    if (refs.length) {
      return {
        ok: false,
        reason: `该页被跟镜头面板引用：${refs.slice(0, 3).join('、')}${refs.length > 3 ? '…' : ''}，请先解绑或关闭面板`,
      }
    }
    const idx = document.value.pages.findIndex((p) => p.id === pageId)
    if (idx < 0) return { ok: false, reason: '页面不存在' }
    document.value.pages.splice(idx, 1)
    if (document.value.homePageId === pageId) {
      document.value.homePageId = listNavigationPages(document.value)[0]?.id
    }
    if (activePageId.value === pageId) {
      const nav = listNavigationPages(document.value)
      activePageId.value = nav[Math.min(idx, Math.max(0, nav.length - 1))]?.id ?? nav[0]?.id
      if (activePageId.value) syncActiveLayerForPage(activePageId.value)
      selectedWidgetIds.value = []
      clearHistory()
    }
    touch()
    return { ok: true }
  }

  function movePage(pageId: string, direction: -1 | 1) {
    const idx = document.value.pages.findIndex((p) => p.id === pageId)
    if (idx < 0) return
    const target = idx + direction
    if (target < 0 || target >= document.value.pages.length) return
    const pages = document.value.pages
    ;[pages[idx], pages[target]] = [pages[target], pages[idx]]
    touch()
  }

  function duplicatePage(pageId: string) {
    const page = document.value.pages.find((p) => p.id === pageId)
    if (!page) return
    const copy = clonePageWithNewIds(page)
    const idx = document.value.pages.findIndex((p) => p.id === pageId)
    document.value.pages.splice(idx + 1, 0, copy)
    activePageId.value = copy.id
    syncActiveLayerForPage(copy.id)
    selectedWidgetIds.value = []
    clearHistory()
    touch()
  }

  function savePageAsTemplate(pageId: string, name?: string) {
    const page = document.value.pages.find((p) => p.id === pageId)
    if (!page) return null
    if (!document.value.pageTemplates) document.value.pageTemplates = []
    const tpl = createPageTemplate(name?.trim() || `${page.name} 模板`, page)
    document.value.pageTemplates.push(tpl)
    touch()
    return tpl
  }

  function createPageFromTemplate(templateId: string, name?: string) {
    const tpl = document.value.pageTemplates?.find((t) => t.id === templateId)
    if (!tpl) return null
    const page = clonePageWithNewIds(tpl.page, name?.trim() || `${tpl.name}`)
    document.value.pages.push(page)
    activePageId.value = page.id
    syncActiveLayerForPage(page.id)
    selectedWidgetIds.value = []
    selectedObject3dIds.value = []
    clearHistory()
    touch()
    return page
  }

  function removePageTemplate(templateId: string) {
    if (!document.value.pageTemplates) return
    document.value.pageTemplates = document.value.pageTemplates.filter((t) => t.id !== templateId)
    touch()
  }

  function setHomePage(pageId: string) {
    if (!document.value.pages.some((p) => p.id === pageId)) return
    document.value.homePageId = pageId
    touch()
  }

  async function saveAs(name: string): Promise<ProjectDocument> {
    const now = Date.now()
    const cloned = clonePlain(document.value)
    cloned.meta = {
      ...cloned.meta,
      id: `prj_${now}`,
      name: name.trim() || `${cloned.meta.name} 副本`,
      createdAt: now,
      updatedAt: now,
      version: '0.1.0',
    }
    document.value = normalizeProjectDocument(cloned)
    activePageId.value = cloned.homePageId ?? cloned.pages[0]?.id
    syncActiveLayerForPage(activePageId.value!)
    selectedWidgetIds.value = []
    published.value = null
    clearHistory()
    return save()
  }

  async function addImageResource(file: File): Promise<ProjectResource> {
    try {
      const uploaded = await apiUploadResource(document.value.meta.id, file)
      const resource: ProjectResource = {
        id: uploaded.id,
        name: uploaded.name,
        kind: uploaded.kind === 'svg' ? 'svg' : 'image',
        path: uploaded.path,
        mimeType: uploaded.mimeType,
      }
      document.value.resources.push(resource)
      touch()
      return resource
    } catch {
      // 后端不可用时回退 dataURL，保证本地仍可设计
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          const kind = file.name.toLowerCase().endsWith('.svg') ? 'svg' : 'image'
          const resource: ProjectResource = {
            id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            kind,
            path: dataUrl,
            mimeType: file.type,
          }
          document.value.resources.push(resource)
          touch()
          resolve(resource)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
    }
  }

  async function addImageWidgetFromFile(file: File) {
    const resource = await addImageResource(file)
    const widget = addWidget('image')
    if (!widget) return null
    updateWidget(
      widget.id,
      {
        name: resource.name,
        props: { resourceId: resource.id, src: resolveResourceUrl(resource.path) },
      },
      { recordHistory: false },
    )
    return widget
  }

  function selectObject3d(id: string | null, opts?: { additive?: boolean }) {
    if (!id) {
      selectedObject3dIds.value = []
      return
    }
    if (opts?.additive) {
      const rest = selectedObject3dIds.value.filter((x) => x !== id)
      const already = selectedObject3dIds.value.includes(id)
      // 再点已选项：仅改为主选，不取消（取消用空白单击）
      selectedObject3dIds.value = already ? [id, ...rest] : [id, ...rest]
    } else {
      selectedObject3dIds.value = [id]
    }
  }

  function setObject3dSelection(ids: string[], primaryId?: string) {
    const uniq = [...new Set(ids.filter(Boolean))]
    if (primaryId && uniq.includes(primaryId)) {
      selectedObject3dIds.value = [primaryId, ...uniq.filter((x) => x !== primaryId)]
    } else {
      selectedObject3dIds.value = uniq
    }
  }

  function requestFocusSelected3d() {
    // 仅「再框住当前选中」；不与对象树聚焦命令混用
    focus3dNonce.value += 1
  }

  /** 对象树点选：选中 + 一条聚焦命令 */
  function focusCameraOnObject3d(id: string) {
    if (!id) return
    selectedObject3dIds.value = [id]
    cameraFocus3dCmd.value = { id, at: Date.now() }
  }

  async function addObject3d(opts?: {
    primitive?: BuiltinPrimitive3D
    modelResourceId?: string
    name?: string
    panel?: true | import('@web-scada/core').Object3DPanel
  }) {
    const page = activePage3d.value
    if (!page) return null
    pushHistory()
    const obj = createObject3D(opts)
    // 在当前视角焦点附近落点（小范围错开），避免按对象总数往外摊到格子外
    const y = opts?.panel ? 1.2 : opts?.primitive === 'arrow' ? 1.4 : 0.5
    const hint = spawnHint3d.value
    const focus = page.camera?.target
    const sel = selectedObject3d.value
    const cx = hint
      ? hint.x
      : Number.isFinite(focus?.[0])
        ? focus![0]
        : sel
          ? sel.transform.position[0]
          : 0
    const cz = hint
      ? hint.z
      : Number.isFinite(focus?.[2])
        ? focus![2]
        : sel
          ? sel.transform.position[2]
          : 0
    const slot = page.objects.length % 9
    const ox = (slot % 3 - 1) * 1.2
    const oz = (Math.floor(slot / 3) - 1) * 1.2
    obj.transform.position = [cx + ox, y, cz + oz]

    // 模型：文件按米建模；scale=[1,1,1] 即真实尺寸（与 sourceSize 同数值）
    if (opts?.modelResourceId) {
      const url = getResourceUrl(opts.modelResourceId)
      if (url) {
        try {
          const { measureModelSourceSize } = await import('@/shared/three/modelFit')
          const { sizeMetersFromObject3d } = await import('@web-scada/core')
          const { sourceSize } = await measureModelSourceSize(url)
          obj.sourceSize = sourceSize
          obj.sourceUnit = 'm'
          obj.transform.scale = [1, 1, 1]
          // 底部贴近地面：米制高度的一半
          const sizeM = sizeMetersFromObject3d(obj)
          const halfH = sizeM[1] / 2
          if (Number.isFinite(halfH) && halfH > 0) {
            obj.transform.position[1] = halfH
          }
        } catch {
          /* 测量失败则保持 scale=1，无 sourceSize */
        }
      }
    }

    page.objects = [...page.objects, obj]
    selectedObject3dIds.value = [obj.id]
    bumpScene3d({ frame: true })
    touch()
    return obj
  }

  function resolvePage3dForObject(objectId: string): Page3D | null {
    const active = activePage3d.value
    if (active && findObject3dDeep(active.objects, objectId)) return active
    const retId = panelEditReturnPageId.value
    if (retId) {
      const ret = document.value.pages.find((p) => p.id === retId && p.type === '3d')
      if (ret && ret.type === '3d' && findObject3dDeep(ret.objects, objectId)) return ret
    }
    for (const p of document.value.pages) {
      if (p.type !== '3d') continue
      if (findObject3dDeep(p.objects, objectId)) return p
    }
    return null
  }

  function updateObject3d(
    id: string,
    patch: Partial<Object3DNode>,
    opts?: { recordHistory?: boolean },
  ) {
    // 面板 2D 弹窗打开时 active 是 2D 页，需回落到原 3D 页
    const page = resolvePage3dForObject(id)
    if (!page) return
    const loc = locateObject3d(page.objects, id)
    if (!loc) return
    if (opts?.recordHistory !== false) pushHistory()
    const prev = loc.list[loc.index]
    loc.list[loc.index] = {
      ...prev,
      ...patch,
      transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
      style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
      // 必须用 in：显式 panel: undefined 表示关闭面板；!== undefined 会永远保留旧 panel
      panel: 'panel' in patch ? patch.panel : prev.panel,
      bindings: patch.bindings ?? prev.bindings,
      animations: patch.animations ?? prev.animations,
      animationLinks: patch.animationLinks ?? prev.animationLinks,
      events: patch.events ?? prev.events,
      children: patch.children ?? prev.children,
    }
    touch()
    if ('panel' in patch) bumpScene3d()
  }

  function removeObject3d(id: string) {
    removeObject3ds([id])
  }

  function removeObject3ds(ids: string[]) {
    const page = activePage3d.value
    if (!page || !ids.length) return
    pushHistory()
    const idSet = new Set(ids)
    const strip = (list: Object3DNode[]): Object3DNode[] =>
      list
        .filter((o) => !idSet.has(o.id))
        .map((o) => ({
          ...o,
          children: o.children?.length ? strip(o.children) : o.children,
        }))
    page.objects = strip(page.objects)
    selectedObject3dIds.value = selectedObject3dIds.value.filter((id) => !idSet.has(id))
    bumpScene3d()
    touch()
  }

  /**
   * 液位层：给罐体加一层液体（已有则原地更新），返回液位层节点。
   * 几何按罐体尺寸自动算，液位由「位移 Y + 缩放 Y」两条连接从罐底往上长。
   */
  function addLiquidLevel(tankId: string, opts: LiquidLevelOptions): Object3DNode | null {
    if (!opts.tagId) return null
    const page = resolvePage3dForObject(tankId)
    if (!page) return null
    const loc = locateObject3d(page.objects, tankId)
    if (!loc) return null
    const tank = loc.list[loc.index]
    pushHistory()
    const exist = (tank.children ?? []).find((c) => c.liquid)
    const node = exist
      ? syncLiquidLevelNode(tank, exist, opts)
      : createLiquidLevelNode(tank, opts)
    const children = exist
      ? (tank.children ?? []).map((c) => (c.id === node.id ? node : c))
      : [...(tank.children ?? []), node]
    loc.list[loc.index] = { ...tank, children }
    selectedObject3dIds.value = [node.id]
    bumpScene3d()
    touch()
    return node
  }

  /** 改液位层配置（变量 / 量程 / 颜色 / 形状 / 内缩 / 液体不透明度） */
  function updateLiquidLevel(
    liquidId: string,
    opts: Partial<LiquidLevelOptions>,
  ): Object3DNode | null {
    const node = findObject3dById(liquidId)
    if (!node?.liquid) return null
    const tank = findObject3dById(node.liquid.tankId)
    if (!tank) return null
    const merged: LiquidLevelOptions = {
      tagId: node.liquid.tagId,
      inMin: node.liquid.inMin,
      inMax: node.liquid.inMax,
      color: node.liquid.color,
      opacity: node.liquid.opacity,
      shape: node.liquid.shape,
      inset: node.liquid.inset,
      ...opts,
    }
    if (!merged.tagId) return null
    const next = syncLiquidLevelNode(tank, node, merged)
    updateObject3d(liquidId, next)
    return next
  }

  /**
   * 一键生成「透明液位罐」预制件：半透明圆罐 + 液位层（液位层是罐壁子对象，改尺寸自动跟随）。
   * 纯内置图元组合，不需要任何模型文件；变量可在属性栏「液位」里补选。
   */
  function addGlassLiquidTank(opts?: {
    tagId?: string
    name?: string
    diameter?: number
    height?: number
  }): Object3DNode | null {
    const page = activePage3d.value
    if (!page) return null
    pushHistory()
    const dia = Math.max(0.2, Number(opts?.diameter) || 2)
    const hgt = Math.max(0.2, Number(opts?.height) || 3)
    const shell = createObject3D({ primitive: 'cylinder', name: opts?.name ?? '液位罐' })
    shell.sourceSize = [...PRIMITIVE_SOURCE_SIZE_M.cylinder] as [number, number, number]
    shell.sourceUnit = 'm'
    shell.transform.scale = [dia / 0.9, hgt / 1.2, dia / 0.9]
    const hint = spawnHint3d.value
    const focus = page.camera?.target
    shell.transform.position = [hint?.x ?? focus?.[0] ?? 0, hgt / 2, hint?.z ?? focus?.[2] ?? 0]
    // 玻璃罐壁：半透明 + 双面，便于看到内部液位
    shell.material = {
      override: true,
      opacity: 0.25,
      color: shell.style?.color ?? '#a8c4d8',
      side: 'double',
      metalness: 0.05,
      roughness: 0.25,
    }
    const node = createLiquidLevelNode(shell, {
      tagId: opts?.tagId ?? '',
      mode: 'primitive',
      color: LIQUID_DEFAULT_COLOR,
      opacity: 1,
      shape: 'cylinder',
      inset: 0.02,
    })
    shell.children = [node]
    page.objects = [...page.objects, shell]
    selectedObject3dIds.value = [node.id]
    bumpScene3d({ frame: true })
    touch()
    return node
  }

  /**
   * 管道流动：给一批对象加/改/删 flow 连接（可一次选中整张管网批量应用）。
   * opts = null 表示移除。
   */
  function setObject3dFlow(
    objectIds: string[],
    opts: {
      tagId: string
      inMin: number
      inMax: number
      outMin?: number
      outMax?: number
      speed: number
      stripe?: number
      color?: string
      duty?: number
      axis?: 'auto' | 'x' | 'y' | 'z'
      style?: 'skin' | 'ribbon' | 'chevron' | 'arrow' | 'stripe'
      width?: number
      thick?: number
      size?: number
      alpha?: number
      glow?: number
    } | null,
  ) {
    const ids = objectIds.filter(Boolean)
    if (!ids.length) return
    pushHistory()
    for (const id of ids) {
      const node = findObject3dById(id)
      if (!node) continue
      const others = (node.animationLinks ?? []).filter((l) => l.type !== 'flow')
      if (!opts) {
        updateObject3d(id, { animationLinks: others }, { recordHistory: false })
        continue
      }
      const prev = (node.animationLinks ?? []).find(
        (l) => l.type === 'flow',
      ) as AnimationLinkFlow | undefined
      const link: AnimationLinkFlow = {
        id: prev?.id ?? `flow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'flow',
        enabled: true,
        tagId: opts.tagId,
        inMin: opts.inMin,
        inMax: opts.inMax,
        outMin: opts.outMin ?? 0,
        outMax: opts.outMax ?? 1,
        speed: opts.speed,
        stripe: opts.stripe,
        color: opts.color,
        duty: opts.duty,
        axis: opts.axis ?? 'auto',
        style:
          opts.style === 'stripe'
            ? 'stripe'
            : opts.style === 'arrow'
              ? 'arrow'
              : opts.style === 'chevron'
                ? 'chevron'
                : opts.style === 'ribbon'
                  ? 'ribbon'
                  : 'skin',
        width: opts.width,
        thick: opts.thick,
        size: opts.size,
        alpha: opts.alpha,
        glow: opts.glow,
      }
      updateObject3d(id, { animationLinks: [...others, link] }, { recordHistory: false })
    }
    bumpScene3d()
    touch()
  }

  /** 选中本页所有"用同一模型"的对象（一键选中整张管网） */
  function selectObject3dsByModel(resourceId: string): number {
    const page = activePage3d.value
    if (!page || !resourceId) return 0
    const ids: string[] = []
    walkObject3dTree(page.objects, (obj) => {
      if (obj.modelResourceId === resourceId) ids.push(obj.id)
    })
    if (!ids.length) return 0
    selectedObject3dIds.value = ids
    bumpScene3d()
    return ids.length
  }

  /** 删除液位层 */
  function removeLiquidLevel(liquidId: string) {
    const node = findObject3dById(liquidId)
    if (!node?.liquid) return
    removeObject3d(liquidId)
  }

  /**
   * 罐壁不透明度 0.05~1：做液位时通常调到 0.35 左右才看得见罐内液体。
   * 只补 opacity 等字段，保留用户已有的材质改动与贴图。
   */
  function setObject3dShellOpacity(tankId: string, opacity: number) {
    const tank = findObject3dById(tankId)
    if (!tank) return
    const prev = tank.material
    const next: Object3DMaterial = {
      ...(prev ?? {}),
      override: true,
      opacity: Math.min(1, Math.max(0.05, Number(opacity) || 1)),
      color: prev?.color ?? tank.style?.color ?? '#94a3b8',
      side: prev?.side ?? 'double',
      metalness: prev?.metalness ?? 0.1,
      roughness: prev?.roughness ?? 0.6,
    }
    updateObject3d(tankId, { material: next })
  }

  /** 删除所有 3D 页中引用指定模型资源的对象 */
  function removeObjectsUsingModelResource(
    resourceId: string,
    opts?: { recordHistory?: boolean },
  ): number {
    const idSet = new Set<string>()
    for (const page of document.value.pages) {
      if (page.type !== '3d') continue
      walkObject3dTree(page.objects, (o) => {
        if (o.modelResourceId === resourceId) idSet.add(o.id)
      })
    }
    if (!idSet.size) return 0
    if (opts?.recordHistory !== false) pushHistory()
    const strip = (list: Object3DNode[]): Object3DNode[] =>
      list
        .filter((o) => !idSet.has(o.id))
        .map((o) => ({
          ...o,
          children: o.children?.length ? strip(o.children) : o.children,
        }))
    for (const page of document.value.pages) {
      if (page.type !== '3d') continue
      page.objects = strip(page.objects)
    }
    selectedObject3dIds.value = selectedObject3dIds.value.filter((id) => !idSet.has(id))
    bumpScene3d()
    touch()
    return idSet.size
  }

  /** 删除模型资源；若场景有引用则一并移除对应对象（一次历史） */
  function deleteModelResource(resourceId: string): { ok: boolean; removedObjects: number } {
    if (!document.value.resources.some((r) => r.id === resourceId && r.kind === 'model')) {
      return { ok: false, removedObjects: 0 }
    }
    pushHistory()
    const removedObjects = removeObjectsUsingModelResource(resourceId, { recordHistory: false })
    document.value.resources = document.value.resources.filter((r) => r.id !== resourceId)
    bumpScene3d()
    touch()
    return { ok: true, removedObjects }
  }

  /**
   * 粘贴/副本共用的偏移量（整批一个 gap）。
   * 禁止按「每个对象自己的 scale」分别算：多选时各模型缩放不同会导致相对位置散开、直线变斜。
   */
  function pasteGapForNodes(nodes: Object3DNode[]): number {
    let typical = 0
    for (const node of nodes) {
      const sx = Math.abs(node.transform.scale[0] || 1)
      const sy = Math.abs(node.transform.scale[1] || 1)
      const sz = Math.abs(node.transform.scale[2] || 1)
      typical = Math.max(typical, sx, sy, sz)
    }
    /**
     * 内置图元 scale≈1，可用尺寸推间距。
     * CAD 管道等自动缩放后 scale 常为 1e-3～1e6，再乘 1.25 会贴到「很远」；这类用固定场景间距。
     */
    if (typical > 0.05 && typical < 8) {
      return Math.min(3, Math.max(1.2, typical * 1.25))
    }
    return 1.5
  }

  function offsetPosition3d(
    position: [number, number, number],
    gap: number,
  ): [number, number, number] {
    return [position[0] + gap, position[1], position[2] + gap * 0.35]
  }

  function copySelectedObject3ds() {
    if (!selectedObjects3d.value.length) return false
    clipboard3d.value = selectedObjects3d.value.map((o) => clonePlain(o))
    return true
  }

  function cutSelectedObject3ds() {
    if (!selectedObjects3d.value.length) return false
    copySelectedObject3ds()
    removeObject3ds([...selectedObject3dIds.value])
    return true
  }

  /** @returns 新创建的对象；失败返回空数组 */
  function pasteClipboard3d(): Object3DNode[] {
    const page = activePage3d.value
    if (!page || !clipboard3d.value.length) return []
    pushHistory()
    const gap = pasteGapForNodes(clipboard3d.value)
    const created: Object3DNode[] = []
    for (const src of clipboard3d.value) {
      const copy = cloneObject3dWithNewIds(src)
      copy.transform = {
        ...copy.transform,
        position: offsetPosition3d(copy.transform.position, gap),
      }
      created.push(copy)
    }
    if (!created.length) return []
    page.objects = [...page.objects, ...created]
    // 再次粘贴继续偏移
    clipboard3d.value = created.map((o) => clonePlain(o))
    selectedObject3dIds.value = created.map((o) => o.id)
    bumpScene3d({ frame: true })
    touch()
    return created
  }

  function duplicateObject3d(id: string) {
    const copies = duplicateObject3ds([id])
    return copies[0] ?? null
  }

  function duplicateObject3ds(ids: string[]) {
    const page = activePage3d.value
    if (!page || !ids.length) return [] as Object3DNode[]
    pushHistory()
    const sources = ids
      .map((id) => findObject3dDeep(page.objects, id))
      .filter((n): n is Object3DNode => Boolean(n))
    if (!sources.length) return []
    const gap = pasteGapForNodes(sources)
    const created: Object3DNode[] = []
    for (const src of sources) {
      const loc = locateObject3d(page.objects, src.id)
      const copy = cloneObject3dWithNewIds(src)
      copy.name = `${src.name} 副本`
      copy.transform = {
        ...copy.transform,
        position: offsetPosition3d(copy.transform.position, gap),
      }
      if (loc?.parent) {
        loc.parent.children = [...(loc.parent.children ?? []), copy]
      } else {
        page.objects = [...page.objects, copy]
      }
      created.push(copy)
    }
    if (created.length) {
      selectedObject3dIds.value = created.map((o) => o.id)
      bumpScene3d({ frame: true })
      touch()
    }
    return created
  }

  /** 将对象移到新父节点下（null = 场景根）；变换按简易位置差处理 */
  function reparentObject3d(id: string, newParentId: string | null) {
    const page = activePage3d.value
    if (!page) return
    if (newParentId === id) return
    if (newParentId && isDescendantOf(page.objects, id, newParentId)) return
    const loc = locateObject3d(page.objects, id)
    if (!loc) return
    const oldParentId = loc.parent?.id ?? null
    if (oldParentId === newParentId) return
    pushHistory()
    const [node] = loc.list.splice(loc.index, 1)
    if (loc.parent) {
      loc.parent.children = loc.list.length ? [...loc.list] : undefined
    }
    const oldParent = loc.parent
    const newParent = newParentId ? findObject3dDeep(page.objects, newParentId) : null
    if (newParentId && !newParent) {
      page.objects.push(node)
      touch()
      return
    }
    // 简易世界→局部：仅平移加减父级位置
    const worldPos: [number, number, number] = [
      node.transform.position[0] + (oldParent?.transform.position[0] ?? 0),
      node.transform.position[1] + (oldParent?.transform.position[1] ?? 0),
      node.transform.position[2] + (oldParent?.transform.position[2] ?? 0),
    ]
    if (newParent) {
      node.transform = {
        ...node.transform,
        position: [
          worldPos[0] - newParent.transform.position[0],
          worldPos[1] - newParent.transform.position[1],
          worldPos[2] - newParent.transform.position[2],
        ],
      }
      newParent.children = [...(newParent.children ?? []), node]
    } else {
      node.transform = { ...node.transform, position: worldPos }
      page.objects.push(node)
    }
    touch()
  }

  /** 将当前多选（同级）收拢到新组节点下 */
  function groupSelectedObject3ds(): Object3DNode | null {
    const page = activePage3d.value
    const ids = selectedObject3dIds.value
    if (!page || ids.length < 2) return null
    const locs = ids.map((id) => locateObject3d(page.objects, id)).filter(Boolean) as Array<
      NonNullable<ReturnType<typeof locateObject3d>>
    >
    if (locs.length < 2) return null
    const parentKey = locs[0].parent?.id ?? null
    if (!locs.every((l) => (l.parent?.id ?? null) === parentKey)) return null
    pushHistory()
    const nodes = locs.map((l) => l.list[l.index])
    let sx = 0
    let sy = 0
    let sz = 0
    for (const n of nodes) {
      sx += n.transform.position[0]
      sy += n.transform.position[1]
      sz += n.transform.position[2]
    }
    const cx = sx / nodes.length
    const cy = sy / nodes.length
    const cz = sz / nodes.length
    // 组只做变换父节点：scale 必须为 1，否则子物体坐标会被缩放冲掉
    const group = createObject3D({ name: '组合', primitive: 'box' })
    group.style = { color: '#64748b', opacity: 0 }
    group.transform.position = [cx, cy, cz]
    group.transform.rotation = [0, 0, 0]
    group.transform.scale = [1, 1, 1]
    const idSet = new Set(ids)
    const stripFrom = (list: Object3DNode[]) => {
      const kept: Object3DNode[] = []
      for (const o of list) {
        if (idSet.has(o.id)) continue
        kept.push(o)
      }
      return kept
    }
    if (locs[0].parent) {
      locs[0].parent.children = stripFrom(locs[0].parent.children ?? [])
    } else {
      page.objects = stripFrom(page.objects)
    }
    group.children = nodes.map((n) => ({
      ...n,
      transform: {
        ...n.transform,
        position: [
          n.transform.position[0] - cx,
          n.transform.position[1] - cy,
          n.transform.position[2] - cz,
        ] as [number, number, number],
      },
    }))
    if (locs[0].parent) {
      locs[0].parent.children = [...(locs[0].parent.children ?? []), group]
    } else {
      page.objects = [...page.objects, group]
    }
    selectedObject3dIds.value = [group.id]
    bumpScene3d({ frame: true })
    touch()
    return group
  }

  function ungroupSelectedObject3ds(): string[] {
    const page = activePage3d.value
    if (!page) return []
    const groups = selectedObjects3d.value.filter((o) => o.children?.length)
    if (!groups.length) return []
    pushHistory()
    const restoredIds: string[] = []
    for (const group of groups) {
      const loc = locateObject3d(page.objects, group.id)
      if (!loc) continue
      const children = (group.children ?? []).map((c) => ({
        ...c,
        transform: {
          ...c.transform,
          position: [
            c.transform.position[0] + group.transform.position[0],
            c.transform.position[1] + group.transform.position[1],
            c.transform.position[2] + group.transform.position[2],
          ] as [number, number, number],
        },
      }))
      loc.list.splice(loc.index, 1, ...children)
      if (loc.parent) loc.parent.children = [...loc.list]
      restoredIds.push(...children.map((c) => c.id))
    }
    selectedObject3dIds.value = restoredIds
    bumpScene3d({ frame: true })
    touch()
    return restoredIds
  }

  function commitObject3dTransforms(
    patches: Record<string, Object3DNode['transform']>,
    opts?: { recordHistory?: boolean },
  ) {
    if (!Object.keys(patches).length) return
    if (opts?.recordHistory !== false) pushHistory()
    for (const [id, transform] of Object.entries(patches)) {
      updateObject3d(id, { transform }, { recordHistory: false })
    }
  }

  function alignSelectedObject3ds(mode: AlignMode) {
    const patches = computeAlignPatches3d(selectedObjects3d.value, mode)
    commitObject3dTransforms(patches)
  }

  function nudgeSelectedObject3ds(dx: number, dy: number, dz = 0) {
    if (!selectedObject3dIds.value.length) return
    const patches: Record<string, Object3DNode['transform']> = {}
    for (const o of selectedObjects3d.value) {
      if (o.locked) continue
      patches[o.id] = {
        ...o.transform,
        position: [
          o.transform.position[0] + dx,
          o.transform.position[1] + dy,
          o.transform.position[2] + dz,
        ],
      }
    }
    if (!Object.keys(patches).length) return
    commitObject3dTransforms(patches)
  }

  function setSelectedObject3dFlags(key: 'visible' | 'locked', value?: boolean) {
    const objects = selectedObjects3d.value
    if (!objects.length) return
    const current =
      key === 'visible' ? objects[0].visible !== false : Boolean(objects[0].locked)
    const next = value ?? !current
    pushHistory()
    for (const o of objects) {
      updateObject3d(o.id, { [key]: next }, { recordHistory: false })
    }
  }

  function selectAllObject3ds() {
    const page = activePage3d.value
    if (!page) return
    const ids: string[] = []
    walkObject3dTree(page.objects, (o) => {
      if (o.visible !== false) ids.push(o.id)
    })
    selectedObject3dIds.value = ids
  }

  function findDuplicateModelByName(fileName: string, excludeId?: string) {
    const key = fileName.trim().toLowerCase()
    if (!key) return undefined
    return document.value.resources.find(
      (r) =>
        r.kind === 'model' &&
        r.id !== excludeId &&
        r.name.trim().toLowerCase() === key,
    )
  }

  async function addModelResource(
    file: File,
    opts?: { excludeId?: string },
  ): Promise<ProjectResource> {
    const dup = findDuplicateModelByName(file.name, opts?.excludeId)
    if (dup) {
      throw new Error('duplicate_model')
    }
    try {
      const uploaded = await apiUploadResource(document.value.meta.id, file)
      const resource: ProjectResource = {
        id: uploaded.id,
        name: uploaded.name,
        kind: 'model',
        path: uploaded.path,
        mimeType: uploaded.mimeType || 'model/gltf-binary',
      }
      document.value.resources.push(resource)
      touch()
      return resource
    } catch (err) {
      if (err instanceof Error && err.message === 'duplicate_model') throw err
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          const resource: ProjectResource = {
            id: `res_model_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            kind: 'model',
            path: dataUrl,
            mimeType: file.type || 'model/gltf-binary',
          }
          document.value.resources.push(resource)
          touch()
          resolve(resource)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
    }
  }

  async function addModelObjectFromFile(file: File) {
    const resource = await addModelResource(file)
    return addObject3d({
      modelResourceId: resource.id,
      name: resource.name.replace(/\.(glb|gltf|obj|fbx|stl)$/i, ''),
    })
  }

  function updatePage3dCamera(
    camera: NonNullable<Page3D['camera']>,
  ) {
    const page = activePage3d.value
    if (!page) return
    page.camera = camera
    touch()
  }

  function updatePage3dPresentation(partial: Partial<NonNullable<Page3D['presentation']>>) {
    const page = activePage3d.value
    if (!page) return
    page.presentation = { ...page.presentation, ...partial }
    touch()
  }

  /** 属性面板 → Canvas3DBoard：捕获/恢复默认相机 */
  const scene3dCameraCmd = ref<{ type: 'capture' | 'apply'; at: number } | null>(null)
  function requestScene3dCamera(type: 'capture' | 'apply') {
    scene3dCameraCmd.value = { type, at: Date.now() }
  }

  /** 将资源 path 解析为浏览器可加载 URL（路径段编码，兼容中文文件名） */
  function resolveResourceUrl(path: string): string {
    if (!path) return path
    if (path.startsWith('data:') || path.startsWith('blob:')) return path
    const encodePath = (p: string) =>
      p
        .split('/')
        .map((seg) => {
          if (!seg) return seg
          try {
            return encodeURIComponent(decodeURIComponent(seg))
          } catch {
            return encodeURIComponent(seg)
          }
        })
        .join('/')
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        const u = new URL(path)
        u.pathname = encodePath(u.pathname)
        return u.toString()
      } catch {
        return path
      }
    }
    if (path.startsWith('/')) return encodePath(path)
    return encodePath(`/api/files/${path.replace(/^\/+/, '')}`)
  }

  function getResourceUrl(resourceId: string): string | undefined {
    const path = document.value.resources.find((r) => r.id === resourceId)?.path
    return path ? resolveResourceUrl(path) : undefined
  }

  /** 删除资源；force 时清除引用，否则有引用则拒绝 */
  function removeResource(
    resourceId: string,
    opts?: { force?: boolean },
  ): { ok: boolean; refs: number } {
    if (!document.value.resources.some((r) => r.id === resourceId)) {
      return { ok: false, refs: 0 }
    }
    const refs = countRefsByResource(document.value).get(resourceId) ?? 0
    if (refs > 0 && !opts?.force) {
      return { ok: false, refs }
    }
    if (refs > 0) clearResourceRefs(document.value, resourceId)
    document.value.resources = document.value.resources.filter((r) => r.id !== resourceId)
    touch()
    return { ok: true, refs }
  }

  /** 清理未被引用的资源 */
  function cleanupOrphanResources(): number {
    const used = countRefsByResource(document.value)
    const before = document.value.resources.length
    document.value.resources = document.value.resources.filter((r) => used.has(r.id))
    const removed = before - document.value.resources.length
    if (removed > 0) touch()
    return removed
  }

  /**
   * 用新文件替换已有资源（保留 resourceId，引用无需改写）。
   * 失败时回退为新建资源并改写引用。
   */
  async function replaceResourceFile(resourceId: string, file: File): Promise<ProjectResource> {
    const existing = document.value.resources.find((r) => r.id === resourceId)
    if (!existing) throw new Error('resource_not_found')
    try {
      const uploaded = await apiUploadResource(document.value.meta.id, file)
      existing.name = uploaded.name
      existing.path = uploaded.path
      existing.mimeType = uploaded.mimeType
      if (uploaded.kind === 'model') existing.kind = 'model'
      else if (uploaded.kind === 'svg') existing.kind = 'svg'
      else if (existing.kind === 'model') {
        /* keep model if server mis-detects */
      } else {
        existing.kind = 'image'
      }
      const url = resolveResourceUrl(existing.path)
      replaceResourceRefs(document.value, resourceId, resourceId, url)
      touch()
      return existing
    } catch {
      const next =
        existing.kind === 'model'
          ? await addModelResource(file, { excludeId: resourceId })
          : await addImageResource(file)
      replaceResourceRefs(
        document.value,
        resourceId,
        next.id,
        resolveResourceUrl(next.path),
      )
      document.value.resources = document.value.resources.filter((r) => r.id !== resourceId)
      touch()
      return next
    }
  }

  function addScript(partial?: {
    name?: string
    source?: string
    intervalMs?: number
    intervalEnabled?: boolean
  }) {
    const script = {
      id: `script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: partial?.name ?? `脚本_${document.value.scripts.length + 1}`,
      language: 'javascript' as const,
      source:
        partial?.source ??
        `// 安全沙箱脚本
// API: getTag(id), writeTag(id, value), log(msg), context
// context: { scriptId, scriptName, pageId, widgetId, trigger, mode }
log('script ready · ' + (context.trigger || 'try'))
`,
      intervalMs: partial?.intervalMs,
      intervalEnabled: partial?.intervalEnabled,
    }
    document.value.scripts.push(script)
    touch()
    return script
  }

  function updateScript(
    id: string,
    patch: {
      name?: string
      source?: string
      intervalMs?: number | null
      intervalEnabled?: boolean
    },
  ) {
    const script = document.value.scripts.find((s) => s.id === id)
    if (!script) return
    if (patch.name !== undefined) script.name = patch.name
    if (patch.source !== undefined) script.source = patch.source
    if (patch.intervalMs !== undefined) {
      script.intervalMs = patch.intervalMs == null ? undefined : patch.intervalMs
    }
    if (patch.intervalEnabled !== undefined) script.intervalEnabled = patch.intervalEnabled
    touch()
  }

  function removeScript(id: string) {
    document.value.scripts = document.value.scripts.filter((s) => s.id !== id)
    // 清理页面挂载
    for (const page of document.value.pages) {
      if (page.scriptIds) page.scriptIds = page.scriptIds.filter((sid) => sid !== id)
    }
    touch()
  }

  function attachScriptToActivePage(scriptId: string) {
    const page = activePage.value
    if (!page) return
    const ids = new Set(page.scriptIds ?? [])
    ids.add(scriptId)
    page.scriptIds = [...ids]
    touch()
  }

  function setActivePage(pageId: string) {
    if (document.value.pages.some((p) => p.id === pageId)) {
      activePageId.value = pageId
      syncActiveLayerForPage(pageId)
      selectedWidgetIds.value = []
      selectedObject3dIds.value = []
      clearHistory()
    }
  }

  function renameProject(name: string, description?: string) {
    document.value.meta.name = name
    if (description !== undefined) document.value.meta.description = description
    touch()
  }

  function addPage(page: Page) {
    document.value.pages.push(page)
    touch()
    activePageId.value = page.id
    syncActiveLayerForPage(page.id)
    selectedWidgetIds.value = []
    clearHistory()
  }

  function newProject(name = '未命名工程', description = '') {
    document.value = normalizeProjectDocument(createEmptyProject(name))
    document.value.meta.description = description
    activePageId.value = document.value.homePageId
    syncActiveLayerForPage(activePageId.value!)
    published.value = null
    selectedWidgetIds.value = []
    dirty.value = true
    clearHistory()
  }

  async function save(): Promise<ProjectDocument> {
    const saved = await saveProjectDocument(document.value)
    document.value = normalizeProjectDocument(saved)
    dirty.value = false
    await refreshList()
    return document.value
  }

  async function openProject(id: string): Promise<boolean> {
    const doc = await loadProjectDocument(id)
    if (!doc) return false
    document.value = normalizeProjectDocument(doc)
    activePageId.value = doc.homePageId ?? doc.pages[0]?.id
    syncActiveLayerForPage(activePageId.value!)
    published.value = await loadPublishPackage(id)
    selectedWidgetIds.value = []
    dirty.value = false
    clearHistory()
    await refreshList()
    return true
  }

  async function removeProject(id: string) {
    await deleteProjectDocument(id)
    if (document.value.meta.id === id) {
      newProject('演示工程')
      dirty.value = false
    }
    await refreshList()
  }

  /** 导出当前工程完整包（需服务端）；先自动保存未落盘改动 */
  async function exportProjectPackage(): Promise<{ fileName: string }> {
    await probeStorage()
    if (getStorageMode() !== 'api') {
      throw new Error('export_requires_api')
    }
    if (dirty.value) await save()
    const { blob, fileName } = await apiExportProject(document.value.meta.id)
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    return { fileName }
  }

  /**
   * 导出网站部署包（Runtime + 工程发布快照 + 资源）。
   * 需服务端且本机已有 win-x64-java 模板（pnpm pack:win 或 SCADA_SITE_TEMPLATE）。
   */
  async function exportSitePackage(): Promise<{ fileName: string }> {
    await probeStorage()
    if (getStorageMode() !== 'api') {
      throw new Error('export_requires_api')
    }
    if (dirty.value) await save()
    await publish()
    const { blob, fileName } = await apiExportSite(document.value.meta.id)
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    return { fileName }
  }

  /** 导入工程包 → 服务端新建并打开（不覆盖当前工程 id） */
  async function importProjectPackage(file: File): Promise<ProjectDocument> {
    await probeStorage()
    if (getStorageMode() !== 'api') {
      throw new Error('import_requires_api')
    }
    const doc = await apiImportProject(file)
    document.value = normalizeProjectDocument(doc)
    activePageId.value = doc.homePageId ?? doc.pages[0]?.id
    syncActiveLayerForPage(activePageId.value!)
    published.value = null
    selectedWidgetIds.value = []
    selectedObject3dIds.value = []
    dirty.value = false
    clearHistory()
    await refreshList()
    return document.value
  }

  async function hydrateFromStorage() {
    await probeStorage()
    await refreshList()
    const lastId = await getLastProjectId()
    if (lastId && (await openProject(lastId))) return
    if (projectList.value[0] && (await openProject(projectList.value[0].id))) return
  }

  function nextPublishVersion(current: string): string {
    const match = current.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!match) return `1.0.${Date.now() % 1000}`
    const major = Number(match[1])
    const minor = Number(match[2])
    const patch = Number(match[3]) + 1
    return `${major}.${minor}.${patch}`
  }

  /** 发布前把 resourceId 解析进图元 src，保证 Runtime 可加载 */
  function hydrateImageSources(doc: ProjectDocument): ProjectDocument {
    const cloned = clonePlain(doc)
    const byId = new Map(cloned.resources.map((r) => [r.id, r.path]))
    for (const page of cloned.pages) {
      if (page.type !== '2d') continue
      for (const layer of page.layers) {
        for (const widget of layer.widgets) {
          fillImageSrc(widget, byId)
          for (const child of widget.children ?? []) fillImageSrc(child, byId)
        }
      }
    }
    return cloned
  }

  function fillImageSrc(
    widget: { type: string; props: Record<string, unknown> },
    byId: Map<string, string>,
  ) {
    if (widget.type !== 'image') return
    const resourceId = String(widget.props.resourceId || '')
    const fromRes = resourceId && byId.has(resourceId) ? byId.get(resourceId) : undefined
    const raw = String(widget.props.src || fromRes || '')
    if (raw) widget.props.src = resolveResourceUrl(raw)
  }

  async function publish(version?: string): Promise<PublishPackage> {
    const now = Date.now()
    const publishVersion = version || nextPublishVersion(document.value.meta.version || '1.0.0')
    const documentForPublish = hydrateImageSources(document.value)
    const pkg: PublishPackage = {
      manifest: {
        projectId: documentForPublish.meta.id,
        projectName: documentForPublish.meta.name,
        publishVersion,
        publishedAt: now,
        homePageId: documentForPublish.homePageId,
        documentPath: 'document.json',
        resourceIndex: documentForPublish.resources.map((r) => ({
          id: r.id,
          path: r.path,
          kind: r.kind,
        })),
      },
      document: documentForPublish,
    }
    published.value = pkg
    document.value.meta.version = publishVersion
    document.value.meta.updatedAt = now
    await saveProjectDocument(document.value)
    await savePublishPackage(pkg)
    dirty.value = false
    await refreshList()
    return pkg
  }

  function loadPublished(pkg: PublishPackage) {
    published.value = pkg
    document.value = normalizeProjectDocument(hydrateImageSources(pkg.document))
    activePageId.value = pkg.manifest.homePageId ?? pkg.document.pages[0]?.id
    syncActiveLayerForPage(activePageId.value!)
    selectedWidgetIds.value = []
    dirty.value = false
    clearHistory()
  }

  return {
    document,
    activePageId,
    activeLayerId,
    activePage,
    activePage2d,
    activePage3d,
    published,
    dirty,
    projectList,
    selectedWidgetIds,
    selectedWidgetId,
    selectedWidget,
    selectedWidgets,
    selectedObject3dIds,
    selectedObject3dId,
    selectedObject3d,
    selectedObjects3d,
    snapEnabled,
    gridVisible,
    animationConnectionOpen,
    animationConnectionTab,
    liquidConfigOpen,
    flowConfigOpen,
    object3dPanelEditorOpen,
    object3dModelEditorOpen,
    drawTool,
    previewLive,
    gizmoMode3d,
    focus3dNonce,
    cameraFocus3dCmd,
    frameAfter3dTreeReload,
    setSpawnHint3d,
    scene3dMutateNonce,
    clipboard,
    clipboard3d,
    canUndo,
    canRedo,
    setActivePage,
    setActiveLayer,
    findLayerOfWidget,
    addLayer,
    removeLayer,
    renameLayer,
    setLayerFlag,
    moveLayer,
    selectWidget,
    setSelection,
    addWidget,
    insertWidget,
    startDrawTool,
    cancelDrawTool,
    setPreviewLive,
    setGizmoMode3d,
    requestFocusSelected3d,
    focusCameraOnObject3d,
    updateWidget,
    commitWidgetTransforms,
    removeWidget,
    removeWidgets,
    duplicateWidget,
    duplicateWidgets,
    alignSelected,
    reorderSelected,
    groupSelected,
    ungroupSelected,
    copySelected,
    cutSelected,
    nudgeSelected,
    rotateSelected,
    setSelectedFlags,
    openAnimationConnection,
    closeAnimationConnection,
    openLiquidConfig,
    closeLiquidConfig,
    openFlowConfig,
    closeFlowConfig,
    openObject3dPanelEditor,
    closeObject3dPanelEditor,
    saveObject3dPanelEditor,
    discardObject3dPanelEditor,
    panelEditObjectId,
    panelEditReturnPageId,
    isPanelEditMode,
    getPanelEditObject,
    ensurePanelPage2d,
    bindPanelPage2d,
    openPanelPageInDesigner,
    getPanelPage2d,
    findObjectsUsingPanelPage2d,
    openObject3dModelEditor,
    closeObject3dModelEditor,
    moveWidgetIndex,
    pasteClipboard,
    addGuide,
    updateGuide,
    removeGuide,
    saveSymbolFromSelection,
    placeSymbol,
    removeSymbol,
    createAndAddPage,
    renamePage,
    updatePageSettings,
    removePage,
    movePage,
    duplicatePage,
    savePageAsTemplate,
    createPageFromTemplate,
    removePageTemplate,
    setHomePage,
    saveAs,
    addImageResource,
    addImageWidgetFromFile,
    removeResource,
    cleanupOrphanResources,
    replaceResourceFile,
    selectObject3d,
    setObject3dSelection,
    addObject3d,
    updateObject3d,
    removeObject3d,
    removeObject3ds,
    addLiquidLevel,
    updateLiquidLevel,
    removeLiquidLevel,
    setObject3dShellOpacity,
    addGlassLiquidTank,
    setObject3dFlow,
    selectObject3dsByModel,
    findObject3dById,
    removeObjectsUsingModelResource,
    deleteModelResource,
    copySelectedObject3ds,
    cutSelectedObject3ds,
    pasteClipboard3d,
    duplicateObject3d,
    duplicateObject3ds,
    reparentObject3d,
    groupSelectedObject3ds,
    ungroupSelectedObject3ds,
    commitObject3dTransforms,
    alignSelectedObject3ds,
    nudgeSelectedObject3ds,
    setSelectedObject3dFlags,
    selectAllObject3ds,
    addModelResource,
    addModelObjectFromFile,
    updatePage3dCamera,
    updatePage3dPresentation,
    scene3dCameraCmd,
    requestScene3dCamera,
    getResourceUrl,
    resolveResourceUrl,
    addScript,
    updateScript,
    removeScript,
    attachScriptToActivePage,
    getActiveWidgets,
    pushHistory,
    undo,
    redo,
    renameProject,
    addPage,
    newProject,
    save,
    openProject,
    removeProject,
    exportProjectPackage,
    exportSitePackage,
    importProjectPackage,
    hydrateFromStorage,
    refreshList,
    publish,
    loadPublished,
    getStorageMode,
  }
})
