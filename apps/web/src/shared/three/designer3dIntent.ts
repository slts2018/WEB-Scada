/**
 * 设计端 3D 选中 / 聚焦（唯一业务入口）。
 */
import type { Scene3DBundle } from '@/shared/three/createScene3D'

export function applyDesigner3dSelection(opts: {
  bundle: Scene3DBundle
  ids: string[]
  commitStore: (ids: string[]) => void
  locked?: boolean
  /** 是否把相机框到选中 */
  frame?: boolean
}): boolean {
  const { bundle, ids, commitStore, locked = false, frame = false } = opts
  commitStore([...ids])
  const gizmo = ids.length > 0 && !locked
  bundle.selectObjects(ids, { gizmo })
  if (!frame || !ids.length) return true
  return bundle.fitView(ids)
}

/** 只聚焦、不改选中（用于「看选中」按钮） */
export function frameDesigner3dSelection(bundle: Scene3DBundle, ids: string[]): boolean {
  if (!ids.length) return false
  return bundle.fitView(ids)
}
