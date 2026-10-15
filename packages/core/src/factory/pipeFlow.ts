/**
 * 管道流动的纯配置数学（不依赖 three，便于单测）。
 * 条纹用"米"做间隔、用物体最长轴做流向，因此：
 * - 模型没有 UV 也能用（CAD 直出的管子直接就能绑）
 * - 管子被非均匀拉伸时条纹密度依然一致，不会拉花
 */

export type FlowAxisOption = 'auto' | 'x' | 'y' | 'z'

/** 流向轴（物体局部）：auto = 最长轴（直管即管长方向） */
export function resolveFlowAxisLocal(
  axis: FlowAxisOption,
  size: [number, number, number],
): [number, number, number] {
  if (axis === 'x') return [1, 0, 0]
  if (axis === 'y') return [0, 1, 0]
  if (axis === 'z') return [0, 0, 1]
  const [x, y, z] = size
  if (x >= y && x >= z) return [1, 0, 0]
  return y >= z ? [0, 1, 0] : [0, 0, 1]
}

export interface FlowRibbonPlacement {
  /** 一个周期（箭头 + 间隔）的米数 */
  period: number
  /** 箭头长度（米） */
  length: number
  /** 箭头平面宽度（米） */
  width: number
  /** 抬升高度（米）：0 = 与管子同一高度（贴在管子两侧，不浮空） */
  lift: number
  /** 单侧横向偏移（米）：让每片箭头紧贴管壁外侧 */
  sideOffset: number
  /** 箭头占周期的比例 */
  headRatio: number
}

/**
 * 浮空平面箭头（参考"浮在管子上方的平面箭头"那种观感）的尺寸：
 * 尺寸按**米**算，所以细管上也能有看得见的箭头；管子被拉伸不影响箭头大小。
 */
export function resolveFlowRibbon(
  size: [number, number, number],
  opts?: { stripe?: number; size?: number; axis?: FlowAxisOption },
): FlowRibbonPlacement {
  const dims = [size[0], size[1], size[2]].filter((n) => Number.isFinite(n) && n > 1e-6)
  const sorted = [...dims].sort((a, b) => a - b)
  const diameter = sorted.length >= 2 ? sorted[0] : 0.05
  // 箭头是"符号"而不是按管径等比：细管上也要看得见，所以有绝对下限。
  // 默认"长箭头 + 稀疏"：间隔 ≈ 110 倍管径（细管 3m 起），箭头长 ≈ 0.72 × 间隔
  const period =
    opts?.stripe != null && Number.isFinite(opts.stripe) && opts.stripe > 0.02
      ? opts.stripe
      : Math.min(14, Math.max(3, diameter * 110))
  const length =
    opts?.size != null && Number.isFinite(opts.size) && opts.size > 0.02
      ? opts.size
      : period * 0.72
  const width = Math.min(0.6, Math.max(0.1, diameter * 3))
  // 贴在管子两侧：与管轴同高（不抬升），横向分别贴到管壁外沿
  const lift = 0
  const sideOffset = diameter * 0.5 + width * 0.5
  return {
    period,
    length,
    width,
    lift,
    sideOffset,
    headRatio: Math.min(0.95, length / period),
  }
}

/**
 * 贴皮箭头（管壁上一根「杆 + 三角头」）的几何：
 * u = 周期内轴向 0~1，ang = 绕管角度 -1~1（一个周期 360°，±1 是同一根线）。
 * faceAng = 箭头贴在哪一个角度上（运行端每帧把它设成"管壁朝向相机的那一点"，
 *           于是箭头总在看得见的那一面上，不会跑到轮廓线上变成一条亮线）。
 * 返回该点亮度 0~1。与本仓库 flowMaterial 的 GLSL 保持同一套式子。
 */
export function skinArrowStroke(
  u: number,
  ang: number,
  opts?: { len?: number; lobe?: number; tip?: number; glow?: number; faceAng?: number },
): number {
  const len = Math.min(0.6, Math.max(0.05, opts?.len ?? 0.42))
  const lobe = Math.min(0.5, Math.max(0.1, opts?.lobe ?? 0.45))
  const tip = Math.min(0.98, opts?.tip ?? Math.min(0.98, 0.55 + len * 0.6))
  const glow = opts?.glow ?? 0.45
  const back = tip - len
  const shaftEnd = back + len * 0.62
  // 绕管角周期为 2（±1 是同一根线），取到贴皮中心角的最近距离
  const faceAng = opts?.faceAng ?? 0.5
  const delta = Math.abs(ang - faceAng)
  const d = Math.min(delta, 2 - delta)
  const halfAt = (t: number): number => {
    if (t < back || t > tip) return -1
    if (t <= shaftEnd) return lobe * 0.34
    return lobe * (1 - (t - shaftEnd) / Math.max(1e-6, tip - shaftEnd))
  }
  const stroke = (t: number, k: number): number => {
    const half = halfAt(t)
    if (half < 0) return 0
    const edge = half * k
    if (d >= edge) return 0
    return 1 - smoothstep(edge * 0.75, edge, d)
  }
  return Math.min(1, stroke(u, 1) + glow * stroke(u, 1.9))
}

/**
 * 发光斜箭（"»"）的几何：给定「周期内轴向位置 u(0~1)、绕管角度 ang(-1~1)」，
 * 返回该点的明亮度 0~1。与本仓库 flowMaterial 里的 GLSL 保持同一套式子。
 *
 * 形状：一条（=一双，双斜）从尾部的 |ang|=width 斜向尖端的 |ang|=0 的斜线，
 * 即经典的 ">" / "»" 指向标记；line 之外用平滑衰减做出光晕。
 */
export function chevronStroke(
  u: number,
  ang: number,
  opts?: { len?: number; width?: number; thick?: number; tip?: number; gap?: number; glow?: number },
): number {
  const len = Math.min(0.6, Math.max(0.05, opts?.len ?? 0.42))
  const width = Math.min(1, Math.max(0.2, opts?.width ?? 1))
  const thick = Math.min(0.5, Math.max(0.06, opts?.thick ?? 0.22))
  const tip = Math.min(0.98, opts?.tip ?? Math.min(0.98, 0.55 + len * 0.6))
  const gap = opts?.gap ?? len * 0.45
  const glow = opts?.glow ?? 0.45
  const one = (tipU: number, strokeThick: number): number => {
    const back = tipU - len
    if (u < back || u > tipU) return 0
    const spread = Math.min(1, Math.max(0, (tipU - u) / Math.max(1e-6, len)))
    const d = Math.abs(Math.abs(ang) - spread * width)
    const t = Math.max(strokeThick * 0.45, 1e-6)
    return 1 - smoothstep(t, Math.max(t + 1e-6, strokeThick), d)
  }
  const core = Math.max(one(tip, thick), one(tip - gap, thick))
  const halo = Math.max(one(tip, thick * 3), one(tip - gap, thick * 3))
  return Math.min(1, core + glow * halo)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 给定流向轴，构造两个与它垂直的单位基（用于算"绕管一圈的角度"）。
 * 箭头样式靠这个角度把箭头包裹到管子整圈上，任何视角都能看到。
 */
export function resolveFlowSideBasis(
  axis: [number, number, number],
): { b1: [number, number, number]; b2: [number, number, number] } {
  const [ax, ay, az] = axis
  const len = Math.hypot(ax, ay, az) || 1
  const a: [number, number, number] = [ax / len, ay / len, az / len]
  // 选一个与轴不平行的参考向量，避免叉乘退化
  const ref: [number, number, number] = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
  const norm = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const b1 = norm(cross(ref, a))
  const b2 = norm(cross(a, b1))
  return { b1, b2 }
}

/**
 * 条纹间隔（米）：优先用配置值；否则按"最小边 × 6"自动（直径 3cm 的管 → 约 18cm 一道），
 * 并夹在 0.03~0.6m，避免细管条纹过密、粗管条纹过稀。
 */
export function resolveFlowStripe(size: [number, number, number], stripe?: number): number {
  if (stripe != null && Number.isFinite(stripe) && stripe > 0.005) return stripe
  const dims = [size[0], size[1], size[2]].filter((n) => Number.isFinite(n) && n > 1e-6)
  const minDim = dims.length ? Math.min(...dims) : 0.05
  return Math.min(0.6, Math.max(0.03, minDim * 6))
}
