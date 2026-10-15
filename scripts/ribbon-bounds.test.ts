/**
 * 浮空箭头（ribbon）隐藏后不能撑大宿主对象的包围盒。
 *
 * 背景：three 的 Box3.setFromObject / BoxHelper 会遍历**不可见**子节点，
 * 浮空箭头平面是挂在管子上的子 mesh，如果隐藏时还留着上一次的放大 scale，
 * 选中黄框和「看选中 / 适配」的取景就会被这块隐形大平面撑大 ——
 * 用户看到的现象是"配置完流动以后模型外壳变这么大了"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  ensureFlowRibbon,
  hideFlowRibbon,
  updateFlowRibbon,
} from '../apps/web/src/shared/three/flowRibbon.ts'

/** three 装在 apps/web 下（scripts 目录里没有），从那里解析 */
type ThreeNS = Record<string, any>
const { Box3, Color, Group, Mesh, PlaneGeometry, Vector3 } = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
)('three') as ThreeNS

/** 造一根 1 米长的"管子"，浮空箭头挂在它身上 */
function makePipe() {
  const pipe = new Group()
  const body = new Mesh(new PlaneGeometry(1, 1))
  body.scale.set(0.3, 0.3, 0.3)
  pipe.add(body)
  return pipe
}

const sizeOf = (obj: unknown) => new Box3().setFromObject(obj).getSize(new Vector3())

test('浮空箭头不参与包围盒（黄框/取景只按模型），隐藏后也一样', () => {
  const pipe = makePipe()
  const bare = sizeOf(pipe)

  const handle = ensureFlowRibbon(pipe, { value: 0 })
  updateFlowRibbon(pipe, {
    center: new Vector3(0, 0, 0),
    axisWorld: new Vector3(1, 0, 0),
    worldLength: 6,
    width: 0.5,
    lift: 0,
    sideOffset: 0.3,
    headRatio: 0.7,
    period: 3,
    color: new Color('#22c55e'),
    alpha: 0.85,
    glow: 0,
    phaseSpeed: 0.5,
  })
  assert.ok(handle.meshes.every((m: any) => m.visible), '上屏后箭头平面应可见')
  const shown = sizeOf(pipe)
  assert.ok(
    Math.max(shown.x, shown.y, shown.z) < 0.5,
    '箭头是装饰，不该算进包围盒：' + shown.toArray(),
  )

  hideFlowRibbon(pipe)
  const hidden = sizeOf(pipe)
  assert.ok(
    Math.abs(hidden.x - bare.x) < 0.01 &&
      Math.abs(hidden.y - bare.y) < 0.01 &&
      Math.abs(hidden.z - bare.z) < 0.01,
    `隐藏后应回到管子本体尺寸：bare=${bare.toArray()} hidden=${hidden.toArray()}`,
  )
})

test('新建的浮空箭头平面默认不影响包围盒', () => {
  const pipe = makePipe()
  const bare = sizeOf(pipe)
  ensureFlowRibbon(pipe, { value: 0 })
  const after = sizeOf(pipe)
  assert.ok(
    Math.abs(after.x - bare.x) < 0.01 && Math.abs(after.z - bare.z) < 0.01,
    `未上屏的平面不该撑大包围盒：bare=${bare.toArray()} after=${after.toArray()}`,
  )
})

test('两片浮空箭头都贴在管子两侧，不会有一片飘走', () => {
  // 回归：updateFlowRibbon 里 basePos 曾与 decompose 的输出共用同一个 Vector3，
  // 第二片箭头会以「第一片的局部位置」为基准 → 整体飘出好几米，把宿主包围盒撑大
  // （用户看到的现象：配置完流动以后，模型外壳的黄色选中框变得巨大）。
  const pipe = makePipe()
  const handle = ensureFlowRibbon(pipe, { value: 0 })
  const sideOffset = 0.9
  const worldLength = 1.46
  const width = 0.6
  const center = new Vector3(0, 0, 0)
  updateFlowRibbon(pipe, {
    center,
    axisWorld: new Vector3(0, 1, 0),
    worldLength,
    width,
    lift: 0,
    sideOffset,
    headRatio: 0.72,
    period: 3,
    color: new Color('#67e8f9'),
    alpha: 0.85,
    glow: 0,
    phaseSpeed: 0.5,
  })

  const spots = handle.meshes.map((m: any) => m.getWorldPosition(new Vector3()))
  spots.forEach((pt: any, i: number) => {
    const d = pt.distanceTo(center)
    assert.ok(
      Math.abs(d - sideOffset) < 0.05,
      `第 ${i + 1} 片箭头应贴在管子两侧（离中心约 ${sideOffset} 米），实测 ${d.toFixed(2)} 米`,
    )
  })

  // 装饰平面完全不算进包围盒：黄框仍只框管子本体
  const size = sizeOf(pipe)
  assert.ok(
    Math.max(size.x, size.y, size.z) < 0.5,
    '包围盒不该被箭头平面撑大：' + size.toArray(),
  )
})
