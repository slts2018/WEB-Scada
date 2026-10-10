/**
 * 运行端「轻点 = 业务，拖拽 = 旋转」判定（纯函数，无 DOM / three 依赖，便于单测）。
 *
 * 背景：OrbitControls 的左键旋转会立刻吃掉按下动作，而模型铺满画面时几乎每次按下都会命中
 * 物体。既不能拦 Orbit（那样旋转就废了，键位也不能改），又必须让轻点可靠触发业务，所以只能
 * 在松手时用「指针位移 + 相机是否真的转过去了」两条信息判定这次手势到底是什么。
 *
 * 判定顺序（从宽到严）：
 * 1. 位移 <= slop                         → 轻点（抖动不惩罚；鼠标 6px / 触摸 10px）
 * 2. 位移 <= 硬上限 且 相机几乎没动        → 仍算轻点（指针漂移但 Orbit 没旋转）
 * 3. 其余                                 → 旋转（保留相机，不触发业务）
 *
 * 效果：正常点击必定触发；想旋转时（哪怕只拖七八个像素）也不会误触发写值/确认框。
 */

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface RuntimeTapStart {
  x: number
  y: number
  /** 按下瞬间的相机位置 */
  camPos: Vec3Like
  /** 按下瞬间的轨道焦点（OrbitControls.target） */
  camTarget: Vec3Like
}

export interface RuntimeTapEnd {
  x: number
  y: number
  /** 松手瞬间的相机位置 */
  camPos: Vec3Like
  /** 松手瞬间的轨道焦点 */
  camTarget: Vec3Like
}

export interface RuntimeTapVerdict {
  kind: 'tap' | 'gesture'
  /** 指针位移（CSS px） */
  travelPx: number
  /** 相机绕焦点转过的角度（度） */
  orbitDeg: number
  /** 焦点位移 / 相机距离 */
  targetShiftRatio: number
  /** 判定说明（诊断面板直接用） */
  reason: string
  /** 本次生效的轻点阈值 */
  slopPx: number
}

/** 鼠标轻点容差；Windows 自身拖拽阈值是 4px，这里留一点余量给手抖 */
export const MOUSE_TAP_SLOP_PX = 6
/** 触摸/手写笔容差：手指抖动更大 */
export const TOUCH_TAP_SLOP_PX = 10
/** 位移硬上限：超过它一定是拖拽，不再看相机 */
export const TAP_HARD_LIMIT_PX = 14
/** 相机旋转容差：超过它说明用户确实在转视角 */
export const TAP_ORBIT_TOL_DEG = 1.2
/** 焦点位移容差（相对相机距离） */
export const TAP_TARGET_TOL_RATIO = 0.004

export function runtimeTapSlopPx(pointerType?: string): number {
  return pointerType === 'touch' || pointerType === 'pen' ? TOUCH_TAP_SLOP_PX : MOUSE_TAP_SLOP_PX
}

function sub(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function len(v: Vec3Like): number {
  return Math.hypot(v.x, v.y, v.z)
}

/** 两个方向向量之间的夹角（度）；任一为零向量时返回 0 */
function angleDeg(a: Vec3Like, b: Vec3Like): number {
  const la = len(a)
  const lb = len(b)
  if (la < 1e-9 || lb < 1e-9) return 0
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)))
  return (Math.acos(cos) * 180) / Math.PI
}

function fmtPx(v: number): string {
  return v < 10 ? v.toFixed(1) : String(Math.round(v))
}

/**
 * 判定一次「按下 → 松手」是轻点还是旋转手势。
 * `forcedGesture=true` 用于中途已被拖拽写值等业务抢走的手势。
 */
export function classifyRuntimeTap(
  start: RuntimeTapStart,
  end: RuntimeTapEnd,
  opts?: { pointerType?: string; forcedGesture?: boolean },
): RuntimeTapVerdict {
  const slopPx = runtimeTapSlopPx(opts?.pointerType)
  const hardLimitPx = slopPx + (TAP_HARD_LIMIT_PX - MOUSE_TAP_SLOP_PX)
  const travelPx = Math.hypot(end.x - start.x, end.y - start.y)
  const orbitDeg = angleDeg(sub(start.camPos, start.camTarget), sub(end.camPos, end.camTarget))
  const camDist = len(sub(end.camPos, end.camTarget))
  const targetShiftRatio = len(sub(end.camTarget, start.camTarget)) / Math.max(1e-6, camDist)
  const base = { travelPx, orbitDeg, targetShiftRatio, slopPx }

  if (opts?.forcedGesture) {
    return { ...base, kind: 'gesture', reason: '手势已被拖拽写值接管' }
  }
  if (travelPx <= slopPx) {
    return { ...base, kind: 'tap', reason: `位移 ${fmtPx(travelPx)}px 在轻点阈值 ${slopPx}px 内` }
  }
  const orbitRotated = orbitDeg > TAP_ORBIT_TOL_DEG || targetShiftRatio > TAP_TARGET_TOL_RATIO
  if (travelPx <= hardLimitPx && !orbitRotated) {
    return {
      ...base,
      kind: 'tap',
      reason: `位移 ${fmtPx(travelPx)}px 略超阈值，但相机未旋转（Orbit 未生效）`,
    }
  }
  return {
    ...base,
    kind: 'gesture',
    reason: orbitRotated
      ? `相机已旋转 ${orbitDeg.toFixed(2)}°（位移 ${fmtPx(travelPx)}px）→ 判为旋转`
      : `位移 ${fmtPx(travelPx)}px 超过硬上限 ${hardLimitPx}px → 判为旋转`,
  }
}