/**
 * 趋势图元多曲线（props.curves）纯函数契约。
 * 重点回归：旧工程（没有 curves 字段 / 只有 props.min,max）行为必须不变 —— 单曲线仍走老路径。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TREND_MAX_CURVES,
  TREND_PALETTE,
  resolveTrendRange,
  trendCurveColor,
  trendCurveTagIds,
  trendCurves,
} from '../packages/core/src/factory/widget.ts'
import {
  clearCurveSamples,
  clearLiveSeries,
  curveSamples,
  curveTimes,
  liveSeriesOf,
  liveTrendTimes,
  pushCurveSample,
  pushLiveSeries,
  retainCurveTimeWindow,
} from '../apps/web/src/shared/runtime/trendSeries.ts'

test('trendCurves：旧工程没有 curves 字段 → 返回空数组（调用方回退单曲线）', () => {
  assert.deepEqual(trendCurves(undefined), [])
  assert.deepEqual(trendCurves({}), [])
  assert.deepEqual(trendCurves({ curves: null }), [])
  assert.deepEqual(trendCurves({ curves: 'whatever' }), [])
  assert.deepEqual(trendCurves({ series: '1,2,3' }), [], '旧的 props.series 不算曲线列表')
})

test('trendCurves：规范化字段（去空格 / 图例 / 颜色 / 缓冲 / 单曲线量程）', () => {
  const list = trendCurves({
    curves: [
      { tagId: '  demo.level  ', label: ' 液位 ', color: '#22d3ee', series: ['1', 2, 'x', 3] },
      { tagId: 'demo.temp', min: 0, max: 120 },
    ],
  })
  assert.equal(list.length, 2)
  assert.equal(list[0]!.tagId, 'demo.level')
  assert.equal(list[0]!.label, '液位')
  assert.equal(list[0]!.color, '#22d3ee')
  assert.deepEqual(list[0]!.series, [1, 2, 3])
  assert.equal(list[1]!.tagId, 'demo.temp')
  assert.equal(list[1]!.min, 0)
  assert.equal(list[1]!.max, 120)
  assert.equal(list[1]!.label, undefined)
})

test('trendCurves：坏数据被跳过；"还没选变量"的空行保留一行（面板里等你选）', () => {
  const props = {
    curves: [
      null,
      'oops',
      { label: '没有变量' },
      { tagId: '' },
      { tagId: 'a' },
      { tagId: 'a', label: '重复' },
      { tagId: 'b' },
    ],
  }
  assert.deepEqual(
    trendCurves(props).map((curve) => curve.tagId),
    ['', 'a', 'b'],
    '空行保留一行，重复的 tagId 丢掉',
  )
  assert.deepEqual(trendCurveTagIds(props), ['a', 'b'], '空行不算"已绑定变量"')
})

test('trendCurves：最多 8 条（超出直接截断）', () => {
  const curves = Array.from({ length: 20 }, (_, i) => ({ tagId: `tag${i}` }))
  assert.equal(trendCurves({ curves }).length, TREND_MAX_CURVES)
  assert.equal(TREND_MAX_CURVES, 8)
})

test('trendCurveColor：按序号循环内置色板，负数也不会越界', () => {
  assert.equal(trendCurveColor(0), TREND_PALETTE[0])
  assert.equal(trendCurveColor(7), TREND_PALETTE[7])
  assert.equal(trendCurveColor(8), TREND_PALETTE[0])
  assert.equal(trendCurveColor(-1), TREND_PALETTE[TREND_PALETTE.length - 1])
  assert.equal(trendCurveColor(0.9), TREND_PALETTE[0])
})

test('resolveTrendRange：给了合理量程就用它（单曲线沿用图元 min/max 的旧行为）', () => {
  assert.deepEqual(resolveTrendRange([1, 2, 3], { min: 0, max: 100 }), { min: 0, max: 100 })
  assert.deepEqual(resolveTrendRange([5, 9], { min: undefined, max: undefined }), { min: 5, max: 9 })
  assert.deepEqual(resolveTrendRange([5, 9], { min: 3, max: 3 }), { min: 5, max: 9 })
  assert.deepEqual(resolveTrendRange([5, 9], { min: 9, max: 3 }), { min: 5, max: 9 })
})

test('resolveTrendRange：多曲线自动缩放带留边（pad），常值曲线不退化成 0 跨度', () => {
  const auto = resolveTrendRange([10, 20], undefined, { pad: true })
  assert.ok(auto.min < 10 && auto.max > 20, '应上下留边：' + JSON.stringify(auto))
  const flat = resolveTrendRange([7, 7, 7], undefined, { pad: true })
  assert.ok(flat.max > flat.min, '常值曲线也要有跨度：' + JSON.stringify(flat))
  const empty = resolveTrendRange([], undefined, { pad: true })
  assert.deepEqual(empty, { min: 0, max: 1 }, '空序列给固定 0~1，不留无意义的负边距')
})

test('trendSeries：多曲线缓冲按「图元|变量」分桶，并按 maxPoints 截断', () => {
  for (let i = 1; i <= 7; i++) pushCurveSample('w1', 'demo.level', i, 5)
  pushCurveSample('w1', 'demo.pressure', 100, 5)
  pushCurveSample('w2', 'demo.level', -1, 5)
  assert.deepEqual(curveSamples('w1', 'demo.level'), [3, 4, 5, 6, 7], '只保留最后 5 个点')
  assert.deepEqual(curveSamples('w1', 'demo.pressure'), [100])
  assert.deepEqual(curveSamples('w2', 'demo.level'), [-1], '不同图元互不影响')
  assert.equal(curveSamples('w1', 'not-exist'), undefined)

  clearCurveSamples('w1', 'demo.level')
  assert.equal(curveSamples('w1', 'demo.level'), undefined, '删除曲线后缓存要清掉')
})

test('trendSeries：单曲线缓冲在没有数据时返回 undefined（渲染层回退 props.series 示例数据）', () => {
  assert.equal(liveSeriesOf('w-none'), undefined)
  pushLiveSeries('w3', 10, 40)
  pushLiveSeries('w3', 12, 40)
  assert.deepEqual(liveSeriesOf('w3'), [10, 12])
  clearLiveSeries('w3')
  assert.equal(liveSeriesOf('w3'), undefined)
})

test('trendSeries：maxPoints 非法时兜底 40，且不小于 5', () => {
  pushLiveSeries('w4', 1, Number.NaN)
  for (let i = 0; i < 100; i++) pushLiveSeries('w4', i, 1)
  const list = liveSeriesOf('w4')
  assert.ok(list && list.length <= 40, '默认最多 40 点：' + (list ? list.length : 'undefined'))
  clearLiveSeries('w4')
})

test('trendSeries：采样同时记时间戳（趋势图用时间轴画，不按点数均分）', () => {
  pushCurveSample('w9', 'demo.level', 1, 5, 1000)
  pushCurveSample('w9', 'demo.level', 2, 5, 2000)
  pushCurveSample('w9', 'demo.level', 3, 5, 3000)
  assert.deepEqual(curveSamples('w9', 'demo.level'), [1, 2, 3])
  assert.deepEqual(curveTimes('w9', 'demo.level'), [1000, 2000, 3000])

  for (let i = 1; i <= 6; i++) pushLiveSeries('w9', i, 5, 5000 + i * 1000)
  assert.deepEqual(liveSeriesOf('w9'), [2, 3, 4, 5, 6], '超上限后值与时间戳一起截断')
  assert.deepEqual(liveTrendTimes('w9'), [7000, 8000, 9000, 10000, 11000])
  clearLiveSeries('w9')
  assert.equal(liveTrendTimes('w9'), undefined)
})

test('retainCurveTimeWindow：快变量和慢变量裁到同一段时间，左边不会先被裁掉', () => {
  for (let i = 0; i < 6; i++) pushCurveSample('win', 'slow', i, 5000, i * 10000)
  for (let i = 0; i <= 50; i++) pushCurveSample('win', 'fast', i, 5000, i * 1000)
  // 下限是 5 个点：慢变量 6 个点里最近 5 个从 10s 到 50s
  retainCurveTimeWindow('win', ['slow', 'fast'], 5)
  const slowT = curveTimes('win', 'slow')
  const fastT = curveTimes('win', 'fast')
  assert.ok(slowT && fastT)
  assert.equal(slowT[0], 10000, '慢变量最近 5 个点从 10s 起')
  assert.ok(fastT[0] <= 11000, '快变量要留到同一起点附近，不能只剩最后几个点')
  assert.ok(fastT.length > 5, '同一段时间里快变量可以多于 maxPoints：' + fastT.length)
  clearCurveSamples('win', 'slow')
  clearCurveSamples('win', 'fast')
})

test('trendSeries：某个 tick 没有可用值 → 进 null（时间轴仍对齐，线上留缺口）', () => {
  pushCurveSample('w10', 'demo.level', 1, 5, 1000)
  pushCurveSample('w10', 'demo.level', null, 5, 2000)
  pushCurveSample('w10', 'demo.level', 3, 5, 3000)
  assert.deepEqual(curveSamples('w10', 'demo.level'), [1, null, 3])
  assert.deepEqual(curveTimes('w10', 'demo.level'), [1000, 2000, 3000], '时间戳照样对齐')
  clearCurveSamples('w10', 'demo.level')
})