/**
 * 管道流动的纯配置数学回归测试（不需要浏览器/GPU）。
 * 运行：node --test scripts/pipe-flow.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chevronStroke,
  skinArrowStroke,
  resolveFlowAxisLocal,
  resolveFlowRibbon,
  resolveFlowSideBasis,
  resolveFlowStripe,
} from '../packages/core/src/factory/pipeFlow.ts'

/** 工程里真实的两个模型尺寸（米） */
const PIPE = [0.027, 0.274, 0.027]
const HOSE = [0.102, 0.021, 0.021]

test('流向轴自动识别：管道长轴 Y、软管长轴 X（直管即管长方向）', () => {
  assert.deepEqual(resolveFlowAxisLocal('auto', PIPE), [0, 1, 0])
  assert.deepEqual(resolveFlowAxisLocal('auto', HOSE), [1, 0, 0])
  assert.deepEqual(resolveFlowAxisLocal('auto', [1, 2, 3]), [0, 0, 1])
})

test('流向轴可手动指定（弯管/异形件兜底）', () => {
  assert.deepEqual(resolveFlowAxisLocal('x', PIPE), [1, 0, 0])
  assert.deepEqual(resolveFlowAxisLocal('y', HOSE), [0, 1, 0])
  assert.deepEqual(resolveFlowAxisLocal('z', PIPE), [0, 0, 1])
})

test('条纹间隔自动：细管约 6 倍管径（2.7cm 管 → 16cm 一道）', () => {
  const stripe = resolveFlowStripe(PIPE)
  assert.ok(Math.abs(stripe - 0.162) < 1e-9, '实际 ' + stripe)
  // 软管最细边 2.1cm → 约 12.6cm
  assert.ok(Math.abs(resolveFlowStripe(HOSE) - 0.126) < 1e-9)
})

test('条纹间隔：显式配置优先；过小/过大都夹住', () => {
  assert.equal(resolveFlowStripe(PIPE, 0.4), 0.4)
  assert.equal(resolveFlowStripe(PIPE, 0.001), 0.162) // 太小视为无效 → 回自动
  assert.equal(resolveFlowStripe([0.0005, 0.2, 0.0005]), 0.03) // 地板
  assert.equal(resolveFlowStripe([1, 5, 1]), 0.6) // 天花板
})

test('条纹间隔与管长无关（被拉伸 8~17 倍也不会拉花）', () => {
  const short = resolveFlowStripe([0.027, 0.274, 0.027])
  const long = resolveFlowStripe([0.027, 4.6, 0.027]) // 同一根管拉伸 17 倍
  assert.equal(short, long)
})

test('绕轴基：与流向垂直、正交且单位长度（箭头靠它包裹整圈）', () => {
  for (const axis of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.577, 0.577, 0.577], [0, -1, 0]]) {
    const { b1, b2 } = resolveFlowSideBasis(axis)
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    const len = (u) => Math.hypot(u[0], u[1], u[2])
    assert.ok(Math.abs(dot(b1, axis)) < 1e-6, 'b1 应垂直于轴')
    assert.ok(Math.abs(dot(b2, axis)) < 1e-6, 'b2 应垂直于轴')
    assert.ok(Math.abs(dot(b1, b2)) < 1e-6, 'b1 ⟂ b2')
    assert.ok(Math.abs(len(b1) - 1) < 1e-6 && Math.abs(len(b2) - 1) < 1e-6)
  }
})

test('发光斜箭：斜线形状正确（尾部宽、尖端收成一点，中间空心）', () => {
  const opts = { len: 0.4, width: 1, thick: 0.2, glow: 0 }
  const tip = 0.55 + 0.4 * 0.6 // = 0.79
  const back = tip - 0.4
  // 尖端：只有 ang≈0 亮
  assert.ok(chevronStroke(tip - 1e-3, 0, opts) > 0.5, '尖端中心应亮')
  assert.equal(chevronStroke(tip - 1e-3, 0.6, opts), 0, '尖端远处应暗')
  // 尾端：亮的位置在 |ang|≈width
  assert.ok(chevronStroke(back + 1e-3, 1, opts) > 0.5, '尾端外侧应亮')
  assert.equal(chevronStroke(back + 1e-3, 0.1, opts), 0, '尾端内侧（空心）应暗')
  // 周期之外不亮
  assert.equal(chevronStroke(tip + 0.1, 0, opts), 0)
  assert.equal(chevronStroke(back - 0.05, 0, opts), 0)
})

test('发光斜箭：双斜（»）= 前后两条，且带光晕', () => {
  const opts = { len: 0.4, width: 1, thick: 0.2 }
  const tip = 0.55 + 0.4 * 0.6
  const gap = 0.4 * 0.45
  const frontOn = chevronStroke(tip - 1e-3, 0, { ...opts, glow: 0 })
  const backOn = chevronStroke(tip - gap - 1e-3, 0, { ...opts, glow: 0 })
  assert.ok(frontOn > 0.5 && backOn > 0.5, '两条斜箭都应在')
  const noGlow = chevronStroke(tip - 1e-3, 0.35, { ...opts, glow: 0 })
  const withGlow = chevronStroke(tip - 1e-3, 0.35, { ...opts, glow: 0.45 })
  assert.ok(withGlow > noGlow, '光晕让斜箭周围更亮')
})

test('浮空箭头尺寸：细管上也有看得见的大小，且与管长无关', () => {
  const short = resolveFlowRibbon([0.027, 0.274, 0.027])
  const long = resolveFlowRibbon([0.027, 4.6, 0.027]) // 同一根管拉伸 17 倍
  assert.equal(short.period, long.period)
  assert.equal(short.length, long.length)
  assert.equal(short.width, long.width)
  assert.ok(short.width >= 0.06, '宽度要有下限，细管上也看得见：' + short.width)
  assert.ok(short.length > 0 && short.length < short.period, '箭头应短于间隔')
  assert.equal(short.lift, 0, '箭头与管子同高（不浮空）')
  assert.ok(short.sideOffset > short.width * 0.5, '两侧偏移要让箭头贴到管壁外侧')
  assert.ok(Math.abs(short.headRatio - short.length / short.period) < 1e-9)
})

test('浮空箭头：显式间隔/大小优先', () => {
  const p = resolveFlowRibbon([0.3, 5, 0.3], { stripe: 3, size: 2 })
  assert.equal(p.period, 3)
  assert.equal(p.length, 2)
  const d = resolveFlowRibbon([0.3, 5, 0.3])
  assert.ok(d.period >= 0.6, '间隔有下限，避免细管上密到看不清：' + d.period)
})

test('贴皮箭头：只有贴皮中心角那一侧有箭头（默认 0.5），其余角度留空', () => {
  const opts = { len: 0.4, lobe: 0.45, glow: 0 }
  const tip = 0.55 + 0.4 * 0.6 // 0.79
  const back = tip - 0.4
  const shaftEnd = back + 0.4 * 0.62
  // 中心角上（默认 0.5）应有杆；对面一侧、垂直方向都要空
  assert.ok(skinArrowStroke(shaftEnd - 1e-3, 0.5, opts) > 0.5, '中心角上应有杆')
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, -0.5, opts), 0, '对面一侧应空')
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, 0, opts), 0, '垂直方向应空')
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, 1, opts), 0, '接缝方向应空')
  // 三角头比杆宽（这是"箭头"而不是"色块"的关键）：同一横向位置，杆不亮、头亮
  const headBase = shaftEnd + 0.01
  const lateral = 0.5 - 0.24
  assert.equal(skinArrowStroke(shaftEnd - 0.01, lateral, opts), 0, '该处杆子够不到')
  assert.ok(skinArrowStroke(headBase, lateral, opts) > 0.2, '头底部应更宽、该处应亮：' + skinArrowStroke(headBase, lateral, opts))
  // 尖端收成一点
  assert.ok(skinArrowStroke(tip - 1e-3, 0.5, opts) > 0, '尖端应在中线附近')
})

test('贴皮箭头：周期之外不亮', () => {
  const opts = { len: 0.4, lobe: 0.45, glow: 0 }
  const tip = 0.55 + 0.4 * 0.6
  assert.equal(skinArrowStroke(tip + 0.05, 0.5, opts), 0)
  assert.equal(skinArrowStroke(tip - 0.4 - 0.05, 0.5, opts), 0)
})

test('默认"长箭头 + 稀疏"：间隔 ≥3m、箭头 ≈0.72×间隔', () => {
  const p = resolveFlowRibbon([0.027, 0.274, 0.027])
  assert.ok(p.period >= 3, '间隔要够疏：' + p.period)
  assert.ok(Math.abs(p.length / p.period - 0.72) < 1e-9, '箭头要够长：' + p.length / p.period)
  assert.ok(p.length > 2, '细管上箭头也要有 2m 以上：' + p.length)
})

test('贴皮箭头：faceAng 指到哪一侧，箭头就在哪一侧（运行端每帧指向相机）', () => {
  const opts = { len: 0.4, lobe: 0.45, glow: 0 }
  const tip = 0.55 + 0.4 * 0.6
  const shaftEnd = tip - 0.4 + 0.4 * 0.62
  // faceAng = 0 → 箭头在 ang 0，原来的 ±0.5 处空
  assert.ok(skinArrowStroke(shaftEnd - 1e-3, 0, { ...opts, faceAng: 0 }) > 0.5, 'faceAng=0 处应有杆')
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, 0.5, { ...opts, faceAng: 0 }), 0, '原 ±0.5 处应空')
  // 跨过 ±1 接缝也要连续：faceAng = 0.95 时，ang = -0.95 只差 0.1
  assert.ok(
    skinArrowStroke(shaftEnd - 1e-3, -0.95, { ...opts, faceAng: 0.95 }) > 0.5,
    '绕管角接缝处不能断',
  )
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, 0, { ...opts, faceAng: 0.95 }), 0, '对面那一侧应空')
})

test('光晕默认关：glow=0 时箭头外侧没有柔光，拉大才有', () => {
  const opts = { len: 0.4, lobe: 0.45 }
  const tip = 0.55 + 0.4 * 0.6
  const back = tip - 0.4
  const shaftEnd = back + 0.4 * 0.62
  const ring = 0.5 - 0.22 // 杆子外侧、光晕范围内（杆半宽 0.153，光晕边界 0.29）
  assert.equal(skinArrowStroke(shaftEnd - 1e-3, ring, { ...opts, glow: 0 }), 0, 'glow=0 应无光晕')
  assert.ok(skinArrowStroke(shaftEnd - 1e-3, ring, { ...opts, glow: 0.45 }) > 0, 'glow>0 才有光晕')
})
