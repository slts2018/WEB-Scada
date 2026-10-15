import type {
  AnimationLink,
  AnimationLinkFlow,
  Object3DNode,
  Page2D,
  Page3D,
  TagValue,
  Transform3D,
} from '@web-scada/core'
import { walkObject3dTree } from '@/shared/project/object3dTree'
import { clonePlain } from '@/shared/utils/clonePlain'
import { collectPageTagIds } from '@/shared/runtime/bindingEngine'
import { resolveLiquidLevelFraction } from '@web-scada/core'

/** 管道流动的运行态参数 */
export interface ResolvedFlow {
  /** 速度系数（变量量程映射结果；0 = 停流） */
  factor: number
  /** 满速速度（米/秒，带符号） */
  speed: number
  stripe?: number
  color?: string
  duty?: number
  axis: 'auto' | 'x' | 'y' | 'z'
  /** skin（默认）= 贴皮箭头（管壁两侧）；ribbon = 浮空平面；chevron = 发光斜箭；arrow = 锥形；stripe = 条纹 */
  style: 'skin' | 'ribbon' | 'chevron' | 'arrow' | 'stripe'
  /** 横向张开 0.3~1（1 = 整圈包裹） */
  width: number
  /** 斜箭粗细 0.06~0.5 */
  thick: number
  /** 浮空箭头长度（米，缺省自动） */
  size?: number
  /** 浮空箭头不透明度（缺省 0.85） */
  alpha?: number
  /** 光晕强度 0~1（缺省 0 = 纯色，不要光晕） */
  glow: number
}

/** 解析流动连接：变量 → 速度系数（变量缺失/坏质量 = 停流） */
export function resolveObject3DFlow(
  object: Pick<Object3DNode, 'animationLinks'>,
  getTag: (tagId: string) => TagValue | undefined,
): ResolvedFlow | null {
  const link = (object.animationLinks ?? []).find(
    (l): l is AnimationLinkFlow => l.type === 'flow' && l.enabled,
  )
  if (!link) return null
  const tag = getTag(link.tagId)
  const n = tag ? asNumber(tag.value) : null
  const bad = !tag || tag.quality === 'Bad' || tag.quality === 'Offline'
  const factor = n === null || bad ? 0 : mapRange(n, link.inMin, link.inMax, link.outMin, link.outMax)
  return {
    factor,
    speed: Number(link.speed) || 0,
    stripe: link.stripe,
    color: link.color,
    duty: link.duty,
    axis: link.axis ?? 'auto',
    style:
      link.style === 'stripe'
        ? 'stripe'
        : link.style === 'arrow'
          ? 'arrow'
          : link.style === 'chevron'
            ? 'chevron'
            : link.style === 'ribbon'
              ? 'ribbon'
              : 'skin',
    width: Math.min(1, Math.max(0.3, Number(link.width) || 1)),
    thick: Math.min(0.5, Math.max(0.06, Number(link.thick) || 0.22)),
    size: link.size,
    alpha: link.alpha,
    glow: Math.min(1, Math.max(0, Number(link.glow) || 0)),
  }
}

export interface ResolvedObject3D {
  object: Object3DNode
  blink: boolean
  /** 使能连接结果：false 时禁止运行端点击交互 */
  interactive: boolean
  quality: TagValue['quality'] | 'Good'
  /** 0~1 液位（液位层专用；null = 变量缺失/质量差 → 隐藏液体） */
  liquidLevel: number | null
  /** 管道流动参数（无流动连接 = null） */
  flow: ResolvedFlow | null
  /**
   * 动画/绑定/质量是否主动改了颜色。
   * GLTF 模型仅在此为 true 时才允许整模染色，否则保留原材质。
   */
  colorTinted: boolean
}

function asNumber(v: TagValue['value']): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const span = inMax - inMin
  const t = span === 0 ? 0 : (value - inMin) / span
  const clamped = Math.min(1, Math.max(0, t))
  return outMin + clamped * (outMax - outMin)
}

function matchColorRange(
  value: TagValue['value'],
  range: { min?: number; max?: number; equals?: number | boolean | string; color: string; blink?: boolean },
): boolean {
  if (range.equals !== undefined) return value === range.equals
  const num = asNumber(value)
  if (num === null) return false
  if (range.min !== undefined && num < range.min) return false
  if (range.max !== undefined && num > range.max) return false
  return range.min !== undefined || range.max !== undefined
}

/** 3D 支持的动画连接子集（含 XYZ 位移/缩放/旋转；fillH/V 兼容旧数据） */
export const OBJECT3D_LINK_TYPES = [
  'hide',
  'colorFill',
  'colorFill2',
  'colorStroke',
  'moveH',
  'moveV',
  'moveZ',
  'height',
  'width',
  'scaleZ',
  'rotX',
  'rotY',
  'rotZ',
  'fillH',
  'fillV',
  'dragH',
  'dragV',
  'dragZ',
  'valueIn',
  'digitalIn',
  'textIn',
  'enable',
  'flow',
] as const
export type Object3DLinkType = (typeof OBJECT3D_LINK_TYPES)[number]

export function isObject3DLinkType(type: AnimationLink['type']): type is Object3DLinkType {
  return (OBJECT3D_LINK_TYPES as readonly string[]).includes(type)
}

export function object3dHasInteractiveLinks(object: Object3DNode): boolean {
  return (object.animationLinks ?? []).some(
    (l) =>
      l.enabled &&
      (l.type === 'valueIn' ||
        l.type === 'digitalIn' ||
        l.type === 'textIn' ||
        l.type === 'dragH' ||
        l.type === 'dragV' ||
        l.type === 'dragZ'),
  )
}

function setAxis(transform: Transform3D, axis: 'position' | 'rotation' | 'scale', index: 0 | 1 | 2, value: number) {
  const next = [...transform[axis]] as [number, number, number]
  next[index] = value
  transform[axis] = next
}

function applyObject3DLink(
  object: Object3DNode,
  link: AnimationLink,
  tag: TagValue | undefined,
  flags: { blink: boolean; interactive: boolean; colorTinted: boolean },
) {
  if (!link.enabled || !tag) return
  if (link.type !== 'enable' && (tag.quality === 'Bad' || tag.quality === 'Offline')) return

  if (link.type === 'hide') {
    const show = link.trueShow ? Boolean(tag.value) : !Boolean(tag.value)
    object.visible = show
    return
  }

  if (link.type === 'colorFill' || link.type === 'colorFill2') {
    for (const range of link.ranges) {
      if (!matchColorRange(tag.value, range)) continue
      object.style = { ...object.style, color: range.color }
      flags.colorTinted = true
      if (range.blink) flags.blink = true
      break
    }
    return
  }

  if (link.type === 'colorStroke') {
    for (const range of link.ranges) {
      if (!matchColorRange(tag.value, range)) continue
      object.style = { ...object.style, emissive: range.color }
      flags.colorTinted = true
      if (range.blink) flags.blink = true
      break
    }
    return
  }

  if (link.type === 'moveH' || link.type === 'moveV' || link.type === 'moveZ') {
    const n = asNumber(tag.value)
    if (n === null) return
    const mapped = mapRange(n, link.inMin, link.inMax, link.outMin, link.outMax)
    const axisIndex = link.type === 'moveH' ? 0 : link.type === 'moveV' ? 1 : 2
    setAxis(object.transform, 'position', axisIndex, mapped)
    return
  }

  if (link.type === 'rotX' || link.type === 'rotY' || link.type === 'rotZ') {
    const n = asNumber(tag.value)
    if (n === null) return
    const mapped = mapRange(n, link.inMin, link.inMax, link.outMin, link.outMax)
    const axisIndex = link.type === 'rotX' ? 0 : link.type === 'rotY' ? 1 : 2
    setAxis(object.transform, 'rotation', axisIndex, mapped)
    return
  }

  // 填充 / 宽高 / 长度：映射到非均匀缩放；拖拽连接不在此写外观
  if (
    link.type === 'fillH' ||
    link.type === 'fillV' ||
    link.type === 'width' ||
    link.type === 'height' ||
    link.type === 'scaleZ'
  ) {
    const n = asNumber(tag.value)
    if (n === null) return
    const mapped = mapRange(n, link.inMin, link.inMax, link.outMin, link.outMax)
    const axisIndex =
      link.type === 'fillH' || link.type === 'width' ? 0 : link.type === 'fillV' || link.type === 'height' ? 1 : 2
    setAxis(object.transform, 'scale', axisIndex, Math.max(1e-4, mapped))
    return
  }

  if (link.type === 'dragH' || link.type === 'dragV' || link.type === 'dragZ') {
    // 运行端拖拽写值；解析阶段不改姿态（避免与拖拽冲突）
    return
  }

  if (link.type === 'valueIn' || link.type === 'digitalIn' || link.type === 'textIn') {
    return
  }

  // 流动不改姿态/颜色，由渲染层按变量算速度
  if (link.type === 'flow') return

  if (link.type === 'enable') {
    const truthy = Boolean(tag.value)
    flags.interactive = link.trueEnable ? truthy : !truthy
  }
}

/** 解析 3D 对象运行态外观（动画连接子集 + 属性绑定 + 旧动画） */
export function resolveObject3DVisual(
  source: Object3DNode,
  getTag: (tagId: string) => TagValue | undefined,
): ResolvedObject3D {
  const object = clonePlain(source) as Object3DNode
  const flags = { blink: false, interactive: true, colorTinted: false }
  /** 管道流动：变量 → 速度系数（缺省 1，用于设计端预览） */
  const resolvedFlow = resolveObject3DFlow(object, getTag)
  let quality: ResolvedObject3D['quality'] = 'Good'

  for (const link of object.animationLinks ?? []) {
    if (!isObject3DLinkType(link.type)) continue
    const tag = getTag(link.tagId)
    if (tag && (tag.quality === 'Bad' || tag.quality === 'Offline' || tag.quality === 'Uncertain')) {
      quality = tag.quality
    }
    applyObject3DLink(object, link, tag, flags)
  }

  for (const binding of object.bindings ?? []) {
    const tag = getTag(binding.tagId)
    if (!tag) continue
    if (tag.quality === 'Bad' || tag.quality === 'Offline' || tag.quality === 'Uncertain') {
      quality = tag.quality
    }
    if (tag.quality === 'Bad' || tag.quality === 'Offline') continue

    switch (binding.prop) {
      case 'visible':
        object.visible = Boolean(tag.value)
        break
      case 'color':
      case 'fill':
        if (typeof tag.value === 'string') {
          object.style = { ...object.style, color: tag.value }
          flags.colorTinted = true
        } else if (typeof tag.value === 'boolean') {
          object.style = { ...object.style, color: tag.value ? '#22c55e' : '#334155' }
          flags.colorTinted = true
        }
        break
      case 'opacity': {
        const n = asNumber(tag.value)
        if (n !== null) object.style = { ...object.style, opacity: Math.min(1, Math.max(0, n)) }
        break
      }
      case 'x': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'position', 0, n)
        break
      }
      case 'y': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'position', 1, n)
        break
      }
      case 'z': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'position', 2, n)
        break
      }
      case 'rotX': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'rotation', 0, n)
        break
      }
      case 'rotation':
      case 'rotY': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'rotation', 1, n)
        break
      }
      case 'rotZ': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'rotation', 2, n)
        break
      }
      case 'scaleX': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'scale', 0, n)
        break
      }
      case 'scaleY': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'scale', 1, n)
        break
      }
      case 'scaleZ': {
        const n = asNumber(tag.value)
        if (n !== null) setAxis(object.transform, 'scale', 2, n)
        break
      }
      default:
        break
    }
  }

  for (const rule of object.animations ?? []) {
    const tag = getTag(rule.tagId)
    if (!tag) continue
    if (rule.kind === 'state') {
      for (const range of rule.ranges) {
        const match = range.equals !== undefined ? tag.value === range.equals : true
        if (!match) continue
        if (range.apply.fill) {
          object.style = { ...object.style, color: String(range.apply.fill) }
          flags.colorTinted = true
        }
        if (range.apply.visible !== undefined) object.visible = Boolean(range.apply.visible)
        if (range.apply.opacity !== undefined) {
          object.style = { ...object.style, opacity: Number(range.apply.opacity) }
        }
        break
      }
    }
  }

  // 液位层：解析 0~1 液位；形状模式由裁剪面使用，图元模式用来兜空液位
  let liquidLevel: number | null = null
  if (object.liquid) {
    liquidLevel = resolveLiquidLevelFraction(object.liquid, getTag(object.liquid.tagId))
    object.liquid = { ...object.liquid, level: liquidLevel }
    // 液体永远按液体色渲染（模型副本默认不整模刷色，这里显式打开）
    flags.colorTinted = true
    if (liquidLevel === null) quality = 'Uncertain'
  }

  if (quality === 'Bad' || quality === 'Offline') {
    object.style = {
      ...object.style,
      opacity: Math.min(object.style?.opacity ?? 1, 0.4),
      color: '#ef4444',
    }
    flags.colorTinted = true
  }

  return {
    object,
    blink: flags.blink,
    interactive: flags.interactive,
    quality,
    liquidLevel,
    colorTinted: flags.colorTinted,
    flow: resolvedFlow,
  }
}

function collectWidgetTagIdsInto(ids: Set<string>, widgets: { type?: string; bindings?: { tagId?: string }[]; animations?: { tagId?: string }[]; animationLinks?: { tagId?: string }[]; events?: { actions?: { type: string; tagId?: string }[] }[] }[]) {
  for (const w of widgets) {
    if (w.type === 'scene3d') continue
    for (const b of w.bindings ?? []) {
      if (b.tagId) ids.add(b.tagId)
    }
    for (const a of w.animations ?? []) {
      if (a.tagId) ids.add(a.tagId)
    }
    for (const link of w.animationLinks ?? []) {
      if (link.tagId) ids.add(link.tagId)
    }
    for (const e of w.events ?? []) {
      for (const action of e.actions ?? []) {
        if (action.type === 'writeTag' && action.tagId) ids.add(action.tagId)
      }
    }
  }
}

export function collectPage3DTagIds(
  page: Page3D,
  resolvePage2d?: (page2dId: string) => Page2D | null | undefined,
): string[] {
  const ids = new Set<string>()
  walkObject3dTree(page.objects, (obj) => {
    for (const b of obj.bindings ?? []) ids.add(b.tagId)
    for (const a of obj.animations ?? []) ids.add(a.tagId)
    for (const link of obj.animationLinks ?? []) ids.add(link.tagId)
    for (const e of obj.events ?? []) {
      for (const action of e.actions) {
        if (action.type === 'writeTag') ids.add(action.tagId)
      }
    }
    const page2dId = obj.panel?.page2dId?.trim()
    if (page2dId && resolvePage2d) {
      const page2d = resolvePage2d(page2dId)
      if (page2d) {
        for (const id of collectPageTagIds(page2d)) ids.add(id)
        return
      }
    }
    const panelWidgets = obj.panel?.widgets
    if (panelWidgets?.length) {
      collectWidgetTagIdsInto(ids, panelWidgets)
    } else {
      for (const item of obj.panel?.items ?? []) {
        if (item.tagId) ids.add(item.tagId)
      }
    }
  })
  return [...ids]
}
