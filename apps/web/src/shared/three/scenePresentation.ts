/**
 * 设计/运行场景观感：RoomEnvironment + 软阴影（Three 官方能力）
 * 参数来自 Page3D.presentation（可持久化）。
 */
import {
  Color,
  DirectionalLight,
  PMREMGenerator,
  PCFSoftShadowMap,
  Scene,
  WebGLRenderer,
  type Object3D,
  type AmbientLight,
  type Mesh,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Page3DPresentation } from '@web-scada/core'
import { resolvePage3DPresentation } from '@web-scada/core'

export type ScenePresentationApi = {
  apply: (pres?: Page3DPresentation | null) => void
  dispose: () => void
}

export function applyScenePresentation(
  renderer: WebGLRenderer,
  scene: Scene,
  dirLight: DirectionalLight,
  ambientLight: AmbientLight,
  shadowFloor?: Mesh | null,
): ScenePresentationApi {
  renderer.shadowMap.type = PCFSoftShadowMap

  const pmrem = new PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = env.texture

  const apply = (pres?: Page3DPresentation | null) => {
    const p = resolvePage3DPresentation(pres)
    scene.background = new Color(p.background)
    scene.environmentIntensity = p.environmentIntensity
    ambientLight.intensity = p.ambientIntensity

    dirLight.visible = p.sunEnabled
    dirLight.intensity = p.sunEnabled ? p.sunIntensity : 0

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

    if (shadowFloor) {
      shadowFloor.visible = shadowsOn
      const mat = shadowFloor.material as { opacity?: number }
      if (mat && typeof mat.opacity === 'number') mat.opacity = shadowsOn ? 0.32 : 0
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
