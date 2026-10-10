import type { Object3DNode, ProjectDocument, Widget2D } from '@web-scada/core'

export interface ResourceRefHit {
  resourceId: string
  pageId: string
  pageName: string
  ownerId: string
  ownerName: string
  kind: 'image' | 'model'
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

/** 收集工程内对资源的引用 */
export function collectResourceRefs(doc: ProjectDocument): ResourceRefHit[] {
  const hits: ResourceRefHit[] = []
  for (const page of doc.pages) {
    if (page.type === '2d') {
      for (const layer of page.layers) {
        walkWidgets(layer.widgets, (w) => {
          if (w.type !== 'image') return
          const resourceId = String(w.props.resourceId || '')
          if (!resourceId) return
          hits.push({
            resourceId,
            pageId: page.id,
            pageName: page.name,
            ownerId: w.id,
            ownerName: w.name,
            kind: 'image',
          })
        })
      }
    } else {
      walkObjects(page.objects, (o) => {
        if (o.modelResourceId) {
          hits.push({
            resourceId: o.modelResourceId,
            pageId: page.id,
            pageName: page.name,
            ownerId: o.id,
            ownerName: o.name,
            kind: 'model',
          })
        }
        if (o.panel?.widgets?.length) {
          for (const w of o.panel.widgets) {
            if (w.type !== 'image') continue
            const rid = String(w.props.resourceId || '')
            if (!rid) continue
            hits.push({
              resourceId: rid,
              pageId: page.id,
              pageName: page.name,
              ownerId: o.id,
              ownerName: `${o.name}/面板`,
              kind: 'image',
            })
          }
        } else {
          for (const item of o.panel?.items ?? []) {
            if (item.type !== 'image' || !item.resourceId) continue
            hits.push({
              resourceId: item.resourceId,
              pageId: page.id,
              pageName: page.name,
              ownerId: o.id,
              ownerName: `${o.name}/面板`,
              kind: 'image',
            })
          }
        }
        if (o.panel?.backgroundResourceId) {
          hits.push({
            resourceId: o.panel.backgroundResourceId,
            pageId: page.id,
            pageName: page.name,
            ownerId: o.id,
            ownerName: `${o.name}/面板背景`,
            kind: 'image',
          })
        }
        const maps = o.material?.maps
        if (maps) {
          const slots: Array<[string, string | undefined]> = [
            ['漫反射', maps.diffuse?.resourceId],
            ['自发光', maps.emissive?.resourceId],
            ['金属', maps.metalness?.resourceId],
            ['凹凸', maps.bump?.resourceId],
          ]
          for (const [label, resourceId] of slots) {
            if (!resourceId) continue
            hits.push({
              resourceId,
              pageId: page.id,
              pageName: page.name,
              ownerId: o.id,
              ownerName: `${o.name}/材质/${label}`,
              kind: 'image',
            })
          }
        }
      })
    }
  }
  return hits
}

export function countRefsByResource(doc: ProjectDocument): Map<string, number> {
  const map = new Map<string, number>()
  for (const hit of collectResourceRefs(doc)) {
    map.set(hit.resourceId, (map.get(hit.resourceId) ?? 0) + 1)
  }
  return map
}

export function findOrphanResourceIds(doc: ProjectDocument): string[] {
  const used = countRefsByResource(doc)
  return doc.resources.filter((r) => !used.has(r.id)).map((r) => r.id)
}

/** 将引用从 fromId 改写到 toId；可选同步 image.src */
export function replaceResourceRefs(
  doc: ProjectDocument,
  fromId: string,
  toId: string,
  nextSrc?: string,
): number {
  let changed = 0
  for (const page of doc.pages) {
    if (page.type === '2d') {
      for (const layer of page.layers) {
        walkWidgets(layer.widgets, (w) => {
          if (w.type !== 'image') return
          if (String(w.props.resourceId || '') !== fromId) return
          w.props = {
            ...w.props,
            resourceId: toId,
            ...(nextSrc !== undefined ? { src: nextSrc } : {}),
          }
          changed += 1
        })
      }
    } else {
      walkObjects(page.objects, (o) => {
        if (o.modelResourceId === fromId) {
          o.modelResourceId = toId
          changed += 1
        }
        if (o.panel?.widgets?.length) {
          let panelChanged = false
          const widgets = o.panel.widgets.map((w) => {
            if (w.type !== 'image') return w
            if (String(w.props.resourceId || '') !== fromId) return w
            panelChanged = true
            changed += 1
            return { ...w, props: { ...w.props, resourceId: toId } }
          })
          if (panelChanged) {
            const next = { ...o.panel, widgets }
            delete next.items
            o.panel = next
          }
        } else if (o.panel?.items?.length) {
          // 旧工程兜底：仅 items 时改完再迁到 widgets（由后续 normalize 清 items）
          let panelChanged = false
          const items = o.panel.items.map((it) => {
            if (it.type !== 'image' || it.resourceId !== fromId) return it
            panelChanged = true
            changed += 1
            return { ...it, resourceId: toId }
          })
          if (panelChanged) o.panel = { ...o.panel, items }
        }
        if (o.panel?.backgroundResourceId === fromId) {
          o.panel = { ...o.panel, backgroundResourceId: toId }
          changed += 1
        }
        if (o.material?.maps) {
          const maps = { ...o.material.maps }
          let mapChanged = false
          for (const key of ['diffuse', 'emissive', 'metalness', 'bump'] as const) {
            const slot = maps[key]
            if (!slot || slot.resourceId !== fromId) continue
            maps[key] = { ...slot, resourceId: toId }
            mapChanged = true
            changed += 1
          }
          if (mapChanged) o.material = { ...o.material, maps }
        }
      })
    }
  }
  return changed
}

/** 清除对指定资源的引用（图元保留，resourceId/src 置空） */
export function clearResourceRefs(doc: ProjectDocument, resourceId: string): number {
  let changed = 0
  for (const page of doc.pages) {
    if (page.type === '2d') {
      for (const layer of page.layers) {
        walkWidgets(layer.widgets, (w) => {
          if (w.type !== 'image') return
          if (String(w.props.resourceId || '') !== resourceId) return
          w.props = { ...w.props, resourceId: '', src: '' }
          changed += 1
        })
      }
    } else {
      walkObjects(page.objects, (o) => {
        if (o.modelResourceId === resourceId) {
          o.modelResourceId = undefined
          changed += 1
        }
        if (o.panel?.widgets?.length) {
          let panelChanged = false
          const widgets = o.panel.widgets.map((w) => {
            if (w.type !== 'image') return w
            if (String(w.props.resourceId || '') !== resourceId) return w
            panelChanged = true
            changed += 1
            return { ...w, props: { ...w.props, resourceId: '', src: '' } }
          })
          if (panelChanged) {
            const next = { ...o.panel, widgets }
            delete next.items
            o.panel = next
          }
        } else if (o.panel?.items?.length) {
          let panelChanged = false
          const items = o.panel.items.map((it) => {
            if (it.type !== 'image' || it.resourceId !== resourceId) return it
            panelChanged = true
            changed += 1
            return { ...it, resourceId: '' }
          })
          if (panelChanged) o.panel = { ...o.panel, items }
        }
        if (o.panel?.backgroundResourceId === resourceId) {
          const next = { ...o.panel }
          delete next.backgroundResourceId
          o.panel = next
          changed += 1
        }
        if (o.material?.maps) {
          const maps = { ...o.material.maps }
          let mapChanged = false
          for (const key of ['diffuse', 'emissive', 'metalness', 'bump'] as const) {
            const slot = maps[key]
            if (!slot || slot.resourceId !== resourceId) continue
            delete maps[key]
            mapChanged = true
            changed += 1
          }
          if (mapChanged) o.material = { ...o.material, maps }
        }
      })
    }
  }
  return changed
}
