/**
 * 设计/运行场景观感：RoomEnvironment + 软阴影（Three 官方能力）
 * 参数来自 Page3D.presentation（可持久化）。
 */
import {
  Color,
  DirectionalLight,
  MathUtils,
  PMREMGenerator,
  PCFSoftShadowMap,
  Scene,
  WebGLRenderer,
  type Object3D,
  type AmbientLight,
  type Mesh,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Page3DPresentation } from '@web-scada/core'
import { resolvePage3DPresentation, sunPositionFromAngles } from '@web-scada/core'

export type ScenePresentationApi = {
  apply: (pres?: Page3DPresentation | null) => void
  dispose: () => void
}

export type ScenePresentationExtras = {
  shadowFloor?: Mesh | null
  controls?: OrbitControls | null
}

export function applyScenePresentation(
  renderer: WebGLRenderer,
  scene: Scene,
  dirLight: DirectionalLight,
  ambientLight: AmbientLight,
  extras?: ScenePresentationExtras | null,
): ScenePresentationApi {
  const opts: ScenePresentationExtras = extras ?? {}

  renderer.shadowMap.type = PCFSoftShadowMap

  const pmrem = new PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = env.texture

  const apply = (pres?: Page3DPresentation | null) => {
    const p = resolvePage3DPresentation(pres)

    if (p.backgroundMode === 'hemi') {
      // 天空感：略提亮的背景色（仍用用户选的 background 作底）
      const base = new Color(p.background)
      const sky = base.clone().lerp(new Color(0x87b8e8), 0.55)
      scene.background = sky
    } else {
      scene.background = new Color(p.background)
    }

    scene.environmentIntensity = p.environmentIntensity
    ambientLight.intensity = p.ambientIntensity

    dirLight.visible = p.sunEnabled
    dirLight.intensity = p.sunEnabled ? p.sunIntensity : 0
    const [sx, sy, sz] = sunPositionFromAngles(p.sunAzimuthDeg, p.sunElevationDeg, 20)
    dirLight.position.set(sx, sy, sz)
    dirLight.target.position.set(0, 0, 0)
    dirLight.target.updateMatrixWorld()
    if (!dirLight.target.parent) scene.add(dirLight.target)

    const shadowsOn = p.shadowsEnabled && p.sunEnabled
    renderer.shadowMap.enabled = shadowsOn
    dirLight.castShadow = shadowsOn
    dirLight.shadow.bias = p.shadowBias

    const size = p.shadowMapSize
    if (dirLight.shadow.mapSize.x !== size || dirLight.shadow.mapSize.y !== size) {
      dirLight.shadow.mapSize.set(size, size)
      if (dirLight.shadow.map) {
        dirLight.shadow.map.dispose()
        dirLight.shadow.map = null as unknown as typeof dirLight.shadow.map
      }
    }
    dirLight.shadow.camera.near = 0.5
    dirLight.shadow.camera.far = 80
    dirLight.shadow.camera.left = -25
    dirLight.shadow.camera.right = 25
    dirLight.shadow.camera.top = 25
    dirLight.shadow.camera.bottom = -25
    dirLight.shadow.camera.updateProjectionMatrix()

    if (opts.shadowFloor) {
      opts.shadowFloor.visible = shadowsOn && p.groundOpacity > 0.01
      const mat = opts.shadowFloor.material as { opacity?: number; needsUpdate?: boolean }
      if (mat && typeof mat.opacity === 'number') {
        mat.opacity = shadowsOn ? p.groundOpacity : 0
        mat.needsUpdate = true
      }
    }

    if (opts.controls) {
      // 只写限位，勿在此 update()：createScene3D 初始化阶段 update 会派发
      // change → 访问尚未声明的 lodDirty，导致「场景初始化失败」
      opts.controls.minDistance = p.cameraMinDistance
      opts.controls.maxDistance = p.cameraMaxDistance
      opts.controls.minPolarAngle = MathUtils.degToRad(p.cameraMinPolarDeg)
      opts.controls.maxPolarAngle = MathUtils.degToRad(p.cameraMaxPolarDeg)
    }
  }

  apply(null)

  return {
    apply,
    dispose: () => {
      env.texture.dispose()
      pmrem.dispose()
      if (scene.environment === env.texture) scene.environment = null
    },
  }
}

/** 地面接收阴影：半透明平面（网格之下） */
export function enableReceiveShadowTree(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean }
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
}
