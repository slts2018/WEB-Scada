/**
 * 离屏渲染模型缩略图（不改工程资源契约，仅内存缓存）
 */
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D,
} from 'three'
import { loadModelObject } from '@/shared/three/modelLoader'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

let sharedRenderer: WebGLRenderer | null = null
/** 共享 renderer 串行渲染，避免并发互相踩 */
let renderChain: Promise<unknown> = Promise.resolve()

function enqueueRender<T>(fn: () => Promise<T>): Promise<T> {
  const next = renderChain.then(fn, fn)
  renderChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function getRenderer(size: number): WebGLRenderer {
  if (!sharedRenderer) {
    const canvas = document.createElement('canvas')
    sharedRenderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    })
    sharedRenderer.setPixelRatio(1)
  }
  sharedRenderer.setSize(size, size, false)
  return sharedRenderer
}

function disposeObjectTree(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mats = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ) as Material[]
      for (const m of mats) {
        if (!m) continue
        const anyMat = m as Material & { map?: { dispose?: () => void } }
        anyMat.map?.dispose?.()
        m.dispose()
      }
    }
  })
}

function cacheKey(resourceId: string, url: string, size: number, bust?: string) {
  return `${resourceId}|${url}|${size}|${bust || ''}`
}

/** 资源替换/删除后清掉对应缩略图 */
export function invalidateModelThumbnail(resourceId: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${resourceId}|`)) cache.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(`${resourceId}|`)) inflight.delete(key)
  }
}

/**
 * 加载模型并渲染一张 PNG data URL。
 * 失败返回 null（调用方显示占位）。
 */
export async function getModelThumbnail(
  resourceId: string,
  url: string,
  opts?: { size?: number; bust?: string },
): Promise<string | null> {
  if (!url) return null
  const size = opts?.size ?? 128
  const key = cacheKey(resourceId, url, size, opts?.bust)
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async (): Promise<string | null> => {
    let root: Object3D | null = null
    try {
      root = await loadModelObject(url)
      return await enqueueRender(async () => {
        if (!root) return null
        const scene = new Scene()
        scene.background = new Color(0x161a22)
        scene.add(new AmbientLight(0xffffff, 0.9))
        const keyLight = new DirectionalLight(0xffffff, 0.95)
        keyLight.position.set(2.5, 4, 3)
        scene.add(keyLight)
        const fill = new DirectionalLight(0xa8c0e0, 0.35)
        fill.position.set(-2, 1, -1)
        scene.add(fill)
        scene.add(root)

        root.updateMatrixWorld(true)
        const box = new Box3().setFromObject(root)
        const center = new Vector3()
        const boxSize = new Vector3()
        if (box.isEmpty()) {
          center.set(0, 0, 0)
          boxSize.set(1, 1, 1)
        } else {
          box.getCenter(center)
          box.getSize(boxSize)
        }
        const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z, 1e-3)
        const dist = maxDim * 2.15

        const camera = new PerspectiveCamera(32, 1, 0.01, Math.max(200, dist * 40))
        camera.position
          .copy(center)
          .add(new Vector3(1.15, 0.8, 1.15).normalize().multiplyScalar(dist))
        camera.near = Math.max(0.01, dist / 120)
        camera.far = Math.max(200, dist * 40)
        camera.updateProjectionMatrix()
        camera.lookAt(center)

        const renderer = getRenderer(size)
        renderer.render(scene, camera)
        const dataUrl = renderer.domElement.toDataURL('image/png')
        cache.set(key, dataUrl)

        disposeObjectTree(root)
        root = null
        return dataUrl
      })
    } catch {
      return null
    } finally {
      if (root) disposeObjectTree(root)
      inflight.delete(key)
    }
  })()

  inflight.set(key, task)
  return task
}
