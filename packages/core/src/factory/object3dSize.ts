import type { Object3DNode, Object3DSourceUnit } from '../types/project'

/** 内置图元在 scale=1 时的包围盒（场景单位=米） */
export const PRIMITIVE_SOURCE_SIZE_M: Record<
  'box' | 'sphere' | 'cylinder' | 'arrow',
  [number, number, number]
> = {
  box: [1, 1, 1],
  sphere: [1.2, 1.2, 1.2],
  cylinder: [0.9, 1.2, 0.9],
  /** 杆+锥近似 */
  arrow: [0.44, 1.15, 0.44],
}

export function roundMeters3(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1000) / 1000
}

export function resolveSourceUnit(node: Pick<Object3DNode, 'sourceUnit' | 'modelResourceId'>): Object3DSourceUnit {
  if (node.sourceUnit === 'mm' || node.sourceUnit === 'm') return node.sourceUnit
  return node.modelResourceId ? 'mm' : 'm'
}

/** 文件/几何单位 → 米 */
export function sourceUnitToMeters(unit: Object3DSourceUnit): number {
  return unit === 'mm' ? 0.001 : 1
}

export function resolveSourceSize(
  node: Pick<Object3DNode, 'sourceSize' | 'primitive' | 'modelResourceId' | 'panel'>,
): [number, number, number] {
  if (node.sourceSize && node.sourceSize.length === 3) {
    return [
      Math.max(1e-12, Math.abs(node.sourceSize[0])),
      Math.max(1e-12, Math.abs(node.sourceSize[1])),
      Math.max(1e-12, Math.abs(node.sourceSize[2])),
    ]
  }
  if (node.primitive && node.primitive in PRIMITIVE_SOURCE_SIZE_M) {
    const key = node.primitive as keyof typeof PRIMITIVE_SOURCE_SIZE_M
    return [...PRIMITIVE_SOURCE_SIZE_M[key]] as [number, number, number]
  }
  // 旧工程无 sourceSize：退化为 1，此时属性里的「米」≈ Three scale
  return [1, 1, 1]
}

/**
 * 属性栏展示的轴向尺寸（米）= sourceSize × unitToM × threeScale
 */
export function sizeMetersFromObject3d(node: Object3DNode): [number, number, number] {
  const src = resolveSourceSize(node)
  const k = sourceUnitToMeters(resolveSourceUnit(node))
  const s = node.transform.scale
  return [
    roundMeters3(src[0] * k * Math.abs(s[0] || 0)),
    roundMeters3(src[1] * k * Math.abs(s[1] || 0)),
    roundMeters3(src[2] * k * Math.abs(s[2] || 0)),
  ]
}

/** 由目标米制尺寸反算 Three scale */
export function threeScaleFromSizeMeters(
  node: Object3DNode,
  sizeM: [number, number, number],
): [number, number, number] {
  const src = resolveSourceSize(node)
  const k = sourceUnitToMeters(resolveSourceUnit(node))
  const axis = (i: 0 | 1 | 2) => {
    const denom = src[i] * k
    const m = Math.max(0, Number.isFinite(sizeM[i]) ? sizeM[i] : 0)
    if (denom < 1e-15) return 1
    return Math.max(1e-12, m / denom)
  }
  return [axis(0), axis(1), axis(2)]
}

export function patchObject3dSizeMeters(
  node: Object3DNode,
  sizeM: [number, number, number],
): Pick<Object3DNode, 'transform'> {
  return {
    transform: {
      ...node.transform,
      scale: threeScaleFromSizeMeters(node, sizeM),
    },
  }
}
