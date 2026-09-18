import type { Widget2D } from '@web-scada/core'

/** 与画布网格一致 */
export const GRID = 20
export const GUIDE_THRESHOLD = 6

export function snap(value: number, grid = GRID) {
  return Math.round(value / grid) * grid
}

export function snapTransform(
  transform: Widget2D['transform'],
  grid = GRID,
): Widget2D['transform'] {
  return {
    ...transform,
    x: snap(transform.x, grid),
    y: snap(transform.y, grid),
    width: Math.max(grid, snap(transform.width, grid)),
    height: transform.height === 0 ? 0 : Math.max(0, snap(transform.height, grid)),
  }
}

export type AlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distributeH'
  | 'distributeV'

function bounds(w: Widget2D) {
  return {
    x: w.transform.x,
    y: w.transform.y,
    right: w.transform.x + w.transform.width,
    bottom: w.transform.y + w.transform.height,
    cx: w.transform.x + w.transform.width / 2,
    cy: w.transform.y + w.transform.height / 2,
  }
}

/** 返回 id -> 新 transform 的补丁 */
export function computeAlignPatches(
  widgets: Widget2D[],
  mode: AlignMode,
): Record<string, Widget2D['transform']> {
  if (widgets.length < 2 && !mode.startsWith('distribute')) return {}
  if (widgets.length < 2) return {}

  const patches: Record<string, Widget2D['transform']> = {}
  const bs = widgets.map((w) => ({ w, b: bounds(w) }))

  if (mode === 'left') {
    const x = Math.min(...bs.map((i) => i.b.x))
    for (const { w } of bs) patches[w.id] = { ...w.transform, x }
  } else if (mode === 'right') {
    const right = Math.max(...bs.map((i) => i.b.right))
    for (const { w } of bs) patches[w.id] = { ...w.transform, x: right - w.transform.width }
  } else if (mode === 'center') {
    const cx = bs.reduce((s, i) => s + i.b.cx, 0) / bs.length
    for (const { w } of bs) patches[w.id] = { ...w.transform, x: cx - w.transform.width / 2 }
  } else if (mode === 'top') {
    const y = Math.min(...bs.map((i) => i.b.y))
    for (const { w } of bs) patches[w.id] = { ...w.transform, y }
  } else if (mode === 'bottom') {
    const bottom = Math.max(...bs.map((i) => i.b.bottom))
    for (const { w } of bs) patches[w.id] = { ...w.transform, y: bottom - w.transform.height }
  } else if (mode === 'middle') {
    const cy = bs.reduce((s, i) => s + i.b.cy, 0) / bs.length
    for (const { w } of bs) patches[w.id] = { ...w.transform, y: cy - w.transform.height / 2 }
  } else if (mode === 'distributeH' && widgets.length >= 3) {
    const sorted = [...bs].sort((a, b) => a.b.x - b.b.x)
    const left = sorted[0].b.x
    const right = sorted[sorted.length - 1].b.right
    const totalW = sorted.reduce((s, i) => s + i.w.transform.width, 0)
    const gap = (right - left - totalW) / (sorted.length - 1)
    let cursor = left
    for (const item of sorted) {
      patches[item.w.id] = { ...item.w.transform, x: cursor }
      cursor += item.w.transform.width + gap
    }
  } else if (mode === 'distributeV' && widgets.length >= 3) {
    const sorted = [...bs].sort((a, b) => a.b.y - b.b.y)
    const top = sorted[0].b.y
    const bottom = sorted[sorted.length - 1].b.bottom
    const totalH = sorted.reduce((s, i) => s + i.w.transform.height, 0)
    const gap = (bottom - top - totalH) / (sorted.length - 1)
    let cursor = top
    for (const item of sorted) {
      patches[item.w.id] = { ...item.w.transform, y: cursor }
      cursor += item.w.transform.height + gap
    }
  }

  return patches
}

export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export interface GuideLine {
  orientation: 'v' | 'h'
  /** 页面坐标上的线位置 */
  pos: number
}

export interface SnapGuideResult {
  x: number
  y: number
  guides: GuideLine[]
}

/**
 * 拖拽时相对其它图元对齐吸附，并产出辅助线。
 * moving: 当前拖动包围盒（页面坐标）
 */
export function snapWithGuides(
  moving: { x: number; y: number; width: number; height: number },
  others: Array<{ x: number; y: number; width: number; height: number }>,
  opts?: { grid?: number; threshold?: number; snapGrid?: boolean },
): SnapGuideResult {
  const threshold = opts?.threshold ?? GUIDE_THRESHOLD
  const grid = opts?.grid ?? GRID
  let x = moving.x
  let y = moving.y
  const guides: GuideLine[] = []

  const mLeft = moving.x
  const mRight = moving.x + moving.width
  const mCx = moving.x + moving.width / 2
  const mTop = moving.y
  const mBottom = moving.y + moving.height
  const mCy = moving.y + moving.height / 2

  let bestDx = threshold + 1
  let bestDy = threshold + 1
  let snapX: number | null = null
  let snapY: number | null = null
  let guideV: number | null = null
  let guideH: number | null = null

  for (const o of others) {
    const oLeft = o.x
    const oRight = o.x + o.width
    const oCx = o.x + o.width / 2
    const oTop = o.y
    const oBottom = o.y + o.height
    const oCy = o.y + o.height / 2

    const xCandidates: Array<{ delta: number; nextX: number; line: number }> = [
      { delta: Math.abs(mLeft - oLeft), nextX: oLeft, line: oLeft },
      { delta: Math.abs(mLeft - oRight), nextX: oRight, line: oRight },
      { delta: Math.abs(mRight - oLeft), nextX: oLeft - moving.width, line: oLeft },
      { delta: Math.abs(mRight - oRight), nextX: oRight - moving.width, line: oRight },
      { delta: Math.abs(mCx - oCx), nextX: oCx - moving.width / 2, line: oCx },
    ]
    for (const c of xCandidates) {
      if (c.delta < bestDx && c.delta <= threshold) {
        bestDx = c.delta
        snapX = c.nextX
        guideV = c.line
      }
    }

    const yCandidates: Array<{ delta: number; nextY: number; line: number }> = [
      { delta: Math.abs(mTop - oTop), nextY: oTop, line: oTop },
      { delta: Math.abs(mTop - oBottom), nextY: oBottom, line: oBottom },
      { delta: Math.abs(mBottom - oTop), nextY: oTop - moving.height, line: oTop },
      { delta: Math.abs(mBottom - oBottom), nextY: oBottom - moving.height, line: oBottom },
      { delta: Math.abs(mCy - oCy), nextY: oCy - moving.height / 2, line: oCy },
    ]
    for (const c of yCandidates) {
      if (c.delta < bestDy && c.delta <= threshold) {
        bestDy = c.delta
        snapY = c.nextY
        guideH = c.line
      }
    }
  }

  if (snapX !== null) {
    x = snapX
    if (guideV !== null) guides.push({ orientation: 'v', pos: guideV })
  } else if (opts?.snapGrid !== false) {
    x = snap(x, grid)
  }

  if (snapY !== null) {
    y = snapY
    if (guideH !== null) guides.push({ orientation: 'h', pos: guideH })
  } else if (opts?.snapGrid !== false) {
    y = snap(y, grid)
  }

  return { x, y, guides }
}
