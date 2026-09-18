/**
 * Three.js 共用底座占位。
 * Designer 与 Runtime 后续都从这里扩展场景/加载/选择能力。
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'

export interface BasicSceneBundle {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  dispose: () => void
}

export function createBasicScene(container: HTMLElement): BasicSceneBundle {
  const width = container.clientWidth || 640
  const height = container.clientHeight || 360

  const scene = new Scene()
  scene.background = new Color(0x12151c)

  const camera = new PerspectiveCamera(50, width / height, 0.1, 2000)
  camera.position.set(5, 5, 5)
  camera.lookAt(0, 0, 0)

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  container.appendChild(renderer.domElement)

  scene.add(new AmbientLight(0xffffff, 0.55))
  const dir = new DirectionalLight(0xffffff, 0.85)
  dir.position.set(6, 10, 4)
  scene.add(dir)

  const onResize = () => {
    const w = container.clientWidth || width
    const h = container.clientHeight || height
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', onResize)

  return {
    scene,
    camera,
    renderer,
    dispose: () => {
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
