/**
 * 运行端轻点/旋转判定的回归测试（纯逻辑，不需要浏览器）。
 * 运行：node --test scripts/runtime-tap-gate.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRuntimeTap,
  MOUSE_TAP_SLOP_PX,
  TAP_HARD_LIMIT_PX,
} from '../apps/web/src/shared/three/runtimeTapGate.ts'

const TARGET = { x: 0, y: 0.5, z: 0 }
/** 以焦点为圆心把相机方向旋转 deg 度（绕 Z 轴），得到「确实转了视角」的相机位置 */
function orbit(deg) {
  const r = (deg * Math.PI) / 180
  const dx = 6
  const dy = 4.5
  const dz = 8
  return {
    camPos: {
      x: TARGET.x + dx * Math.cos(r) - dy * Math.sin(r),
      y: TARGET.y + dx * Math.sin(r) + dy * Math.cos(r),
      z: TARGET.z + dz,
    },
    camTarget: TARGET,
  }
}

function start(x = 400, y = 300, deg = 0) {
  const o = orbit(deg)
  return { x, y, camPos: o.camPos, camTarget: o.camTarget }
}

test('轻点：零位移且相机未动 → 触发业务', () => {
  const v = classifyRuntimeTap(start(), { x: 400, y: 300, camPos: orbit(0).camPos, camTarget: TARGET })
  assert.equal(v.kind, 'tap')
  assert.equal(v.travelPx, 0)
})

test('轻点：手抖 3px、相机几乎没动 → 仍触发业务', () => {
  const v = classifyRuntimeTap(
    start(),
    { x: 402.5, y: 301.5, camPos: orbit(0.4).camPos, camTarget: TARGET },
    { pointerType: 'mouse' },
  )
  assert.equal(v.kind, 'tap')
  assert.ok(v.travelPx < MOUSE_TAP_SLOP_PX)
})

test('旋转：位移 8px 但相机真转了 → 不触发业务（旧实现会误触发写值）', () => {
  const v = classifyRuntimeTap(start(), {
    x: 408,
    y: 300,
    camPos: orbit(3).camPos,
    camTarget: TARGET,
  })
  assert.equal(v.kind, 'gesture')
  assert.ok(v.orbitDeg > 1.2, '相机转角应超过旋转容差: ' + v.orbitDeg)
  assert.ok(v.orbitDeg < 3.5, '相机转角不应过大: ' + v.orbitDeg)
  assert.match(v.reason, /相机已旋转/)
})

test('旋转：大幅拖拽 40px → 不触发业务', () => {
  const v = classifyRuntimeTap(start(), {
    x: 440,
    y: 320,
    camPos: orbit(15).camPos,
    camTarget: TARGET,
  })
  assert.equal(v.kind, 'gesture')
  assert.ok(v.travelPx > TAP_HARD_LIMIT_PX)
})

test('轻点：位移 10px 但相机完全没动（Orbit 未接管）→ 仍触发业务', () => {
  const v = classifyRuntimeTap(start(), { x: 410, y: 300, camPos: orbit(0).camPos, camTarget: TARGET })
  assert.equal(v.kind, 'tap')
  assert.match(v.reason, /相机未旋转/)
})

test('触摸：阈值放宽到 10px，8px 抖动仍算轻点', () => {
  const v = classifyRuntimeTap(
    start(),
    { x: 408, y: 300, camPos: orbit(1).camPos, camTarget: TARGET },
    { pointerType: 'touch' },
  )
  assert.equal(v.kind, 'tap')
  assert.equal(v.slopPx, 10)
})

test('触摸：长距离滑动 → 判为手势（不误触发写值）', () => {
  const v = classifyRuntimeTap(
    start(),
    { x: 460, y: 300, camPos: orbit(10).camPos, camTarget: TARGET },
    { pointerType: 'touch' },
  )
  assert.equal(v.kind, 'gesture')
})

test('位移 9px 且焦点明显位移（平移/接手）→ 判为手势', () => {
  const v = classifyRuntimeTap(
    start(),
    { x: 409, y: 300, camPos: { ...orbit(0).camPos, x: 8.2 }, camTarget: { x: 1.4, y: 0.5, z: 0 } },
  )
  assert.equal(v.kind, 'gesture')
})

test('已被拖拽写值接管的手势 → 一定是手势', () => {
  const v = classifyRuntimeTap(
    start(),
    { x: 400, y: 300, camPos: orbit(0).camPos, camTarget: TARGET },
    { forcedGesture: true },
  )
  assert.equal(v.kind, 'gesture')
})