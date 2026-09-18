import type { Page3DPresentation } from '../types/project'

/** 与历史 createScene3D / scenePresentation 硬编码一致 */
export const DEFAULT_PAGE3D_PRESENTATION = {
  background: '#12151c',
  environmentIntensity: 0.55,
  ambientIntensity: 0.45,
  sunEnabled: true,
  sunIntensity: 1.05,
  shadowsEnabled: true,
  shadowMapSize: 1024,
  shadowBias: -0.0002,
} as const satisfies Required<Page3DPresentation>

export type ResolvedPage3DPresentation = {
  background: string
  environmentIntensity: number
  ambientIntensity: number
  sunEnabled: boolean
  sunIntensity: number
  shadowsEnabled: boolean
  shadowMapSize: number
  shadowBias: number
}

export function resolvePage3DPresentation(
  partial?: Page3DPresentation | null,
): ResolvedPage3DPresentation {
  const d = DEFAULT_PAGE3D_PRESENTATION
  const p = partial ?? {}
  const mapSize = p.shadowMapSize
  return {
    background: p.background?.trim() || d.background,
    environmentIntensity:
      p.environmentIntensity != null && Number.isFinite(p.environmentIntensity)
        ? Math.max(0, Math.min(3, p.environmentIntensity))
        : d.environmentIntensity,
    ambientIntensity:
      p.ambientIntensity != null && Number.isFinite(p.ambientIntensity)
        ? Math.max(0, Math.min(3, p.ambientIntensity))
        : d.ambientIntensity,
    sunEnabled: p.sunEnabled !== false,
    sunIntensity:
      p.sunIntensity != null && Number.isFinite(p.sunIntensity)
        ? Math.max(0, Math.min(5, p.sunIntensity))
        : d.sunIntensity,
    shadowsEnabled: p.shadowsEnabled !== false,
    shadowMapSize:
      mapSize === 512 || mapSize === 1024 || mapSize === 2048 || mapSize === 4096
        ? mapSize
        : d.shadowMapSize,
    shadowBias:
      p.shadowBias != null && Number.isFinite(p.shadowBias) ? p.shadowBias : d.shadowBias,
  }
}
