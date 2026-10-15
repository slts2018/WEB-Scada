import type { AnimationRule } from './animation'
import type { AnimationLink } from './animationLink'
import type { PropBinding } from './binding'
import type { EventBinding } from './event'

export type PageType = '2d' | '3d'

export interface Transform2D {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface Transform3D {
  position: [number, number, number]
  /** 欧拉角，单位：度（写入 Three.js 时再转弧度） */
  rotation: [number, number, number]
  /**
   * Three.js 本地缩放倍率（相对 sourceSize）。
   * 属性栏「缩放」展示/编辑的是米制尺寸，不是该字段本身。
   */
  scale: [number, number, number]
}

/** 模型/图元几何在 scale=1 时的尺寸单位 */
export type Object3DSourceUnit = 'mm' | 'm'

/** 2D 图元 */
export interface Widget2D {
  id: string
  type: string
  name: string
  transform: Transform2D
  style: Record<string, unknown>
  props: Record<string, unknown>
  locked?: boolean
  visible?: boolean
  bindings: PropBinding[]
  /** @deprecated 请优先用 animationLinks（Flight 动画连接） */
  animations: AnimationRule[]
  /** Flight 风格动画连接 */
  animationLinks?: AnimationLink[]
  events: EventBinding[]
  scriptIds?: string[]
  /** type=group 时，子图元（相对 group 坐标） */
  children?: Widget2D[]
}

/**
 * 3D 跟镜头面板内控件（旧格式）。
 * @deprecated 请用 Object3DPanel.widgets（Widget2D 子集）；加载时会迁移。
 */
export interface Object3DPanelItem {
  id: string
  type: 'label' | 'value' | 'button' | 'image'
  /** 显示文案 / 按钮文字 */
  text?: string
  /** value / button 关联 Tag */
  tagId?: string
  /** button 写入的值 */
  writeValue?: string | number | boolean
  /** button 写前确认 */
  confirm?: boolean
  /** image：工程资源 id（kind=image|svg） */
  resourceId?: string
  /** 相对面板内容区左上角（px）；缺省时运行时按旧版流式兜底 */
  x?: number
  y?: number
  width?: number
  height?: number
  /** 字号（px）；缺省则按面板尺寸自动缩放 */
  fontSize?: number
  /** 文字颜色（CSS）；缺省用面板主题色 */
  color?: string
}

/** 3D 跟镜头操作面板（CSS2D，始终朝向相机） */
export interface Object3DPanel {
  title?: string
  /** 标题字号（px）；缺省则继承面板按尺寸算出的默认字号 */
  titleFontSize?: number
  /** 面板内容区宽度（px），默认 400 */
  width?: number
  /** 面板内容区高度（px，不含标题栏），默认 280 */
  height?: number
  /**
   * 面板内容填充方式（作用于面板内全部控件）
   * - none：原始大小（默认）
   * - contain：适应
   * - cover：裁剪铺满
   * - fill：拉伸铺满
   */
  objectFit?: 'none' | 'contain' | 'cover' | 'fill'
  /** 面板背景图（工程资源 id，kind=image|svg）；缺省为纯色底 */
  backgroundResourceId?: string
  /**
   * 嵌入的完整 2D 页面 id（工程 pages 中 type=2d）。
   * 有合法 page2dId 时，编辑/运行以该页为准。
   */
  page2dId?: string
  /**
   * 旧面板内联控件；仅兼容迁移，规范化后迁入 page2d 并清除。
   * @deprecated 使用 page2dId
   */
  widgets?: Widget2D[]
  /**
   * 更旧的控件列表；仅兼容读取，规范化后清除。
   * @deprecated 使用 page2dId
   */
  items?: Object3DPanelItem[]
}

/** 3D 材质贴图槽（工程图片资源 + UV） */
export interface Object3DTextureSlot {
  /** 工程 resources 中 kind=image|svg 的 id */
  resourceId: string
  /** UV 横向偏移，默认 0 */
  offsetU?: number
  /** UV 纵向偏移，默认 0 */
  offsetV?: number
  /** UV 横向重复/缩放，默认 1 */
  repeatU?: number
  /** UV 纵向重复/缩放，默认 1 */
  repeatV?: number
}

/**
 * 3D 对象材质覆盖（编辑器写入）。
 * override=true 时场景按此刷 MeshStandardMaterial，不再保留 GLTF 原材质外观。
 */
export interface Object3DMaterial {
  /** 用户在「编辑模型」中覆盖过材质 */
  override: boolean
  /** 0~1，默认 0.1 */
  metalness?: number
  /** 0~1，默认 0.6 */
  roughness?: number
  /** 漫反射色，如 #3d8bfd */
  color?: string
  /** 自发光色 */
  emissive?: string
  /** 0~1 */
  opacity?: number
  /** front=隐藏背面；double=双面 */
  side?: 'front' | 'double'
  maps?: {
    diffuse?: Object3DTextureSlot
    emissive?: Object3DTextureSlot
    metalness?: Object3DTextureSlot
    bump?: Object3DTextureSlot
  }
}

/**
 * 3D 对象的「液位层」配置（挂在液位层节点自身）。
 * 节点是一块液体图元；几何与两条动画连接（位移 Y + 缩放 Y）由 factory/object3dLiquid 生成。
 */
export interface Object3DLiquidLevel {
  /** 所属罐体对象 id */
  tankId: string
  /**
   * 液体生成方式：
   * - shape：复制罐体本身几何（可带模型），按世界水平面裁剪出液面 → **任意罐形自动贴合，零几何调参**（推荐）
   * - primitive：内置圆柱/长方体图元，用「位移 Y + 缩放 Y」两条连接从罐底往上长（轻量，适合规则罐）
   * 缺省按 primitive 处理（兼容早期数据）。
   */
  mode?: 'shape' | 'primitive'
  /**
   * 运行态解析出的液位（0~1），由 bindingEngine 每帧写入，仅内存、不落盘；
   * null = 变量缺失/质量差 → 隐藏液体。
   */
  level?: number | null
  /** 液位变量 */
  tagId: string
  /** 变量量程下限 → 0% */
  inMin: number
  /** 变量量程上限 → 100% */
  inMax: number
  /** 液体色 */
  color: string
  /** 液体不透明度 0~1 */
  opacity: number
  /** 液面形状：圆柱（圆罐）/ 长方体（方罐） */
  shape: 'cylinder' | 'box'
  /** 相对罐体内壁的内缩比例 0~0.25 */
  inset: number
}

/** 3D 场景对象 */
export interface Object3DNode {
  id: string
  name: string
  /** 内置图元（无模型时使用） */
  primitive?: 'box' | 'sphere' | 'cylinder' | 'arrow'
  /** 资源 id，指向工程 resources 中的模型（glb/gltf/obj/fbx/stl） */
  modelResourceId?: string
  /**
   * 跟镜头 HTML 面板。可与图元/模型并存；仅面板时仍用小盒子作选中锚点。
   */
  panel?: Object3DPanel
  /**
   * 液位层（由「添加液位」生成；普通对象不设置）。
   * 液位由两条动画连接（位移 Y + 缩放 Y）从罐底往上长，运行时沿用现有能力。
   */
  liquid?: Object3DLiquidLevel
  /**
   * 几何在 transform.scale=[1,1,1] 时的包围盒尺寸（sourceUnit 单位）。
   * 上传模型与内置图元默认均为米；可选 mm（少见）。
   */
  sourceSize?: [number, number, number]
  /** 缺省：m（模型与图元统一按米） */
  sourceUnit?: Object3DSourceUnit
  transform: Transform3D
  /** 颜色等样式 */
  style?: {
    color?: string
    opacity?: number
    /** colorStroke 等连接写入的发光色 */
    emissive?: string
  }
  /**
   * 材质覆盖（编辑模型对话框）。缺省或 override=false：图元用 style，模型保留原材质。
   */
  material?: Object3DMaterial
  /** 投射阴影，默认 true */
  castShadow?: boolean
  /** 接收阴影，默认 true */
  receiveShadow?: boolean
  visible?: boolean
  /** 设计端锁定：不可用手柄/属性改变换 */
  locked?: boolean
  bindings: PropBinding[]
  animations: AnimationRule[]
  /** Flight 风格动画连接子集（隐藏 / 色 / 位移映射 / 使能） */
  animationLinks?: AnimationLink[]
  events: EventBinding[]
  children?: Object3DNode[]
}

export interface Layer2D {
  id: string
  name: string
  visible: boolean
  locked: boolean
  widgets: Widget2D[]
}

/** 页面参考线（标尺拖出，对齐 Flight 辅助线） */
export interface GuideLine2D {
  id: string
  orientation: 'h' | 'v'
  pos: number
}

export interface Page2D {
  id: string
  type: '2d'
  name: string
  width: number
  height: number
  background?: string
  layers: Layer2D[]
  /** 页面持久参考线 */
  guides?: GuideLine2D[]
  scriptIds?: string[]
  /**
   * 用途：page=普通画面（页面树可见）；object3d-panel=跟镜头面板内容（隐藏于页面树/运行页签）。
   * 缺省视为 page。
   */
  usage?: 'page' | 'object3d-panel'
}

export interface Page3D {
  id: string
  type: '3d'
  name: string
  camera?: {
    position: [number, number, number]
    target: [number, number, number]
  }
  /**
   * 场景观感（环境/阳光/阴影等）。缺省字段用运行时默认值。
   */
  presentation?: Page3DPresentation
  objects: Object3DNode[]
  scriptIds?: string[]
}

/** 3D 页场景观感（可持久化；与设计/运行共用） */
export interface Page3DPresentation {
  /** 背景色，默认 #12151c */
  background?: string
  /**
   * 背景模式：color=纯色；hemi=浅色天空感（仍用 background 作主色调）。
   * 默认 color。
   */
  backgroundMode?: 'color' | 'hemi'
  /** IBL / RoomEnvironment 强度，默认 0.55 */
  environmentIntensity?: number
  /** 环境光强度，默认 0.45 */
  ambientIntensity?: number
  /** 是否开启太阳光（平行光），默认 true */
  sunEnabled?: boolean
  /** 太阳光强度，默认 1.05 */
  sunIntensity?: number
  /** 阳光水平角（度，绕 Y），默认 35 */
  sunAzimuthDeg?: number
  /** 阳光高度角（度，0=地平线 90=顶），默认 55 */
  sunElevationDeg?: number
  /** 是否产生阴影，默认 true */
  shadowsEnabled?: boolean
  /** 阴影贴图边长，默认 1024 */
  shadowMapSize?: number
  /** 阴影偏移，默认 -0.0002 */
  shadowBias?: number
  /** 地面网格，默认 true；运行端可用 query showGrid 覆盖 */
  gridVisible?: boolean
  /** 网格中心/主线颜色 */
  gridColor?: string
  /** 网格次线颜色 */
  gridDivisionColor?: string
  /** 阴影接收地面透明度 0–1，默认 0.32 */
  groundOpacity?: number
  /** 相机最小距离，默认 0.5 */
  cameraMinDistance?: number
  /** 相机最大距离，默认 500 */
  cameraMaxDistance?: number
  /** 俯仰下限（极角，度；0=顶视），默认 5 */
  cameraMinPolarDeg?: number
  /** 俯仰上限（极角，度；90≈平视），默认 89 */
  cameraMaxPolarDeg?: number
}

export type Page = Page2D | Page3D

export interface ProjectResource {
  id: string
  name: string
  kind: 'image' | 'svg' | 'model' | 'other'
  /** 相对工程资源目录的路径 */
  path: string
  mimeType?: string
}

export interface ScriptAsset {
  id: string
  name: string
  language: 'javascript'
  source: string
  /**
   * 页面挂载期间周期执行间隔（毫秒）。
   * 未设置或 < 100 时仅在进入页面时执行一次（runPageScripts）。
   */
  intervalMs?: number
  /** 是否启用周期调度；默认 true（仅当 intervalMs 有效时生效） */
  intervalEnabled?: boolean
}

/** 组合另存的可复用符号（工程内图元模板） */
export interface SymbolDefinition {
  id: string
  name: string
  /** 根图元快照（常为 group） */
  root: Widget2D
  createdAt: number
}

export interface ProjectMeta {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  version: string
  /**
   * 3D `transform.rotation` 单位。
   * 旧工程缺省（按弧度存）；normalize 时升为 `deg` 并换算数值。
   */
  transformRotationUnit?: 'deg' | 'rad'
}

/** 页面模板（工程内快照；从模板新建时重映射 id） */
export interface PageTemplate {
  id: string
  name: string
  /** 模板来源页面类型 */
  pageType: '2d' | '3d'
  page: Page
  createdAt: number
}

export interface ProjectDocument {
  meta: ProjectMeta
  pages: Page[]
  resources: ProjectResource[]
  scripts: ScriptAsset[]
  /** 符号库（阶段 A：组合另存为符号） */
  symbols: SymbolDefinition[]
  /** 页面模板 / 母版快照（阶段 E） */
  pageTemplates?: PageTemplate[]
  /** 首页 pageId */
  homePageId?: string
}
