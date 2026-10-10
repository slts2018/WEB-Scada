import type { Page3DPresentation } from '../types/project'

/** 与历史 createScene3D / scenePresentation 硬编码一致，并含网格/阳光角/相机限位 */
export const DEFAULT_PAGE3D_PRESENTATION = {
  background: '#12151c',
  backgroundMode: 'color',
  environmentIntensity: 0.55,
  ambientIntensity: 0.45,
  sunEnabled: true,
  sunIntensity: 1.05,
  sunAzimuthDeg: 35,
  sunElevationDeg: 55,
  shadowsEnabled: true,
  shadowMapSize: 1024,
  shadowBias: -0.0002,
  gridVisible: true,
  gridColor: '#3d8bfd',
  gridDivisionColor: '#2a3140',
  groundOpacity: 0.32,
  cameraMinDistance: 0.5,
  cameraMaxDistance: 500,
  cameraMinPolarDeg: 5,
  cameraMaxPolarDeg: 89,
} as const satisfies Required<Page3DPresentation>

export type ResolvedPage3DPresentation = {
  background: string
  backgroundMode: 'color' | 'hemi'
  environmentIntensity: number
  ambientIntensity: number
  sunEnabled: boolean
  sunIntensity: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  shadowsEnabled: boolean
  shadowMapSize: number
  shadowBias: number
  gridVisible: boolean
  gridColor: string
  gridDivisionColor: string
  groundOpacity: number
  cameraMinDistance: number
  cameraMaxDistance: number
  cameraMinPolarDeg: number
  cameraMaxPolarDeg: number
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function finiteOr(n: number | undefined, fallback: number) {
  return n != null && Number.isFinite(n) ? n : fallback
}

export function resolvePage3DPresentation(
  partial?: Page3DPresentation | null,
): ResolvedPage3DPresentation {
  const d = DEFAULT_PAGE3D_PRESENTATION
  const p = partial ?? {}
  const mapSize = p.shadowMapSize
  const mode = p.backgroundMode === 'hemi' ? 'hemi' : 'color'
  let minDist = Math.max(0.05, finiteOr(p.cameraMinDistance, d.cameraMinDistance))
  let maxDist = Math.max(minDist + 0.05, finiteOr(p.cameraMaxDistance, d.cameraMaxDistance))
  let minPolar = clamp(finiteOr(p.cameraMinPolarDeg, d.cameraMinPolarDeg), 0, 179)
  let maxPolar = clamp(finiteOr(p.cameraMaxPolarDeg, d.cameraMaxPolarDeg), 0.1, 180)
  if (maxPolar <= minPolar) maxPolar = Math.min(180, minPolar + 1)

  return {
    background: p.background?.trim() || d.background,
    backgroundMode: mode,
    environmentIntensity: clamp(finiteOr(p.environmentIntensity, d.environmentIntensity), 0, 3),
    ambientIntensity: clamp(finiteOr(p.ambientIntensity, d.ambientIntensity), 0, 3),
    sunEnabled: p.sunEnabled !== false,
    sunIntensity: clamp(finiteOr(p.sunIntensity, d.sunIntensity), 0, 5),
    sunAzimuthDeg: ((finiteOr(p.sunAzimuthDeg, d.sunAzimuthDeg) % 360) + 360) % 360,
    sunElevationDeg: clamp(finiteOr(p.sunElevationDeg, d.sunElevationDeg), 1, 89),
    shadowsEnabled: p.shadowsEnabled !== false,
    shadowMapSize:
      mapSize === 512 || mapSize === 1024 || mapSize === 2048 || mapSize === 4096
        ? mapSize
        : d.shadowMapSize,
    shadowBias: finiteOr(p.shadowBias, d.shadowBias),
    gridVisible: p.gridVisible !== false,
    gridColor: p.gridColor?.trim() || d.gridColor,
    gridDivisionColor: p.gridDivisionColor?.trim() || d.gridDivisionColor,
    groundOpacity: clamp(finiteOr(p.groundOpacity, d.groundOpacity), 0, 1),
    cameraMinDistance: minDist,
    cameraMaxDistance: maxDist,
    cameraMinPolarDeg: minPolar,
    cameraMaxPolarDeg: maxPolar,
  }
}

/** 由水平角/高度角得到平行光方向位置（距离原点 r） */
export function sunPositionFromAngles(
  azimuthDeg: number,
  elevationDeg: number,
  radius = 20,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const c = Math.cos(el)
  return [radius * c * Math.sin(az), radius * Math.sin(el), radius * c * Math.cos(az)]
}
