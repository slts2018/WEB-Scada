import type {
  Object3DMaterial,
  Object3DNode,
  Object3DPanel,
  Object3DPanelItem,
  Transform3D,
} from '../types/project'
import {
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
  defaultPanelItemSize,
} from './panelLayout'
import { PRIMITIVE_SOURCE_SIZE_M } from './object3dSize'

/** 从现有 style 生成可编辑的默认材质覆盖 */
export function createDefaultObject3DMaterial(
  style?: Object3DNode['style'],
): Object3DMaterial {
  return {
    override: true,
    metalness: 0.1,
    roughness: 0.6,
    color: style?.color || '#3d8bfd',
    emissive: style?.emissive || '#000000',
    opacity: style?.opacity ?? 1,
    side: 'front',
  }
}

export type BuiltinPrimitive3D = 'box' | 'sphere' | 'cylinder' | 'arrow'

const DEFAULT_TRANSFORM: Transform3D = {
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}

const PRIMITIVE_META: Record<BuiltinPrimitive3D, { name: string; color: string }> = {
  box: { name: '立方体', color: '#3d8bfd' },
  sphere: { name: '球体', color: '#22c55e' },
  cylinder: { name: '圆柱', color: '#f59e0b' },
  /** 标注箭头：默认尖端朝下，可与面板搭配指向设备 */
  arrow: { name: '箭头', color: '#38bdf8' },
}

function newPanelItemId() {
  return `pi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/** 默认面板内容：文本 + 写值按钮（自由坐标） */
export function createDefaultObject3DPanel(title = '操作面板'): Object3DPanel {
  const labelSize = defaultPanelItemSize('label')
  const buttonSize = defaultPanelItemSize('button')
  return {
    title,
    width: DEFAULT_PANEL_CONTENT_WIDTH,
    height: DEFAULT_PANEL_CONTENT_HEIGHT,
    objectFit: 'none',
    items: [
      {
        id: newPanelItemId(),
        type: 'label',
        text: '文本',
        x: 10,
        y: 12,
        width: labelSize.width,
        height: labelSize.height,
      } satisfies Object3DPanelItem,
      {
        id: newPanelItemId(),
        type: 'button',
        text: '写值',
        tagId: '',
        writeValue: 1,
        confirm: true,
        x: 10,
        y: 48,
        width: buttonSize.width,
        height: buttonSize.height,
      } satisfies Object3DPanelItem,
    ],
  }
}

export function createObject3D(
  opts: {
    primitive?: BuiltinPrimitive3D
    modelResourceId?: string
    name?: string
    transform?: Partial<Transform3D>
    color?: string
    /** 跟镜头 HTML 面板 */
    panel?: Object3DPanel | true
  } = {},
): Object3DNode {
  const withPanel = opts.panel === true || (opts.panel && typeof opts.panel === 'object')
  const panel: Object3DPanel | undefined =
    opts.panel === true
      ? createDefaultObject3DPanel()
      : opts.panel && typeof opts.panel === 'object'
        ? opts.panel
        : undefined

  const primitive =
    opts.primitive ?? (opts.modelResourceId || withPanel ? undefined : 'box')
  const meta = withPanel
    ? { name: '面板', color: '#38bdf8' }
    : primitive
      ? PRIMITIVE_META[primitive]
      : { name: '模型', color: '#94a3b8' }
  const id = `o3d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  const defaultPos = withPanel
    ? ([0, 1.2, 0] as [number, number, number])
    : opts.primitive === 'arrow'
      ? ([0, 1.4, 0] as [number, number, number])
      : DEFAULT_TRANSFORM.position
  const defaultScale = withPanel
    ? ([0.35, 0.35, 0.35] as [number, number, number])
    : opts.primitive === 'arrow'
      ? ([0.55, 0.55, 0.55] as [number, number, number])
      : DEFAULT_TRANSFORM.scale
  // 箭头默认尖端朝下（本地 +Y 为尖），便于放在面板旁指向下方设备
  const defaultRot =
    opts.primitive === 'arrow' && !opts.transform?.rotation
      ? ([180, 0, 0] as [number, number, number])
      : DEFAULT_TRANSFORM.rotation

  const sourcePrimitive: BuiltinPrimitive3D | undefined = withPanel
    ? 'box'
    : primitive && primitive in PRIMITIVE_SOURCE_SIZE_M
      ? primitive
      : undefined

  return {
    id,
    name: opts.name ?? meta.name,
    // 面板用半透明小盒子作选中/拖拽锚点
    primitive: withPanel ? 'box' : primitive,
    modelResourceId: opts.modelResourceId,
    panel,
    // 上传模型的 sourceSize 在放置时测量；图元直接写米制几何尺寸
    sourceSize: opts.modelResourceId
      ? undefined
      : sourcePrimitive
        ? ([...PRIMITIVE_SOURCE_SIZE_M[sourcePrimitive]] as [number, number, number])
        : ([1, 1, 1] as [number, number, number]),
    sourceUnit: opts.modelResourceId ? 'mm' : 'm',
    transform: {
      position: [...(opts.transform?.position ?? defaultPos)] as [number, number, number],
      rotation: [...(opts.transform?.rotation ?? defaultRot)] as [number, number, number],
      scale: [...(opts.transform?.scale ?? defaultScale)] as [number, number, number],
    },
    style: {
      color: opts.color ?? meta.color,
      // 锚点不可见：HTML 面板才是外观；盒子仅用于点选/手柄
      opacity: withPanel ? 0 : 1,
    },
    visible: true,
    bindings: [],
    animations: [],
    animationLinks: [],
    events: [],
  }
}
