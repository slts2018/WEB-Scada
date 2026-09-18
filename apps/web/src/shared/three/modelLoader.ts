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
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

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

/** 加载模型为可挂场景的 Object3D */
export async function loadModelObject(
  url: string,
  opts?: { fileName?: string },
): Promise<Object3D> {
  // 中文文件名等需按段编码，否则部分环境下加载失败
  const loadUrl = encodeModelUrl(url)
  const ext = modelExtFromUrl(url, opts?.fileName) || 'glb'
  let root: Object3D

  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await gltfLoader.loadAsync(loadUrl)
    root = gltf.scene
  } else if (ext === 'obj') {
    root = await objLoader.loadAsync(loadUrl)
  } else if (ext === 'fbx') {
    root = await fbxLoader.loadAsync(loadUrl)
  } else if (ext === 'stl') {
    const geometry = await stlLoader.loadAsync(loadUrl)
    geometry.computeVertexNormals()
    root = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.1, roughness: 0.6 }),
    )
  } else {
    const gltf = await gltfLoader.loadAsync(loadUrl)
    root = gltf.scene
  }

  return prepareModelRoot(root)
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
