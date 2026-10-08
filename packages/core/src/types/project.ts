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
  scale: [number, number, number]
}

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

/** 3D 跟镜头面板内控件（自由坐标，类似 2D 图元） */
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
  items: Object3DPanelItem[]
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
  transform: Transform3D
  /** 颜色等样式 */
  style?: {
    color?: string
    opacity?: number
    /** colorStroke 等连接写入的发光色 */
    emissive?: string
  }
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
  /** IBL / RoomEnvironment 强度，默认 0.55 */
  environmentIntensity?: number
  /** 环境光强度，默认 0.45 */
  ambientIntensity?: number
  /** 是否开启太阳光（平行光），默认 true */
  sunEnabled?: boolean
  /** 太阳光强度，默认 1.05 */
  sunIntensity?: number
  /** 是否产生阴影，默认 true */
  shadowsEnabled?: boolean
  /** 阴影贴图边长，默认 1024 */
  shadowMapSize?: number
  /** 阴影偏移，默认 -0.0002 */
  shadowBias?: number
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
