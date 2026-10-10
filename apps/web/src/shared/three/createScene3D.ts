/**
 * Three.js 3D 场景：设计/运行共用底座。
 *
 * 设计端交互原则（尽量原生）：
 * - OrbitControls：左键旋转，中键平移，滚轮缩放；右键不绑定
 * - TransformControls：官方 connect + attach + 拖拽（不 disconnect、不自研轴拖）
 * - 点选：Raycaster；Shift/Ctrl+空白：框选（SelectionBox）
 * - 标注：官方 CSS2DRenderer
 * - 多选跟拖：在官方 objectChange 上做增量（业务薄封装）
 * - 渲染：按需 RAF（脏标记）；continuousRender 回退复用同一 tick
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BoxHelper,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  GridHelper,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  MOUSE,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type LOD,
  type Material,
  type Object3D,
  type Side,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { Object3DNode, Page3D, Page3DPresentation, Transform3D } from '@web-scada/core'
import { resolvePage3DPresentation } from '@web-scada/core'
import { isAdditivePointer, installPointerModifierTracker } from '@/shared/designer/designerHotkeys'
import { fitCameraToBox, unionObjectBoxes } from '@/shared/three/modelFit'
import { classifyRuntimeTap } from '@/shared/three/runtimeTapGate'
import { loadModelObject } from '@/shared/three/modelLoader'
import { applyScenePresentation } from '@/shared/three/scenePresentation'
import {
  buildObject3dPanelElement,
  disposePanelKonvaRuntime,
  panelRuntimeIsInteractive,
  ensureObject3dPanelStyles,
  refreshPanelKonvaVisuals,
  setObject3dPanelValues,
  type Object3dPanelDomHandlers,
  type PanelWidgetRuntimeState,
} from '@/shared/three/object3dPanelUi'
import {
  applyObject3DMaterial,
  clearObject3DMaterialMaps,
} from '@/shared/three/object3dMaterialApply'
import type { EventBinding, EventTrigger, Page2D, TagValue, Widget2D } from '@web-scada/core'

export type TransformGizmoMode = 'translate' | 'rotate' | 'scale'

/** 运行端交互诊断信息（?diag3d=1 面板 / 排障用） */
export interface RuntimeInteractInfo {
  phase: 'down' | 'up'
  hitId: string | null
  /** 命中的对象是否有单击/双击事件或输入连接 */
  clickable: boolean
  /** 命中的对象是否有拖拽写值连接 */
  dragLinks: boolean
  pointerType?: string
  travelPx?: number
  orbitDeg?: number
  targetShiftRatio?: number
  verdict?: 'tap' | 'rotate' | 'none'
  fired?: boolean
  reason?: string
}

export interface Scene3DHandlers {
  onSelect?: (
    objectId: string | null,
    meta?: { additive?: boolean; ids?: string[] },
  ) => void
  onEmptyPointerDown?: (e: PointerEvent) => void
  onObjectClick?: (objectId: string) => void
  onObjectDblClick?: (objectId: string) => void
  /** 运行端：对象是否有单击/写值等交互（用于轻点候选，不改变 Orbit 键位） */
  isObjectClickable?: (objectId: string) => boolean
  /** 运行端交互诊断（轻点 / 旋转判定过程） */
  onRuntimeInteract?: (info: RuntimeInteractInfo) => void
  onTransformCommit?: (objectId: string, transform: Transform3D) => void
  onTransformsCommit?: (patches: Record<string, Transform3D>) => void
  resolveDragLinks?: (objectId: string) => {
    h?: { tagId: string; inMin: number; inMax: number; outMin: number; outMax: number }
    v?: { tagId: string; inMin: number; inMax: number; outMin: number; outMax: number }
    d?: { tagId: string; inMin: number; inMax: number; outMin: number; outMax: number }
  } | null
  onDragWrite?: (
    objectId: string,
    axis: 'h' | 'v' | 'd',
    tagId: string,
    value: number,
  ) => void
  /** 运行端：面板按钮（兼容） */
  onPanelButton?: (objectId: string, widget: Widget2D) => void
  /** 运行端：面板 Konva 图元事件（与 2D runtime 对齐） */
  onPanelWidgetEvent?: (
    objectId: string,
    widgetId: string,
    trigger: EventTrigger,
    events: EventBinding[],
  ) => void
  onPanelAnimationInput?: (objectId: string, widgetId: string) => void
  onPanelDragWrite?: (
    objectId: string,
    widgetId: string,
    axis: 'h' | 'v',
    tagId: string,
    value: number,
  ) => void
  /** 设计端：双击面板打开编辑器 */
  onPanelEdit?: (objectId: string) => void
  /** 解析面板绑定的 2D 页 */
  resolvePage2d?: (page2dId: string) => Page2D | null | undefined
  /** 设计端：同步当前轨道焦点（新增物体落点） */
  onSpawnHint?: (hint: { x: number; y: number; z: number }) => void
}

export interface Scene3DOptions {
  enableGizmo?: boolean
  /** 设计端 CSS2D 对象名；默认不显示，可用「名」按钮打开 */
  enableLabels?: boolean
  /**
   * 地面网格。默认与 enableGizmo 一致：设计端开、运行端关。
   */
  showGrid?: boolean
  /**
   * 选中时是否发光（emissive 高亮）。
   * 默认与 enableGizmo 一致：设计端开、运行端关。
   */
  selectionHighlight?: boolean
  /**
   * 回退：空闲也持续 RAF。默认 false（设计/运行都按需）。
   * 与按需共用同一 tick，只把续帧条件视为恒 true，不另开循环。
   */
  continuousRender?: boolean
}

export interface Scene3DBundle {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  controls: OrbitControls
  setPage: (page: Page3D, resolveModelUrl: (resourceId: string) => string | undefined) => Promise<void>
  /** 增量挂载（粘贴/新增），不清场景、不改相机 */
  mountObject: (
    node: Object3DNode,
    resolveModelUrl: (resourceId: string) => string | undefined,
    parentId?: string | null,
  ) => Promise<void>
  /** 增量卸载（删除），含子树 */
  unmountObjects: (objectIds: string[]) => void
  /** 清掉同 id 重复挂载的残影（粘贴竞态等） */
  pruneDuplicateRoots: (keepIds?: Set<string>) => void
  /** 调整父子（组合/解组），对象已在场景中时用 */
  reparentObject: (objectId: string, parentId: string | null) => void
  selectObject: (objectId: string | null, opts?: { gizmo?: boolean }) => void
  selectObjects: (objectIds: string[], opts?: { gizmo?: boolean }) => void
  applyVisual: (
    objectId: string,
    visual: Object3DNode,
    opts?: { applyModelColor?: boolean },
  ) => void
  setGizmoMode: (mode: TransformGizmoMode) => void
  getGizmoMode: () => TransformGizmoMode
  getObjectIds: () => string[]
  getSelectedObjectIds: () => string[]
  raycastAt: (clientX: number, clientY: number) => string | null
  /** 屏幕像素矩形（相对 canvas）→ 官方 SelectionBox */
  pickIdsInScreenRect: (rect: { x: number; y: number; width: number; height: number }) => string[]
  isGizmoDragging: () => boolean
  fitView: (objectIds?: string[]) => boolean
  /** 新增对象落点参考：当前轨道焦点在地面附近的 xz */
  getSpawnHint: () => { x: number; y: number; z: number }
  getObject3D: (objectId: string) => Object3D | undefined
  /** 应用页内相机默认视角 */
  applyPageCamera: (page: Page3D) => void
  /** 应用场景观感（环境/阳光/阴影） */
  applyPresentation: (pres?: Page3D['presentation']) => void
  setLabelsVisible: (visible: boolean) => void
  getLabelsVisible: () => boolean
  /** 重建单个对象的跟镜头面板 DOM（属性变更后） */
  syncPanel: (node: Object3DNode) => void
  /** 刷新面板内数值显示（旧 DOM）；Konva 请用 refreshPanel */
  setPanelValues: (
    objectId: string,
    values: Record<string, string | PanelWidgetRuntimeState>,
  ) => void
  /** 用 Tag 刷新面板 Konva 绑定视觉 */
  refreshPanel: (objectId: string, getTag: (id: string) => TagValue | undefined) => void
  /**
   * 请求下一帧绘制。绕过工厂改 scene 时必须手动调。
   * 多次调用合并到下一帧（最终一致，非每变必渲）。
   */
  invalidate: () => void
  getGizmoStatus: () => {
    enabled: boolean
    attached: boolean
    helperVisible: boolean
    helperInScene: boolean
    selectedId: string | null
    wanted: boolean
    mapHasSelected: boolean
    mapSize: number
    error: string | null
    lastPickId: string | null
    lastPointerNote: string
    pointerDownCount: number
    selectedPrimitive: string | null
  }
  dispose: () => void
}

const USER_DATA_ID = 'scadaObjectId'
const USER_DATA_ORIG_MAT = 'scadaOrigMat'

type OrigMatSnapshot = {
  color: Color
  opacity: number
  transparent: boolean
  emissive: Color
  metalness: number
  roughness: number
  side: Side
} | null

function cacheOriginalMaterials(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || mesh.userData[USER_DATA_ORIG_MAT]) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mesh.userData[USER_DATA_ORIG_MAT] = mats.map((m) => {
      const std = m as MeshStandardMaterial
      if (!std?.isMeshStandardMaterial) return null
      return {
        color: std.color.clone(),
        opacity: std.opacity,
        transparent: std.transparent,
        emissive: std.emissive.clone(),
        metalness: std.metalness,
        roughness: std.roughness,
        side: std.side,
      } satisfies NonNullable<OrigMatSnapshot>
    }) as OrigMatSnapshot[]
  })
}

function disposeObject3DResources(root: Object3D) {
  clearObject3DMaterialMaps(root)
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat?.dispose()
  })
}

function restoreOriginalMaterials(root: Object3D) {
  clearObject3DMaterialMaps(root)
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const cached = mesh.userData[USER_DATA_ORIG_MAT] as OrigMatSnapshot[] | undefined
    if (!cached) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mats.forEach((m, i) => {
      const std = m as MeshStandardMaterial
      const snap = cached[i]
      if (!std?.isMeshStandardMaterial || !snap) return
      std.color.copy(snap.color)
      std.opacity = snap.opacity
      std.transparent = snap.transparent
      std.emissive.copy(snap.emissive)
      std.metalness = snap.metalness
      std.roughness = snap.roughness
      std.side = snap.side
      std.map = null
      std.emissiveMap = null
      std.metalnessMap = null
      std.bumpMap = null
      std.needsUpdate = true
    })
  })
}

function applyNodeShadowFlags(root: Object3D, node: Object3DNode) {
  const cast = node.castShadow !== false
  const receive = node.receiveShadow !== false
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = cast
    mesh.receiveShadow = receive
  })
}

function applyTransform(obj: Object3D, node: Object3DNode) {
  const [px, py, pz] = node.transform.position
  const [rx, ry, rz] = node.transform.rotation
  const [sx, sy, sz] = node.transform.scale
  obj.position.set(px, py, pz)
  // 工程模型存度；Three.js Euler 用弧度
  obj.rotation.set(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz))
  obj.scale.set(sx, sy, sz)
  obj.visible = node.visible !== false
}

function readTransform(obj: Object3D): Transform3D {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [
      MathUtils.radToDeg(obj.rotation.x),
      MathUtils.radToDeg(obj.rotation.y),
      MathUtils.radToDeg(obj.rotation.z),
    ],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
  }
}

function setMeshColor(root: Object3D, color: string, opacity = 1) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material
    const apply = (m: MeshStandardMaterial) => {
      m.color = new Color(color)
      m.transparent = opacity < 1
      m.opacity = opacity
      m.needsUpdate = true
    }
    if (Array.isArray(mat)) {
      for (const item of mat) {
        if ((item as MeshStandardMaterial).isMeshStandardMaterial) apply(item as MeshStandardMaterial)
      }
    } else if ((mat as MeshStandardMaterial)?.isMeshStandardMaterial) {
      apply(mat as MeshStandardMaterial)
    }
  })
}

/** 只改透明度，不碰顶点色/贴图色（GLTF 闪烁用） */
function setMeshOpacity(root: Object3D, opacity: number) {
  const o = Math.min(1, Math.max(0, opacity))
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as MeshStandardMaterial
      if (!std?.isMeshStandardMaterial) continue
      std.transparent = o < 1
      std.opacity = o
      std.needsUpdate = true
    }
  })
}

function setMeshEmissive(root: Object3D, emissive: string | null) {
  const color = emissive ? new Color(emissive) : new Color(0x000000)
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as MeshStandardMaterial
      if (std.isMeshStandardMaterial) {
        std.emissive = color.clone()
      }
    }
  })
}

function createPrimitiveMesh(node: Object3DNode): Object3D {
  // 纯面板 / 组合父节点：方块只作射线/手柄锚点，默认不画出来
  const panelAnchorOnly = Boolean(node.panel) && !node.modelResourceId
  const groupAnchorOnly =
    !node.modelResourceId && (node.children?.length ?? 0) > 0 && (node.style?.opacity ?? 1) <= 0.01
  const anchorOnly = panelAnchorOnly || groupAnchorOnly
  const color = node.style?.color || '#3d8bfd'
  const opacity = anchorOnly ? 0 : (node.style?.opacity ?? 1)
  const material = new MeshStandardMaterial({
    color: new Color(color),
    transparent: opacity < 1 || anchorOnly,
    opacity,
    depthWrite: opacity >= 1 && !anchorOnly,
  })

  if (node.primitive === 'arrow' && !anchorOnly) {
    // 杆 + 锥：本地 +Y 为尖端；工程默认 rotation.x=180° 时尖端朝下
    const group = new Group()
    const shaft = new Mesh(new CylinderGeometry(0.08, 0.08, 0.7, 12), material)
    shaft.position.y = -0.15
    const tip = new Mesh(new ConeGeometry(0.22, 0.45, 16), material.clone())
    tip.position.y = 0.42
    group.add(shaft, tip)
    group.userData.scadaArrow = true
    return group
  }

  let geometry
  switch (node.primitive) {
    case 'sphere':
      geometry = new SphereGeometry(0.6, 32, 16)
      break
    case 'cylinder':
      geometry = new CylinderGeometry(0.45, 0.45, 1.2, 24)
      break
    case 'box':
    default:
      geometry = new BoxGeometry(1, 1, 1)
      break
  }
  const mesh = new Mesh(geometry, material)
  if (panelAnchorOnly) mesh.userData.scadaPanelAnchor = true
  return mesh
}

export function createScene3D(
  container: HTMLElement,
  handlers: Scene3DHandlers = {},
  options: Scene3DOptions = {},
): Scene3DBundle {
  const width = container.clientWidth || 640
  const height = container.clientHeight || 360
  const enableGizmo = options.enableGizmo === true
  if (enableGizmo) installPointerModifierTracker()
  const continuousRender = options.continuousRender === true
  const selectionHighlight = options.selectionHighlight ?? enableGizmo
  let labelsVisible = Boolean(options.enableLabels) && enableGizmo

  const scene = new Scene()
  scene.background = new Color(0x12151c)

  const camera = new PerspectiveCamera(50, width / height, 0.1, 10000)
  camera.position.set(6, 5, 8)

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height, false)
  container.style.position = 'relative'
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.overflow = 'hidden'
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.position = 'absolute'
  renderer.domElement.style.left = '0'
  renderer.domElement.style.top = '0'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  // 官方 CSS2D：对象名标注层（必须透明，且不可盖住布局）
  const labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(width, height)
  const labelEl = labelRenderer.domElement
  labelEl.style.position = 'absolute'
  labelEl.style.left = '0'
  labelEl.style.top = '0'
  labelEl.style.width = '100%'
  labelEl.style.height = '100%'
  labelEl.style.margin = '0'
  labelEl.style.padding = '0'
  labelEl.style.border = '0'
  labelEl.style.background = 'transparent'
  labelEl.style.pointerEvents = 'none'
  labelEl.style.overflow = 'hidden'
  labelEl.style.zIndex = '1'
  container.appendChild(labelEl)
  const labelMap = new Map<string, CSS2DObject>()
  const panelMap = new Map<string, CSS2DObject>()
  /** setPage / mountObject 写入，供面板图片解析 */
  let resolveResourceUrlFn: ((resourceId: string) => string | undefined) | undefined
  /** 材质贴图异步加载取消 */
  const materialApplyCancel = new Map<string, () => void>()

  const controls = new OrbitControls(camera, renderer.domElement)
  // 组态操作要跟手：松手即停，不要惯性滑动
  controls.enableDamping = false
  controls.target.set(0, 0.5, 0)
  /**
   * 视角键位（设计端 / 运行端相同，不改键位）：
   * - 左键：旋转（运行端在松手且位移小时再判单击，不抢 Orbit）
   * - 中键：平移
   * - 滚轮：远近
   * - 右键：不绑定
   */
  type OrbitInternal = OrbitControls & {
    _onPointerDown: (ev: PointerEvent) => void
    disconnect: () => void
    connect: () => void
  }
  const orbit = controls as OrbitInternal
  orbit.disconnect()
  const orbitNativePointerDown = orbit._onPointerDown.bind(orbit)
  orbit._onPointerDown = (ev: PointerEvent) => {
    if (ev.button === 2) {
      ev.preventDefault()
      return
    }
    orbitNativePointerDown(ev)
  }
  orbit.connect()
  controls.mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.PAN,
    RIGHT: -1 as unknown as null,
  }

  const onBlockRightButton = (e: Event) => {
    if ((e as PointerEvent).button !== 2) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  for (const el of [renderer.domElement, container] as HTMLElement[]) {
    el.addEventListener('pointerdown', onBlockRightButton, true)
    el.addEventListener('mousedown', onBlockRightButton, true)
  }
  console.info('[scada-3d] orbit: 左键旋转 | 中键平移 | 滚轮远近 | 右键无')

  // 必须在 Orbit change 监听之前声明：presentation/限位若触发 update 会同步派发 change
  let dirty = false
  let lodDirty = false
  let orbitPointer = false

  const onOrbitStart = () => {
    orbitPointer = true
    invalidate()
  }
  const onOrbitEnd = () => {
    orbitPointer = false
    invalidate()
  }
  const onOrbitChange = () => {
    lodDirty = true
    invalidate()
  }
  controls.addEventListener('start', onOrbitStart)
  controls.addEventListener('end', onOrbitEnd)
  controls.addEventListener('change', onOrbitChange)

  // 定期把视角焦点同步给 store（新增物体落点），不 dirty 工程
  let spawnHintTimer: ReturnType<typeof setInterval> | null = null
  if (enableGizmo) {
    spawnHintTimer = setInterval(() => {
      handlers.onSpawnHint?.({
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      })
    }, 400)
  }

  const ambient = new AmbientLight(0xffffff, 0.45)
  scene.add(ambient)
  const dir = new DirectionalLight(0xffffff, 1.05)
  dir.position.set(8, 14, 6)
  scene.add(dir)

  /** 地面网格：颜色变更时重建；显隐由 presentation / options.showGrid 共同决定 */
  let gridHelper: GridHelper | null = null
  let gridSig = ''
  const syncGrid = (pres?: Page3DPresentation | null) => {
    const p = resolvePage3DPresentation(pres)
    const visible = options.showGrid ?? p.gridVisible
    const nextSig = `${p.gridColor}|${p.gridDivisionColor}`
    if (!gridHelper || gridSig !== nextSig) {
      if (gridHelper) {
        scene.remove(gridHelper)
        gridHelper.geometry.dispose()
        const gmat = gridHelper.material
        if (Array.isArray(gmat)) gmat.forEach((m) => m.dispose())
        else gmat.dispose()
        gridHelper = null
      }
      gridHelper = new GridHelper(20, 20, p.gridColor, p.gridDivisionColor)
      gridHelper.name = 'scada-grid'
      scene.add(gridHelper)
      gridSig = nextSig
    }
    gridHelper.visible = visible
  }
  syncGrid(null)

  // 阴影接收面（网格下方）
  const shadowFloor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.32 }))
  shadowFloor.rotation.x = -Math.PI / 2
  shadowFloor.position.y = -0.002
  shadowFloor.receiveShadow = true
  scene.add(shadowFloor)

  const presentation = applyScenePresentation(renderer, scene, dir, ambient, {
    shadowFloor,
    controls,
  })

  const root = new Group()
  root.name = 'scada-objects'
  scene.add(root)

  // 官方框选：只扫业务对象根，避开网格/灯光/手柄（API 类型写 Scene，运行只需 Object3D 树）
  const selectionBox = new SelectionBox(camera, root as unknown as Scene)

  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const nodeMap = new Map<string, Object3DNode>()
  const objectMap = new Map<string, Object3D>()
  /** 需每帧 lod.update(camera) */
  const lodList: LOD[] = []
  /** 防止 paste + sync 并发对同一 id 挂两份（移动/删除后会留下残影） */
  const mountingIds = new Set<string>()
  let selectedId: string | null = null
  let selectedIds: string[] = []
  let gizmoMode: TransformGizmoMode = 'translate'
  let raf = 0
  let disposed = false
  let suppressTimer: ReturnType<typeof setTimeout> | null = null
  let gizmoDragging = false
  let gizmoWanted = false
  let attachedObjectId: string | null = null
  let attachError: string | null = null
  let multiDragStarts: Map<
    string,
    { position: Vector3; rotation: Vector3; scale: Vector3 }
  > | null = null
  let primaryDragStart: { position: Vector3; rotation: Vector3; scale: Vector3 } | null = null

  let transformControls: TransformControls | null = null
  let gizmoHelper: Object3D | null = null
  /** 多选时手柄挂在选区中心（参考 Unity 等） */
  const selectionPivot = new Group()
  selectionPivot.name = '__scadaSelectionPivot'
  selectionPivot.userData.scadaInternal = true
  scene.add(selectionPivot)
  let pivotDragStart: {
    position: Vector3
    rotation: Vector3
    scale: Vector3
  } | null = null
  let multiWorldStarts: Map<string, Vector3> | null = null

  const snapshotLocal = (obj: Object3D) => ({
    position: obj.position.clone(),
    rotation: new Vector3(obj.rotation.x, obj.rotation.y, obj.rotation.z),
    scale: obj.scale.clone(),
  })

  const selectionWorldCenter = (ids: string[]) => {
    const box = new Box3()
    let any = false
    for (const id of ids) {
      const obj = objectMap.get(id)
      if (!obj) continue
      obj.updateMatrixWorld(true)
      const b = new Box3().setFromObject(obj)
      if (!b.isEmpty()) {
        box.union(b)
        any = true
      } else {
        const p = new Vector3()
        obj.getWorldPosition(p)
        box.expandByPoint(p)
        any = true
      }
    }
    if (!any || box.isEmpty()) return new Vector3()
    return box.getCenter(new Vector3())
  }

  const placeSelectionPivot = () => {
    const center = selectionWorldCenter(selectedIds)
    selectionPivot.position.copy(center)
    selectionPivot.rotation.set(0, 0, 0)
    selectionPivot.scale.set(1, 1, 1)
    selectionPivot.updateMatrixWorld(true)
  }

  if (enableGizmo) {
    // 官方用法：connect 保持开启，由 TC 自己处理手柄拖拽
    transformControls = new TransformControls(camera, renderer.domElement)
    transformControls.setMode('translate')
    transformControls.setSize(1.25)
    // 未选中时禁用，避免每次 pointerdown 都 setPointerCapture 干扰点选
    transformControls.enabled = false
    gizmoHelper = transformControls.getHelper()
    scene.add(gizmoHelper)

    transformControls.addEventListener('change', () => {
      updateSelectionHelpers()
      invalidate()
    })
    transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as { value?: boolean }).value)
      gizmoDragging = dragging
      controls.enabled = !dragging
      lodDirty = true
      updateSelectionHelpers()
      invalidate()
      if (dragging && selectedIds.length) {
        multiDragStarts = new Map()
        multiWorldStarts = new Map()
        for (const id of selectedIds) {
          const o = objectMap.get(id)
          if (!o) continue
          multiDragStarts.set(id, snapshotLocal(o))
          const wp = new Vector3()
          o.getWorldPosition(wp)
          multiWorldStarts.set(id, wp)
        }
        if (selectedIds.length > 1) {
          pivotDragStart = snapshotLocal(selectionPivot)
          primaryDragStart = null
        } else if (selectedId) {
          pivotDragStart = null
          const primary = objectMap.get(selectedId)
          primaryDragStart = primary ? snapshotLocal(primary) : null
        }
        lastPointerNote = `drag:${transformControls?.axis ?? '?'}`
      } else if (!dragging && selectedIds.length) {
        const patches: Record<string, Transform3D> = {}
        for (const id of selectedIds) {
          const o = objectMap.get(id)
          if (o) patches[id] = readTransform(o)
        }
        if (handlers.onTransformsCommit && Object.keys(patches).length) {
          handlers.onTransformsCommit(patches)
        } else if (selectedId) {
          const obj = objectMap.get(selectedId)
          if (obj) handlers.onTransformCommit?.(selectedId, readTransform(obj))
        }
        // 松手后把手柄重新钉到选区中心
        if (selectedIds.length > 1) placeSelectionPivot()
        multiDragStarts = null
        multiWorldStarts = null
        primaryDragStart = null
        pivotDragStart = null
        lastPointerNote = `idle`
        updateSelectionHelpers()
        invalidate()
      }
    })

    // 多选：手柄在中心枢轴；单选：原生拖主物体
    transformControls.addEventListener('objectChange', () => {
      lodDirty = true
      updateSelectionHelpers()
      invalidate()
      if (!gizmoDragging || !multiDragStarts) return

      if (selectedIds.length > 1 && pivotDragStart) {
        const dPos = selectionPivot.position.clone().sub(pivotDragStart.position)
        const dRot = new Vector3(
          selectionPivot.rotation.x - pivotDragStart.rotation.x,
          selectionPivot.rotation.y - pivotDragStart.rotation.y,
          selectionPivot.rotation.z - pivotDragStart.rotation.z,
        )
        const sx = selectionPivot.scale.x / Math.max(1e-6, pivotDragStart.scale.x)
        const sy = selectionPivot.scale.y / Math.max(1e-6, pivotDragStart.scale.y)
        const sz = selectionPivot.scale.z / Math.max(1e-6, pivotDragStart.scale.z)
        const center = pivotDragStart.position.clone()
        const rotEuler = new Euler(dRot.x, dRot.y, dRot.z, 'XYZ')

        for (const id of selectedIds) {
          const o = objectMap.get(id)
          const start = multiDragStarts.get(id)
          const startWorld = multiWorldStarts?.get(id)
          if (!o || !start) continue

          if (gizmoMode === 'translate') {
            // 枢轴与多数对象同属场景根，局部位移可直接叠加
            o.position.copy(start.position).add(dPos)
          } else if (gizmoMode === 'rotate') {
            if (startWorld) {
              const offset = startWorld.clone().sub(center).applyEuler(rotEuler)
              o.position.copy(center.clone().add(offset))
            }
            o.rotation.set(
              start.rotation.x + dRot.x,
              start.rotation.y + dRot.y,
              start.rotation.z + dRot.z,
            )
          } else {
            o.scale.set(
              Math.max(1e-4, start.scale.x * sx),
              Math.max(1e-4, start.scale.y * sy),
              Math.max(1e-4, start.scale.z * sz),
            )
            if (startWorld) {
              const offset = startWorld.clone().sub(center)
              offset.x *= sx
              offset.y *= sy
              offset.z *= sz
              o.position.copy(center.clone().add(offset))
            }
          }
        }
        return
      }

      if (!selectedId || !primaryDragStart || selectedIds.length <= 1) return
      const primary = objectMap.get(selectedId)
      if (!primary) return
      const dPos = primary.position.clone().sub(primaryDragStart.position)
      const dRot = new Vector3(
        primary.rotation.x - primaryDragStart.rotation.x,
        primary.rotation.y - primaryDragStart.rotation.y,
        primary.rotation.z - primaryDragStart.rotation.z,
      )
      const dScale = new Vector3(
        primary.scale.x / Math.max(1e-6, primaryDragStart.scale.x),
        primary.scale.y / Math.max(1e-6, primaryDragStart.scale.y),
        primary.scale.z / Math.max(1e-6, primaryDragStart.scale.z),
      )
      for (const id of selectedIds) {
        if (id === selectedId) continue
        const o = objectMap.get(id)
        const start = multiDragStarts.get(id)
        if (!o || !start) continue
        if (gizmoMode === 'translate') {
          o.position.copy(start.position).add(dPos)
        } else if (gizmoMode === 'rotate') {
          o.rotation.set(
            start.rotation.x + dRot.x,
            start.rotation.y + dRot.y,
            start.rotation.z + dRot.z,
          )
        } else {
          o.scale.set(
            Math.max(1e-4, start.scale.x * dScale.x),
            Math.max(1e-4, start.scale.y * dScale.y),
            Math.max(1e-4, start.scale.z * dScale.z),
          )
        }
      }
    })
  }

  let lastPickId: string | null = null
  let lastPointerNote = 'idle'
  let pointerDownCount = 0
  let suppressOrbitUntil = 0
  /** fitView 期间关掉阻尼，结束后再恢复 */
  let restoreDampingAfterSuppress = false
  let selectionHelpers: BoxHelper[] = []

  const clearSelectionHelpers = () => {
    for (const h of selectionHelpers) {
      scene.remove(h)
      h.geometry.dispose()
      ;(h.material as Material).dispose()
    }
    selectionHelpers = []
  }

  const updateSelectionHelpers = () => {
    for (const h of selectionHelpers) h.update()
  }

  const syncSelectionHelpers = (ids: string[]) => {
    clearSelectionHelpers()
    // 运行端无选中框：仅设计端（selectionHighlight）显示黄框
    if (!selectionHighlight || !ids.length) {
      invalidate()
      return
    }
    for (const id of ids) {
      const obj = objectMap.get(id)
      if (!obj) continue
      const h = new BoxHelper(obj, 0xffcc33)
      scene.add(h)
      selectionHelpers.push(h)
    }
    invalidate()
  }

  const setRayFromEvent = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    camera.updateMatrixWorld()
    raycaster.setFromCamera(pointer, camera)
    return true
  }

  /** 点选：仅 Raycaster（Three 基础能力） */
  const pickObjectAtClient = (
    clientX: number,
    clientY: number,
  ): { id: string; distance: number } | null => {
    if (!setRayFromEvent(clientX, clientY)) {
      lastPickId = null
      return null
    }
    root.updateMatrixWorld(true)
    const targets = [...objectMap.values()]
    const hits = targets.length ? raycaster.intersectObjects(targets, true) : []
    for (const hit of hits) {
      let cur: Object3D | null = hit.object
      while (cur && !cur.userData[USER_DATA_ID]) cur = cur.parent
      const id = cur?.userData[USER_DATA_ID] as string | undefined
      if (!id || nodeMap.get(id)?.visible === false) continue
      lastPickId = id
      return { id, distance: hit.distance }
    }
    lastPickId = null
    return null
  }

  const clearLabels = () => {
    for (const lab of labelMap.values()) {
      lab.parent?.remove(lab)
      lab.element.remove()
    }
    labelMap.clear()
  }

  const clearPanels = () => {
    for (const pan of panelMap.values()) {
      if (pan.element instanceof HTMLElement) {
        disposePanelKonvaRuntime(pan.element)
      }
      pan.parent?.remove(pan)
      pan.element.remove()
    }
    panelMap.clear()
  }

  const removePanel = (objectId: string) => {
    const pan = panelMap.get(objectId)
    if (!pan) return
    if (pan.element instanceof HTMLElement) {
      disposePanelKonvaRuntime(pan.element)
    }
    pan.parent?.remove(pan)
    pan.element.remove()
    panelMap.delete(objectId)
  }

  const panelDomHandlers = (): Object3dPanelDomHandlers => ({
    designerMode: enableGizmo,
    resolveResourceUrl: (resourceId) => resolveResourceUrlFn?.(resourceId),
    resolvePage2d: (page2dId) => handlers.resolvePage2d?.(page2dId),
    onSelect: (objectId) => {
      handlers.onSelect?.(objectId)
    },
    onEdit: (objectId) => {
      handlers.onPanelEdit?.(objectId)
    },
    onButton: (objectId, item) => {
      handlers.onPanelButton?.(objectId, item)
    },
    onWidgetEvent: (objectId, widgetId, trigger, events) => {
      handlers.onPanelWidgetEvent?.(objectId, widgetId, trigger, events)
    },
    onAnimationInput: (objectId, widgetId) => {
      handlers.onPanelAnimationInput?.(objectId, widgetId)
    },
    onDragWrite: (objectId, widgetId, axis, tagId, value) => {
      handlers.onPanelDragWrite?.(objectId, widgetId, axis, tagId, value)
    },
  })

  const syncPanelGizmoPass = () => {
    if (!enableGizmo) return
    ensureObject3dPanelStyles()
    // 手柄开启时所有面板内容穿透（大面板会盖住轴手柄）；标题仍可点选
    const pass = gizmoWanted
    for (const [, pan] of panelMap) {
      const el = pan.element
      if (!(el instanceof HTMLElement)) continue
      const panelEl =
        el.classList.contains('scada-3d-panel')
          ? el
          : el.querySelector('.scada-3d-panel')
      if (panelEl instanceof HTMLElement) {
        panelEl.classList.toggle('scada-3d-panel--pass-gizmo', pass)
      }
    }
  }

  /** 参考视距：约等于默认相机到原点距离，此时面板为设计稿像素大小 */
  const PANEL_WORLD_REF_DIST = 10
  const _panelCamPos = new Vector3()
  const _panelWorldPos = new Vector3()

  /**
   * CSS2D 按距离缩放，近大远小（参考视距时为设计稿像素大小）。
   * 必须用 zoom，不能用 transform:scale：后者先按设计稿栅格化再拉伸，近处字体会糊。
   */
  const updatePanelWorldScales = () => {
    if (panelMap.size === 0) return
    camera.getWorldPosition(_panelCamPos)
    for (const [, pan] of panelMap) {
      const wrap = pan.element.querySelector(
        '.scada-3d-panel__world-scale',
      ) as HTMLElement | null
      if (!wrap) continue
      pan.getWorldPosition(_panelWorldPos)
      const dist = Math.max(0.35, _panelWorldPos.distanceTo(_panelCamPos))
      const s = PANEL_WORLD_REF_DIST / dist
      if (Math.abs(s - 1) < 0.001) {
        wrap.style.zoom = ''
        wrap.style.transform = ''
      } else {
        // zoom 会按新尺寸重排/重绘文字，底边中心仍由 CSS2D center(0.5,1) 对齐锚点
        wrap.style.zoom = String(s)
        wrap.style.transform = ''
      }
    }
  }

  /**
   * 运行端：没有可点控件的「纯展示面板」整块穿透。
   * 面板内容区是 Konva 画布（pointer-events:auto），不透传时会挡住模型单击与左键旋转，
   * 表现为「面板盖住的那块区域点了没反应、也转不了视角」。
   */
  const applyRuntimePanelPassthrough = (host: HTMLElement) => {
    if (enableGizmo) return
    if (panelRuntimeIsInteractive(host)) return
    const targets: HTMLElement[] = []
    if (host instanceof HTMLElement) targets.push(host)
    for (const sel of ['.scada-3d-panel', '.scada-3d-panel__title', '.scada-3d-panel__stage']) {
      const found = host.querySelector(sel)
      if (found instanceof HTMLElement) targets.push(found)
    }
    for (const el of targets) el.style.pointerEvents = 'none'
  }

  const attachPanel = (node: Object3DNode, obj: Object3D) => {
    removePanel(node.id)
    if (!node.panel || node.visible === false) return
    try {
      const el = buildObject3dPanelElement(node, panelDomHandlers())
      applyRuntimePanelPassthrough(el)
      const pan = new CSS2DObject(el)
      // 底边中心对齐锚点上方（CSS2D center：0.5/1 = 水平中、垂直底）
      pan.center.set(0.5, 1)
      pan.position.set(0, 0.55, 0)
      obj.add(pan)
      panelMap.set(node.id, pan)
      syncPanelGizmoPass()
      updatePanelWorldScales()
    } catch (err) {
      console.error('[createScene3D] attachPanel failed', node.id, err)
    }
  }

  const syncPanel = (node: Object3DNode) => {
    nodeMap.set(node.id, node)
    const obj = objectMap.get(node.id)
    if (!obj) return
    attachPanel(node, obj)
    invalidate()
  }

  const setPanelValues = (
    objectId: string,
    values: Record<string, string | PanelWidgetRuntimeState>,
  ) => {
    const pan = panelMap.get(objectId)
    if (!pan || !(pan.element instanceof HTMLElement)) return
    setObject3dPanelValues(pan.element, values)
  }

  const refreshPanel = (
    objectId: string,
    getTag: (id: string) => TagValue | undefined,
  ) => {
    const pan = panelMap.get(objectId)
    if (!pan || !(pan.element instanceof HTMLElement)) return
    refreshPanelKonvaVisuals(pan.element, getTag)
  }

  const rebuildLabels = () => {
    clearLabels()
    if (!labelsVisible) return
    try {
      for (const [id, obj] of objectMap) {
        const node = nodeMap.get(id)
        if (node?.visible === false) continue
        // 有面板时用面板标题，不再叠一层对象名
        if (node?.panel) continue
        const el = document.createElement('div')
        el.className = 'scada-3d-label'
        el.textContent = node?.name?.trim() || id.slice(-6)
        const lab = new CSS2DObject(el)
        obj.updateMatrixWorld(true)
        const box = new Box3().setFromObject(obj)
        if (!box.isEmpty()) {
          const center = new Vector3()
          const size = new Vector3()
          box.getCenter(center)
          box.getSize(size)
          const world = center.clone()
          world.y += size.y * 0.5 + 0.12
          obj.worldToLocal(world)
          if ([world.x, world.y, world.z].every(Number.isFinite)) {
            lab.position.copy(world)
          } else {
            lab.position.set(0, 0.8, 0)
          }
        } else {
          lab.position.set(0, 0.8, 0)
        }
        obj.add(lab)
        labelMap.set(id, lab)
      }
    } catch (err) {
      console.error('[createScene3D] rebuildLabels failed', err)
      clearLabels()
    }
  }

  const setLabelsVisible = (visible: boolean) => {
    labelsVisible = visible
    rebuildLabels()
    invalidate()
  }

  const clearObjects = () => {
    transformControls?.detach()
    attachedObjectId = null
    attachError = null
    clearSelectionHelpers()
    clearLabels()
    clearPanels()
    lodList.length = 0
    for (const cancel of materialApplyCancel.values()) cancel()
    materialApplyCancel.clear()
    while (root.children.length) {
      const child = root.children[0]
      root.remove(child)
      clearObject3DMaterialMaps(child)
      child.traverse((obj) => {
        const mesh = obj as Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
        }
      })
    }
    objectMap.clear()
    nodeMap.clear()
  }

  const highlight = (ids: string[]) => {
    if (!selectionHighlight) return
    const set = new Set(ids)
    for (const [oid, obj] of objectMap) {
      const node = nodeMap.get(oid)
      // 面板 / 不可见组合锚点不发光
      if (node?.panel && !node.modelResourceId) continue
      if (
        !node?.modelResourceId &&
        (node?.children?.length ?? 0) > 0 &&
        (node?.style?.opacity ?? 1) <= 0.01
      ) {
        continue
      }
      const on = set.has(oid)
      const base = node?.style?.emissive
      const color = on ? new Color(0x886622) : base ? new Color(base) : new Color(0x000000)
      obj.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const std = m as MeshStandardMaterial
          if (std.isMeshStandardMaterial) {
            std.emissive = color.clone()
            std.emissiveIntensity = on ? 0.85 : 1
          }
        }
      })
    }
    invalidate()
  }

  const selectionIsPanelOnly = () => {
    if (!selectedIds.length) return false
    return selectedIds.every((id) => {
      const n = nodeMap.get(id)
      return Boolean(n?.panel) && !n?.modelResourceId
    })
  }

  /** 面板对象仅允许平移手柄（旋转/缩放对 CSS2D 面板无意义） */
  const clampGizmoModeForSelection = (mode: TransformGizmoMode): TransformGizmoMode => {
    if ((mode === 'rotate' || mode === 'scale') && selectionIsPanelOnly()) {
      return 'translate'
    }
    return mode
  }

  const attachGizmo = (objectId: string | null) => {
    try {
      if (!transformControls || !gizmoHelper) {
        attachedObjectId = null
        attachError = 'no-controls'
        return
      }
      transformControls.detach()
      attachedObjectId = null

      if (!objectId || !selectedIds.length) {
        // 未挂对象时必须禁用：否则 TC 每次 pointerdown 都会 setPointerCapture，干扰点选
        transformControls.enabled = false
        attachError = null
        return
      }

      gizmoMode = clampGizmoModeForSelection(gizmoMode)

      if (gizmoHelper.parent !== scene) scene.add(gizmoHelper)
      transformControls.enabled = true
      transformControls.setMode(gizmoMode)
      // 多选枢轴用世界空间，便于手柄停在几何中心
      transformControls.setSpace(
        selectedIds.length > 1 || gizmoMode !== 'scale' ? 'world' : 'local',
      )

      if (selectedIds.length > 1) {
        placeSelectionPivot()
        transformControls.attach(selectionPivot)
        if (transformControls.object !== selectionPivot) {
          attachedObjectId = null
          transformControls.enabled = false
          attachError = 'tc.pivot未生效'
          return
        }
        attachedObjectId = objectId
        attachError = null
        return
      }

      const obj = objectMap.get(objectId)
      if (!obj) {
        transformControls.enabled = false
        attachError = `map无此id(size=${objectMap.size})`
        return
      }
      if (!obj.parent) root.add(obj)
      transformControls.setSpace(gizmoMode === 'scale' ? 'local' : 'world')
      obj.updateMatrixWorld(true)
      transformControls.attach(obj)

      if (transformControls.object !== obj) {
        attachedObjectId = null
        transformControls.enabled = false
        attachError = 'tc.object未生效'
        return
      }
      attachedObjectId = objectId
      attachError = null
    } finally {
      syncPanelGizmoPass()
    }
  }

  const applyPageCamera = (page: Page3D) => {
    const cam = page.camera
    if (!cam) return
    const [px, py, pz] = cam.position
    const [tx, ty, tz] = cam.target
    if (![px, py, pz, tx, ty, tz].every(Number.isFinite)) return
    camera.position.set(px, py, pz)
    controls.target.set(tx, ty, tz)
    controls.update()
  }

  const mountNode = async (
    node: Object3DNode,
    resolveModelUrl: (resourceId: string) => string | undefined,
    parent: Object3D = root,
  ) => {
    if (objectMap.has(node.id)) return
    nodeMap.set(node.id, node)
    let obj: Object3D
    if (node.modelResourceId) {
      const url = resolveModelUrl(node.modelResourceId)
      if (url) {
        try {
          const detail = await loadModelObject(url)
          // await 期间另一路可能已挂上同 id：丢弃本份，避免「粘贴残影」
          if (objectMap.has(node.id)) {
            disposeObject3DResources(detail)
            return
          }
          // 设计/运行均不用距离 LOD：拉远变代理盒会影响组态观感（管道变成大方块）。
          // 仍须包一层 Group：prepareModelRoot 的居中写在 detail.position 上，
          // 若直接 applyTransform(detail) 会冲掉居中，CAD 管道会跑到远处看起来像「不显示」
          const wrap = new Group()
          wrap.userData.focusRoot = detail
          wrap.add(detail)
          obj = wrap
        } catch {
          obj = createPrimitiveMesh({ ...node, primitive: 'box' })
        }
      } else {
        obj = createPrimitiveMesh({ ...node, primitive: node.primitive ?? 'box' })
      }
    } else {
      obj = createPrimitiveMesh(node)
    }
    if (objectMap.has(node.id)) {
      disposeObject3DResources(obj)
      return
    }
    obj.userData[USER_DATA_ID] = node.id
    applyTransform(obj, node)
    // 外购模型保持 frustumCulled=false（包围球不准时整模会被裁掉）
    const keepFrustumOff = Boolean(node.modelResourceId)
    obj.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) mesh.frustumCulled = !keepFrustumOff
    })
    applyNodeShadowFlags(obj, node)
    parent.add(obj)
    objectMap.set(node.id, obj)
    if (node.modelResourceId) cacheOriginalMaterials(obj)

    if (node.panel && !node.modelResourceId) {
      // 已有工程里面板锚点可能仍是半透明；强制隐藏外观
      setMeshOpacity(obj, 0)
    } else if (node.material?.override) {
      // 同签名重复应用不会取消进行中的贴图加载（内部处理）
      const cancel = applyObject3DMaterial(
        obj,
        node.material,
        (id) => resolveModelUrl(id) ?? resolveResourceUrlFn?.(id),
        () => invalidate(),
      )
      materialApplyCancel.set(node.id, cancel)
    } else if (node.style?.color && !node.modelResourceId) {
      setMeshColor(obj, node.style.color, node.style.opacity ?? 1)
    }
    attachPanel(node, obj)
    // 按需渲染：挂上对象后必须刷一帧，否则要等拖拽/滚轮才看得见（远程慢加载时像黑屏）
    invalidate()
    for (const child of node.children ?? []) {
      await mountNode(child, resolveModelUrl, obj)
    }
  }

  const selectObjects = (objectIds: string[], opts?: { gizmo?: boolean }) => {
    selectedIds = [...objectIds]
    selectedId = objectIds[0] ?? null
    highlight(selectedIds)
    controls.enabled = !gizmoDragging
    gizmoMode = clampGizmoModeForSelection(gizmoMode)
    const nodeLocked = selectedId ? Boolean(nodeMap.get(selectedId)?.locked) : false
    gizmoWanted =
      enableGizmo && Boolean(selectedId) && opts?.gizmo !== false && !nodeLocked
    if (gizmoWanted) attachGizmo(selectedId)
    else attachGizmo(null)
    syncPanelGizmoPass()
    // 每个选中对象都画黄框（多选时不能只框主对象）
    syncSelectionHelpers(selectedIds)
    invalidate()
  }

  const setPage = async (
    page: Page3D,
    resolveModelUrl: (resourceId: string) => string | undefined,
  ) => {
    resolveResourceUrlFn = resolveModelUrl
    clearObjects()
    selectedId = null
    selectedIds = []
    gizmoWanted = false
    presentation.apply(page.presentation)
    syncGrid(page.presentation)
    applyPageCamera(page)
    for (const node of page.objects) {
      try {
        await mountNode(node, resolveModelUrl)
      } catch (err) {
        console.error('[createScene3D] mountNode failed', node.id, err)
        // 单对象失败不拖垮整页：落一个占位盒子
        try {
          const fallback = createPrimitiveMesh({ ...node, primitive: 'box', modelResourceId: undefined })
          fallback.userData[USER_DATA_ID] = node.id
          applyTransform(fallback, node)
          root.add(fallback)
          objectMap.set(node.id, fallback)
          nodeMap.set(node.id, node)
          invalidate()
        } catch {
          /* ignore */
        }
      }
    }
    highlight([])
    rebuildLabels()
    lodDirty = true
    invalidate()
    // 布局/资源晚到时再刷一帧，避免首屏一直黑到用户交互才画
    requestAnimationFrame(() => {
      if (disposed) return
      invalidate()
    })
  }

  const mountObject = async (
    node: Object3DNode,
    resolveModelUrl: (resourceId: string) => string | undefined,
    parentId?: string | null,
  ) => {
    resolveResourceUrlFn = resolveModelUrl
    if (disposed || objectMap.has(node.id) || mountingIds.has(node.id)) return
    mountingIds.add(node.id)
    try {
      if (objectMap.has(node.id)) return
      const parent =
        parentId == null || parentId === ''
          ? root
          : objectMap.get(parentId)
      if (parentId && !parent) {
        console.warn('[createScene3D] mountObject parent missing', parentId, node.id)
        return
      }
      try {
        await mountNode(node, resolveModelUrl, parent ?? root)
      } catch (err) {
        console.error('[createScene3D] mountObject failed', node.id, err)
        return
      }
      rebuildLabels()
      lodDirty = true
      invalidate()
    } finally {
      mountingIds.delete(node.id)
    }
  }

  /** 清掉同 id 重复挂到 root 的残影（objectMap 只记最后一份时会发生） */
  const pruneDuplicateRoots = (keepIds?: Set<string>) => {
    const removeList: Object3D[] = []
    for (const child of [...root.children]) {
      const id = child.userData?.[USER_DATA_ID] as string | undefined
      if (!id) continue
      if (keepIds && !keepIds.has(id)) {
        removeList.push(child)
        continue
      }
      const canonical = objectMap.get(id)
      if (canonical && canonical !== child) removeList.push(child)
    }
    if (!removeList.length) return
    for (const obj of removeList) {
      const id = obj.userData?.[USER_DATA_ID] as string | undefined
      obj.parent?.remove(obj)
      disposeObject3DResources(obj)
      if (id && objectMap.get(id) === obj) {
        const lodIdx = lodList.indexOf(obj as LOD)
        if (lodIdx >= 0) lodList.splice(lodIdx, 1)
        removePanel(id)
        const lab = labelMap.get(id)
        if (lab) {
          lab.parent?.remove(lab)
          lab.element.remove()
          labelMap.delete(id)
        }
        objectMap.delete(id)
        nodeMap.delete(id)
      }
    }
    invalidate()
  }

  const unmountObjects = (objectIds: string[]) => {
    if (disposed || !objectIds.length) return
    const idSet = new Set(objectIds)
    const topIds: string[] = []
    for (const id of idSet) {
      const obj = objectMap.get(id)
      if (!obj) continue
      let covered = false
      let p: Object3D | null = obj.parent
      while (p) {
        const pid = p.userData?.[USER_DATA_ID] as string | undefined
        if (pid && idSet.has(pid)) {
          covered = true
          break
        }
        p = p.parent
      }
      if (!covered) topIds.push(id)
    }

    for (const id of topIds) {
      const obj = objectMap.get(id)
      if (!obj) continue
      const clearIds: string[] = []
      obj.traverse((o) => {
        const sid = o.userData?.[USER_DATA_ID] as string | undefined
        if (sid) clearIds.push(sid)
      })
      obj.parent?.remove(obj)
      disposeObject3DResources(obj)
      for (const sid of clearIds) {
        materialApplyCancel.get(sid)?.()
        materialApplyCancel.delete(sid)
        const mapped = objectMap.get(sid)
        if (mapped) {
          const lodIdx = lodList.indexOf(mapped as LOD)
          if (lodIdx >= 0) lodList.splice(lodIdx, 1)
        }
        removePanel(sid)
        const lab = labelMap.get(sid)
        if (lab) {
          lab.parent?.remove(lab)
          lab.element.remove()
          labelMap.delete(sid)
        }
        objectMap.delete(sid)
        nodeMap.delete(sid)
      }
    }

    // 删掉 canonical 后，同 id 的重复挂载残影也清掉
    pruneDuplicateRoots()

    if (selectedId && !objectMap.has(selectedId)) {
      selectedId = null
      selectedIds = selectedIds.filter((sid) => objectMap.has(sid))
      attachGizmo(null)
    }
    rebuildLabels()
    lodDirty = true
    invalidate()
  }

  const reparentObject = (objectId: string, parentId: string | null) => {
    const obj = objectMap.get(objectId)
    if (!obj) return
    const parent = parentId ? objectMap.get(parentId) : root
    if (parentId && !parent) return
    if (obj.parent === parent) return
    parent!.add(obj)
    invalidate()
  }

  const selectObject = (objectId: string | null, opts?: { gizmo?: boolean }) => {
    selectObjects(objectId ? [objectId] : [], opts)
    handlers.onSelect?.(objectId)
  }

  const applyVisual = (
    objectId: string,
    visual: Object3DNode,
    opts?: { applyModelColor?: boolean },
  ) => {
    const obj = objectMap.get(objectId)
    if (!obj) return
    nodeMap.set(objectId, visual)
    if (!gizmoDragging || selectedId !== objectId) {
      const [px, py, pz] = visual.transform.position
      const [rx, ry, rz] = visual.transform.rotation
      const [sx, sy, sz] = visual.transform.scale
      const rxRad = MathUtils.degToRad(rx)
      const ryRad = MathUtils.degToRad(ry)
      const rzRad = MathUtils.degToRad(rz)
      if (
        obj.position.x !== px ||
        obj.position.y !== py ||
        obj.position.z !== pz ||
        obj.rotation.x !== rxRad ||
        obj.rotation.y !== ryRad ||
        obj.rotation.z !== rzRad ||
        obj.scale.x !== sx ||
        obj.scale.y !== sy ||
        obj.scale.z !== sz
      ) {
        lodDirty = true
      }
      applyTransform(obj, visual)
    }
    const isModel = Boolean(visual.modelResourceId)
    const opacity = visual.style?.opacity
    applyNodeShadowFlags(obj, visual)

    if (visual.material?.override) {
      const cancel = applyObject3DMaterial(
        obj,
        visual.material,
        (id) => resolveResourceUrlFn?.(id),
        () => invalidate(),
      )
      materialApplyCancel.set(objectId, cancel)
      // 动画/绑定主动改色时叠在材质覆盖之上
      if (opts?.applyModelColor && visual.style?.color) {
        setMeshColor(obj, visual.style.color, visual.material.opacity ?? opacity ?? 1)
      }
      if (opts?.applyModelColor && visual.style?.emissive) {
        setMeshEmissive(obj, visual.style.emissive)
      }
    } else if (isModel && !opts?.applyModelColor) {
      // GLTF 默认不整模刷色；仅动画/绑定主动改色时 applyModelColor=true 才染色
      materialApplyCancel.get(objectId)?.()
      materialApplyCancel.delete(objectId)
      restoreOriginalMaterials(obj)
      if (opacity != null) setMeshOpacity(obj, opacity)
    } else if (visual.style?.color) {
      materialApplyCancel.get(objectId)?.()
      materialApplyCancel.delete(objectId)
      setMeshColor(obj, visual.style.color, opacity ?? 1)
    }

    if (!selectionHighlight || !selectedIds.includes(objectId)) {
      if (visual.material?.override) {
        // 已在上方处理 emissive；选中高亮关闭时保持材质自发光
      } else if (visual.style?.emissive) {
        setMeshEmissive(obj, visual.style.emissive)
      } else if (!isModel) {
        setMeshEmissive(obj, null)
      }
    } else {
      highlight(selectedIds)
    }
    // 名称变更时刷新对应标注
    if (labelsVisible && !visual.panel) {
      const lab = labelMap.get(objectId)
      if (lab) lab.element.textContent = visual.name?.trim() || objectId.slice(-6)
    }
    const pan = panelMap.get(objectId)
    if (visual.panel) {
      if (!pan) attachPanel(visual, obj)
      else pan.element.style.display = visual.visible === false ? 'none' : ''
    } else if (pan) {
      removePanel(objectId)
    }
    invalidate()
  }

  const setGizmoMode = (mode: TransformGizmoMode) => {
    gizmoMode = clampGizmoModeForSelection(mode)
    if (!transformControls) return
    if (gizmoWanted && selectedId) {
      attachGizmo(selectedId)
    } else {
      transformControls.setMode(gizmoMode)
      transformControls.setSpace(gizmoMode === 'scale' ? 'local' : 'world')
    }
    invalidate()
  }

  const raycastId = (clientX: number, clientY: number): string | null =>
    pickObjectAtClient(clientX, clientY)?.id ?? null

  /** 官方 SelectionBox：屏幕像素矩形 → NDC → 锥体命中 */
  const pickIdsInScreenRect = (rect: {
    x: number
    y: number
    width: number
    height: number
  }): string[] => {
    const w = renderer.domElement.clientWidth || 1
    const h = renderer.domElement.clientHeight || 1
    const x0 = (rect.x / w) * 2 - 1
    const x1 = ((rect.x + rect.width) / w) * 2 - 1
    const yTop = -(rect.y / h) * 2 + 1
    const yBot = -((rect.y + rect.height) / h) * 2 + 1
    selectionBox.startPoint.set(Math.min(x0, x1), Math.max(yTop, yBot), 0.5)
    selectionBox.endPoint.set(Math.max(x0, x1), Math.min(yTop, yBot), 0.5)
    root.updateMatrixWorld(true)
    const found = selectionBox.select() as Object3D[]
    const ids = new Set<string>()
    for (const mesh of found) {
      let cur: Object3D | null = mesh
      while (cur && !cur.userData[USER_DATA_ID]) cur = cur.parent
      const id = cur?.userData[USER_DATA_ID] as string | undefined
      if (!id || nodeMap.get(id)?.visible === false) continue
      ids.add(id)
    }
    return [...ids]
  }

  const fitView = (objectIds?: string[]): boolean => {
    const ids = objectIds?.length ? objectIds : [...objectMap.keys()]
    const objs = ids
      .map((id) => objectMap.get(id))
      .filter((o): o is Object3D => Boolean(o))
    if (!objs.length) {
      lastPointerNote = `focus:miss map=${objectMap.size}`
      return false
    }
    root.updateMatrixWorld(true)
    for (const o of objs) o.updateMatrixWorld(true)
    for (const lod of lodList) lod.update(camera)
    const box = unionObjectBoxes(objs)
    if (box.isEmpty()) {
      const center = objs[0].getWorldPosition(new Vector3())
      box.setFromCenterAndSize(center, new Vector3(1, 1, 1))
    }
    restoreDampingAfterSuppress = controls.enableDamping
    const ok = fitCameraToBox(camera, controls, box, { leaveDampingOff: true })
    if (ok) {
      suppressOrbitUntil = performance.now() + 1600
      lastPointerNote = `focus:${ids[0]?.slice(-6) ?? '?'}`
      if (suppressTimer) clearTimeout(suppressTimer)
      suppressTimer = setTimeout(() => {
        suppressTimer = null
        invalidate()
      }, 1600)
      lodDirty = true
      invalidate()
    } else {
      controls.enableDamping = restoreDampingAfterSuppress
      lastPointerNote = `focus:fail`
    }
    return ok
  }

  let runtimeDrag: {
    objectId: string
    axis: 'h' | 'v' | 'd'
    link: { tagId: string; inMin: number; inMax: number; outMin: number; outMax: number }
    startClientX: number
    startClientY: number
    startPos: Vector3
  } | null = null
  let suppressNextClick = false
  /**
   * 运行端轻点（键位不变）：
   * - 按下不拦 Orbit → 拖 = 照常左旋
   * - 松手时按「指针位移 + 相机是否真的转过去了」判定（runtimeTapGate）
   * - 轻点 → 还原相机微动 + 触发业务（确认框等本次指针序列结束再弹）
   * - 旋转 → 保留相机，不触发业务
   * - 有拖拽写连接时：越过拖拽阈值才抢走手势写值
   */
  type RuntimeTapState = {
    pointerId: number
    pointerType: string
    objectId: string
    x: number
    y: number
    camPos: Vector3
    camTarget: Vector3
    /** 已被拖拽写值等业务接管，不再作为轻点 */
    forcedGesture: boolean
  }
  let runtimeTap: RuntimeTapState | null = null
  /** 拖拽写值抢手势阈值：略大于轻点阈值，避免把轻微抖动当拖拽 */
  const RUNTIME_DRAG_STEAL_PX = 12
  let pendingRuntimeDrag: {
    pointerId: number
    objectId: string
    startClientX: number
    startClientY: number
    links: NonNullable<ReturnType<NonNullable<Scene3DHandlers['resolveDragLinks']>>>
  } | null = null
  let runtimeTapFired = false

  const mapDragOffsetToTag = (
    offset: number,
    link: { inMin: number; inMax: number; outMin: number; outMax: number },
  ) => {
    const spanOut = link.outMax - link.outMin || 1
    const t = Math.min(1, Math.max(0, (offset - link.outMin) / spanOut))
    return link.inMin + t * (link.inMax - link.inMin)
  }

  const toVec3 = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z })

  const noteRuntimeInteract = (info: RuntimeInteractInfo) => {
    try {
      handlers.onRuntimeInteract?.(info)
    } catch (err) {
      console.error('[scada-3d] onRuntimeInteract failed', err)
    }
  }

  const fireRuntimeTap = (objectId: string) => {
    if (runtimeTapFired) return
    runtimeTapFired = true
    // 等本次指针序列（pointerup → mouseup → click）彻底跑完再弹确认框，
    // 否则确认框可能被同一次手势的后续事件 / 焦点变化吞掉。
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        try {
          handlers.onObjectClick?.(objectId)
        } catch (err) {
          console.error('[scada-3d] onObjectClick failed', objectId, err)
        }
      }, 0)
    })
  }

  /** 结束 Orbit 对指定 pointer 的跟踪，避免单击后相机还粘着转 */
  const endOrbitPointer = (pointerId: number) => {
    const c = controls as OrbitControls & {
      state: number
      _pointers: number[]
      _onPointerUp: (ev: Event) => void
    }
    if (typeof c._onPointerUp === 'function' && Array.isArray(c._pointers) && c._pointers.includes(pointerId)) {
      try {
        c._onPointerUp(
          new PointerEvent('pointerup', {
            pointerId,
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        )
      } catch {
        /* ignore */
      }
    }
  }

  const finishRuntimeTapFromEvent = (e: PointerEvent) => {
    if (enableGizmo) return false
    const tap = runtimeTap
    if (!tap || tap.pointerId !== e.pointerId) return false
    runtimeTap = null
    pendingRuntimeDrag = null
    if (suppressNextClick || runtimeDrag) {
      suppressNextClick = false
      return true
    }

    const verdict = classifyRuntimeTap(
      { x: tap.x, y: tap.y, camPos: toVec3(tap.camPos), camTarget: toVec3(tap.camTarget) },
      {
        x: e.clientX,
        y: e.clientY,
        camPos: toVec3(camera.position),
        camTarget: toVec3(controls.target),
      },
      { pointerType: tap.pointerType, forcedGesture: tap.forcedGesture },
    )

    if (verdict.kind === 'gesture') {
      // 旋转：保留用户刚转到的视角，不触发业务
      suppressNextClick = true
      noteRuntimeInteract({
        phase: 'up',
        hitId: tap.objectId,
        clickable: true,
        dragLinks: false,
        pointerType: tap.pointerType,
        verdict: 'rotate',
        fired: false,
        travelPx: verdict.travelPx,
        orbitDeg: verdict.orbitDeg,
        targetShiftRatio: verdict.targetShiftRatio,
        reason: verdict.reason,
      })
      return true
    }

    // 轻点：把 Orbit 的微动还回去，再触发业务
    camera.position.copy(tap.camPos)
    controls.target.copy(tap.camTarget)
    controls.update()
    endOrbitPointer(e.pointerId)
    invalidate()
    suppressNextClick = true
    noteRuntimeInteract({
      phase: 'up',
      hitId: tap.objectId,
      clickable: true,
      dragLinks: false,
      pointerType: tap.pointerType,
      verdict: 'tap',
      fired: true,
      travelPx: verdict.travelPx,
      orbitDeg: verdict.orbitDeg,
      targetShiftRatio: verdict.targetShiftRatio,
      reason: verdict.reason,
    })
    fireRuntimeTap(tap.objectId)
    return true
  }

  const resolveDragAxis = (
    e: PointerEvent,
    links: NonNullable<ReturnType<NonNullable<Scene3DHandlers['resolveDragLinks']>>>,
  ): { axis: 'h' | 'v' | 'd'; link: NonNullable<(typeof links)['h']> } | null => {
    const count = Number(Boolean(links.h)) + Number(Boolean(links.v)) + Number(Boolean(links.d))
    let axis: 'h' | 'v' | 'd'
    if (count === 1) axis = links.h ? 'h' : links.v ? 'v' : 'd'
    else if (e.altKey && links.d) axis = 'd'
    else if (e.shiftKey && links.v) axis = 'v'
    else if (links.h) axis = 'h'
    else if (links.v) axis = 'v'
    else axis = 'd'
    const link = axis === 'h' ? links.h : axis === 'v' ? links.v : links.d
    if (!link) return null
    return { axis, link }
  }

  /**
   * 设计端点选（capture）：
   * - 命中手柄（官方 picker）：不拦截，交给 TransformControls
   * - 命中物体：当场选中，并 stopImmediatePropagation，避免 Orbit 抢同一 pointerdown
   * - Shift/Ctrl+空白：框选
   * - 普通空白左拖：Orbit 旋转
   *
   * 注意：手柄 depthTest=false 画在模型上面，但射线距离可能更远；
   * 因此必须先按 TC 官方 picker 判定手柄，不能先选物体再判手柄。
   */
  let orbitSuppressGesture = false
  let emptyClickAt: { x: number; y: number } | null = null
  /** 本轮指针已成功点选：禁止随后 empty-clear 冲掉选中 */
  let suppressEmptyClear = false

  /** 与 TransformControls 内部 hover 一致：用不可见 picker 判定轴 */
  const syncTransformControlsHover = (e: { clientX: number; clientY: number; button?: number }) => {
    if (!transformControls?.object || !transformControls.enabled) return
    if (transformControls.dragging) return
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    transformControls.pointerHover({
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      button: e.button ?? 0,
    } as unknown as PointerEvent)
  }

  const hitGizmo = (e: { clientX: number; clientY: number; button?: number }): boolean => {
    if (!transformControls?.object || !gizmoHelper?.visible || !transformControls.enabled) {
      return false
    }
    syncTransformControlsHover(e)
    if (transformControls.axis) return true

    // 兜底：可见手柄网格（极细线/箭头）
    if (!setRayFromEvent(e.clientX, e.clientY)) return false
    gizmoHelper.updateMatrixWorld(true)
    const hits = raycaster.intersectObject(gizmoHelper, true)
    for (const hit of hits) {
      let cur: Object3D | null = hit.object
      while (cur) {
        const anyCur = cur as Object3D & {
          tag?: string
          isTransformControlsPlane?: boolean
        }
        if (anyCur.isTransformControlsPlane || anyCur.tag === 'helper') break
        if (cur.name) return true
        cur = cur.parent
      }
    }
    return false
  }

  const restoreOrbitAfterGesture = () => {
    if (!enableGizmo) return
    orbitSuppressGesture = false
    controls.enableRotate = true
    controls.enablePan = true
    if (!gizmoDragging) controls.enabled = true
  }

  const applyDesignerPick = (
    e: {
      shiftKey: boolean
      ctrlKey: boolean
      metaKey: boolean
      getModifierState?: (k: string) => boolean
    },
    pickedId: string,
  ) => {
    const additive = isAdditivePointer(e)
    const ids = additive
      ? [pickedId, ...selectedIds.filter((id) => id !== pickedId)]
      : [pickedId]
    selectObjects(ids, { gizmo: true })
    handlers.onSelect?.(pickedId, { additive, ids })
    suppressEmptyClear = true
    emptyClickAt = null
    lastPointerNote = `pick:${pickedId.slice(-6)}${additive ? '+add' : ''}`
  }

  const onDesignerPointerDownCapture = (e: PointerEvent) => {
    if (!enableGizmo || e.button !== 0) return
    pointerDownCount += 1
    emptyClickAt = null
    suppressEmptyClear = false

    const onGizmo = hitGizmo(e)

    // 拖拽结束事件丢失时 dragging 会粘住；点选空白/物体时强制松开
    if (transformControls?.dragging && !onGizmo) {
      gizmoDragging = false
      controls.enabled = true
    }

    if (gizmoDragging || (transformControls?.dragging && onGizmo)) {
      controls.enableRotate = false
      controls.enablePan = false
      orbitSuppressGesture = true
      lastPointerNote = 'gizmo:drag'
      return
    }

    // 手柄优先：不 stopPropagation，让官方 TransformControls 收到 pointerdown
    if (onGizmo) {
      controls.enableRotate = false
      controls.enablePan = false
      orbitSuppressGesture = true
      lastPointerNote = `gizmo:${transformControls?.axis ?? 'hit'}`
      return
    }

    const additive = isAdditivePointer(e)
    const picked = pickObjectAtClient(e.clientX, e.clientY)
    if (picked) {
      controls.enableRotate = false
      controls.enablePan = false
      orbitSuppressGesture = true
      applyDesignerPick(e, picked.id)
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }

    if (additive) {
      controls.enableRotate = false
      controls.enablePan = false
      orbitSuppressGesture = true
      lastPointerNote = `marquee map=${objectMap.size}`
      handlers.onEmptyPointerDown?.(e)
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }

    controls.enableRotate = true
    controls.enablePan = true
    orbitSuppressGesture = false
    lastPointerNote = `orbit map=${objectMap.size}`
    emptyClickAt = { x: e.clientX, y: e.clientY }
  }

  const onDesignerPointerUp = (e: PointerEvent) => {
    if (!enableGizmo || e.button !== 0) return
    if (orbitSuppressGesture) restoreOrbitAfterGesture()

    if (!transformControls?.dragging) {
      gizmoDragging = false
      controls.enabled = true
    }

    if (suppressEmptyClear) {
      suppressEmptyClear = false
      emptyClickAt = null
      return
    }

    // 空白轻点 → 取消选中；空白拖旋转 → 吞掉随后 click，避免松手误选模型
    if (emptyClickAt) {
      const dx = e.clientX - emptyClickAt.x
      const dy = e.clientY - emptyClickAt.y
      emptyClickAt = null
      if (dx * dx + dy * dy >= 25) {
        suppressNextClick = true
        lastPointerNote = 'orbit-drag'
        return
      }
      if (!gizmoDragging) {
        selectObjects([])
        handlers.onSelect?.(null)
        lastPointerNote = 'empty-clear'
      }
    }
  }

  /** 单击兜底：capture 点选若被其它层干扰，click 再补一次 */
  const onDesignerClick = (e: MouseEvent) => {
    if (!enableGizmo || e.button !== 0) return
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    if (gizmoDragging || transformControls?.dragging) return
    if (hitGizmo(e)) return
    const picked = pickObjectAtClient(e.clientX, e.clientY)
    if (!picked) return
    const additive = isAdditivePointer(e)
    if (
      !additive &&
      selectedIds.length === 1 &&
      selectedIds[0] === picked.id &&
      transformControls?.object
    ) {
      return
    }
    applyDesignerPick(e, picked.id)
  }

  /**
   * 运行端：只记轻点候选，不拦 Orbit（左键旋转键位不变）。
   * 最终「轻点 or 旋转」在 pointerup 用 runtimeTapGate 判定。
   */
  const onRuntimePointerDown = (e: PointerEvent) => {
    if (enableGizmo || e.button !== 0) return
    if (!handlers.onObjectClick && !handlers.onDragWrite) return
    suppressNextClick = false
    runtimeTap = null
    pendingRuntimeDrag = null
    runtimeTapFired = false

    const picked = pickObjectAtClient(e.clientX, e.clientY)
    if (!picked) {
      noteRuntimeInteract({
        phase: 'down',
        hitId: null,
        clickable: false,
        dragLinks: false,
        pointerType: e.pointerType,
        reason: '未命中物体（空白处只旋转）',
      })
      return
    }

    const clickable =
      typeof handlers.isObjectClickable === 'function'
        ? handlers.isObjectClickable(picked.id)
        : Boolean(handlers.onObjectClick)

    let dragLinks: NonNullable<ReturnType<NonNullable<Scene3DHandlers['resolveDragLinks']>>> | null =
      null
    if (handlers.resolveDragLinks && handlers.onDragWrite) {
      dragLinks = handlers.resolveDragLinks(picked.id)
      if (dragLinks && !dragLinks.h && !dragLinks.v && !dragLinks.d) dragLinks = null
    }

    noteRuntimeInteract({
      phase: 'down',
      hitId: picked.id,
      clickable,
      dragLinks: Boolean(dragLinks),
      pointerType: e.pointerType,
    })

    if (!clickable && !dragLinks) return

    runtimeTap = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      objectId: picked.id,
      x: e.clientX,
      y: e.clientY,
      camPos: camera.position.clone(),
      camTarget: controls.target.clone(),
      forcedGesture: false,
    }

    if (dragLinks) {
      pendingRuntimeDrag = {
        pointerId: e.pointerId,
        objectId: picked.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        links: dragLinks,
      }
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (runtimeTap && runtimeTap.pointerId === e.pointerId && pendingRuntimeDrag) {
      const dx = e.clientX - runtimeTap.x
      const dy = e.clientY - runtimeTap.y
      if (dx * dx + dy * dy > RUNTIME_DRAG_STEAL_PX * RUNTIME_DRAG_STEAL_PX) {
        const resolved = resolveDragAxis(e, pendingRuntimeDrag.links)
        const obj = objectMap.get(pendingRuntimeDrag.objectId)
        if (resolved && obj) {
          // 拖拽写：打断 Orbit，进入写值拖
          runtimeTap.forcedGesture = true
          endOrbitPointer(e.pointerId)
          runtimeDrag = {
            objectId: pendingRuntimeDrag.objectId,
            axis: resolved.axis,
            link: resolved.link,
            startClientX: pendingRuntimeDrag.startClientX,
            startClientY: pendingRuntimeDrag.startClientY,
            startPos: obj.position.clone(),
          }
          controls.enabled = false
          suppressNextClick = true
          runtimeTap = null
          try {
            renderer.domElement.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }
        // 走 Orbit 旋转时保留 runtimeTap：松手要按相机位移判定是轻点还是旋转
        pendingRuntimeDrag = null
      }
    }
    if (!runtimeDrag) return
    const obj = objectMap.get(runtimeDrag.objectId)
    if (!obj) return
    const rect = renderer.domElement.getBoundingClientRect()
    const dist = Math.max(1, camera.position.distanceTo(obj.getWorldPosition(new Vector3())))
    const scale = (dist * 2) / Math.max(1, rect.height)
    const dx = (e.clientX - runtimeDrag.startClientX) * scale
    const dy = -(e.clientY - runtimeDrag.startClientY) * scale
    suppressNextClick = true
    const lo = Math.min(runtimeDrag.link.outMin, runtimeDrag.link.outMax)
    const hi = Math.max(runtimeDrag.link.outMin, runtimeDrag.link.outMax)
    if (runtimeDrag.axis === 'h') {
      obj.position.x = Math.min(hi, Math.max(lo, runtimeDrag.startPos.x + dx))
    } else if (runtimeDrag.axis === 'v') {
      obj.position.y = Math.min(hi, Math.max(lo, runtimeDrag.startPos.y + dy))
    } else {
      obj.position.z = Math.min(hi, Math.max(lo, runtimeDrag.startPos.z + dx))
    }
    lodDirty = true
    invalidate()
  }

  const onPointerUp = (e: PointerEvent) => {
    if (enableGizmo) return

    if (runtimeDrag) {
      try {
        renderer.domElement.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const obj = objectMap.get(runtimeDrag.objectId)
      if (obj) {
        const offset =
          runtimeDrag.axis === 'h'
            ? obj.position.x
            : runtimeDrag.axis === 'v'
              ? obj.position.y
              : obj.position.z
        const value = mapDragOffsetToTag(offset, runtimeDrag.link)
        handlers.onDragWrite?.(
          runtimeDrag.objectId,
          runtimeDrag.axis,
          runtimeDrag.link.tagId,
          value,
        )
      }
      runtimeDrag = null
      controls.enabled = true
      invalidate()
      runtimeTap = null
      pendingRuntimeDrag = null
      suppressNextClick = false
      return
    }

    finishRuntimeTapFromEvent(e)
  }

  /** canvas 丢 pointerup 时的兜底（capture 在 window 上） */
  const onWindowRuntimePointerUp = (e: PointerEvent) => {
    if (enableGizmo || e.button !== 0) return
    if (runtimeDrag) return
    if (!runtimeTap || runtimeTap.pointerId !== e.pointerId) return
    finishRuntimeTapFromEvent(e)
  }

  /**
   * 指针被系统取消（触摸转滚屏、窗口失焦、系统手势等）：
   * 只丢弃候选，绝不触发业务 —— 旧实现把 pointercancel 接到 pointerup 上会误写值。
   */
  const onRuntimePointerCancel = (e: PointerEvent) => {
    if (enableGizmo) return
    if (!runtimeTap || runtimeTap.pointerId !== e.pointerId) return
    runtimeTap = null
    pendingRuntimeDrag = null
    noteRuntimeInteract({
      phase: 'up',
      hitId: null,
      clickable: false,
      dragLinks: false,
      pointerType: e.pointerType,
      verdict: 'none',
      fired: false,
      reason: '指针被取消（pointercancel）→ 丢弃本次轻点',
    })
  }

  const onDblClick = (e: MouseEvent) => {
    if (gizmoDragging) return
    const id = pickObjectAtClient(e.clientX, e.clientY)?.id ?? null
    if (!id) return
    if (enableGizmo) {
      selectObjects([id], { gizmo: true })
      handlers.onObjectDblClick?.(id)
      return
    }
    handlers.onObjectDblClick?.(id)
  }

  renderer.domElement.style.touchAction = 'none'

  /**
   * 浏览器鼠标手势等会吞掉 canvas 的 pointerup，OrbitControls 会一直跟着鼠标转。
   * 窗口级检测：按键已松开但仍处于拖拽态 → 强制结束。
   */
  type OrbitControlsInternal = OrbitControls & {
    state: number
    _pointers: number[]
    _onPointerUp: (ev: Event) => void
  }

  const isOrbitStuck = () => {
    const c = controls as OrbitControlsInternal
    return (
      orbitPointer ||
      c.state !== -1 ||
      (Array.isArray(c._pointers) && c._pointers.length > 0)
    )
  }

  const forceEndStuckPointers = () => {
    if (disposed) return
    const c = controls as OrbitControlsInternal
    const orbitStuck = isOrbitStuck()
    if (orbitStuck && typeof c._onPointerUp === 'function' && c._pointers?.length) {
      for (const pointerId of [...c._pointers]) {
        try {
          c._onPointerUp(
            new PointerEvent('pointerup', {
              pointerId,
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          )
        } catch {
          /* ignore */
        }
      }
    } else if (orbitStuck) {
      try {
        c.state = -1
        if (c._pointers) c._pointers.length = 0
      } catch {
        /* ignore */
      }
      orbitPointer = false
    }

    if (runtimeDrag) {
      runtimeDrag = null
      if (!gizmoDragging) controls.enabled = true
    }
    pendingRuntimeDrag = null
    // runtimeTap 留给 canvas/window pointerup 消费
    if (orbitSuppressGesture) restoreOrbitAfterGesture()
    if (orbitStuck) invalidate()
  }

  const onWindowPointerWatch = (e: PointerEvent) => {
    if (disposed) return
    if (e.buttons !== 0) return
    if (e.type === 'pointerup') {
      // 正常松手：单击交由 onWindowRuntimePointerUp / canvas pointerup 收尾
      if (runtimeTap || pendingRuntimeDrag) return
    } else if (runtimeTap || pendingRuntimeDrag) {
      // 已经抬起却没收到 pointerup（被系统菜单/浏览器手势吞掉）：
      // 候选已失效，先清掉再收尾，否则 Orbit 会一直跟着鼠标转
      runtimeTap = null
      pendingRuntimeDrag = null
    }
    if (isOrbitStuck() || runtimeDrag) forceEndStuckPointers()
  }

  const onWindowBlurOrHide = () => {
    if (disposed) return
    forceEndStuckPointers()
  }

  const onVisibilityChange = () => {
    if (document.hidden) onWindowBlurOrHide()
  }

  // pointermove：松手后若仍粘拖，下一帧移动即可掰开；pointerup/cancel 作备份
  window.addEventListener('pointermove', onWindowPointerWatch, true)
  window.addEventListener('pointerup', onWindowPointerWatch, true)
  window.addEventListener('pointercancel', onWindowPointerWatch, true)
  window.addEventListener('blur', onWindowBlurOrHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (enableGizmo) {
    // capture 阶段完成点选；click 兜底；不再挂 bubble pointerdown（避免 Orbit/TC 抢事件）
    renderer.domElement.addEventListener('pointerdown', onDesignerPointerDownCapture, true)
    renderer.domElement.addEventListener('pointerup', onDesignerPointerUp)
    renderer.domElement.addEventListener('click', onDesignerClick)
    renderer.domElement.addEventListener('dblclick', onDblClick)
  } else {
    renderer.domElement.addEventListener('pointerdown', onRuntimePointerDown, true)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onRuntimePointerCancel)
    renderer.domElement.addEventListener('dblclick', onDblClick)
    // 比 canvas bubble 更早：即使 canvas 丢了 pointerup 也能完成单击
    window.addEventListener('pointerup', onWindowRuntimePointerUp, true)
    window.addEventListener('pointercancel', onRuntimePointerCancel, true)
  }

  const onResize = () => {
    if (disposed) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w < 1 || h < 1) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // updateStyle=false：避免把 canvas 写成固定 px，撑破/盖住整页
    renderer.setSize(w, h, false)
    labelRenderer.setSize(w, h)
    labelEl.style.width = '100%'
    labelEl.style.height = '100%'
    invalidate()
  }
  const ro = new ResizeObserver(onResize)
  ro.observe(container)

  function schedule() {
    if (disposed || raf) return
    raf = requestAnimationFrame(tick)
  }

  /**
   * 绕过工厂改 scene 必须手动调。
   * 多次调用合并到下一帧（最终一致，非每变必渲）。
   */
  function invalidate() {
    if (disposed) return
    dirty = true
    schedule()
  }

  function tick() {
    raf = 0
    if (disposed) return
    // 进帧先吃脏：render 中再 invalidate 能重新置 true
    dirty = false
    const now = performance.now()
    const suppressing = now < suppressOrbitUntil
    if (!suppressing && restoreDampingAfterSuppress) {
      // 恢复 fitView 前的阻尼设置（当前默认关闭，避免再被强制打开）
      controls.enableDamping = restoreDampingAfterSuppress
      restoreDampingAfterSuppress = false
    }
    const canTickUpdate =
      !orbitPointer && !gizmoDragging && !runtimeDrag && !suppressing
    const damped = canTickUpdate ? controls.update() : false
    const moving = continuousRender || damped
    if (lodDirty || damped || continuousRender) {
      for (const lod of lodList) lod.update(camera)
      lodDirty = false
    }
    updateSelectionHelpers()
    renderer.render(scene, camera)
    if (labelsVisible || panelMap.size > 0) {
      updatePanelWorldScales()
      labelRenderer.render(scene, camera)
    }
    // 帧尾：刚被置脏 或 还在动，都续帧；别写成 !dirty
    if (dirty || moving) schedule()
  }

  invalidate()

  return {
    scene,
    camera,
    renderer,
    controls,
    setPage,
    mountObject,
    unmountObjects,
    pruneDuplicateRoots,
    reparentObject,
    selectObject,
    selectObjects,
    applyVisual,
    setGizmoMode,
    getGizmoMode: () => gizmoMode,
    getObjectIds: () => [...objectMap.keys()],
    getSelectedObjectIds: () => [...selectedIds],
    raycastAt: raycastId,
    pickIdsInScreenRect,
    isGizmoDragging: () => gizmoDragging,
    fitView,
    getSpawnHint: () => ({
      x: controls.target.x,
      y: controls.target.y,
      z: controls.target.z,
    }),
    getObject3D: (objectId: string) => objectMap.get(objectId),
    applyPageCamera,
    applyPresentation: (pres?: Page3D['presentation']) => {
      presentation.apply(pres)
      syncGrid(pres)
      invalidate()
    },
    setLabelsVisible,
    getLabelsVisible: () => labelsVisible,
    syncPanel,
    setPanelValues,
    refreshPanel,
    invalidate,
    getGizmoStatus: () => ({
      enabled: enableGizmo,
      attached: Boolean(
        selectedId &&
          attachedObjectId === selectedId &&
          transformControls?.object &&
          transformControls.object === objectMap.get(selectedId),
      ),
      helperVisible: Boolean(gizmoHelper?.visible),
      helperInScene: Boolean(gizmoHelper && gizmoHelper.parent === scene),
      selectedId,
      wanted: gizmoWanted,
      mapHasSelected: selectedId ? objectMap.has(selectedId) : false,
      mapSize: objectMap.size,
      error: attachError,
      lastPickId,
      lastPointerNote,
      pointerDownCount,
      selectedPrimitive: selectedId
        ? (nodeMap.get(selectedId)?.primitive ??
            (nodeMap.get(selectedId)?.modelResourceId ? 'model' : null))
        : null,
    }),
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      raf = 0
      if (suppressTimer) {
        clearTimeout(suppressTimer)
        suppressTimer = null
      }
      if (spawnHintTimer) {
        clearInterval(spawnHintTimer)
        spawnHintTimer = null
      }
      ro.disconnect()
      window.removeEventListener('pointermove', onWindowPointerWatch, true)
      window.removeEventListener('pointerup', onWindowPointerWatch, true)
      window.removeEventListener('pointercancel', onWindowPointerWatch, true)
      window.removeEventListener('blur', onWindowBlurOrHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      for (const el of [renderer.domElement, container] as HTMLElement[]) {
        el.removeEventListener('pointerdown', onBlockRightButton, true)
        el.removeEventListener('mousedown', onBlockRightButton, true)
      }
      if (enableGizmo) {
        renderer.domElement.removeEventListener(
          'pointerdown',
          onDesignerPointerDownCapture,
          true,
        )
        renderer.domElement.removeEventListener('pointerup', onDesignerPointerUp)
        renderer.domElement.removeEventListener('click', onDesignerClick)
        renderer.domElement.removeEventListener('dblclick', onDblClick)
      } else {
        renderer.domElement.removeEventListener('pointerdown', onRuntimePointerDown, true)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        renderer.domElement.removeEventListener('pointercancel', onRuntimePointerCancel)
        renderer.domElement.removeEventListener('dblclick', onDblClick)
        window.removeEventListener('pointerup', onWindowRuntimePointerUp, true)
        window.removeEventListener('pointercancel', onRuntimePointerCancel, true)
      }
      controls.removeEventListener('start', onOrbitStart)
      controls.removeEventListener('end', onOrbitEnd)
      controls.removeEventListener('change', onOrbitChange)
      transformControls?.detach()
      transformControls?.dispose()
      if (gizmoHelper) {
        scene.remove(gizmoHelper)
        gizmoHelper = null
      }
      clearObjects()
      if (gridHelper) {
        scene.remove(gridHelper)
        gridHelper.geometry.dispose()
        const gmat = gridHelper.material
        if (Array.isArray(gmat)) gmat.forEach((m) => m.dispose())
        else gmat.dispose()
        gridHelper = null
      }
      presentation.dispose()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
    },
  }
}

export function captureCameraState(camera: PerspectiveCamera, controls: OrbitControls) {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z] as [
      number,
      number,
      number,
    ],
    target: [controls.target.x, controls.target.y, controls.target.z] as [number, number, number],
  }
}

export function lookAtOrigin(camera: PerspectiveCamera, controls: OrbitControls) {
  camera.position.set(6, 5, 8)
  controls.target.set(0, 0.5, 0)
  controls.update()
}
