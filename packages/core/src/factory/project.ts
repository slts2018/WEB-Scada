import type {
  ProjectDocument,
  Page2D,
  Page3D,
  Page,
  Layer2D,
  GuideLine2D,
  SymbolDefinition,
  Widget2D,
  Object3DNode,
  Object3DPanel,
  PageTemplate,
} from '../types/project'
import {
  normalizeObject3dPanelsInTree,
  resolvePanelWidgets,
} from './panelWidgets'
import {
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
} from './panelLayout'

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/** 纯数据深拷贝（避免 structuredClone 在 Proxy 上失败） */
function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createLayer2D(name = '图层'): Layer2D {
  return {
    id: newId('layer'),
    name,
    visible: true,
    locked: false,
    widgets: [],
  }
}

export function createPage2D(
  name = '新页面',
  opts?: { usage?: Page2D['usage']; width?: number; height?: number },
): Page2D {
  return {
    id: newId('page_2d'),
    type: '2d',
    name,
    width: opts?.width && opts.width > 0 ? opts.width : 1920,
    height: opts?.height && opts.height > 0 ? opts.height : 1080,
    background: '#1a1d24',
    layers: [createLayer2D('默认图层')],
    guides: [],
    usage: opts?.usage,
  }
}

/** 跟镜头面板内容页：不进页面树 / 运行页签 */
export function isObject3dPanelPage(page: Page): boolean {
  return page.type === '2d' && page.usage === 'object3d-panel'
}

/** 工程内「普通」页面（可出现在页面树） */
export function listNavigationPages(doc: ProjectDocument): Page[] {
  return doc.pages.filter((p) => !isObject3dPanelPage(p))
}

export function createPage3D(name = '三维场景'): Page3D {
  return {
    id: newId('page_3d'),
    type: '3d',
    name,
    camera: {
      position: [5, 5, 5],
      target: [0, 0, 0],
    },
    objects: [],
  }
}

export function createEmptyProject(name = '未命名工程'): ProjectDocument {
  const page2d = createPage2D('总貌')
  const page3d = createPage3D('三维场景')
  const now = Date.now()

  return {
    meta: {
      id: `prj_${now}`,
      name,
      createdAt: now,
      updatedAt: now,
      version: '0.1.0',
      transformRotationUnit: 'deg',
    },
    pages: [page2d, page3d],
    resources: [],
    scripts: [],
    symbols: [],
    pageTemplates: [],
    homePageId: page2d.id,
  }
}

export function clonePage(page: Page, name?: string): Page {
  const copy = cloneData(page)
  copy.id = newId(page.type === '2d' ? 'page_2d' : 'page_3d')
  copy.name = name ?? `${page.name} 副本`
  return copy
}

function cloneWidgetTree(widget: Widget2D): Widget2D {
  const copy = cloneData(widget)
  copy.id = newId(`w_${copy.type}`)
  if (copy.children?.length) {
    copy.children = copy.children.map(cloneWidgetTree)
  }
  return copy
}

function cloneObject3dTree(obj: Object3DNode): Object3DNode {
  const copy = cloneData(obj)
  copy.id = newId('obj3d')
  if (copy.children?.length) {
    copy.children = copy.children.map(cloneObject3dTree)
  }
  return copy
}

/** 深拷贝页面并为图层/图元/对象重新分配 id（模板实例化 / 安全复制） */
export function clonePageWithNewIds(page: Page, name?: string): Page {
  const copy = clonePage(page, name)
  if (copy.type === '2d') {
    copy.layers = copy.layers.map((layer) => ({
      ...layer,
      id: newId('layer'),
      widgets: layer.widgets.map(cloneWidgetTree),
    }))
    if (copy.guides?.length) {
      copy.guides = copy.guides.map((g) => ({ ...g, id: newId('guide') }))
    }
  } else {
    copy.objects = copy.objects.map(cloneObject3dTree)
  }
  return copy
}

export function createPageTemplate(name: string, page: Page): PageTemplate {
  return {
    id: newId('ptpl'),
    name,
    pageType: page.type,
    page: cloneData(page),
    createdAt: Date.now(),
  }
}

/** 兼容旧工程：补齐 symbols / guides / pageTemplates / animationLinks；3D 旋转 rad→deg；面板 → page2dId */
export function normalizeProjectDocument(doc: ProjectDocument): ProjectDocument {
  if (!Array.isArray(doc.symbols)) doc.symbols = []
  if (!Array.isArray(doc.pageTemplates)) doc.pageTemplates = []
  for (const page of doc.pages) {
    if (page.type === '2d' && !Array.isArray(page.guides)) page.guides = []
    if (page.type === '3d') {
      ensureObject3dAnimationLinks(page.objects)
      normalizeObject3dPanelsInTree(page.objects)
    }
  }
  for (const tpl of doc.pageTemplates) {
    if (tpl.page.type === '2d' && !Array.isArray((tpl.page as Page2D).guides)) {
      ;(tpl.page as Page2D).guides = []
    }
    if (tpl.page.type === '3d') {
      ensureObject3dAnimationLinks(tpl.page.objects)
      normalizeObject3dPanelsInTree(tpl.page.objects)
    }
  }

  migratePanelWidgetsToPages(doc)
  migrateTransformRotationToDegrees(doc)
  return doc
}

/**
 * 面板内联 widgets/items → 专用 Page2D + panel.page2dId。
 * 已有合法 page2dId 则只清除残留 widgets。
 */
export function migratePanelWidgetsToPages(doc: ProjectDocument): void {
  const pageIds = new Set(doc.pages.map((p) => p.id))

  // 早期自动创建的「面板/xxx」页补上 usage，避免出现在页面树
  for (const page of doc.pages) {
    if (page.type === '2d' && !page.usage && page.name.startsWith('面板/')) {
      page.usage = 'object3d-panel'
    }
  }

  const visit = (objects: Object3DNode[]) => {
    for (const obj of objects) {
      if (obj.panel) {
        obj.panel = migrateOnePanelToPage(doc, obj, obj.panel, pageIds)
      }
      if (obj.children?.length) visit(obj.children)
    }
  }

  for (const page of doc.pages) {
    if (page.type === '3d') visit(page.objects)
  }
  for (const tpl of doc.pageTemplates ?? []) {
    if (tpl.page.type === '3d') visit(tpl.page.objects)
  }
}

function migrateOnePanelToPage(
  doc: ProjectDocument,
  obj: Object3DNode,
  panel: Object3DPanel,
  pageIds: Set<string>,
): Object3DPanel {
  const existingId = panel.page2dId?.trim()
  if (existingId && pageIds.has(existingId)) {
    const next = { ...panel, page2dId: existingId }
    delete next.widgets
    delete next.items
    return next
  }

  const widgets = resolvePanelWidgets(panel).filter((w) => w.type !== 'scene3d')
  const width = panel.width ?? DEFAULT_PANEL_CONTENT_WIDTH
  const height = panel.height ?? DEFAULT_PANEL_CONTENT_HEIGHT
  const page = createPage2D(`面板/${obj.name || obj.id.slice(-6)}`, {
    usage: 'object3d-panel',
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  })
  page.background = '#1a1d24'
  if (!page.layers[0]) page.layers = [createLayer2D('默认图层')]
  page.layers[0]!.widgets = widgets
  doc.pages.push(page)
  pageIds.add(page.id)

  const next: Object3DPanel = {
    ...panel,
    width,
    height,
    page2dId: page.id,
  }
  delete next.widgets
  delete next.items
  return next
}

function ensureObject3dAnimationLinks(objects: Object3DNode[]) {
  walkObject3dNodes(objects, (obj) => {
    if (!Array.isArray(obj.animationLinks)) obj.animationLinks = []
    if (!Array.isArray(obj.events)) obj.events = []
    if (!Array.isArray(obj.bindings)) obj.bindings = []
  })
}

function walkObject3dNodes(objects: Object3DNode[], visit: (obj: Object3DNode) => void) {
  for (const obj of objects) {
    visit(obj)
    if (obj.children?.length) walkObject3dNodes(obj.children, visit)
  }
}

const RAD_2_DEG = 180 / Math.PI
/** 超过约 2π 的分量视为已是「度」（避免把已按度保存的工程再乘一次） */
const DEGREE_HINT = Math.PI * 2 + 0.05

function migrateTransformRotationToDegrees(doc: ProjectDocument) {
  if (doc.meta.transformRotationUnit === 'deg') return

  const roots: Object3DNode[][] = []
  for (const page of doc.pages) {
    if (page.type === '3d') roots.push(page.objects)
  }
  for (const tpl of doc.pageTemplates ?? []) {
    if (tpl.page.type === '3d') roots.push(tpl.page.objects)
  }

  let maxAbs = 0
  for (const list of roots) {
    walkObject3dNodes(list, (obj) => {
      const r = obj.transform?.rotation
      if (!r) return
      maxAbs = Math.max(maxAbs, Math.abs(r[0] || 0), Math.abs(r[1] || 0), Math.abs(r[2] || 0))
    })
  }

  // 旧工程按弧度存（常见 |r|≤2π）；已按度调过的（如 90）不再换算
  if (maxAbs > 0 && maxAbs <= DEGREE_HINT) {
    for (const list of roots) {
      walkObject3dNodes(list, (obj) => {
        const r = obj.transform?.rotation
        if (!r) return
        obj.transform.rotation = [r[0] * RAD_2_DEG, r[1] * RAD_2_DEG, r[2] * RAD_2_DEG]
      })
    }
  }

  doc.meta.transformRotationUnit = 'deg'
}

export function createGuideLine(orientation: 'h' | 'v', pos: number): GuideLine2D {
  return {
    id: newId('guide'),
    orientation,
    pos,
  }
}

export function createSymbolDefinition(name: string, root: Widget2D): SymbolDefinition {
  return {
    id: newId('sym'),
    name,
    root: cloneData(root),
    createdAt: Date.now(),
  }
}
