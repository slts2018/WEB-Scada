/**
 * 防双击误触单击门控单测。
 * 运行：node --test scripts/click-dblclick-gate.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createClickDblclickGate,
  DEFAULT_CLICK_DBLCLICK_DELAY_MS,
} from '../apps/web/src/shared/runtime/clickDblclickGate.ts'

function fakeTimers() {
  let nextId = 1
  /** @type {Map<number, { fn: () => void, at: number }>} */
  const jobs = new Map()
  let now = 0
  return {
    now: () => now,
    advance(ms) {
      now += ms
      for (const [id, job] of [...jobs.entries()]) {
        if (job.at <= now) {
          jobs.delete(id)
          job.fn()
        }
      }
    },
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++
        jobs.set(id, { fn, at: now + ms })
        return id
      },
      clearTimeout(id) {
        jobs.delete(id)
      },
    },
  }
}

test('无 dblclick：单击立即执行', () => {
  const ft = fakeTimers()
  const gate = createClickDblclickGate({ timers: ft.timers })
  const log = []
  gate.scheduleClick('a', () => log.push('click'), false)
  assert.deepEqual(log, ['click'])
  ft.advance(DEFAULT_CLICK_DBLCLICK_DELAY_MS + 10)
  assert.deepEqual(log, ['click'])
})

test('有 dblclick：单击延时后执行', () => {
  const ft = fakeTimers()
  const gate = createClickDblclickGate({ delayMs: 280, timers: ft.timers })
  const log = []
  gate.scheduleClick('a', () => log.push('click'), true)
  assert.deepEqual(log, [])
  ft.advance(279)
  assert.deepEqual(log, [])
  ft.advance(2)
  assert.deepEqual(log, ['click'])
})

test('有 dblclick：窗口内双击取消待执行单击', () => {
  const ft = fakeTimers()
  const gate = createClickDblclickGate({ delayMs: 280, timers: ft.timers })
  const log = []
  gate.scheduleClick('a', () => log.push('click1'), true)
  ft.advance(50)
  gate.scheduleClick('a', () => log.push('click2'), true)
  ft.advance(50)
  gate.triggerDblclick('a', () => log.push('dbl'))
  ft.advance(500)
  assert.deepEqual(log, ['dbl'])
})

test('不同 key 互不影响', () => {
  const ft = fakeTimers()
  const gate = createClickDblclickGate({ delayMs: 100, timers: ft.timers })
  const log = []
  gate.scheduleClick('a', () => log.push('a'), true)
  gate.scheduleClick('b', () => log.push('b'), true)
  gate.triggerDblclick('a', () => log.push('a-dbl'))
  ft.advance(100)
  assert.deepEqual(log, ['a-dbl', 'b'])
})

test('dispose 取消所有待执行单击', () => {
  const ft = fakeTimers()
  const gate = createClickDblclickGate({ delayMs: 100, timers: ft.timers })
  const log = []
  gate.scheduleClick('a', () => log.push('a'), true)
  gate.dispose()
  ft.advance(200)
  assert.deepEqual(log, [])
})
