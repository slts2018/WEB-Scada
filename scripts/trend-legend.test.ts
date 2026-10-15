/**
 * 趋势图例排版（纯函数）契约。
 *
 * 重点回归：图例**不能静默丢条目**。
 * 之前是"一行放不下就直接 return"—— 画了 4 条曲线却只显示 3 个名字，
 * 用户看到一条没有名字的线，会以为"这条不是我绑的变量"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatLegendValue,
  maxTrendLegendRows,
  trendLegendLayout,
} from '../apps/web/src/shared/konva/trendLegendLayout.ts'

/** 假的文字度量：一个字符 ≈ 0.6 * fontSize */
const measure = (text: string, fontSize: number) => text.length * fontSize * 0.6
const colorOf = (index: number) => `#col${index}`
const makeCurves = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ tagId: `tag.${i}`, label: `变量${i}` }))

test('图例：窄图元也保证每条曲线都有条目（换行，不丢）', () => {
  const layout = trendLegendLayout({
    curves: makeCurves(4),
    hidden: new Set<string>(),
    width: 220,
    height: 240,
    fontSize: 14,
    colorOf,
    measure,
    valueOf: () => 42,
  })
  assert.equal(layout.entries.length, 4, '4 条曲线 → 4 个图例项')
  assert.ok(
    Math.max(...layout.entries.map((entry) => entry.row)) >= 1,
    '宽度不够时必须换行，而不是丢掉后两条',
  )
  assert.equal(layout.overflow, null)
  assert.ok(layout.height >= layout.rowHeight * 2, '两行图例要占两行高度')
  for (const entry of layout.entries) {
    assert.ok(entry.label.length > 0, '每个条目都要有名字')
    assert.ok(entry.labelW > 0)
    assert.equal(entry.value, '42.00')
  }
})

test('图例：条目超出最多行数 → 折叠成 +N，总数守恒', () => {
  const layout = trendLegendLayout({
    curves: makeCurves(12),
    hidden: new Set<string>(),
    width: 140,
    height: 120,
    fontSize: 14,
    colorOf,
    measure,
    valueOf: () => 1,
  })
  assert.ok(layout.overflow, '放不下时要有 +N 提示')
  assert.equal(
    layout.entries.length + Number(layout.overflow!.text.slice(1)),
    12,
    '图例条目 + N 必须等于曲线总数（数量不能丢）',
  )
  assert.ok(layout.entries.length >= 1)
})

test('图例：隐藏的曲线照样出现在图例里（置灰），颜色可被曲线自己覆盖', () => {
  const layout = trendLegendLayout({
    curves: [
      { tagId: 'demo.level', label: '液位', color: '#00ff00' },
      { tagId: 'demo.pressure' },
    ],
    hidden: new Set(['demo.level']),
    width: 600,
    height: 240,
    fontSize: 14,
    colorOf,
    measure,
    valueOf: () => null,
  })
  assert.equal(layout.entries.length, 2)
  assert.equal(layout.entries[0]!.hidden, true, '点掉的曲线不能从图例里消失')
  assert.equal(layout.entries[0]!.color, '#00ff00', '曲线自带颜色优先')
  assert.equal(layout.entries[1]!.color, '#col1', '没配颜色按序号取色板')
  assert.equal(layout.entries[1]!.value, '—', '没有采样显示 —（而不是 0）')
})

test('图例：最多行数按图元高度收敛', () => {
  assert.equal(maxTrendLegendRows(240, 20), 4, '高度够 → 上限 4 行')
  assert.equal(maxTrendLegendRows(120, 20), 2)
  assert.equal(maxTrendLegendRows(20, 20), 1, '再矮也至少一行')
})

test('图例：值格式化按量级收敛小数位', () => {
  assert.equal(formatLegendValue(undefined), '—')
  assert.equal(formatLegendValue(null), '—')
  assert.equal(formatLegendValue(Number.NaN), '—')
  assert.equal(formatLegendValue(12.3), '12.30')
  assert.equal(formatLegendValue(101.29), '101.3')
  assert.equal(formatLegendValue(12345.6), '12346')
})