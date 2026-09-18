import type {
  EventAction,
  Object3DNode,
  Page,
  Page2D,
  ProjectDocument,
  TagMeta,
  Widget2D,
} from '@web-scada/core'

export type PublishIssueLevel = 'error' | 'warning'

export interface PublishIssue {
  id: string
  level: PublishIssueLevel
  code: string
  message: string
  pageId?: string
  pageName?: string
}

export interface PublishValidationResult {
  ok: boolean
  errors: PublishIssue[]
  warnings: PublishIssue[]
  issues: PublishIssue[]
}

function walkWidgets(widgets: Widget2D[], visit: (w: Widget2D) => void) {
  for (const w of widgets) {
    visit(w)
    if (w.children?.length) walkWidgets(w.children, visit)
  }
}

function walkObjects(objects: Object3DNode[], visit: (o: Object3DNode) => void) {
  for (const o of objects) {
    visit(o)
    if (o.children?.length) walkObjects(o.children, visit)
  }
}

function pageWidgetCount(page: Page2D): number {
  let n = 0
  for (const layer of page.layers) {
    walkWidgets(layer.widgets, () => {
      n += 1
    })
  }
  return n
}

function collectTagIdsFromWidget(w: Widget2D, into: Set<string>) {
  for (const b of w.bindings ?? []) {
    if (b.tagId) into.add(b.tagId)
    else into.add('')
  }
  for (const a of w.animations ?? []) {
    if (a.tagId) into.add(a.tagId)
    else into.add('')
  }
  for (const link of w.animationLinks ?? []) {
    if (link.tagId) into.add(link.tagId)
    else into.add('')
  }
  for (const evt of w.events ?? []) {
    for (const action of evt.actions) {
      if (action.type === 'writeTag') {
        if (action.tagId) into.add(action.tagId)
        else into.add('')
      }
    }
  }
}

function collectTagIdsFromObject(o: Object3DNode, into: Set<string>) {
  for (const b of o.bindings ?? []) {
    if (b.tagId) into.add(b.tagId)
    else into.add('')
  }
  for (const a of o.animations ?? []) {
    if (a.tagId) into.add(a.tagId)
    else into.add('')
  }
  for (const link of o.animationLinks ?? []) {
    if (link.tagId) into.add(link.tagId)
    else into.add('')
  }
  for (const evt of o.events ?? []) {
    for (const action of evt.actions) {
      if (action.type === 'writeTag') {
        if (action.tagId) into.add(action.tagId)
        else into.add('')
      }
    }
  }
}

function collectNavTargets(
  page: Page,
  into: { pageIds: Set<string>; dialogIds: Set<string>; scriptIds: Set<string> },
) {
  const visitActions = (actions: EventAction[]) => {
    for (const action of actions) {
      if (action.type === 'navigate') into.pageIds.add(action.pageId || '')
      if (action.type === 'openDialog') into.dialogIds.add(action.dialogId || '')
      if (action.type === 'runScript') into.scriptIds.add(action.scriptId || '')
    }
  }

  if (page.type === '2d') {
    for (const layer of page.layers) {
      walkWidgets(layer.widgets, (w) => {
        for (const evt of w.events ?? []) visitActions(evt.actions)
      })
    }
  } else {
    walkObjects(page.objects, (o) => {
      for (const evt of o.events ?? []) visitActions(evt.actions)
    })
  }
}

/** 发布前校验：空页、缺 Tag、坏绑定、坏资源/跳转引用 */
export function validatePublishPackage(
  doc: ProjectDocument,
  tagMetas: TagMeta[],
): PublishValidationResult {
  const issues: PublishIssue[] = []
  let seq = 0
  const push = (issue: Omit<PublishIssue, 'id'>) => {
    seq += 1
    issues.push({ ...issue, id: `pv_${seq}` })
  }

  const knownTags = new Set(tagMetas.map((t) => t.tagId))
  const knownPages = new Set(doc.pages.map((p) => p.id))
  const knownScripts = new Set(doc.scripts.map((s) => s.id))
  const knownResources = new Set(doc.resources.map((r) => r.id))
  const pageById = new Map(doc.pages.map((p) => [p.id, p]))

  if (!doc.pages.length) {
    push({ level: 'error', code: 'no_pages', message: '工程没有任何页面' })
  }

  for (const page of doc.pages) {
    if (page.type === '2d') {
      if (pageWidgetCount(page) === 0) {
        push({
          level: 'warning',
          code: 'empty_page',
          message: `2D 页面「${page.name}」没有图元`,
          pageId: page.id,
          pageName: page.name,
        })
      }
    } else if (!page.objects.length) {
      push({
        level: 'warning',
        code: 'empty_page',
        message: `3D 页面「${page.name}」没有对象`,
        pageId: page.id,
        pageName: page.name,
      })
    }

    const tagIds = new Set<string>()
    if (page.type === '2d') {
      for (const layer of page.layers) {
        walkWidgets(layer.widgets, (w) => collectTagIdsFromWidget(w, tagIds))
      }
    } else {
      walkObjects(page.objects, (o) => collectTagIdsFromObject(o, tagIds))
    }

    if (tagIds.has('')) {
      push({
        level: 'error',
        code: 'empty_tag_id',
        message: `页面「${page.name}」存在未选择 Tag 的绑定/动画/写值`,
        pageId: page.id,
        pageName: page.name,
      })
    }
    for (const tagId of tagIds) {
      if (!tagId) continue
      if (!knownTags.has(tagId)) {
        push({
          level: 'error',
          code: 'missing_tag',
          message: `页面「${page.name}」引用了不存在的 Tag：${tagId}`,
          pageId: page.id,
          pageName: page.name,
        })
      }
    }

    // 资源引用
    if (page.type === '2d') {
      for (const layer of page.layers) {
        walkWidgets(layer.widgets, (w) => {
          if (w.type !== 'image') return
          const resourceId = String(w.props.resourceId || '')
          if (!resourceId) {
            push({
              level: 'warning',
              code: 'image_no_resource',
              message: `页面「${page.name}」图元「${w.name}」未绑定图片资源`,
              pageId: page.id,
              pageName: page.name,
            })
            return
          }
          if (!knownResources.has(resourceId)) {
            push({
              level: 'error',
              code: 'missing_resource',
              message: `页面「${page.name}」图元「${w.name}」引用缺失资源：${resourceId}`,
              pageId: page.id,
              pageName: page.name,
            })
          }
        })
      }
    } else {
      walkObjects(page.objects, (o) => {
        if (!o.modelResourceId) return
        if (!knownResources.has(o.modelResourceId)) {
          push({
            level: 'error',
            code: 'missing_resource',
            message: `页面「${page.name}」对象「${o.name}」引用缺失模型：${o.modelResourceId}`,
            pageId: page.id,
            pageName: page.name,
          })
        }
      })
    }

    const targets = {
      pageIds: new Set<string>(),
      dialogIds: new Set<string>(),
      scriptIds: new Set<string>(),
    }
    collectNavTargets(page, targets)
    for (const pageId of targets.pageIds) {
      if (!pageId || !knownPages.has(pageId)) {
        push({
          level: 'error',
          code: 'bad_navigate',
          message: `页面「${page.name}」跳转目标无效：${pageId || '(空)'}`,
          pageId: page.id,
          pageName: page.name,
        })
      }
    }
    for (const dialogId of targets.dialogIds) {
      const target = dialogId ? pageById.get(dialogId) : undefined
      if (!dialogId || !target || target.type !== '2d') {
        push({
          level: 'error',
          code: 'bad_dialog',
          message: `页面「${page.name}」对话框页无效：${dialogId || '(空)'}`,
          pageId: page.id,
          pageName: page.name,
        })
      }
    }
    for (const scriptId of targets.scriptIds) {
      if (!scriptId || !knownScripts.has(scriptId)) {
        push({
          level: 'error',
          code: 'bad_script',
          message: `页面「${page.name}」引用了不存在的脚本：${scriptId || '(空)'}`,
          pageId: page.id,
          pageName: page.name,
        })
      }
    }
  }

  if (doc.homePageId && !knownPages.has(doc.homePageId)) {
    push({
      level: 'warning',
      code: 'bad_home',
      message: `首页 ID 无效：${doc.homePageId}`,
    })
  }

  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  }
}
