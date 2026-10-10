<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Page3D } from '@web-scada/core'
import {
  captureCameraState,
  createScene3D,
  type Scene3DBundle,
  type TransformGizmoMode,
} from '@/shared/three/createScene3D'
import { frameDesigner3dSelection } from '@/shared/three/designer3dIntent'
import { fitScaleFromMountedObject } from '@/shared/three/modelFit'
import { collectPage3DTagIds, resolveObject3DVisual } from '@/shared/runtime/bindingEngine3d'
import { panelValuesFromTags } from '@/shared/three/object3dPanelUi'
import {
  findObject3dDeep,
  object3dPanelSignature,
  object3dTreeSignature,
  walkObject3dTree,
} from '@/shared/project/object3dTree'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import {
  isDesignerCanvasContext,
  installPointerModifierTracker,
  isAdditivePointer,
} from '@/shared/designer/designerHotkeys'

const props = withDefaults(
  defineProps<{
    page: Page3D
    /** 设计端默认 true。注意：Vue 对 Boolean prop 缺省会变成 false，必须显式默认 true */
    interactive?: boolean
  }>(),
  { interactive: true },
)

const project = useProjectStore()
const tags = useTagStore()
const host = ref<HTMLDivElement | null>(null)
const marquee = ref<{ x: number; y: number; width: number; height: number } | null>(null)
let bundle: Scene3DBundle | null = null
let removeTagListener: (() => void) | null = null
let boxStart: { x: number; y: number; additive: boolean } | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null
/** 实时预览闪烁（对齐 Runtime） */
const previewBlinkVisuals = new Map<string, import('@web-scada/core').Object3DNode>()
const previewBlinkColorTinted = new Map<string, boolean>()
let previewBlinkPhase = false
let previewBlinkTimer: ReturnType<typeof setInterval> | null = null

const objectCount = computed(() => {
  let n = 0
  walkObject3dTree(props.page.objects, () => {
    n += 1
  })
  return n
})

const gizmoMode = computed(() => project.gizmoMode3d)

/** 纯面板选中：仅允许平移 */
const panelOnlySelection = computed(() => {
  const ids = project.selectedObject3dIds
  if (!ids.length) return false
  return ids.every((id) => {
    const o = findObject3dDeep(props.page.objects, id)
    return Boolean(o?.panel) && !o?.modelResourceId
  })
})

const previewHint = computed(() =>
  project.previewLive
    ? '实时预览中：外观随 Tag 刷新（含闪烁；不写回）'
    : '点画布后：Ctrl/Shift+点多选 · Ctrl+C/V · Delete · W/E/R · F',
)

const gizmoModeLabel = computed(() => {
  if (panelOnlySelection.value) return '手柄：平移（面板）'
  if (gizmoMode.value === 'translate') return '手柄：平移'
  if (gizmoMode.value === 'rotate') return '手柄：旋转'
  return '手柄：缩放'
})

watch(panelOnlySelection, (v) => {
  if (v && (gizmoMode.value === 'rotate' || gizmoMode.value === 'scale')) {
    setMode('translate', { quiet: true })
  }
})

const gizmoStatusText = ref('手柄: -')

function refreshGizmoStatus() {
  const s = bundle?.getGizmoStatus()
  if (!s) {
    gizmoStatusText.value = '手柄: 未初始化'
    return
  }
  if (!s.enabled) {
    gizmoStatusText.value = '手柄: 未启用'
    return
  }
  if (s.attached) {
    const sid = s.selectedId ? s.selectedId.slice(-6) : '-'
    const prim = s.selectedPrimitive ? ` ${s.selectedPrimitive}` : ''
    gizmoStatusText.value = `已挂载${prim} sid:${sid} ${s.lastPointerNote}`
    return
  }
  if (!s.selectedId) {
    gizmoStatusText.value = `待选中 #${s.pointerDownCount} ${s.lastPointerNote}`
    return
  }
  if (!s.wanted) {
    gizmoStatusText.value = '手柄: 已锁定/关闭'
    return
  }
  if (!s.mapHasSelected) {
    gizmoStatusText.value = `手柄: 场景未找到对象 map=${s.mapSize}`
    return
  }
  gizmoStatusText.value = `手柄: 未挂载${s.error ? '(' + s.error + ')' : ''}`
}

function toLocal(e: PointerEvent) {
  const el = host.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function ensureBox(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

function onEmptyPointerDown(e: PointerEvent) {
  if (props.interactive === false || !bundle) return
  // 框选仅修饰键（主流 B：普通空白左拖归 Orbit 旋转）
  const additive = isAdditivePointer(e)
  if (!additive) return
  const pt = toLocal(e)
  boxStart = { ...pt, additive }
  marquee.value = { x: pt.x, y: pt.y, width: 0, height: 0 }
  window.addEventListener('pointermove', onMarqueeMove)
  window.addEventListener('pointerup', onMarqueeUp, { once: true })
}

function onBoardPointerUp(e: PointerEvent) {
  // 延迟 focus，避免与本轮 pointer 事件叠出假单击冲掉选中
  if (isAdditivePointer(e)) return
  const el = e.currentTarget as HTMLElement
  if (document.activeElement === el) return
  window.setTimeout(() => {
    if (document.activeElement === el) return
    el.focus({ preventScroll: true })
  }, 0)
}

function onMarqueeMove(e: PointerEvent) {
  if (!boxStart) return
  marquee.value = ensureBox(boxStart, toLocal(e))
}

function onMarqueeUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onMarqueeMove)
  if (!boxStart || !bundle) {
    boxStart = null
    marquee.value = null
    return
  }
  const box = ensureBox(boxStart, toLocal(e))
  const additive = boxStart.additive
  boxStart = null
  marquee.value = null
  if (box.width < 4 && box.height < 4) return
  const hit = bundle.pickIdsInScreenRect(box)
  if (additive) {
    const set = new Set([...project.selectedObject3dIds, ...hit])
    project.setObject3dSelection([...set])
  } else {
    project.setObject3dSelection(hit)
  }
}

async function reload() {
  if (!bundle) return
  await bundle.setPage(props.page, (id) => project.getResourceUrl(id))
  syncSelectionGizmo()
  bundle.setGizmoMode(gizmoMode.value)
  if (project.previewLive) applyPreview()
  else {
    walkObject3dTree(props.page.objects, (obj) => {
      if (!obj.panel || !bundle) return
      bundle.setPanelValues(
        obj.id,
        panelValuesFromTags(obj, (id) => tags.getValue(id)?.value),
      )
    })
  }
}

/** 粘贴/删除/组合：增量同步，避免整页重载模型 + 相机被打回默认 */
let sceneSyncing = false
let sceneSyncQueued = false
async function syncSceneFromPage() {
  if (!bundle) return
  if (sceneSyncing) {
    sceneSyncQueued = true
    return
  }
  sceneSyncing = true
  try {
    do {
      sceneSyncQueued = false
      const resolveUrl = (id: string) => project.getResourceUrl(id)
      const desired = new Set<string>()
      walkObject3dTree(props.page.objects, (obj) => {
        desired.add(obj.id)
      })
      const existing = new Set(bundle.getObjectIds())

      const toRemove = [...existing].filter((id) => !desired.has(id))
      if (toRemove.length) bundle.unmountObjects(toRemove)

      const toMount: { node: import('@web-scada/core').Object3DNode; parentId: string | null }[] =
        []
      walkObject3dTree(props.page.objects, (obj, parent) => {
        if (!bundle!.getObject3D(obj.id)) {
          toMount.push({ node: obj, parentId: parent?.id ?? null })
        }
      })
      for (const item of toMount) {
        if (bundle.getObject3D(item.node.id)) continue
        await bundle.mountObject(item.node, resolveUrl, item.parentId)
      }

      bundle.pruneDuplicateRoots(desired)

      walkObject3dTree(props.page.objects, (obj, parent) => {
        const threeObj = bundle!.getObject3D(obj.id)
        if (!threeObj) return
        const wantParentId = parent?.id ?? null
        const curParentId =
          (threeObj.parent?.userData?.scadaObjectId as string | undefined) ?? null
        const curIsRoot =
          threeObj.parent != null && threeObj.parent.userData?.scadaObjectId == null
        const curEffective = curIsRoot ? null : curParentId
        if (wantParentId !== curEffective) {
          bundle!.reparentObject(obj.id, wantParentId)
        }
      })

      // 撤销/属性改姿态后：已有对象也要刷回 transform（树签名不含姿态，仅靠 mount 不够）
      walkObject3dTree(props.page.objects, (obj) => {
        if (!bundle!.getObject3D(obj.id)) return
        if (project.previewLive) {
          const resolved = resolveObject3DVisual(obj, (id) => tags.getValue(id))
          bundle!.applyVisual(obj.id, resolved.object, { applyModelColor: resolved.colorTinted })
        } else {
          bundle!.applyVisual(obj.id, obj)
        }
      })

      syncSelectionGizmo()
      bundle.setGizmoMode(gizmoMode.value)
      if (project.previewLive) applyPreview()

      if (project.frameAfter3dTreeReload) {
        project.frameAfter3dTreeReload = false
        await nextTick()
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            frameSelectedObjects()
          })
        })
      }
    } while (sceneSyncQueued)
  } finally {
    sceneSyncing = false
  }
}

function setMode(mode: TransformGizmoMode, opts?: { quiet?: boolean }) {
  if (panelOnlySelection.value && (mode === 'rotate' || mode === 'scale')) {
    if (!opts?.quiet) ElMessage.info('面板对象只能平移，请在面板编辑器中调整大小')
    return
  }
  project.setGizmoMode3d(mode)
  bundle?.setGizmoMode(mode)
  if (!project.selectedObject3dId) {
    if (!opts?.quiet) {
      ElMessage.info('请先在场景中点击选中对象，再拖红/绿/蓝手柄')
    }
    return
  }
  // 切换模式后立即重新挂上手柄，避免不可见
  syncSelectionGizmo()
}

function cycleGizmoMode() {
  if (panelOnlySelection.value) {
    setMode('translate', { quiet: true })
    return
  }
  const order: TransformGizmoMode[] = ['translate', 'rotate', 'scale']
  const i = order.indexOf(gizmoMode.value)
  setMode(order[(i + 1) % order.length])
}

function applyPulsedPreviewVisual(
  objectId: string,
  visual: import('@web-scada/core').Object3DNode,
) {
  if (!bundle) return
  const tint = { applyModelColor: previewBlinkColorTinted.get(objectId) === true }
  if (!previewBlinkPhase) {
    const base = visual.style?.opacity ?? 1
    bundle.applyVisual(
      objectId,
      {
        ...visual,
        style: { ...visual.style, opacity: Math.min(base, 0.28) },
      },
      tint,
    )
    return
  }
  bundle.applyVisual(objectId, visual, tint)
}

function syncPreviewBlinkLoop() {
  if (previewBlinkVisuals.size > 0 && !previewBlinkTimer) {
    previewBlinkTimer = setInterval(() => {
      previewBlinkPhase = !previewBlinkPhase
      for (const [id, visual] of previewBlinkVisuals) applyPulsedPreviewVisual(id, visual)
    }, 420)
  } else if (previewBlinkVisuals.size === 0 && previewBlinkTimer) {
    clearInterval(previewBlinkTimer)
    previewBlinkTimer = null
    previewBlinkPhase = false
  }
}

function clearPreviewBlink() {
  if (previewBlinkTimer) {
    clearInterval(previewBlinkTimer)
    previewBlinkTimer = null
  }
  previewBlinkPhase = false
  previewBlinkVisuals.clear()
  previewBlinkColorTinted.clear()
}

function applyPreview() {
  if (!bundle || !project.previewLive) return
  previewBlinkVisuals.clear()
  previewBlinkColorTinted.clear()
  walkObject3dTree(props.page.objects, (obj) => {
    const resolved = resolveObject3DVisual(obj, (id) => tags.getValue(id))
    if (resolved.blink) {
      previewBlinkVisuals.set(obj.id, resolved.object)
      previewBlinkColorTinted.set(obj.id, resolved.colorTinted)
      applyPulsedPreviewVisual(obj.id, resolved.object)
    } else {
      bundle!.applyVisual(obj.id, resolved.object, { applyModelColor: resolved.colorTinted })
    }
    if (obj.panel) {
      bundle!.setPanelValues(
        obj.id,
        panelValuesFromTags(obj, (id) => tags.getValue(id)?.value),
      )
    }
  })
  syncPreviewBlinkLoop()
}

function startPreview() {
  tags.setPageSubscription(collectPage3DTagIds(props.page))
  tags.connectRealtime()
  removeTagListener?.()
  removeTagListener = tags.addListener(() => applyPreview())
  applyPreview()
}

function stopPreview() {
  removeTagListener?.()
  removeTagListener = null
  clearPreviewBlink()
  void reload()
}

function captureDefaultCamera() {
  if (!bundle) return
  const cam = captureCameraState(bundle.camera, bundle.controls)
  project.updatePage3dCamera(cam)
  ElMessage.success('已设为默认视角')
}

function fitAll() {
  if (!bundle?.fitView()) {
    ElMessage.warning('场景中没有可适配的对象')
    return
  }
  ElMessage.success('已适配全部对象')
}

function fitSelection() {
  if (!bundle) return
  const ids = [...project.selectedObject3dIds]
  if (!ids.length) {
    ElMessage.info('请先选中对象')
    return
  }
  // 与点选聚焦同一套：先同步手柄，再框相机
  syncSelectionGizmo()
  const ok = frameDesigner3dSelection(bundle, ids)
  focusHint.value = ok ? `已看选中 ${ids.length} 个` : '聚焦失败:无法框住'
  if (!ok) ElMessage.warning('无法框住选中对象')
  refreshGizmoStatus()
}

const focusHint = ref('')
const labelsOn = ref(false)

/** store 选中 → 场景手柄 */
function syncSelectionGizmo() {
  if (!bundle) return
  const ids = [...project.selectedObject3dIds]
  const useGizmo = !Boolean(project.selectedObject3d?.locked)
  bundle.selectObjects(ids, { gizmo: useGizmo })
  refreshGizmoStatus()
}

/** 场景里已选中但 store 丢了时，补回选中（复制前常用） */
function syncStoreSelectionFromScene() {
  if (project.selectedObject3dIds.length || !bundle) return
  const ids = bundle.getSelectedObjectIds()
  if (ids.length) project.setObject3dSelection(ids)
}

/** 粘贴后直接挂载新物体（不依赖 watch，避免「没反应」） */
async function pasteAndShow() {
  syncStoreSelectionFromScene()
  const created = project.pasteClipboard3d()
  if (!created.length) {
    ElMessage.warning('剪贴板为空，请先 Ctrl+C 复制对象')
    return false
  }
  ElMessage.success(`已粘贴 ${created.length} 个对象`)
  // 只走增量同步，避免与 watch(bumpScene3d) 并发 mount 出双份残影
  await syncSceneFromPage()
  syncSelectionGizmo()
  await nextTick()
  requestAnimationFrame(() => {
    frameSelectedObjects()
  })
  return true
}

async function copySelectedAndNotify() {
  syncStoreSelectionFromScene()
  if (project.copySelectedObject3ds()) {
    ElMessage.success(`已复制 ${project.clipboard3d.length} 个对象`)
    return true
  }
  ElMessage.warning('请先在场景中点选对象再复制')
  return false
}

/**
 * 选中 + 框住（与工具栏「看选中」同一接口）。
 * 延迟到指针手势结束后再 fit，避免被 Orbit/TC 当帧顶掉。
 */
function focusObject(objectId: string) {
  if (props.interactive === false) return
  if (!objectId) return
  if (!bundle) {
    focusHint.value = '聚焦失败:场景未就绪'
    return
  }

  project.selectObject3d(objectId)
  syncSelectionGizmo()

  const run = () => {
    if (!bundle) return false
    // 直接复用「看选中」：frameDesigner3dSelection → fitView
    return frameDesigner3dSelection(bundle, [objectId])
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ok = run()
      focusHint.value = ok
        ? `已聚焦 ${objectId.slice(-6)}`
        : bundle?.getObject3D(objectId)
          ? `聚焦失败:相机未移动`
          : `聚焦失败:场景无此对象`
      refreshGizmoStatus()
      if (ok) {
        bundle?.fitView([objectId])
        refreshGizmoStatus()
      }
    })
  })
}

/** 框住当前选中（F / focus3dNonce） */
function frameSelectedObjects() {
  if (props.interactive === false) return
  if (!bundle) return
  const ids = [...project.selectedObject3dIds]
  if (!ids.length) return
  fitSelection()
}

function toggleLabels() {
  labelsOn.value = !labelsOn.value
  bundle?.setLabelsVisible(labelsOn.value)
}

/** 按包围盒把选中 GLB 缩放到场景友好尺寸（各模型系数独立） */
function normalizeSelection() {
  if (!bundle) return
  const ids = [...project.selectedObject3dIds]
  if (!ids.length) {
    ElMessage.info('请先选中要适配的模型')
    return
  }
  let n = 0
  for (const id of ids) {
    const node = findObject3dDeep(props.page.objects, id)
    const obj = bundle.getObject3D(id)
    if (!node?.modelResourceId || !obj || node.locked) continue
    const s = fitScaleFromMountedObject(obj)
    const oldS = Math.max(Math.abs(node.transform.scale[0]), 1e-8)
    const ratio = s / oldS
    const [px, py, pz] = node.transform.position
    project.updateObject3d(id, {
      transform: {
        ...node.transform,
        scale: [s, s, s],
        position: [px, py * ratio, pz],
      },
    })
    n += 1
  }
  if (!n) {
    ElMessage.warning('请选中已导入的 GLB/GLTF 模型')
    return
  }
  void nextTick(() => {
    bundle?.fitView(ids)
  })
  ElMessage.success(`已适配 ${n} 个模型尺寸`)
}

function onKeyDown(e: KeyboardEvent) {
  if (props.interactive === false) return
  if (e.isComposing) return
  // 通用编辑快捷键改由 DesignerView 捕获统一处理；此处只保留 3D 工具键
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // 与复制等一致：仅画布焦点下生效（属性面板不抢）
  if (!isDesignerCanvasContext(e.target)) return

  const code = e.code
  const isTool =
    code === 'KeyW' ||
    code === 'KeyE' ||
    code === 'KeyR' ||
    code === 'KeyQ' ||
    code === 'KeyF'
  if (!isTool) return

  const hasSel =
    project.selectedObject3dIds.length > 0 ||
    (bundle?.getSelectedObjectIds().length ?? 0) > 0

  if (code === 'KeyW') {
    e.preventDefault()
    e.stopPropagation()
    setMode('translate', { quiet: !hasSel })
    return
  }
  if (code === 'KeyE') {
    e.preventDefault()
    e.stopPropagation()
    setMode('rotate', { quiet: !hasSel })
    return
  }
  if (code === 'KeyR') {
    e.preventDefault()
    e.stopPropagation()
    setMode('scale', { quiet: !hasSel })
    return
  }
  if (code === 'KeyQ') {
    e.preventDefault()
    e.stopPropagation()
    cycleGizmoMode()
    return
  }
  if (code === 'KeyF') {
    e.preventDefault()
    e.stopPropagation()
    if (hasSel) frameSelectedObjects()
    else ElMessage.info('请先选中对象再按 F 看选中')
  }
}

let skipSelectedVisualUntil = 0

onMounted(async () => {
  if (!host.value) return
  try {
    bundle = createScene3D(
      host.value,
      {
        onSelect: (id, meta) => {
          if (props.interactive === false) return
          try {
            const additive = Boolean(meta?.additive)
            if (meta?.ids) {
              project.setObject3dSelection(meta.ids, id ?? undefined)
              syncSelectionGizmo()
              return
            }
            if (additive) {
              if (id) project.selectObject3d(id, { additive: true })
              else project.selectObject3d(null)
              syncSelectionGizmo()
              return
            }
            if (!id) {
              project.selectObject3d(null)
              syncSelectionGizmo()
              return
            }
            project.selectObject3d(id)
            syncSelectionGizmo()
          } catch (err) {
            console.error('[Canvas3DBoard] onSelect failed', err)
          }
        },
        onEmptyPointerDown: (e) => onEmptyPointerDown(e),
        // 设计端不执行业务事件；事件仅在运行端生效
        onObjectClick: () => {
          /* 单击选中已在 onSelect 完成 */
        },
        onObjectDblClick: (id) => {
          if (!id) return
          project.selectObject3d(id)
          syncSelectionGizmo()
          fitSelection()
        },
        onPanelEdit: (id) => {
          if (!id) return
          project.selectObject3d(id)
          syncSelectionGizmo()
          project.openObject3dPanelEditor(id)
        },
        onSpawnHint: (hint) => {
          project.setSpawnHint3d(hint)
        },
        onTransformCommit: (id, transform) => {
          const obj = findObject3dDeep(props.page.objects, id)
          if (obj?.locked) return
          // 松手写入后短时忽略属性面板回写，避免旧坐标把物体拽回原地（看起来像残影）
          skipSelectedVisualUntil = performance.now() + 250
          project.updateObject3d(id, { transform })
        },
        onTransformsCommit: (patches) => {
          const filtered: typeof patches = {}
          for (const [id, transform] of Object.entries(patches)) {
            const obj = findObject3dDeep(props.page.objects, id)
            if (obj?.locked) continue
            filtered[id] = transform
          }
          skipSelectedVisualUntil = performance.now() + 250
          project.commitObject3dTransforms(filtered)
        },
        resolvePage2d: (page2dId) => {
          const page = project.document.pages.find((p) => p.id === page2dId && p.type === '2d')
          return page && page.type === '2d' ? page : null
        },
      },
      { enableGizmo: true, enableLabels: false },
    )
    await reload()
    labelsOn.value = bundle.getLabelsVisible()
    installPointerModifierTracker()
    if (project.previewLive) startPreview()
    window.addEventListener('keydown', onKeyDown, true)
    statusTimer = setInterval(() => refreshGizmoStatus(), 400)
  } catch (err) {
    console.error('[Canvas3DBoard] init failed', err)
    ElMessage.error('3D 场景初始化失败，请刷新页面重试')
    try {
      bundle?.dispose()
    } catch {
      /* ignore */
    }
    bundle = null
  }
})

watch(
  () => props.page.id,
  async () => {
    await reload()
    if (project.previewLive) startPreview()
  },
)

watch(
  () => object3dTreeSignature(props.page.objects),
  async () => {
    await syncSceneFromPage()
  },
)

watch(
  () => object3dPanelSignature(props.page.objects, project.document.pages),
  () => {
    if (!bundle) return
    walkObject3dTree(props.page.objects, (obj) => {
      if (obj.panel) bundle!.syncPanel(obj)
      else bundle!.syncPanel({ ...obj, panel: undefined })
    })
    if (project.previewLive) applyPreview()
  },
)

watch(
  () => project.scene3dMutateNonce,
  async () => {
    if (!bundle) return
    await syncSceneFromPage()
  },
)

// 选中 → 只同步手柄；切视角只走 cameraFocus3dCmd / focusObject /「看选中」
watch(
  () => project.selectedObject3dIds.join(','),
  () => {
    syncSelectionGizmo()
  },
)

watch(
  () => project.focus3dNonce,
  () => {
    frameSelectedObjects()
  },
)

watch(
  () => {
    const cmd = project.cameraFocus3dCmd
    return cmd ? `${cmd.id}:${cmd.at}` : ''
  },
  (key) => {
    if (!key) return
    const id = project.cameraFocus3dCmd?.id
    if (id) focusObject(id)
  },
)

watch(
  () => project.activePage3d?.presentation,
  (pres) => {
    if (!bundle) return
    bundle.applyPresentation(pres)
  },
  { deep: true },
)

watch(
  () => {
    const cmd = project.scene3dCameraCmd
    return cmd ? `${cmd.type}:${cmd.at}` : ''
  },
  (key) => {
    if (!key || !bundle) return
    const type = project.scene3dCameraCmd?.type
    if (type === 'capture') captureDefaultCamera()
    else if (type === 'apply') {
      bundle.applyPageCamera(props.page)
      ElMessage.success('已恢复默认视角')
    }
  },
)

watch(
  () => project.selectedObject3d,
  (obj) => {
    if (!obj || !bundle) return
    // 拖手柄过程中不要用属性面板的旧值回写变换，否则会「物体走了、残影留在原地」
    if (bundle.isGizmoDragging()) return
    if (performance.now() < skipSelectedVisualUntil) return
    if (project.previewLive) {
      const resolved = resolveObject3DVisual(obj, (id) => tags.getValue(id))
      bundle.applyVisual(obj.id, resolved.object, { applyModelColor: resolved.colorTinted })
    } else {
      bundle.applyVisual(obj.id, obj)
    }
  },
  { deep: true },
)

watch(
  () => project.gizmoMode3d,
  (mode) => {
    bundle?.setGizmoMode(mode)
  },
)

watch(
  () => project.previewLive,
  (on) => {
    if (on) startPreview()
    else stopPreview()
  },
)

onUnmounted(() => {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
  clearPreviewBlink()
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('pointermove', onMarqueeMove)
  removeTagListener?.()
  removeTagListener = null
  if (bundle && props.interactive !== false) {
    const cam = captureCameraState(bundle.camera, bundle.controls)
    project.updatePage3dCamera(cam)
  }
  bundle?.dispose()
  bundle = null
})

function unmountByIds(ids: string[]) {
  if (!bundle || !ids.length) return
  bundle.unmountObjects(ids)
  syncSelectionGizmo()
}

defineExpose({
  applyVisual: (id: string, visual: import('@web-scada/core').Object3DNode) => {
    bundle?.applyVisual(id, visual)
  },
  reload,
  syncSceneFromPage,
  pasteAndShow,
  copySelectedAndNotify,
  syncStoreSelectionFromScene,
  getSceneSelectedCount: () => bundle?.getSelectedObjectIds().length ?? 0,
  unmountByIds,
  fitAll,
  fitSelection,
  focusObject,
  normalizeSelection,
})
</script>

<template>
  <div
    class="board3d"
    data-scada-canvas="3d"
    tabindex="0"
    @pointerdown.capture="($event.currentTarget as HTMLElement).focus({ preventScroll: true })"
    @pointerup="onBoardPointerUp"
  >
    <div ref="host" class="host" />
    <div
      v-if="marquee"
      class="marquee"
      :style="{
        left: marquee.x + 'px',
        top: marquee.y + 'px',
        width: marquee.width + 'px',
        height: marquee.height + 'px',
      }"
    />
    <div v-if="interactive !== false" class="tools">
      <button
        type="button"
        :class="{ active: gizmoMode === 'translate' }"
        title="平移手柄 (W)"
        @click="setMode('translate')"
      >
        平移
      </button>
      <button
        type="button"
        :class="{ active: gizmoMode === 'rotate' }"
        :disabled="panelOnlySelection"
        title="旋转手柄 (E)"
        @click="setMode('rotate')"
      >
        旋转
      </button>
      <button
        type="button"
        :class="{ active: gizmoMode === 'scale' }"
        :disabled="panelOnlySelection"
        title="缩放手柄 (R)"
        @click="setMode('scale')"
      >
        缩放
      </button>
      <button type="button" class="cam" title="适配全部对象" @click="fitAll">适</button>
      <button
        type="button"
        class="cam"
        :class="{ active: labelsOn }"
        title="显示/隐藏对象名标注 (CSS2D)"
        @click="toggleLabels"
      >
        名
      </button>
      <button type="button" class="cam" title="设为默认视角" @click="captureDefaultCamera">视</button>
    </div>
    <div class="hud">
      <span>{{ page.name }}</span>
      <span>对象 {{ objectCount }}</span>
      <span v-if="project.selectedObject3dId">{{ gizmoModeLabel }}</span>
      <span>{{ gizmoStatusText }}</span>
      <span v-if="focusHint" class="focus-hint">{{ focusHint }}</span>
      <span>{{ previewHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.board3d {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0b0d11;
  outline: none;
}

.host {
  width: 100%;
  height: 100%;
}

.marquee {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border: 1px dashed #3d8bfd;
  background: rgba(61, 139, 253, 0.12);
}

.tools {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 6px;
  z-index: 20;
  pointer-events: auto;
}

.tools button {
  min-width: 48px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #3d8bfd;
  border-radius: 4px;
  background: rgba(15, 18, 28, 0.92);
  color: #e8edf7;
  cursor: pointer;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}

.tools button.cam {
  width: auto;
  padding: 0 8px;
  margin-left: 4px;
}

.tools button.active,
.tools button:hover {
  color: var(--scada-text);
  border-color: var(--scada-accent);
  background: rgba(61, 139, 253, 0.2);
}

.tools button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  color: #64748b;
  border-color: rgba(100, 116, 139, 0.35);
  background: rgba(15, 18, 28, 0.6);
  box-shadow: none;
}

.tools button:disabled:hover {
  color: #64748b;
  border-color: rgba(100, 116, 139, 0.35);
  background: rgba(15, 18, 28, 0.6);
}

.hud {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 12px;
  color: var(--scada-muted);
  pointer-events: none;
}

.focus-hint {
  color: #fbbf24;
  font-weight: 600;
}
</style>

<!-- CSS2D 标注挂在场景容器下，需非 scoped 全局类名 -->
<style>
.scada-3d-label {
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(12, 16, 28, 0.82);
  border: 1px solid rgba(61, 139, 253, 0.55);
  color: #e8edf7;
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-50%, -100%);
}
</style>
