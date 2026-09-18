import type { Object3DNode } from '@web-scada/core'
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

/** 面板内容变更签名（属性面板编辑后重建 CSS2D） */
export function object3dPanelSignature(objects: Object3DNode[]): string {
  const parts: string[] = []
  walkObject3dTree(objects, (obj) => {
    if (!obj.panel) return
    parts.push(`${obj.id}:${obj.name}:${JSON.stringify(obj.panel)}`)
  })
  return parts.join('|')
}

let object3dIdSeq = 0

export function cloneObject3dWithNewIds(src: Object3DNode): Object3DNode {
  const copy = clonePlain(src)
  const assignIds = (node: Object3DNode) => {
    object3dIdSeq += 1
    node.id = `obj3d_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 7)}`
    if (node.panel?.items?.length) {
      node.panel = {
        ...node.panel,
        items: node.panel.items.map((item) => ({
          ...item,
          id: `pi_${Date.now()}_${object3dIdSeq}_${Math.random().toString(36).slice(2, 6)}`,
        })),
      }
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
