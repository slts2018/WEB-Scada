/**
 * 管道流动材质注入：**不依赖模型 UV**，用「世界坐标 × 流向轴」生成伪 UV 条纹并随时间滚动。
 *
 * 为什么不用 UV 滚动：这套模型的 GLB 是 CAD 直出的（38 个模型 TEXCOORD_0 全为 0），没有可滚动的 UV。
 * 而管网是同一根"直管"复制出来的，所以用「物体局部最长轴的世界方向」当条纹轴：
 * - 每根直管都能得到沿管长滚动的条纹
 * - 条纹间隔按"米"算 → 被拉伸 8~17 倍的管子条纹密度一致，不会拉花
 * - 同轴的多段管子条纹在世界上连续（相位按世界坐标算）
 */
import { Color, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'

export interface FlowUniforms {
  uFlowEnabled: { value: number }
  uFlowTime: { value: number }
  /** 实际速度（米/秒，已乘速度系数；负值反向） */
  uFlowSpeed: { value: number }
  /** 条纹频率（1/米） */
  uFlowFreq: { value: number }
  uFlowColor: { value: Color }
  /** 条纹宽度占比 */
  uFlowDuty: { value: number }
  /** 0 = 停流时隐藏箭头/条纹 */
  uFlowIntensity: { value: number }
  /** 世界空间流向（单位向量） */
  uFlowAxis: { value: Vector3 }
  /** 0 = 条纹，1 = 箭头 */
  uFlowStyle: { value: number }
  /** 箭头横向张开 0.3~1（1 = 整圈包裹） */
  uFlowWidth: { value: number }
  /** 光晕强度：0 = 纯色（默认），>0 才有亮芯 + 外圈柔光 */
  uFlowGlow: { value: number }
  /** 物体中心（世界）：算"绕管一圈的角度"用 */
  uFlowCenter: { value: Vector3 }
  /** 与流向轴垂直的两个单位基（世界） */
  uFlowB1: { value: Vector3 }
  uFlowB2: { value: Vector3 }
  /** 斜箭 Stroke 粗细（绕管角度比例）0.06~0.5 */
  uFlowThick: { value: number }
  /**
   * 贴皮箭头所在的那一圈角度（-1..1，1 = 180°）。
   * 运行时要把它设成「管壁朝向相机的那一点」，箭头才会贴在**看得见的那一面**上；
   * 否则箭头会落在管子轮廓线上，正面看就是一条亮线（像描边 / 光晕）。
   */
  uFlowFaceAng: { value: number }
}

export interface FlowHandle {
  uniforms: FlowUniforms
  materials: MeshStandardMaterial[]
}

/** 默认条纹颜色（青） */
export const FLOW_DEFAULT_COLOR = '#67e8f9'
/** 默认条纹宽度占比 */
export const FLOW_DEFAULT_DUTY = 0.42

const HANDLE_KEY = 'scadaFlowHandle'
const MAT_KEY = 'scadaFlowInjected'
/** 改这里可强制所有材质重编译（注入逻辑变更时用） */
const SHADER_VERSION = 'scada-flow-v2'

function createUniforms(): FlowUniforms {
  return {
    uFlowEnabled: { value: 0 },
    uFlowTime: { value: 0 },
    uFlowSpeed: { value: 0 },
    uFlowFreq: { value: 1 / 0.2 },
    uFlowColor: { value: new Color(FLOW_DEFAULT_COLOR) },
    uFlowDuty: { value: FLOW_DEFAULT_DUTY },
    uFlowIntensity: { value: 0 },
    uFlowAxis: { value: new Vector3(0, 1, 0) },
    uFlowStyle: { value: 1 },
    uFlowWidth: { value: 1 },
    uFlowGlow: { value: 0 },
    uFlowCenter: { value: new Vector3(0, 0, 0) },
    uFlowB1: { value: new Vector3(1, 0, 0) },
    uFlowB2: { value: new Vector3(0, 0, 1) },
    uFlowThick: { value: 0.22 },
    uFlowFaceAng: { value: 0 },
  }
}

/**
 * 给物体上的所有 Standard 材质注入流动条纹（幂等）。
 * 各材质共用同一份 uniform 对象，所以每帧只更新一次即可。
 */
export function ensureFlowOnObject(obj: Object3D): FlowHandle {
  const existing = obj.userData[HANDLE_KEY] as FlowHandle | undefined
  if (existing) return existing
  const uniforms = createUniforms()
  const materials: MeshStandardMaterial[] = []
  obj.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of list) {
      const std = m as MeshStandardMaterial
      if (!std?.isMeshStandardMaterial) continue
      materials.push(std)
      if (std.userData[MAT_KEY] === SHADER_VERSION) continue
      std.userData[MAT_KEY] = SHADER_VERSION
      const previous = std.onBeforeCompile
      std.onBeforeCompile = (shader, renderer) => {
        previous?.call(std, shader, renderer)
        shader.uniforms.uFlowEnabled = uniforms.uFlowEnabled
        shader.uniforms.uFlowTime = uniforms.uFlowTime
        shader.uniforms.uFlowSpeed = uniforms.uFlowSpeed
        shader.uniforms.uFlowFreq = uniforms.uFlowFreq
        shader.uniforms.uFlowColor = uniforms.uFlowColor
        shader.uniforms.uFlowDuty = uniforms.uFlowDuty
        shader.uniforms.uFlowIntensity = uniforms.uFlowIntensity
        shader.uniforms.uFlowAxis = uniforms.uFlowAxis
        shader.uniforms.uFlowStyle = uniforms.uFlowStyle
        shader.uniforms.uFlowWidth = uniforms.uFlowWidth
        shader.uniforms.uFlowGlow = uniforms.uFlowGlow
        shader.uniforms.uFlowCenter = uniforms.uFlowCenter
        shader.uniforms.uFlowB1 = uniforms.uFlowB1
        shader.uniforms.uFlowB2 = uniforms.uFlowB2
        shader.uniforms.uFlowThick = uniforms.uFlowThick
        shader.uniforms.uFlowFaceAng = uniforms.uFlowFaceAng
        shader.vertexShader =
          'varying vec3 vScadaFlowPos;\n' +
          shader.vertexShader.replace(
            '#include <project_vertex>',
            'vScadaFlowPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>',
          )
        shader.fragmentShader =
          'varying vec3 vScadaFlowPos;\n' +
          'uniform float uFlowEnabled;\n' +
          'uniform float uFlowTime;\n' +
          'uniform float uFlowSpeed;\n' +
          'uniform float uFlowFreq;\n' +
          'uniform vec3 uFlowColor;\n' +
          'uniform float uFlowDuty;\n' +
          'uniform float uFlowIntensity;\n' +
          'uniform vec3 uFlowAxis;\n' +
          'uniform float uFlowStyle;\n' +
          'uniform float uFlowWidth;\n' +
          'uniform float uFlowGlow;\n' +
          'uniform vec3 uFlowCenter;\n' +
          'uniform vec3 uFlowB1;\n' +
          'uniform vec3 uFlowB2;\n' +
          'uniform float uFlowThick;\n' +
          'uniform float uFlowFaceAng;\n' +
          'float scadaFlowChevronOne( float u, float ang, float len, float width, float thick, float tipU ) {\n' +
'  float back = tipU - len;\n' +
'  if ( u < back || u > tipU ) return 0.0;\n' +
'  float spread = clamp( ( tipU - u ) / max( 1e-6, len ), 0.0, 1.0 );\n' +
'  float d = abs( abs( ang ) - spread * width );\n' +
'  float t = max( thick * 0.45, 1e-6 );\n' +
'  return 1.0 - smoothstep( t, max( t + 1e-6, thick ), d );\n' +
'}\n' +
'float scadaFlowChevron( float u, float ang, float len, float width, float thick, float tipU, float gap, float glow ) {\n' +
'  float core = max( scadaFlowChevronOne( u, ang, len, width, thick, tipU ), scadaFlowChevronOne( u, ang, len, width, thick, tipU - gap ) );\n' +
'  float halo = max( scadaFlowChevronOne( u, ang, len, width, thick * 3.0, tipU ), scadaFlowChevronOne( u, ang, len, width, thick * 3.0, tipU - gap ) );\n' +
'  return min( 1.0, core + glow * halo );\n' +
'}\n' +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  if ( uFlowEnabled > 0.5 && uFlowIntensity > 0.001 ) {
    vec3 flowRel = vScadaFlowPos - uFlowCenter;
    float flowAxial = dot( flowRel, uFlowAxis );
    float flowT = flowAxial * uFlowFreq - uFlowTime * uFlowSpeed * uFlowFreq;
    float flowU = fract( flowT );
    // 绕轴量：极径 + 绕管角度（-1..1，0 = 顶上，±0.5 = 两侧）——各样式共用
    float flowLat = length( flowRel - uFlowAxis * flowAxial );
    float flowAng = atan( dot( flowRel, uFlowB2 ), dot( flowRel, uFlowB1 ) ) / 3.14159265;
    float flowBand = 0.0;
    if ( uFlowStyle < 0.5 ) {
      // 贴皮箭头：一根「杆 + 三角头」贴管壁，中心角由 uFlowFaceAng 指到朝向相机的那一面，
      // 随管壁弯曲 → 任何视角都是一块贴皮箭头，而不是轮廓上的一条亮线
      float skinLen = clamp( uFlowDuty, 0.05, 0.6 );
      float skinTip = min( 0.98, 0.55 + skinLen * 0.6 );
      float skinBack = skinTip - skinLen;
      float skinShaftEnd = skinBack + skinLen * 0.62;
      float skinLobe = clamp( uFlowWidth, 0.1, 0.5 );
      // 绕管角度周期是 2（±1 是同一根线），取到贴皮中心角的最近距离
      float skinDelta = abs( flowAng - uFlowFaceAng );
      float skinD = min( skinDelta, 2.0 - skinDelta );
      float skinHalf = -1.0;
      if ( flowU >= skinBack && flowU <= skinTip ) {
        skinHalf = flowU <= skinShaftEnd
          ? skinLobe * 0.34
          : skinLobe * ( 1.0 - ( flowU - skinShaftEnd ) / max( 1e-4, skinTip - skinShaftEnd ) );
      }
      if ( skinHalf > 0.0 ) {
        float skinCore = 1.0 - smoothstep( skinHalf * 0.86, skinHalf, skinD );
        flowBand = skinCore;
        if ( uFlowGlow > 0.001 ) {
          float skinHalo = 1.0 - smoothstep( skinHalf * 0.9, skinHalf * 1.9, skinD );
          flowBand = min( 1.0, skinCore + uFlowGlow * skinHalo );
        }
      }
      flowBand *= smoothstep( 0.0, 0.06 / max( uFlowFreq, 1e-6 ), flowLat );
    } else if ( uFlowStyle < 1.5 ) {
      // 斜箭「»」：纯色（光晕由 uFlowGlow 控制）
      float flowLen = clamp( uFlowDuty, 0.05, 0.6 );
      float flowTip = min( 0.98, 0.55 + flowLen * 0.6 );
      float flowGap = flowLen * 0.45;
      float flowThick = clamp( uFlowThick, 0.06, 0.5 );
      flowBand = scadaFlowChevron( flowU, flowAng, flowLen, uFlowWidth, flowThick, flowTip, flowGap, uFlowGlow );
      flowBand *= smoothstep( 0.0, 0.06 / max( uFlowFreq, 1e-6 ), flowLat );
    } else if ( uFlowStyle < 2.5 ) {
      // 锥形箭头：尖端朝 +轴向，整圈包裹
      // 极细处淡出，避免管端封盖中心出现楔形花纹。
      float flowLen = max( 0.05, min( 0.9, uFlowDuty ) );
      float flowTip = min( 0.98, 0.35 + flowLen );
      float flowBack = flowTip - flowLen;
      float flowSpread = ( flowTip - flowU ) / max( 1e-4, flowTip - flowBack );
      flowBand = step( flowBack, flowU ) * step( flowU, flowTip )
        * ( 1.0 - step( flowSpread * uFlowWidth, abs( flowAng ) ) );
      flowBand *= smoothstep( 0.0, 0.08 / max( uFlowFreq, 1e-6 ), flowLat );
    } else {
      float flowHalf = max( 0.001, uFlowDuty * 0.5 );
      flowBand = smoothstep( 0.5 - flowHalf, 0.5 - flowHalf * 0.25, flowU )
        * ( 1.0 - smoothstep( 0.5 + flowHalf * 0.25, 0.5 + flowHalf, flowU ) );
    }
    flowBand *= uFlowIntensity;
    float flowAmt = clamp( flowBand, 0.0, 1.0 );
    // 默认纯色：只有 uFlowGlow > 0 时才把中心提亮成"亮芯"
    vec3 flowHot = mix( uFlowColor, vec3( 1.0 ), 0.55 * uFlowGlow * flowAmt );
    diffuseColor.rgb = mix( diffuseColor.rgb, flowHot, flowAmt * 0.95 );
    // 自发光也只跟 uFlowGlow 走：glow = 0 → 箭头就是一层"漆"，和管子一起受光，
    // 不会在暗面自己发亮（原来这里恒加 0.9×颜色，看着就是一圈光晕）
    totalEmissiveRadiance += uFlowColor * flowBand * 0.9 * uFlowGlow;
  }
}`,
          )
      }
      std.customProgramCacheKey = () => SHADER_VERSION
      std.needsUpdate = true
    }
  })
  const handle: FlowHandle = { uniforms, materials }
  obj.userData[HANDLE_KEY] = handle
  return handle
}