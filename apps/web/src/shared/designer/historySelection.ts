/**
 * 撤销 / 重做之后该选中谁。
 * 历史里只有整页快照，所以用「离开的那一版」和「落到的那一版」按 id 比较：
 * - 落到的版本里新出现，或同一 id 的内容、父级、前后邻居变了 → 选中
 * - 这一步是新建、撤回后对象已经不在 → 不选
 * - 两边几乎没有相同 id（整页替换）→ 不整页选中
 *
 * 二维组内子图元不能单独选，改动归到所在的顶层图元。
 */

interface NodeLike {
  id: string
  children?: NodeLike[]
}

export interface HistoryLayer {
  id: string
  widgets: NodeLike[]
}

function stableString(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableString(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => key !== 'children' && record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableString(record[key])}`).join(',')}}`
}

interface IndexedNode {
  content: string
  parentId: string
  prevId: string
  /** 二维：顶层图元 id。三维：节点自己 */
  selectId: string
}

function indexForest(
  nodes: NodeLike[] | undefined,
  parentId: string,
  map: Map<string, IndexedNode>,
  selectRoot: boolean,
  rootId: string | null,
) {
  let prev = ''
  for (const node of nodes ?? []) {
    const selectId = selectRoot ? (rootId ?? node.id) : node.id
    map.set(node.id, {
      content: stableString(node),
      parentId,
      prevId: prev,
      selectId,
    })
    prev = node.id
    indexForest(node.children, node.id, map, selectRoot, selectRoot ? selectId : null)
  }
}

function remember(ids: string[], seen: Set<string>, selectId: string) {
  if (seen.has(selectId)) return
  seen.add(selectId)
  ids.push(selectId)
}

function idsAfterSwap(from: Map<string, IndexedNode>, to: Map<string, IndexedNode>): string[] {
  const primary: string[] = []
  const secondary: string[] = []
  const seenPrimary = new Set<string>()
  const seenSecondary = new Set<string>()
  let shared = 0
  let disappeared = 0
  for (const id of from.keys()) {
    if (!to.has(id)) disappeared += 1
  }
  for (const [id, next] of to) {
    const prev = from.get(id)
    if (prev) shared += 1
    if (!to.has(next.selectId)) continue
    if (!prev || prev.content !== next.content || prev.parentId !== next.parentId) {
      remember(primary, seenPrimary, next.selectId)
    } else if (prev.prevId !== next.prevId && !seenPrimary.has(next.selectId)) {
      remember(secondary, seenSecondary, next.selectId)
    }
  }
  // 新建被撤回时对象已经不在，旁边只是顺位变了，不改选中到邻居上。
  const picked = primary.length ? primary : disappeared ? [] : secondary
  if (!picked.length) return []
  const fromCount = from.size
  const toCount = to.size
  if (fromCount >= 8 && toCount >= 8 && shared / Math.min(fromCount, toCount) < 0.2) return []
  return picked
}

function indexLayers(layers: HistoryLayer[], into: Map<string, IndexedNode>) {
  for (const layer of layers) {
    indexForest(layer.widgets, layer.id, into, true, null)
  }
}

/** 落到 toLayers 之后应选中的顶层图元（页面顺序） */
export function widgetIdsAfterHistory(fromLayers: HistoryLayer[], toLayers: HistoryLayer[]): string[] {
  const from = new Map<string, IndexedNode>()
  const to = new Map<string, IndexedNode>()
  indexLayers(fromLayers, from)
  indexLayers(toLayers, to)
  return idsAfterSwap(from, to)
}

/** 落到 toObjects 之后应选中的三维对象（含组内成员，树顺序） */
export function objectIdsAfterHistory(fromObjects: NodeLike[], toObjects: NodeLike[]): string[] {
  const from = new Map<string, IndexedNode>()
  const to = new Map<string, IndexedNode>()
  indexForest(fromObjects, '', from, false, null)
  indexForest(toObjects, '', to, false, null)
  return idsAfterSwap(from, to)
}
