/**
 * 模型编辑器内嵌预览：独立小场景，实时显示材质/旋转/缩放效果。
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Object3DNode } from '@web-scada/core'
import { loadModelObject } from '@/shared/three/modelLoader'
import {
  applyObject3DMaterial,
  clearObject3DMaterialMaps,
} from '@/shared/three/object3dMaterialApply'

export interface ModelEditorPreview {
  setObject: (
    node: Object3DNode,
    resolveUrl: (resourceId: string) => string | undefined,
  ) => Promise<void>
  applyAppearance: (node: Object3DNode) => void
  resize: () => void
  dispose: () => void
}

function disposeTree(root: Object3D) {
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

function createPrimitive(node: Object3DNode): Object3D {
  const color = node.material?.color || node.style?.color || '#3d8bfd'
  const opacity = node.material?.opacity ?? node.style?.opacity ?? 1
  const material = new MeshStandardMaterial({
    color: new Color(color),
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    metalness: node.material?.metalness ?? 0.1,
    roughness: node.material?.roughness ?? 0.6,
  })

  if (node.primitive === 'arrow') {
    const group = new Group()
    const shaft = new Mesh(new CylinderGeometry(0.08, 0.08, 0.7, 12), material)
    shaft.position.y = -0.15
    const tip = new Mesh(new ConeGeometry(0.22, 0.45, 16), material.clone())
    tip.position.y = 0.42
    group.add(shaft, tip)
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
  return new Mesh(geometry, material)
}

/** 把几何中心挪到本地原点，便于预览围观 */
function centerObject(root: Object3D) {
  root.updateMatrixWorld(true)
  const box = new Box3().setFromObject(root)
  if (box.isEmpty()) return
  const center = new Vector3()
  box.getCenter(center)
  root.position.sub(center)
  root.updateMatrixWorld(true)
}

function applyPivotPose(pivot: Object3D, node: Object3DNode) {
  const [rx, ry, rz] = node.transform.rotation
  const [sx, sy, sz] = node.transform.scale
  pivot.rotation.set(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz))
  pivot.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz))
  pivot.position.set(0, 0, 0)
}

function fitCamera(camera: PerspectiveCamera, controls: OrbitControls, pivot: Object3D) {
  pivot.updateMatrixWorld(true)
  const box = new Box3().setFromObject(pivot)
  if (box.isEmpty()) return
  const size = new Vector3()
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z, 0.5)
  const dist = maxDim * 2.4
  camera.near = Math.max(0.01, dist / 100)
  camera.far = dist * 40
  camera.position.set(dist * 0.9, dist * 0.7, dist)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
}

export function createModelEditorPreview(container: HTMLElement): ModelEditorPreview {
  const scene = new Scene()
  scene.background = new Color(0x0b1220)

  const camera = new PerspectiveCamera(45, 1, 0.05, 500)
  camera.position.set(2.2, 1.6, 2.6)

  const renderer = new WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)

  // 偏亮：无环境贴图时高金属度模型容易发黑，预览里加足环境光
  scene.add(new AmbientLight(0xffffff, 0.85))
  scene.add(new HemisphereLight(0xffffff, 0x445566, 0.55))
  const key = new DirectionalLight(0xffffff, 1.25)
  key.position.set(4, 8, 5)
  scene.add(key)
  const fill = new DirectionalLight(0x88aaff, 0.55)
  fill.position.set(-4, 2, -3)
  scene.add(fill)

  const pivot = new Group()
  scene.add(pivot)

  let meshRoot: Object3D | null = null
  let loadToken = 0
  let materialCancel: (() => void) | null = null
  let resolveUrlFn: ((id: string) => string | undefined) | undefined
  let disposed = false
  let raf = 0
  let loadedKey = ''

  const resize = () => {
    if (disposed) return
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    controls.update()
    renderer.render(scene, camera)
  }

  const clearMesh = () => {
    materialCancel?.()
    materialCancel = null
    if (meshRoot) {
      pivot.remove(meshRoot)
      disposeTree(meshRoot)
      meshRoot = null
    }
  }

  const applyAppearance = (node: Object3DNode) => {
    if (!meshRoot || disposed) return
    applyPivotPose(pivot, node)
    if (node.material?.override) {
      // applyObject3DMaterial 同签名不会取消进行中的贴图加载
      materialCancel = applyObject3DMaterial(
        meshRoot,
        node.material,
        (id) => resolveUrlFn?.(id),
        () => undefined,
      )
    } else {
      materialCancel?.()
      materialCancel = null
      clearObject3DMaterialMaps(meshRoot)
      const color = node.style?.color || '#3d8bfd'
      const opacity = node.style?.opacity ?? 1
      const emissive = node.style?.emissive || '#000000'
      meshRoot.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const std = m as MeshStandardMaterial
          if (!std?.isMeshStandardMaterial) continue
          std.color = new Color(color)
          std.emissive = new Color(emissive)
          std.transparent = opacity < 1
          std.opacity = opacity
          std.depthWrite = opacity >= 1
          std.needsUpdate = true
        }
      })
    }
  }

  const setObject = async (
    node: Object3DNode,
    resolveUrl: (resourceId: string) => string | undefined,
  ) => {
    if (disposed) return
    resolveUrlFn = resolveUrl
    const nextKey = `${node.id}|${node.modelResourceId || node.primitive || 'box'}`
    // 同一对象只重建网格一次；材质/位姿走 applyAppearance
    if (meshRoot && loadedKey === nextKey) {
      applyAppearance(node)
      return
    }

    const token = ++loadToken
    clearMesh()
    loadedKey = nextKey

    let root: Object3D
    if (node.modelResourceId) {
      const url = resolveUrl(node.modelResourceId)
      if (url) {
        try {
          root = await loadModelObject(url)
        } catch {
          root = createPrimitive({ ...node, modelResourceId: undefined, primitive: 'box' })
        }
      } else {
        root = createPrimitive({
          ...node,
          modelResourceId: undefined,
          primitive: node.primitive ?? 'box',
        })
      }
    } else {
      root = createPrimitive(node)
    }

    if (disposed || token !== loadToken) {
      disposeTree(root)
      return
    }

    centerObject(root)
    meshRoot = root
    pivot.add(root)
    applyAppearance(node)
    resize()
    fitCamera(camera, controls, pivot)
  }

  resize()
  raf = requestAnimationFrame(tick)
  const ro = new ResizeObserver(() => resize())
  ro.observe(container)

  return {
    setObject,
    applyAppearance,
    resize,
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      clearMesh()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
