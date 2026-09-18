import { Box3, PerspectiveCamera, Vector3, type Object3D } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModelObject } from '@/shared/three/modelLoader'

/** 导入模型目标最长边（与内置立方体 ~1、网格 20 同级） */
export const MODEL_FIT_TARGET_SIZE = 2.5

/** 按最长边算均匀缩放；已接近目标则保持 1 */
export function uniformFitScale(maxDim: number, target = MODEL_FIT_TARGET_SIZE): number {
  if (!Number.isFinite(maxDim) || maxDim <= 1e-8) return 1
  const s = target / maxDim
  if (s > 0.85 && s < 1.25) return 1
  // 放宽下限：工业 CAD 管道可达极大尺寸，过小会在屏幕上「只剩手柄」
  return Math.min(1e6, Math.max(1e-8, s))
}

/** 聚焦用：LOD 只量 detail，避免代理层把包围盒撑坏 */
export function resolveFocusObject(obj: Object3D): Object3D {
  const root = obj.userData?.focusRoot
  return root && typeof root === 'object' ? (root as Object3D) : obj
}

export function maxDimFromObject(obj: Object3D): number {
  const box = new Box3().setFromObject(resolveFocusObject(obj))
  if (box.isEmpty()) return 0
  const size = new Vector3()
  box.getSize(size)
  return Math.max(size.x, size.y, size.z)
}

/** 从已挂载对象反推「原始最长边」再算适配缩放（假定当前为均匀缩放） */
export function fitScaleFromMountedObject(obj: Object3D, target = MODEL_FIT_TARGET_SIZE): number {
  const worldMax = maxDimFromObject(obj)
  const cur = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z), 1e-8)
  const nativeMax = worldMax / cur
  return uniformFitScale(nativeMax, target)
}

/** 加载模型 URL（多格式），测量包围盒并返回建议均匀 scale */
export async function measureModelFitScale(
  url: string,
  target = MODEL_FIT_TARGET_SIZE,
): Promise<{ scale: number; maxDim: number }> {
  const root = await loadModelObject(url)
  const maxDim = maxDimFromObject(root)
  return { scale: uniformFitScale(maxDim, target), maxDim }
}

export function unionObjectBoxes(objs: Object3D[]): Box3 {
  const box = new Box3()
  for (const o of objs) {
    const b = new Box3().setFromObject(resolveFocusObject(o))
    if (!b.isEmpty()) box.union(b)
  }
  return box
}

type OrbitExtras = OrbitControls & {
  sphericalDelta?: { set: (x: number, y: number, z: number) => void }
  panOffset?: { set: (x: number, y: number, z: number) => void }
  _spherical?: { radius: number; theta: number; phi: number; makeSafe?: () => void }
}

/**
 * 相机框住包围盒（硬切视角）。
 * leaveDampingOff：留给 fitView 在 suppressOrbit 结束后再恢复，避免阻尼立刻把镜头拽回去。
 */
export function fitCameraToBox(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  box: Box3,
  opts?: { padding?: number; leaveDampingOff?: boolean },
): boolean {
  if (box.isEmpty()) return false
  const size = new Vector3()
  const center = new Vector3()
  box.getSize(size)
  box.getCenter(center)
  if (![center.x, center.y, center.z].every(Number.isFinite)) return false

  const maxSize = Math.max(size.x, size.y, size.z, 1e-6)
  const padding = opts?.padding ?? 2.2
  const fov = (camera.fov * Math.PI) / 180
  let distance = (maxSize / (2 * Math.tan(fov / 2))) * padding
  distance = Math.max(distance, maxSize * 1.8, 1.5)

  const dir = new Vector3(1.2, 0.85, 1.2).normalize()
  const nextPos = center.clone().addScaledVector(dir, distance)

  const prevDamping = controls.enableDamping
  controls.enableDamping = false
  const anyControls = controls as OrbitExtras
  anyControls.sphericalDelta?.set(0, 0, 0)
  anyControls.panOffset?.set(0, 0, 0)

  controls.target.copy(center)
  camera.position.copy(nextPos)
  camera.up.set(0, 1, 0)
  camera.near = Math.max(0.01, Math.min(1, distance / 100))
  camera.far = Math.max(2000, distance * 50, maxSize * 200)
  camera.updateProjectionMatrix()
  camera.lookAt(center)
  controls.update()

  // 再钉一次，防止 Orbit 内部球坐标未同步
  controls.target.copy(center)
  camera.position.copy(nextPos)
  camera.lookAt(center)
  controls.update()

  if (!opts?.leaveDampingOff) {
    controls.enableDamping = prevDamping
  }
  return true
}
