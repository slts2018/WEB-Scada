/**
 * 统一模型加载（Three 官方 Loader，按扩展名分发）
 * 支持：glb / gltf / obj / fbx / stl
 */
import {
  Box3,
  LOD,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js'

const gltfLoader = new GLTFLoader()
const objLoader = new OBJLoader()
const fbxLoader = new FBXLoader()
const stlLoader = new STLLoader()

const MODEL_EXT_RE = /\.(glb|gltf|obj|fbx|stl)(?:$|\?)/i

export function isSupportedModelUrl(url: string, fileName?: string): boolean {
  const probe = `${fileName || ''} ${url}`.toLowerCase()
  return MODEL_EXT_RE.test(probe) || probe.includes('model/gltf')
}

export function modelExtFromUrl(url: string, fileName?: string): string | null {
  const name = fileName || url.split('?')[0].split('#')[0]
  const m = name.match(/\.(glb|gltf|obj|fbx|stl)$/i)
  if (m) return m[1].toLowerCase()
  // data URL / 无扩展名：默认按 glb 试（历史资源）
  if (url.startsWith('data:model/gltf') || url.includes('gltf')) return 'glb'
  return null
}

function prepareModelRoot(root: Object3D): Object3D {
  root.updateMatrixWorld(true)
  // CAD/管道常见：几何远离原点。先挪到包围盒中心，避免「手柄在原点、模型在远处」
  const box = new Box3().setFromObject(root)
  if (!box.isEmpty()) {
    const center = new Vector3()
    box.getCenter(center)
    if (center.lengthSq() > 1e-8) {
      root.position.sub(center)
      root.updateMatrixWorld(true)
    }
  }
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    // 部分管道/工业模型包围球不准，开启裁剪会整模消失
    mesh.frustumCulled = false
    mesh.geometry?.computeBoundingSphere?.()
    mesh.geometry?.computeBoundingBox?.()
  })
  return root
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
  )
}

function modelResourcePath(url: string): string {
  const i = url.lastIndexOf('/')
  return i >= 0 ? url.slice(0, i + 1) : ''
}

/** 用 fetch 拉主文件，便于在离开 3D 页时用 AbortSignal 中止请求 */
async function fetchModelSource(
  url: string,
  signal: AbortSignal | undefined,
  as: 'arrayBuffer' | 'text',
): Promise<ArrayBuffer | string> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let res: Response
  try {
    res = await fetch(url, { signal, credentials: 'same-origin' })
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    throw err
  }
  if (!res.ok) {
    throw new Error(`模型加载失败：${res.status} ${url}`)
  }
  return as === 'text' ? res.text() : res.arrayBuffer()
}

const sharedGeometries = new WeakSet<BufferGeometry>()
const sharedTextures = new WeakSet<Texture>()

type ParsedModelEntry = {
  template: Object3D | null
  inflight: Promise<Object3D> | null
}

/** 按编码后的文件 URL 缓存已解析模板（同一窗口内换页可复用，新窗口需重解析） */
const parsedModelCache = new Map<string, ParsedModelEntry>()

function forEachSurface(
  root: Object3D,
  visit: (obj: Object3D, geometry: BufferGeometry | undefined, materials: Material[]) => void,
) {
  root.traverse((obj) => {
    const anyObj = obj as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }
    if (!anyObj.geometry && !anyObj.material) return
    const materials = anyObj.material
      ? Array.isArray(anyObj.material)
        ? anyObj.material
        : [anyObj.material]
      : []
    visit(obj, anyObj.geometry, materials)
  })
}

function collectMaterialTextures(mat: Material): Texture[] {
  const out: Texture[] = []
  for (const value of Object.values(mat)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) {
      out.push(value as Texture)
    }
  }
  return out
}

function markTemplateShared(root: Object3D) {
  forEachSurface(root, (_obj, geometry, materials) => {
    if (geometry) sharedGeometries.add(geometry)
    for (const mat of materials) {
      for (const tex of collectMaterialTextures(mat)) sharedTextures.add(tex)
    }
  })
}

function hasSkinnedMesh(root: Object3D): boolean {
  let found = false
  root.traverse((obj) => {
    if ((obj as SkinnedMesh).isSkinnedMesh) found = true
  })
  return found
}

function cloneParsedModel(template: Object3D): Object3D {
  const root = hasSkinnedMesh(template) ? cloneSkinnedModel(template) : template.clone(true)
  forEachSurface(root, (obj, _geometry, materials) => {
    const anyObj = obj as Object3D & { material?: Material | Material[] }
    if (!materials.length) return
    if (Array.isArray(anyObj.material)) {
      anyObj.material = materials.map((m) => m.clone())
    } else if (anyObj.material) {
      anyObj.material = materials[0].clone()
    }
  })
  return root
}

/**
 * 释放场景中的模型实例。
 * 默认不释放缓存模板上共享的几何与贴图；半成品/失效模板传 disposeShared。
 */
export function disposeLoadedModelGraph(root: Object3D, opts?: { disposeShared?: boolean }) {
  const force = opts?.disposeShared === true
  forEachSurface(root, (_obj, geometry, materials) => {
    if (geometry && (force || !sharedGeometries.has(geometry))) {
      geometry.dispose()
    }
    for (const mat of materials) {
      if (!mat) continue
      if (force) {
        for (const tex of collectMaterialTextures(mat)) tex.dispose()
      }
      mat.dispose()
    }
  })
}

/** 资源文件被替换/删除后，丢掉对应解析模板，避免继续克隆旧网格 */
export function invalidateParsedModelCache(url: string) {
  const key = encodeModelUrl(url)
  const entry = parsedModelCache.get(key)
  if (!entry) return
  parsedModelCache.delete(key)
  if (entry.template) {
    disposeLoadedModelGraph(entry.template, { disposeShared: true })
    entry.template = null
  }
}

async function parseModelFromUrl(
  loadUrl: string,
  fileName: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Object3D> {
  const ext = modelExtFromUrl(loadUrl, fileName) || 'glb'
  let root: Object3D

  if (ext === 'glb' || ext === 'gltf') {
    const data = (await fetchModelSource(loadUrl, signal, 'arrayBuffer')) as ArrayBuffer
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const gltf = await gltfLoader.parseAsync(data, modelResourcePath(loadUrl))
    root = gltf.scene
  } else if (ext === 'obj') {
    const text = (await fetchModelSource(loadUrl, signal, 'text')) as string
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    root = objLoader.parse(text)
  } else if (ext === 'fbx') {
    const data = (await fetchModelSource(loadUrl, signal, 'arrayBuffer')) as ArrayBuffer
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    root = fbxLoader.parse(data, modelResourcePath(loadUrl))
  } else if (ext === 'stl') {
    const data = (await fetchModelSource(loadUrl, signal, 'arrayBuffer')) as ArrayBuffer
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const geometry = stlLoader.parse(data)
    geometry.computeVertexNormals()
    root = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.1, roughness: 0.6 }),
    )
  } else {
    const data = (await fetchModelSource(loadUrl, signal, 'arrayBuffer')) as ArrayBuffer
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const gltf = await gltfLoader.parseAsync(data, modelResourcePath(loadUrl))
    root = gltf.scene
  }

  if (signal?.aborted) {
    disposeLoadedModelGraph(root, { disposeShared: true })
    throw new DOMException('Aborted', 'AbortError')
  }
  const prepared = prepareModelRoot(root)
  if (signal?.aborted) {
    disposeLoadedModelGraph(prepared, { disposeShared: true })
    throw new DOMException('Aborted', 'AbortError')
  }
  return prepared
}

/** 加载模型为可挂场景的 Object3D。同一文件只完整解析一次，后续实例克隆（几何共享、材质拆开）。 */
export async function loadModelObject(
  url: string,
  opts?: { fileName?: string; signal?: AbortSignal },
): Promise<Object3D> {
  const loadUrl = encodeModelUrl(url)
  const signal = opts?.signal
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const key = loadUrl
  let entry = parsedModelCache.get(key)
  if (entry?.template) {
    return cloneParsedModel(entry.template)
  }

  if (!entry) {
    entry = { template: null, inflight: null }
    parsedModelCache.set(key, entry)
  }

  if (!entry.inflight && !entry.template) {
    const parseSignal = signal
    entry.inflight = (async () => {
      try {
        const prepared = await parseModelFromUrl(loadUrl, opts?.fileName, parseSignal)
        if (parseSignal?.aborted) {
          disposeLoadedModelGraph(prepared, { disposeShared: true })
          throw new DOMException('Aborted', 'AbortError')
        }
        markTemplateShared(prepared)
        entry!.template = prepared
        return prepared
      } catch (err) {
        if (!entry!.template && parsedModelCache.get(key) === entry) {
          parsedModelCache.delete(key)
        }
        throw err
      } finally {
        if (entry) entry.inflight = null
      }
    })()
  }

  try {
    const template = entry.template ?? (await entry.inflight)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!template) throw new DOMException('Aborted', 'AbortError')
    return cloneParsedModel(template)
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (isAbortError(err) && !parsedModelCache.get(key)?.template) {
      // 首次解析被其它调用方中止：用当前 signal 再拉一次，不要把半成品当模板
      return loadModelObject(url, opts)
    }
    if (isAbortError(err)) throw new DOMException('Aborted', 'AbortError')
    throw err
  }
}

/** 对 /api/files/... 路径按段 encode，保留 data:/blob:/绝对 http */
function encodeModelUrl(url: string): string {
  if (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  ) {
    return url
  }
  try {
    return url
      .split('/')
      .map((seg, i) => (i === 0 && seg === '' ? '' : encodeURIComponent(decodeURIComponent(seg))))
      .join('/')
  } catch {
    return url
      .split('/')
      .map((seg, i) => (i === 0 && seg === '' ? '' : encodeURIComponent(seg)))
      .join('/')
  }
}

/**
 * 远距离用包围盒代理，减轻大模型开销（Three.LOD）。
 * 注意：阈值必须随模型尺寸缩放；禁止空 far 层级（相机会退后到阈值外导致「只剩手柄」）。
 */
export function wrapWithDistanceLod(detail: Object3D, opts?: { mid?: number; far?: number }): LOD {
  detail.updateMatrixWorld(true)
  const box = new Box3().setFromObject(detail)
  const size = new Vector3()
  const center = new Vector3()
  if (!box.isEmpty()) {
    box.getSize(size)
    box.getCenter(center)
  } else {
    size.set(1, 1, 1)
  }

  const maxDim = Math.max(size.x, size.y, size.z, 0.15)
  // 相对模型尺寸：近处原模，稍远代理盒；不再使用「空白 far」（大管道 fit 后必踩中）
  const mid = opts?.mid ?? Math.max(25, maxDim * 12)

  const lod = new LOD()
  lod.userData.focusRoot = detail
  lod.addLevel(detail, 0)

  const proxyMat = new MeshStandardMaterial({
    color: 0x5b7ea6,
    flatShading: true,
    transparent: true,
    opacity: 0.85,
  })
  const proxy = new Mesh(
    new BoxGeometry(
      Math.max(0.15, size.x),
      Math.max(0.15, size.y),
      Math.max(0.15, size.z),
    ),
    proxyMat,
  )
  proxy.position.copy(center)
  proxy.castShadow = true
  proxy.receiveShadow = true
  proxy.frustumCulled = false
  proxy.visible = false
  lod.addLevel(proxy, mid)

  detail.visible = true
  return lod
}
