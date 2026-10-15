/**
 * 液位层几何与连接量程的回归测试（纯逻辑，不需要浏览器）。
 * 运行：node --test scripts/liquid-level.test.ts
 *
 * 这里锁住两条关键不变量：
 *   1) 液面从「罐底」往上长 —— 任何液位下，液体底面都贴在罐底
 *   2) 「位移 Y」「缩放 Y」两条连接必须用同一变量与量程 → 同一个归一化比例
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLiquidLevelNode,
  resolveLiquidLevelGeometry,
  resolveLiquidLevelFraction,
  syncLiquidLevelNode,
} from '../packages/core/src/factory/object3dLiquid.ts'
import { PRIMITIVE_SOURCE_SIZE_M } from '../packages/core/src/factory/object3dSize.ts'

/** 简化版量程映射（与 runtime 的 mapRange 同式） */
function mapRange(value, inMin, inMax, outMin, outMax) {
  const span = (inMax - inMin) || 1
  const t = Math.min(1, Math.max(0, (value - inMin) / span))
  return outMin + t * (outMax - outMin)
}

const CYL_BASE_H = PRIMITIVE_SOURCE_SIZE_M.cylinder[1]
const CYL_BASE_R = PRIMITIVE_SOURCE_SIZE_M.cylinder[0] / 2

function makeTank(sourceSize) {
  return {
    id: 'tank_1',
    name: '罐',
    modelResourceId: 'res_x',
    sourceSize,
    sourceUnit: 'm',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    style: {},
    visible: true,
    bindings: [],
    animations: [],
    animationLinks: [],
    events: [],
  }
}

test('圆罐（储气罐 2.3×4.0×2.54）自动用圆柱，且液体略小于内壁', () => {
  const tank = makeTank([2.3, 4.0, 2.54])
  const geo = resolveLiquidLevelGeometry(tank, { inset: 0.03 })
  assert.equal(geo.shape, 'cylinder')
  assert.equal(geo.bottomY, -2)
  assert.ok(Math.abs(geo.height - 4.0 * 0.97) < 1e-9)
  // 半径取横截面较小边的一半，保证不穿壁
  assert.ok(Math.abs(geo.radius - (2.3 * 0.97) / 2) < 1e-9)
  assert.ok(Math.abs(geo.fullScale[1] - geo.height / CYL_BASE_H) < 1e-9)
  assert.ok(Math.abs(geo.fullScale[0] - geo.radius / CYL_BASE_R) < 1e-9)
})

test('方罐（显式 box）按长方体缩放，长宽高各自独立', () => {
  const tank = makeTank([3, 2, 5])
  const geo = resolveLiquidLevelGeometry(tank, { shape: 'box', inset: 0.05 })
  assert.equal(geo.shape, 'box')
  assert.ok(Math.abs(geo.fullScale[0] - 3 * 0.95) < 1e-9)
  assert.ok(Math.abs(geo.fullScale[1] - 2 * 0.95) < 1e-9)
  assert.ok(Math.abs(geo.fullScale[2] - 5 * 0.95) < 1e-9)
})

test('不变量：任何液位下液体底面都贴罐底，且高度正比于液位', () => {
  const tank = makeTank([2.3, 4.0, 2.54])
  const node = createLiquidLevelNode(tank, {
    tagId: 'demo.level',
    mode: 'primitive',
    inMin: 0,
    inMax: 100,
  })
  const moveV = node.animationLinks.find((l) => l.type === 'moveV')
  const height = node.animationLinks.find((l) => l.type === 'height')
  assert.ok(moveV && height)
  assert.equal(moveV.tagId, height.tagId)
  assert.equal(moveV.inMin, height.inMin)
  assert.equal(moveV.inMax, height.inMax)

  const geo = resolveLiquidLevelGeometry(tank, { inset: node.liquid.inset })
  const halfBody = (height.outMax * CYL_BASE_H) / 2
  for (const tagValue of [0, 10, 25, 50, 100]) {
    const centerY = mapRange(tagValue, moveV.inMin, moveV.inMax, moveV.outMin, moveV.outMax)
    const scaleY = mapRange(tagValue, height.inMin, height.inMax, height.outMin, height.outMax)
    const bottom = centerY - (scaleY * CYL_BASE_H) / 2
    const top = centerY + (scaleY * CYL_BASE_H) / 2
    assert.ok(Math.abs(bottom - geo.bottomY) < 1e-6, `t=${tagValue} 底面 ${bottom} 应贴罐底 ${geo.bottomY}`)
    const expectTop = geo.bottomY + geo.height * (tagValue / 100)
    assert.ok(Math.abs(top - expectTop) < 1e-6, `t=${tagValue} 液面 ${top} 应为 ${expectTop}`)
  }
  // 满液位时液面不得超过罐体内部高度
  assert.ok(geo.topY <= 4.0 / 2 + 1e-9)
  assert.ok(halfBody > 0)
})

test('改配置（颜色/量程/形状）后，两条连接 id 不变，量程同步更新', () => {
  const tank = makeTank([2, 4, 2])
  const first = createLiquidLevelNode(tank, { tagId: 'demo.level', mode: 'primitive' })
  const ids = first.animationLinks.map((l) => l.id)
  const next = syncLiquidLevelNode(tank, first, {
    tagId: 'demo.level',
    mode: 'primitive',
    inMin: 4,
    inMax: 20,
    color: '#ff0000',
    shape: 'box',
  })
  assert.deepEqual(next.animationLinks.map((l) => l.id), ids)
  assert.equal(next.liquid.color, '#ff0000')
  assert.equal(next.liquid.shape, 'box')
  for (const link of next.animationLinks) {
    assert.equal(link.inMin, 4)
    assert.equal(link.inMax, 20)
    assert.equal(link.tagId, 'demo.level')
  }
  assert.equal(next.style.color, '#ff0000')
  // 改形状后几何随之变化：长方体时 X/Z 缩放 = 实际尺寸
  assert.ok(Math.abs(next.transform.scale[0] - 2 * 0.97) < 1e-9)
})

test('变量值 → 液位比例：线性映射、越界钳制、欠测/坏质量返回 null', () => {
  const liquid = { inMin: 0, inMax: 100 }
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 0, quality: 'Good' }), 0)
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 50, quality: 'Good' }), 0.5)
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 100, quality: 'Good' }), 1)
  // 越界钳制
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 130, quality: 'Good' }), 1)
  assert.equal(resolveLiquidLevelFraction(liquid, { value: -5, quality: 'Good' }), 0)
  // 布尔量：量程 0~1 时 false=空、true=满
  assert.equal(resolveLiquidLevelFraction({ inMin: 0, inMax: 1 }, { value: false, quality: 'Good' }), 0)
  assert.equal(resolveLiquidLevelFraction({ inMin: 0, inMax: 1 }, { value: true, quality: 'Good' }), 1)
  // 变量缺失 / 测点坏
  assert.equal(resolveLiquidLevelFraction(liquid, undefined), null)
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 50, quality: 'Bad' }), null)
  assert.equal(resolveLiquidLevelFraction(liquid, { value: 50, quality: 'Offline' }), null)
})

test('形状模式：复制罐体几何、不加连接、等比内缩（任意罐形都不用调尺寸）', () => {
  const tank = makeTank([2.3, 4.0, 2.54])
  const node = createLiquidLevelNode(tank, { tagId: 'demo.level', mode: 'shape', inset: 0.03 })
  assert.equal(node.liquid.mode, 'shape')
  assert.equal(node.modelResourceId, tank.modelResourceId)
  assert.equal(node.primitive, undefined)
  assert.deepEqual(node.sourceSize, tank.sourceSize)
  assert.equal(node.animationLinks.length, 0)
  assert.deepEqual(node.transform.position, [0, 0, 0])
  for (const v of node.transform.scale) assert.ok(Math.abs(v - 0.97) < 1e-9)
  assert.equal(node.locked, true)
})

test('图元模式显式指定时仍生成两条连接（兼容旧数据）', () => {
  const tank = makeTank([2.3, 4.0, 2.54])
  const node = createLiquidLevelNode(tank, { tagId: 'demo.level', mode: 'primitive' })
  assert.equal(node.liquid.mode, 'primitive')
  assert.equal(node.modelResourceId, undefined)
  assert.equal(node.animationLinks.length, 2)
})

