/**
 * 将 Object3DMaterial 应用到场景网格（MeshStandardMaterial）。
 * 贴图异步加载；完成后回调 onUpdated 以便 invalidate。
 */
import {
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Object3D,
} from 'three'
import type { Object3DMaterial, Object3DTextureSlot } from '@web-scada/core'

const USER_DATA_MAT_TEX = 'scadaMatTextures'
const textureLoader = new TextureLoader()
const textureCache = new Map<string, Texture>()

type OwnedTextures = {
  map?: Texture
  emissiveMap?: Texture
  metalnessMap?: Texture
  bumpMap?: Texture
}

function clamp01(n: number | undefined, fallback: number) {
  if (n == null || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
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
  const url = resolveUrl(slot.resourceId)
  if (!url) return Promise.resolve(null)

  const cacheKey = `${url}|${colorSpace}`
  const cached = textureCache.get(cacheKey)
  if (cached) {
    const clone = cached.clone()
    clone.colorSpace = colorSpace === 'srgb' ? SRGBColorSpace : cached.colorSpace
    applySlotUv(clone, slot)
    return Promise.resolve(clone)
  }

  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (tex) => {
        if (colorSpace === 'srgb') tex.colorSpace = SRGBColorSpace
        textureCache.set(cacheKey, tex)
        const clone = tex.clone()
        if (colorSpace === 'srgb') clone.colorSpace = SRGBColorSpace
        applySlotUv(clone, slot)
        resolve(clone)
      },
      undefined,
      () => resolve(null),
    )
  })
}

function disposeOwned(root: Object3D) {
  const owned = root.userData[USER_DATA_MAT_TEX] as OwnedTextures | undefined
  if (!owned) return
  for (const t of Object.values(owned)) {
    t?.dispose()
  }
  delete root.userData[USER_DATA_MAT_TEX]
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

/** 同步写入颜色 / PBR / 透明 / 双面（不含贴图） */
export function applyObject3DMaterialSync(root: Object3D, material: Object3DMaterial) {
  const color = material.color || '#3d8bfd'
  const emissive = material.emissive || '#000000'
  const opacity = clamp01(material.opacity, 1)
  const metalness = clamp01(material.metalness, 0.1)
  const roughness = clamp01(material.roughness, 0.6)
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
    m.needsUpdate = true
  })
}

const USER_DATA_MAP_SIG = 'scadaMatMapSig'

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

/**
 * 完整应用材质（含贴图）。贴图异步；加载完成后调用 onUpdated。
 * maps 签名未变时只同步 PBR 数值，避免滑条拖动反复加载贴图。
 * 返回取消函数。
 */
export function applyObject3DMaterial(
  root: Object3D,
  material: Object3DMaterial,
  resolveUrl: (resourceId: string) => string | undefined,
  onUpdated?: () => void,
): () => void {
  let cancelled = false
  applyObject3DMaterialSync(root, material)

  const sig = mapsSignature(material)
  const prevSig = root.userData[USER_DATA_MAP_SIG] as string | undefined
  if (sig === prevSig) {
    // 仅 UV 也可能变——已含在 sig；签名相同则贴图无需重载
    // 但仍需把已有贴图的 offset/repeat 写回（同 resource 改 UV 时 sig 会变）
    onUpdated?.()
    return () => {
      cancelled = true
    }
  }

  disposeOwned(root)
  root.userData[USER_DATA_MAP_SIG] = sig

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
    root.userData[USER_DATA_MAT_TEX] = owned

    forEachStdMat(root, (m) => {
      m.map = diffuse
      m.emissiveMap = emissiveMap
      m.metalnessMap = metalnessMap
      m.bumpMap = bumpMap
      m.bumpScale = bumpMap ? 0.05 : 1
      m.needsUpdate = true
    })
    onUpdated?.()
  })()

  return () => {
    cancelled = true
  }
}

/** 清除本模块挂上的贴图引用（不 dispose 材质本体） */
export function clearObject3DMaterialMaps(root: Object3D) {
  disposeOwned(root)
  delete root.userData[USER_DATA_MAP_SIG]
  forEachStdMat(root, (m) => {
    m.map = null
    m.emissiveMap = null
    m.metalnessMap = null
    m.bumpMap = null
    m.needsUpdate = true
  })
}
