import type { Object3DNode } from '@web-scada/core'
import { panelItemsToWidgets } from '@web-scada/core'
import { clonePlain } from '@/shared/utils/clonePlain'

export function walkObject3dTree(
  objects: Object3DNode[],
  visit: (obj: Object3DNode, parent: Object3DNode | null) => void,
): void {
  const walk = (list: Object3DNode[], parent: Object3DNode | null) => {
    for (const obj of list) {
      visit(obj, parent)
      if (obj.children?.length) walk(obj.children, obj)
    }
  }
  walk(objects, null)
}

export function findObject3dDeep(
  objects: Object3DNode[],
  id: string,
): Object3DNode | null {
  let found: Object3DNode | null = null
  walkObject3dTree(objects, (obj) => {
    if (obj.id === id) found = obj
  })
  return found
}

/** 找到对象所在数组与下标（父节点或根列表） */
export function locateObject3d(
  objects: Object3DNode[],
  id: string,
): { list: Object3DNode[]; index: number; parent: Object3DNode | null } | null {
  const search = (
    list: Object3DNode[],
    parent: Object3DNode | null,
  ): { list: Object3DNode[]; index: number; parent: Object3DNode | null } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { list, index: i, parent }
      const kids = list[i].children
      if (kids?.length) {
        const hit = search(kids, list[i])
        if (hit) return hit
      }
    }
    return null
  }
  return search(objects, null)
}

export function isDescendantOf(
  objects: Object3DNode[],
  ancestorId: string,
  maybeDescendantId: string,
): boolean {
  const ancestor = findObject3dDeep(objects, ancestorId)
  if (!ancestor?.children?.length) return false
  let hit = false
  walkObject3dTree(ancestor.children, (obj) => {
    if (obj.id === maybeDescendantId) hit = true
  })
  return hit
}

/** 用于 watch：树结构 id 签名（含嵌套） */
export function object3dTreeSignature(objects: Object3DNode[]): string {
  const parts: string[] = []
  walkObject3dTree(objects, (obj, parent) => {
    parts.push(`${parent?.id ?? 'root'}>${obj.id}`)
  })
  return parts.join('|')
}

/** 面板内容变更签名（属性面板编辑后重建 CSS2D）；可传入工程 pages 以纳入 page2d 内容 */
export function object3dPanelSignature(
  objects: Object3DNode[],
  pages?: Array<{ id: string; type: string; layers?: unknown; width?: number; height?: number }>,
): string {
  const parts: string[] = []
  walkObject3dTree(objects, (obj) => {
    if (!obj.panel) return
    parts.push(`${obj.id}:${obj.name}:${JSON.stringify(obj.panel)}`)
    const pid = obj.panel.page2dId?.trim()
    if (pid && pages) {
      const p = pages.find((x) => x.id === pid && x.type === '2d')
      if (p) parts.push(`p2d:${pid}:${p.width}x${p.height}:${JSON.stringify(p.layers)}`)
    }
  })
  return parts.join('|')
}

let object3dIdSeq = 0

export function cloneObject3dWithNewIds(src: Object3DNode): Object3DNode {
  const copy = clonePlain(src)
  const assignIds = (node: Object3DNode) => {
    object3dIdSeq += 1
    node.id = `obj3d_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 7)}`
    if (node.panel) {
      const panel = { ...node.panel }
      // 若仅有旧 items，先迁到 widgets 再换 id
      if (!panel.widgets?.length && panel.items?.length) {
        panel.widgets = panelItemsToWidgets(panel.items)
      }
      delete panel.items
      if (panel.widgets?.length) {
        panel.widgets = panel.widgets.map((w) => ({
          ...w,
          id: `w_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 6)}`,
          bindings: (w.bindings ?? []).map((b) => ({
            ...b,
            id: `bind_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 5)}`,
          })),
          events: (w.events ?? []).map((e) => ({
            ...e,
            id: `evt_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 5)}`,
          })),
        }))
      }
      node.panel = panel
    }
    for (const child of node.children ?? []) assignIds(child)
  }
  assignIds(copy)
  return copy
}

export function countObject3dTree(objects: Object3DNode[]): number {
  let n = 0
  walkObject3dTree(objects, () => {
    n += 1
  })
  return n
}
