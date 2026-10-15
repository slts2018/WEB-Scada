/**
 * 3D「液位层」：按罐体尺寸自动生成一块液体图元，并用**现有两条动画连接**实现「从罐底往上长」：
 *   - 位移 Y（moveV）：液体中心随液位从罐底抬到半高
 *   - 缩放 Y（height）：液体高度随液位 0 → 满高
 * 两条连接共用同一个变量与量程，因此永远同步；运行时不需要任何新能力（沿用动画连接 + 图元）。
 *
 * 为什么不用「贴底的容器节点 + 子液体」：本引擎里既没有图元也没有模型、也没有面板的节点会被
 * 渲染成 1×1×1 盒子（见 createScene3D.createPrimitiveMesh），所以直接用「同一个对象同时改
 * position/scale」最干净。
 */
import type { AnimationLinkRange } from '../types/animationLink'
import type { Object3DNode, Object3DLiquidLevel } from '../types/project'
import { PRIMITIVE_SOURCE_SIZE_M, resolveSourceSize } from './object3dSize'

/** 与 createScene3D 的图元几何保持一致：圆柱 r=0.45、h=1.2；长方体 1×1×1 */
const CYLINDER_BASE_RADIUS = PRIMITIVE_SOURCE_SIZE_M.cylinder[0] / 2
const CYLINDER_BASE_HEIGHT = PRIMITIVE_SOURCE_SIZE_M.cylinder[1]

/** 横截面接近正方形（差异 ≤ 15%）时自动用圆柱 */
const AUTO_CYLINDER_TOLERANCE = 0.15
/** 设计态预览液位：半满；运行时由动画连接覆盖 */
const DESIGN_PREVIEW_LEVEL = 0.5

export const LIQUID_DEFAULT_COLOR = '#38bdf8'
export const LIQUID_DEFAULT_INSET = 0.03
export const LIQUID_DEFAULT_IN_MIN = 0
export const LIQUID_DEFAULT_IN_MAX = 100

export type LiquidLevelShape = 'cylinder' | 'box'

export interface LiquidLevelOptions {
  tagId: string
  /** 生成方式，默认 shape（形状自适应） */
  mode?: 'shape' | 'primitive'
  /** 变量量程下限，映射到 0% */
  inMin?: number
  /** 变量量程上限，映射到 100% */
  inMax?: number
  color?: string
  /** 液体不透明度 0~1（默认 1：不透明液体走不透明通道，和半透明罐壁叠加不会闪） */
  opacity?: number
  /** auto：按罐体横截面自动选择 */
  shape?: LiquidLevelShape | 'auto'
  /** 相对罐体内壁的内缩比例 0~0.25 */
  inset?: number
}

export interface LiquidLevelGeometry {
  shape: LiquidLevelShape
  /** 液体底面在罐体局部坐标里的 Y（sourceSize 单位，与父级同坐标系） */
  bottomY: number
  /** 满液位时的液面 Y */
  topY: number
  height: number
  width: number
  depth: number
  radius: number
  /** 满液位时液体图元的缩放（= 尺寸 / 图元基准尺寸） */
  fullScale: [number, number, number]
}

/**
 * 变量值 → 液位比例 0~1（变量缺失/质量差返回 null）。
 * 形状模式用它算裁剪面高度，图元模式由两条连接直接映射（保持等价，便于单测对照）。
 */
export function resolveLiquidLevelFraction(
  liquid: Pick<Object3DLiquidLevel, 'inMin' | 'inMax'>,
  tagValue: { value: unknown; quality?: string } | undefined,
): number | null {
  if (!tagValue) return null
  if (tagValue.quality === 'Bad' || tagValue.quality === 'Offline') return null
  const v = tagValue.value
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)
  if (!Number.isFinite(n)) return null
  const span = (liquid.inMax - liquid.inMin) || 1
  return Math.min(1, Math.max(0, (n - liquid.inMin) / span))
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 设计端默认配置（面板「添加液位层」用） */
export function defaultLiquidLevelOptions(tagId = ''): LiquidLevelOptions {
  return {
    tagId,
    mode: 'shape',
    inMin: LIQUID_DEFAULT_IN_MIN,
    inMax: LIQUID_DEFAULT_IN_MAX,
    color: LIQUID_DEFAULT_COLOR,
    opacity: 1,
    shape: 'auto',
    inset: LIQUID_DEFAULT_INSET,
  }
}

/**
 * 由罐体尺寸推断液体几何。
 * 罐体几何在自身局部坐标里以原点为中心（模型加载时会居中，图元几何本身也是居中的），
 * 所以底面 Y = -高度/2。
 */
export function resolveLiquidLevelGeometry(
  tank: Pick<Object3DNode, 'sourceSize' | 'primitive' | 'modelResourceId' | 'panel'>,
  opts?: { shape?: LiquidLevelShape | 'auto'; inset?: number },
): LiquidLevelGeometry {
  const src = resolveSourceSize(tank)
  const inset = clamp(opts?.inset ?? LIQUID_DEFAULT_INSET, 0, 0.25)
  const width = src[0] * (1 - inset)
  const depth = src[2] * (1 - inset)
  const height = src[1] * (1 - inset)
  const shape: LiquidLevelShape =
    opts?.shape === 'cylinder' || opts?.shape === 'box'
      ? opts.shape
      : Math.abs(src[0] - src[2]) / Math.max(src[0], src[2], 1e-6) <= AUTO_CYLINDER_TOLERANCE
        ? 'cylinder'
        : 'box'
  const radius = Math.min(width, depth) / 2
  const fullScale: [number, number, number] =
    shape === 'cylinder'
      ? [radius / CYLINDER_BASE_RADIUS, height / CYLINDER_BASE_HEIGHT, radius / CYLINDER_BASE_RADIUS]
      : [width, height, depth]
  return {
    shape,
    bottomY: -src[1] / 2,
    topY: -src[1] / 2 + height,
    height,
    width,
    depth,
    radius,
    fullScale,
  }
}

function linkId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/** 复用已有连接 id，避免「改一次颜色，动画连接里的 id 全变」 */
function reuseLinkId(node: Object3DNode, type: 'moveV' | 'height'): string {
  const hit = (node.animationLinks ?? []).find((l) => l.type === type)
  return hit?.id ?? linkId('liq')
}

/**
 * 把液位配置写进节点（新建 / 改配置都走这里）。
 * 会重算几何、两条连接、颜色与透明度；保留原有 id 与名称。
 */
export function syncLiquidLevelNode(
  tank: Object3DNode,
  node: Object3DNode,
  opts: LiquidLevelOptions,
): Object3DNode {
  const inset = clamp(opts.inset ?? LIQUID_DEFAULT_INSET, 0, 0.25)
  const color = opts.color ?? LIQUID_DEFAULT_COLOR
  const opacity = clamp(opts.opacity ?? 1, 0.05, 1)
  const inMin = Number.isFinite(opts.inMin) ? Number(opts.inMin) : LIQUID_DEFAULT_IN_MIN
  const inMax = Number.isFinite(opts.inMax) ? Number(opts.inMax) : LIQUID_DEFAULT_IN_MAX
  const mode = opts.mode === 'primitive' ? 'primitive' : 'shape'
  const geo = resolveLiquidLevelGeometry(tank, { shape: opts.shape, inset })
  const yAt = (level: number) => geo.bottomY + (geo.height / 2) * level
  const range = { inMin, inMax }
  const moveLink: AnimationLinkRange = {
    id: reuseLinkId(node, 'moveV'),
    type: 'moveV',
    enabled: true,
    tagId: opts.tagId,
    ...range,
    outMin: yAt(0),
    outMax: yAt(1),
  }
  const heightLink: AnimationLinkRange = {
    id: reuseLinkId(node, 'height'),
    type: 'height',
    enabled: true,
    tagId: opts.tagId,
    ...range,
    outMin: 0,
    outMax: geo.fullScale[1],
  }
  const liquid: Object3DLiquidLevel = {
    tankId: tank.id,
    mode,
    tagId: opts.tagId,
    inMin,
    inMax,
    color,
    opacity,
    shape: geo.shape,
    inset,
  }
  /** 形状模式：复制罐体几何（含模型），液面由世界水平裁剪面切出来 → 任意罐形自动贴合 */
  const shapeMode = mode === 'shape' && Boolean(tank.modelResourceId || tank.primitive)
  const base: Object3DNode = {
    ...node,
    name: node.name || '液位',
    panel: undefined,
    sourceUnit: 'm',
    // 位置/高度由连接或裁剪接管，锁定以免误拖破坏与罐体的对应关系
    locked: true,
    visible: true,
    style: { ...node.style, color, opacity },
    material: undefined,
    liquid,
  }
  if (shapeMode) {
    return {
      ...base,
      primitive: tank.modelResourceId ? undefined : tank.primitive,
      modelResourceId: tank.modelResourceId,
      sourceSize: tank.sourceSize ? ([...tank.sourceSize] as [number, number, number]) : undefined,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1 - inset, 1 - inset, 1 - inset],
      },
      animationLinks: [],
    }
  }
  return {
    ...base,
    primitive: geo.shape,
    modelResourceId: undefined,
    sourceSize: [...PRIMITIVE_SOURCE_SIZE_M[geo.shape]] as [number, number, number],
    transform: {
      position: [0, yAt(DESIGN_PREVIEW_LEVEL), 0],
      rotation: [0, 0, 0],
      scale: [...geo.fullScale] as [number, number, number],
    },
    animationLinks: [moveLink, heightLink],
  }
}

/** 新建液位层节点（父级为罐体对象） */
export function createLiquidLevelNode(tank: Object3DNode, opts: LiquidLevelOptions): Object3DNode {
  const empty: Object3DNode = {
    id: `o3d_liquid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '液位',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    style: {},
    visible: true,
    bindings: [],
    animations: [],
    animationLinks: [],
    events: [],
  }
  return syncLiquidLevelNode(tank, empty, opts)
}

/** 从节点里读回液位配置（无则 null） */
export function resolveLiquidLevelOptions(node: Object3DNode): LiquidLevelOptions | null {
  if (!node.liquid) return null
  return {
    tagId: node.liquid.tagId,
    mode: node.liquid.mode === 'primitive' ? 'primitive' : 'shape',
    inMin: node.liquid.inMin,
    inMax: node.liquid.inMax,
    color: node.liquid.color,
    opacity: node.liquid.opacity,
    shape: node.liquid.shape,
    inset: node.liquid.inset,
  }
}