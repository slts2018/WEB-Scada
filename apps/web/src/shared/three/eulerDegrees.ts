import { Euler, MathUtils, Quaternion } from 'three'

/** 属性栏按度编辑，0.001° 以下只是弧度换算的浮点尾巴 */
const DEG_DECIMALS = 1000

export function roundDeg(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * DEG_DECIMALS) / DEG_DECIMALS
}

/** 收到离参考角最近的 360° 周期，避免 90 被写成 -270 */
function nearestTurn(deg: number, ref: number): number {
  if (!Number.isFinite(deg)) return roundDeg(ref)
  if (!Number.isFinite(ref)) return roundDeg(deg)
  return roundDeg(deg + Math.round((ref - deg) / 360) * 360)
}

/**
 * XYZ 的另一组等价欧拉角。
 * Y 接近 ±90° 时 Three.js 常拆出这组，朝向相同，数字会差到 180°。
 */
function alternateXyz(deg: [number, number, number]): [number, number, number] {
  return [deg[0] + 180, 180 - deg[1], deg[2] + 180]
}

function score(value: [number, number, number], prev: [number, number, number]): number {
  const dx = value[0] - prev[0]
  const dy = value[1] - prev[1]
  const dz = value[2] - prev[2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * 在等价的 XYZ 写法里选离原来角度最近的一组，再收到 0.001°。
 * 平移不走这里：平移应原样保留工程里存的度数。
 */
export function closestEulerDegrees(
  raw: [number, number, number],
  prev: [number, number, number],
): [number, number, number] {
  let best: [number, number, number] = [
    nearestTurn(raw[0], prev[0]),
    nearestTurn(raw[1], prev[1]),
    nearestTurn(raw[2], prev[2]),
  ]
  let bestScore = score(best, prev)
  const alt = alternateXyz(raw)
  const aligned: [number, number, number] = [
    nearestTurn(alt[0], prev[0]),
    nearestTurn(alt[1], prev[1]),
    nearestTurn(alt[2], prev[2]),
  ]
  const altScore = score(aligned, prev)
  if (altScore < bestScore) best = aligned
  return best
}

/** 四元数拆回度数时贴着原来的欧拉角，解组乘完矩阵后用 */
export function eulerDegreesFromQuaternion(
  quat: Quaternion,
  prev: [number, number, number],
): [number, number, number] {
  const euler = new Euler().setFromQuaternion(quat, 'XYZ')
  return closestEulerDegrees(
    [MathUtils.radToDeg(euler.x), MathUtils.radToDeg(euler.y), MathUtils.radToDeg(euler.z)],
    prev,
  )
}
