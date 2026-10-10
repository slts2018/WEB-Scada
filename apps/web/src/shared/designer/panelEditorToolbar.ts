/**
 * 面板编辑器工具栏：微移 / 层级 / 旋转 / 吸附（面板内 8px 格）
 */
import type { Widget2D } from '@web-scada/core'
import { clampPanelItemRect } from '@web-scada/core'
import { computeAlignPatches, snap, type AlignMode } from '@/shared/designer/geometry'

export const PANEL_EDITOR_GRID = 8

export type PanelZOrderMode = 'front' | 'forward' | 'backward' | 'back'

export function snapPanelValue(n: number, enabled: boolean, grid = PANEL_EDITOR_GRID): number {
  if (!enabled) return n
  return snap(n, grid)
}

export function snapPanelRect(
  rect: { x: number; y: number; width: number; height: number },
  enabled: boolean,
  panelW: number,
  panelH: number,
  grid = PANEL_EDITOR_GRID,
): { x: number; y: number; width: number; height: number } {
  const next = enabled
    ? {
        x: snap(rect.x, grid),
        y: snap(rect.y, grid),
        width: Math.max(1, snap(rect.width, grid) || grid),
        height: Math.max(1, snap(rect.height, grid) || grid),
      }
    : rect
  return clampPanelItemRect(next, panelW, panelH, { width: 1, height: 1 })
}

export function reorderPanelWidgets(
  widgets: Widget2D[],
  selectedIds: string[],
  mode: PanelZOrderMode,
): Widget2D[] | null {
  if (!selectedIds.length) return null
  const idSet = new Set(selectedIds)
  const selected = widgets.filter((w) => idSet.has(w.id))
  const others = widgets.filter((w) => !idSet.has(w.id))
  if (!selected.length) return null

  if (mode === 'front') return [...others, ...selected]
  if (mode === 'back') return [...selected, ...others]

  const next = [...widgets]
  if (mode === 'forward') {
    // 从后往前换，避免连跳
    for (let i = next.length - 2; i >= 0; i--) {
      if (idSet.has(next[i]!.id) && !idSet.has(next[i + 1]!.id)) {
        const t = next[i]!
        next[i] = next[i + 1]!
        next[i + 1] = t
      }
    }
    return next
  }
  // backward
  for (let i = 1; i < next.length; i++) {
    if (idSet.has(next[i]!.id) && !idSet.has(next[i - 1]!.id)) {
      const t = next[i]!
      next[i] = next[i - 1]!
      next[i - 1] = t
    }
  }
  return next
}

export function nudgePanelWidgets(
  widgets: Widget2D[],
  selectedIds: string[],
  dx: number,
  dy: number,
  panelW: number,
  panelH: number,
  snapEnabled: boolean,
): Widget2D[] | null {
  if (!selectedIds.length) return null
  const idSet = new Set(selectedIds)
  let changed = false
  const next = widgets.map((w) => {
    if (!idSet.has(w.id)) return w
    changed = true
    const rect = snapPanelRect(
      {
        x: w.transform.x + dx,
        y: w.transform.y + dy,
        width: w.transform.width,
        height: w.transform.height,
      },
      snapEnabled,
      panelW,
      panelH,
    )
    return { ...w, transform: { ...w.transform, ...rect } }
  })
  return changed ? next : null
}

export function rotatePanelWidgets(
  widgets: Widget2D[],
  selectedIds: string[],
  deltaDeg: number,
): Widget2D[] | null {
  if (!selectedIds.length) return null
  const idSet = new Set(selectedIds)
  let changed = false
  const next = widgets.map((w) => {
    if (!idSet.has(w.id)) return w
    changed = true
    const rot = ((w.transform.rotation || 0) + deltaDeg) % 360
    return { ...w, transform: { ...w.transform, rotation: rot < 0 ? rot + 360 : rot } }
  })
  return changed ? next : null
}

export function alignPanelWidgets(
  widgets: Widget2D[],
  selectedIds: string[],
  mode: AlignMode,
  panelW: number,
  panelH: number,
): Widget2D[] | null {
  const selected = widgets.filter((w) => selectedIds.includes(w.id))
  const patches = computeAlignPatches(selected, mode)
  if (!Object.keys(patches).length) return null
  return widgets.map((w) => {
    const t = patches[w.id]
    if (!t) return w
    const rect = clampPanelItemRect(
      { x: t.x, y: t.y, width: t.width, height: t.height },
      panelW,
      panelH,
      { width: 1, height: 1 },
    )
    return { ...w, transform: { ...t, ...rect } }
  })
}

export function clonePanelWidgets(
  widgets: Widget2D[],
  selectedIds: string[],
  panelW: number,
  panelH: number,
): { widgets: Widget2D[]; newIds: string[] } | null {
  if (!selectedIds.length) return null
  const idSet = new Set(selectedIds)
  const copies: Widget2D[] = []
  const newIds: string[] = []
  for (const w of widgets) {
    if (!idSet.has(w.id)) continue
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const rect = clampPanelItemRect(
      {
        x: w.transform.x + PANEL_EDITOR_GRID,
        y: w.transform.y + PANEL_EDITOR_GRID,
        width: w.transform.width,
        height: w.transform.height,
      },
      panelW,
      panelH,
      { width: 1, height: 1 },
    )
    copies.push({
      ...JSON.parse(JSON.stringify(w)),
      id,
      transform: { ...w.transform, ...rect },
      bindings: (w.bindings ?? []).map((b) => ({
        ...b,
        id: `bind_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      })),
      events: (w.events ?? []).map((e) => ({
        ...e,
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      })),
    })
    newIds.push(id)
  }
  if (!copies.length) return null
  return { widgets: [...widgets, ...copies], newIds }
}
