/**
 * 浮空平面箭头（ribbon）：在管子上方浮一块**世界水平**的平面，
 * 用着色器画「长杆 + 三角头」并沿流向漂移 —— 即"浮在平面上方的平面箭头"那种观感。
 *
 * 与画在管子表面的 chevron/条纹不同：这块平面法线朝上、不缠在管壁上，
 * 所以视觉上是"浮"在管子上面；深度测试照常，前面的管子会正常遮挡它。
 */
import {
  Box3,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three'

export interface FlowRibbonUniforms {
  uTime: { value: number }
  /** 一块平面里包含几个周期（= 平面长度 / 间隔） */
  uRepeat: { value: number }
  /** 相位速度（周期/秒 = 速度 m/s ÷ 间隔 m） */
  uPhaseSpeed: { value: number }
  /** 箭头长度占周期的比例 */
  uHeadRatio: { value: number }
  /** 杆的半宽（占平面半宽比例） */
  uShaftHalf: { value: number }
  /** 三角头的半宽（占平面半宽比例） */
  uHeadHalf: { value: number }
  uColor: { value: Color }
  uAlpha: { value: number }
  uEnabled: { value: number }
  /** 光晕强度：0 = 纯色（默认） */
  uGlow: { value: number }
}

export interface FlowRibbonHandle {
  /** 左右两片（贴在管子两侧） */
  meshes: Mesh[]
  uniforms: FlowRibbonUniforms
}

/** 隐藏时把平面收成一点，避免撑大宿主对象的包围盒 */
const HIDDEN_SCALE = 1e-4
const RIBBON_KEY = 'scadaFlowRibbon'
const UP = new Vector3(0, 1, 0)
const FALLBACK_X = new Vector3(1, 0, 0)

function createMaterial(sharedTime: { value: number }): ShaderMaterial {
  const uniforms: FlowRibbonUniforms = {
    uTime: sharedTime,
    uRepeat: { value: 1 },
    uPhaseSpeed: { value: 0 },
    uHeadRatio: { value: 0.62 },
    uShaftHalf: { value: 0.3 },
    uHeadHalf: { value: 1 },
    uColor: { value: new Color('#22c55e') },
    uAlpha: { value: 0.85 },
    uEnabled: { value: 0 },
    uGlow: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uRepeat;
      uniform float uPhaseSpeed;
      uniform float uHeadRatio;
      uniform float uShaftHalf;
      uniform float uHeadHalf;
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uEnabled;
      uniform float uGlow;
      void main() {
        if ( uEnabled < 0.5 ) discard;
        float u = fract( vUv.x * uRepeat - uTime * uPhaseSpeed );
        float t = u / max( 1e-4, uHeadRatio );
        if ( t > 1.0 ) discard;
        float v = abs( vUv.y - 0.5 ) * 2.0;
        float shaftEnd = 0.62;
        float halfW = t <= shaftEnd
          ? uShaftHalf
          : uHeadHalf * ( 1.0 - ( t - shaftEnd ) / ( 1.0 - shaftEnd ) );
        float a = 1.0 - smoothstep( halfW * 0.7, halfW, v );
        if ( uGlow > 0.001 ) {
          a = min( 1.0, a + 0.22 * uGlow * ( 1.0 - smoothstep( halfW, halfW * 2.0, v ) ) );
        }
        a *= smoothstep( 0.0, 0.10, t );
        a *= uAlpha;
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( uColor, a );
        #include <colorspace_fragment>
      }
    `,
  })
  material.userData.scadaFlowRibbonMaterial = true
  return material
}

/** 取（或创建）物体上的浮空箭头平面；平面作为物体子节点，随物体一起移动/卸载 */
export function ensureFlowRibbon(
  obj: Object3D,
  sharedTime: { value: number },
): FlowRibbonHandle {
  const existing = obj.userData[RIBBON_KEY] as FlowRibbonHandle | undefined
  if (existing) return existing
  const material = createMaterial(sharedTime)
  // 左右各一片：贴着管子两侧（不浮空）。每片单独一份几何，卸载时不会误伤别的箭头
  const meshes = [0, 1].map(() => {
    const geometry = new PlaneGeometry(1, 1)
    // 箭头是"装饰"，不该算进宿主对象的包围盒：
    // three 的 Box3.setFromObject / BoxHelper 只看 geometry.boundingBox（非精确模式），
    // 把它设成空盒 → 选中黄框、「看选中 / 适配」的取景都只按模型本身算，
    // 不会被这两片几米长的平面撑大。
    geometry.boundingBox = new Box3()
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 2
    mesh.visible = false
    mesh.position.set(0, 0, 0)
    mesh.scale.setScalar(HIDDEN_SCALE)
    obj.add(mesh)
    return mesh
  })
  const handle: FlowRibbonHandle = {
    meshes,
    uniforms: material.uniforms as unknown as FlowRibbonUniforms,
  }
  obj.userData[RIBBON_KEY] = handle
  return handle
}

export function getFlowRibbon(obj: Object3D): FlowRibbonHandle | undefined {
  return obj.userData[RIBBON_KEY] as FlowRibbonHandle | undefined
}

/** 关掉（隐藏）两侧箭头 */
export function hideFlowRibbon(obj: Object3D) {
  const handle = getFlowRibbon(obj)
  if (!handle) return
  for (const mesh of handle.meshes) {
    mesh.visible = false
    // 关键：three 的 Box3.setFromObject 会遍历**不可见**子节点。
    // 平面若留着上一次的放大 scale 和侧向偏移，选中黄框 / 看选中 的取景就会被这块
    // 隐形大平面撑大（用户看到的现象：配置完流动以后"模型外壳变这么大"）。
    // 收成原点上的一个点，包围盒就只剩管子本体。
    mesh.position.set(0, 0, 0)
    mesh.quaternion.identity()
    mesh.scale.setScalar(HIDDEN_SCALE)
  }
  handle.uniforms.uEnabled.value = 0
}

export interface FlowRibbonFrame {
  /** 物体中心（世界） */
  center: Vector3
  /** 世界流向（单位向量） */
  axisWorld: Vector3
  /** 沿流向的世界长度（米） */
  worldLength: number
  /** 平面宽度（米） */
  width: number
  /** 抬升（米）；0 = 与管子同高（贴两侧） */
  lift: number
  /** 单侧横向偏移（米） */
  sideOffset: number
  /** 箭头长度占周期比例 */
  headRatio: number
  /** 间隔（米） */
  period: number
  color: Color
  alpha: number
  /** 光晕强度 0~1（0 = 纯色） */
  glow: number
  /** 相位速度（周期/秒） */
  phaseSpeed: number
}

const _m = new Matrix4()
const _inv = new Matrix4()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _pos = new Vector3()
/** 基准中心单独留一个：_pos 是 decompose 的输出，不能再兼作基准，否则第二片箭头会飘走 */
const _base = new Vector3()
const _quat = new Quaternion()
const _scale = new Vector3()

/**
 * 摆正并更新浮空箭头：平面**世界水平**（法线朝上），长度方向对齐世界流向，
 * 位置抬到管子正上方。因为箭头是物体子节点，这里把目标世界变换换算成局部变换。
 */
export function updateFlowRibbon(obj: Object3D, frame: FlowRibbonFrame): void {
  const handle = getFlowRibbon(obj)
  if (!handle) return
  const { meshes, uniforms } = handle
  // 世界基：Z（法线）朝上，X 沿流向；流向接近竖直时用任意水平方向兜底
  _z.copy(UP)
  _x.copy(frame.axisWorld)
  if (Math.abs(_x.dot(UP)) > 0.95) _x.copy(FALLBACK_X)
  _x.y = 0
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0)
  _x.normalize()
  _y.crossVectors(_z, _x).normalize()
  // 世界基：X 沿流向、Y 横向、Z（法线）朝上 → 两片都在水平面内，贴在管子左右两侧
  obj.updateWorldMatrix(true, false)
  _inv.copy(obj.matrixWorld).invert()
  const basePos = _base.copy(frame.center).addScaledVector(UP, frame.lift)
  for (const [i, mesh] of meshes.entries()) {
    const side = i === 0 ? -1 : 1
    const center = new Vector3().copy(basePos).addScaledVector(_y, side * frame.sideOffset)
    _m.makeBasis(_x, _y, _z)
    _m.setPosition(center)
    _m.scale(new Vector3(frame.worldLength, frame.width, 1))
    _m.premultiply(_inv)
    _m.decompose(_pos, _quat, _scale)
    mesh.position.copy(_pos)
    mesh.quaternion.copy(_quat)
    mesh.scale.copy(_scale)
    mesh.visible = true
    mesh.updateMatrix()
  }
  // 单位（米）
  uniforms.uRepeat.value = Math.max(1e-3, frame.worldLength / frame.period)
  uniforms.uPhaseSpeed.value = frame.phaseSpeed
  uniforms.uHeadRatio.value = Math.max(0.05, Math.min(0.95, frame.headRatio))
  uniforms.uShaftHalf.value = 0.3
  uniforms.uHeadHalf.value = 1
  uniforms.uColor.value.copy(frame.color)
  uniforms.uAlpha.value = Math.max(0.1, Math.min(1, frame.alpha))
  uniforms.uGlow.value = Math.min(1, Math.max(0, frame.glow))
  uniforms.uEnabled.value = 1
}