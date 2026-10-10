/**
 * 将 Object3DMaterial 应用到场景网格（MeshStandardMaterial）。
 * 贴图异步加载；完成后回调 onUpdated 以便 invalidate。
 */
import {
  Box3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three'
import type { Object3DMaterial, Object3DTextureSlot } from '@web-scada/core'

const USER_DATA_MAT_TEX = 'scadaMatTextures'
const USER_DATA_MAP_SIG = 'scadaMatMapSig'
const USER_DATA_MAP_LOAD = 'scadaMatMapLoad'

const textureCache = new Map<string, Texture>()

type OwnedTextures = {
  map?: Texture
  emissiveMap?: Texture
  metalnessMap?: Texture
  bumpMap?: Texture
  extras?: Texture[]
}

type InFlightLoad = {
  sig: string
  cancel: () => void
}

function clamp01(n: number | undefined, fallback: number) {
  if (n == null || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** 编码 URL 路径段，避免中文文件名导致 TextureLoader 失败 */
export function encodeResourceUrl(url: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url)
      u.pathname = u.pathname
        .split('/')
        .map((seg) => {
          if (!seg) return seg
          try {
            return encodeURIComponent(decodeURIComponent(seg))
          } catch {
            return encodeURIComponent(seg)
          }
        })
        .join('/')
      return u.toString()
    }
    return url
      .split('/')
      .map((seg) => {
        if (!seg) return seg
        try {
          return encodeURIComponent(decodeURIComponent(seg))
        } catch {
          return encodeURIComponent(seg)
        }
      })
      .join('/')
  } catch {
    return url
  }
}

function applySlotUv(tex: Texture, slot: Object3DTextureSlot) {
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.offset.set(slot.offsetU ?? 0, slot.offsetV ?? 0)
  tex.repeat.set(slot.repeatU ?? 1, slot.repeatV ?? 1)
  tex.needsUpdate = true
}

function loadTexture(
  slot: Object3DTextureSlot | undefined,
  resolveUrl: (id: string) => string | undefined,
  colorSpace: 'srgb' | 'linear',
): Promise<Texture | null> {
  if (!slot?.resourceId) return Promise.resolve(null)
  const raw = resolveUrl(slot.resourceId)
  if (!raw) {
    console.warn('[material] texture url missing for', slot.resourceId)
    return Promise.resolve(null)
  }
  const url = encodeResourceUrl(raw)

  const cacheKey = `${url}|${colorSpace}`
  const cached = textureCache.get(cacheKey)
  if (cached) {
    const clone = cached.clone()
    clone.colorSpace = colorSpace === 'srgb' ? SRGBColorSpace : cached.colorSpace
    clone.needsUpdate = true
    applySlotUv(clone, slot)
    return Promise.resolve(clone)
  }

  return new Promise((resolve) => {
    const loader = new TextureLoader()
    const isLocal =
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('/') ||
      (typeof window !== 'undefined' && url.startsWith(window.location.origin))
    if (!isLocal) loader.setCrossOrigin('anonymous')

    loader.load(
      url,
      (tex) => {
        if (colorSpace === 'srgb') tex.colorSpace = SRGBColorSpace
        tex.needsUpdate = true
        textureCache.set(cacheKey, tex)
        const clone = tex.clone()
        if (colorSpace === 'srgb') clone.colorSpace = SRGBColorSpace
        clone.needsUpdate = true
        applySlotUv(clone, slot)
        resolve(clone)
      },
      undefined,
      (err) => {
        console.warn('[material] texture load failed', url, err)
        resolve(null)
      },
    )
  })
}

function disposeOwned(root: Object3D) {
  const owned = root.userData[USER_DATA_MAT_TEX] as OwnedTextures | undefined
  if (!owned) return
  owned.map?.dispose()
  owned.emissiveMap?.dispose()
  owned.metalnessMap?.dispose()
  owned.bumpMap?.dispose()
  owned.extras?.forEach((t) => t.dispose())
  delete root.userData[USER_DATA_MAT_TEX]
}

/** 把非 Standard 材质升级为 MeshStandardMaterial，否则贴图写不进去 */
function ensureStandardMaterials(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = mats.map((m) => {
      const std = m as MeshStandardMaterial
      if (std?.isMeshStandardMaterial) return std
      const src = m as Material & {
        color?: Color
        opacity?: number
        transparent?: boolean
        map?: Texture | null
      }
      const upgraded = new MeshStandardMaterial({
        color: src.color?.clone?.() ?? new Color(0xffffff),
        metalness: 0.1,
        roughness: 0.6,
        transparent: Boolean(src.transparent),
        opacity: src.opacity ?? 1,
        map: src.map ?? null,
      })
      src.dispose?.()
      return upgraded
    })
    mesh.material = next.length === 1 ? next[0] : next
  })
}

function forEachStdMat(root: Object3D, fn: (m: MeshStandardMaterial) => void) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as MeshStandardMaterial
      if (std?.isMeshStandardMaterial) fn(std)
    }
  })
}

/** 缺 UV 或 UV 全挤在一点时，贴图会采样成单色（常见全黑）；补一套包围盒投影 UV */
function ensureGeometryUVs(root: Object3D) {
  root.updateMatrixWorld(true)
  const rootBox = new Box3().setFromObject(root)
  if (rootBox.isEmpty()) return
  const rootSize = new Vector3()
  rootBox.getSize(rootSize)
  const maxDim = Math.max(rootSize.x, rootSize.y, rootSize.z, 1e-3)

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geo = mesh.geometry as BufferGeometry
    const uvAttr = geo.getAttribute('uv')
    let need = !uvAttr || uvAttr.count === 0
    if (!need && uvAttr) {
      let minU = Infinity
      let maxU = -Infinity
      let minV = Infinity
      let maxV = -Infinity
      const n = Math.min(uvAttr.count, 256)
      for (let i = 0; i < n; i++) {
        const u = uvAttr.getX(i)
        const v = uvAttr.getY(i)
        if (u < minU) minU = u
        if (u > maxU) maxU = u
        if (v < minV) minV = v
        if (v > maxV) maxV = v
      }
      // 几乎无跨度 → 整模采同一个像素
      if (maxU - minU < 1e-4 && maxV - minV < 1e-4) need = true
    }
    if (!need) return

    const pos = geo.getAttribute('position')
    if (!pos) return
    const box = new Box3().setFromBufferAttribute(pos as never)
    const size = new Vector3()
    box.getSize(size)
    const sx = Math.max(size.x, 1e-6)
    const sy = Math.max(size.y, 1e-6)
    const sz = Math.max(size.z, 1e-6)
    // 选跨度最大的两个轴做平面投影，保证花纹铺开
    const uvs = new Float32Array(pos.count * 2)
    const useXY = sx >= sz && sy >= sz
    const useXZ = sx >= sy && sz >= sy
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      let u: number
      let v: number
      if (useXY) {
        u = (x - box.min.x) / sx
        v = (y - box.min.y) / sy
      } else if (useXZ) {
        u = (x - box.min.x) / sx
        v = (z - box.min.z) / sz
      } else {
        u = (z - box.min.z) / sz
        v = (y - box.min.y) / sy
      }
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
    }
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    geo.attributes.uv.needsUpdate = true
    // 与模型整体尺度无关的标记，便于调试
    mesh.userData.scadaUvGenerated = maxDim
  })
}

function resolveEmissiveHex(material: Object3DMaterial): string {
  const hasEmissiveMap = Boolean(material.maps?.emissive?.resourceId)
  let emissive = material.emissive || '#000000'
  if (hasEmissiveMap) {
    const c = new Color(emissive)
    if (c.r + c.g + c.b < 0.05) emissive = '#ffffff'
  }
  return emissive
}

/** 同步写入颜色 / PBR / 透明 / 双面（不含贴图） */
export function applyObject3DMaterialSync(root: Object3D, material: Object3DMaterial) {
  ensureStandardMaterials(root)
  const hasDiffuseMap = Boolean(material.maps?.diffuse?.resourceId)
  if (hasDiffuseMap) ensureGeometryUVs(root)
  // 有漫反射贴图时强制白色，避免底色把照片乘暗
  let color = material.color || '#3d8bfd'
  if (hasDiffuseMap) color = '#ffffff'
  const emissive = resolveEmissiveHex(material)
  const opacity = clamp01(material.opacity, 1)
  let metalness = clamp01(material.metalness, 0.1)
  // 无环境贴图时高金属度会整模发黑；有漫反射图时压低金属度才能看见花纹
  if (hasDiffuseMap && !material.maps?.metalness?.resourceId) {
    metalness = Math.min(metalness, 0.05)
  } else if (material.maps?.metalness?.resourceId && metalness < 0.35) {
    metalness = 1
  }
  let roughness = clamp01(material.roughness, 0.6)
  if (hasDiffuseMap) roughness = Math.max(roughness, 0.45)
  const side = material.side === 'double' ? DoubleSide : FrontSide

  forEachStdMat(root, (m) => {
    m.color = new Color(color)
    m.emissive = new Color(emissive)
    m.metalness = metalness
    m.roughness = roughness
    m.transparent = opacity < 1
    m.opacity = opacity
    m.depthWrite = opacity >= 1
    m.side = side
    // GLTF 顶点色常把漫反射乘成全黑
    m.vertexColors = false
    // 原模 AO/光照贴图会压暗自定义漫反射
    if (hasDiffuseMap) {
      m.aoMap = null
      m.aoMapIntensity = 0
      m.lightMap = null
      m.lightMapIntensity = 1
    }
    m.needsUpdate = true
  })
}

function mapsSignature(material: Object3DMaterial): string {
  const m = material.maps
  if (!m) return ''
  const parts: string[] = []
  for (const key of ['diffuse', 'emissive', 'metalness', 'bump'] as const) {
    const s = m[key]
    if (!s?.resourceId) continue
    parts.push(
      `${key}:${s.resourceId}:${s.offsetU ?? 0}:${s.offsetV ?? 0}:${s.repeatU ?? 1}:${s.repeatV ?? 1}`,
    )
  }
  return parts.join('|')
}

function assignMapsToMaterials(
  root: Object3D,
  diffuse: Texture | null,
  emissiveMap: Texture | null,
  metalnessMap: Texture | null,
  bumpMap: Texture | null,
) {
  let first = true
  const ownedExtra: Texture[] = []
  forEachStdMat(root, (m) => {
    const take = (t: Texture | null) => {
      if (!t) return null
      if (first) return t
      const c = t.clone()
      c.needsUpdate = true
      ownedExtra.push(c)
      return c
    }
    m.map = take(diffuse)
    m.emissiveMap = take(emissiveMap)
    m.metalnessMap = take(metalnessMap)
    m.bumpMap = take(bumpMap)
    m.bumpScale = bumpMap ? 0.6 : 1
    if (diffuse) {
      m.color.set(0xffffff)
      m.vertexColors = false
      m.aoMap = null
      m.aoMapIntensity = 0
      // 无金属贴图时清掉原模金属贴图，避免把漫反射吃成黑
      if (!metalnessMap) {
        m.metalnessMap = null
        m.metalness = Math.min(m.metalness, 0.05)
      }
      m.roughness = Math.max(m.roughness, 0.45)
    }
    m.needsUpdate = true
    first = false
  })
  return ownedExtra
}

/**
 * 完整应用材质（含贴图）。贴图异步；加载完成后调用 onUpdated。
 * 同签名重复调用不会取消进行中的加载（避免预览 watch 把贴图冲掉）。
 */
export function applyObject3DMaterial(
  root: Object3D,
  material: Object3DMaterial,
  resolveUrl: (resourceId: string) => string | undefined,
  onUpdated?: () => void,
): () => void {
  applyObject3DMaterialSync(root, material)

  const sig = mapsSignature(material)
  const prevSig = root.userData[USER_DATA_MAP_SIG] as string | undefined
  const hasOwned = Boolean(root.userData[USER_DATA_MAT_TEX])
  const inFlight = root.userData[USER_DATA_MAP_LOAD] as InFlightLoad | undefined

  // 已挂上相同贴图
  if (sig === prevSig && hasOwned) {
    onUpdated?.()
    return () => undefined
  }

  // 相同签名正在加载：复用，勿取消
  if (inFlight && inFlight.sig === sig) {
    onUpdated?.()
    return inFlight.cancel
  }

  // 签名变了：取消旧加载
  if (inFlight && inFlight.sig !== sig) {
    inFlight.cancel()
  }

  disposeOwned(root)
  // 注意：MAP_SIG 等加载成功后再写，避免失败后被当成“已应用”

  if (!sig) {
    delete root.userData[USER_DATA_MAP_SIG]
    delete root.userData[USER_DATA_MAP_LOAD]
    forEachStdMat(root, (m) => {
      m.map = null
      m.emissiveMap = null
      m.metalnessMap = null
      m.bumpMap = null
      m.needsUpdate = true
    })
    onUpdated?.()
    return () => undefined
  }

  let cancelled = false
  const cancel = () => {
    cancelled = true
    const cur = root.userData[USER_DATA_MAP_LOAD] as InFlightLoad | undefined
    if (cur?.sig === sig) delete root.userData[USER_DATA_MAP_LOAD]
  }
  root.userData[USER_DATA_MAP_LOAD] = { sig, cancel } satisfies InFlightLoad

  const maps = material.maps
  void (async () => {
    const [diffuse, emissiveMap, metalnessMap, bumpMap] = await Promise.all([
      loadTexture(maps?.diffuse, resolveUrl, 'srgb'),
      loadTexture(maps?.emissive, resolveUrl, 'srgb'),
      loadTexture(maps?.metalness, resolveUrl, 'linear'),
      loadTexture(maps?.bump, resolveUrl, 'linear'),
    ])
    if (cancelled) {
      diffuse?.dispose()
      emissiveMap?.dispose()
      metalnessMap?.dispose()
      bumpMap?.dispose()
      return
    }

    const owned: OwnedTextures = {}
    if (diffuse) owned.map = diffuse
    if (emissiveMap) owned.emissiveMap = emissiveMap
    if (metalnessMap) owned.metalnessMap = metalnessMap
    if (bumpMap) owned.bumpMap = bumpMap
    const extras = assignMapsToMaterials(root, diffuse, emissiveMap, metalnessMap, bumpMap)
    if (extras.length) owned.extras = extras
    root.userData[USER_DATA_MAT_TEX] = owned
    root.userData[USER_DATA_MAP_SIG] = sig
    delete root.userData[USER_DATA_MAP_LOAD]

    const wanted =
      (maps?.diffuse?.resourceId ? 1 : 0) +
      (maps?.emissive?.resourceId ? 1 : 0) +
      (maps?.metalness?.resourceId ? 1 : 0) +
      (maps?.bump?.resourceId ? 1 : 0)
    const got =
      (diffuse ? 1 : 0) + (emissiveMap ? 1 : 0) + (metalnessMap ? 1 : 0) + (bumpMap ? 1 : 0)
    if (wanted > 0 && got === 0) {
      console.warn('[material] all texture slots failed to load', {
        diffuse: maps?.diffuse?.resourceId,
        url: maps?.diffuse?.resourceId ? resolveUrl(maps.diffuse.resourceId) : undefined,
      })
    } else if (wanted > got) {
      console.warn('[material] some texture slots failed to load', {
        diffuse: Boolean(diffuse),
        emissive: Boolean(emissiveMap),
        metalness: Boolean(metalnessMap),
        bump: Boolean(bumpMap),
      })
    }

    onUpdated?.()
  })()

  return cancel
}

/** 清除本模块挂上的贴图引用（不 dispose 材质本体） */
export function clearObject3DMaterialMaps(root: Object3D) {
  const inFlight = root.userData[USER_DATA_MAP_LOAD] as InFlightLoad | undefined
  inFlight?.cancel()
  disposeOwned(root)
  delete root.userData[USER_DATA_MAP_SIG]
  delete root.userData[USER_DATA_MAP_LOAD]
  forEachStdMat(root, (m) => {
    m.map = null
    m.emissiveMap = null
    m.metalnessMap = null
    m.bumpMap = null
    m.needsUpdate = true
  })
}
