import type { Object3DNode, Transform3D } from '@web-scada/core'
import type { AlignMode } from '@/shared/designer/geometry'

/** 按世界轴对齐本地 position（同级对象效果最佳） */
export function computeAlignPatches3d(
  objects: Object3DNode[],
  mode: AlignMode,
): Record<string, Transform3D> {
  const editable = objects.filter((o) => !o.locked && o.visible !== false)
  if (editable.length < 2) return {}
  if ((mode === 'distributeH' || mode === 'distributeV') && editable.length < 3) return {}

  const patches: Record<string, Transform3D> = {}
  const axisOf = (mode: AlignMode): 0 | 1 | 2 | null => {
    if (mode === 'left' || mode === 'center' || mode === 'right' || mode === 'distributeH') return 0
    if (mode === 'top' || mode === 'middle' || mode === 'bottom') return 1
    if (mode === 'distributeV') return 2 // 地面水平面沿 Z 分布
    return null
  }
  const axis = axisOf(mode)
  if (axis === null) return {}

  if (mode === 'left' || mode === 'bottom') {
    // left → min X；bottom → min Y
    const v = Math.min(...editable.map((o) => o.transform.position[axis]))
    for (const o of editable) {
      const position = [...o.transform.position] as [number, number, number]
      position[axis] = v
      patches[o.id] = { ...o.transform, position }
    }
    return patches
  }

  if (mode === 'right' || mode === 'top') {
    // right → max X；top → max Y
    const v = Math.max(...editable.map((o) => o.transform.position[axis]))
    for (const o of editable) {
      const position = [...o.transform.position] as [number, number, number]
      position[axis] = v
      patches[o.id] = { ...o.transform, position }
    }
    return patches
  }

  if (mode === 'center' || mode === 'middle') {
    const v =
      editable.reduce((s, o) => s + o.transform.position[axis], 0) / editable.length
    for (const o of editable) {
      const position = [...o.transform.position] as [number, number, number]
      position[axis] = v
      patches[o.id] = { ...o.transform, position }
    }
    return patches
  }

  if (mode === 'distributeH' || mode === 'distributeV') {
    const sorted = [...editable].sort(
      (a, b) => a.transform.position[axis] - b.transform.position[axis],
    )
    const first = sorted[0].transform.position[axis]
    const last = sorted[sorted.length - 1].transform.position[axis]
    const step = (last - first) / (sorted.length - 1)
    sorted.forEach((o, i) => {
      const position = [...o.transform.position] as [number, number, number]
      position[axis] = first + step * i
      patches[o.id] = { ...o.transform, position }
    })
  }

  return patches
}
