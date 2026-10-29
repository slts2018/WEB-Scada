import { MATERIAL_CATALOG, type MaterialItem } from './materialCatalog'

export { MATERIAL_CATALOG }
export type { MaterialItem }

export const MATERIAL_DND = 'application/x-scada-material'

/** 与乐吾乐素材面板一致的分类顺序 */
export const MATERIAL_CATEGORY_ORDER = [
  '常用图标',
  '智慧园区',
  '智慧工厂',
  '智慧校园',
  '智慧楼宇',
  '智慧水务',
  '智慧消防',
  '智能家居',
  '暖通系统',
  '标题',
  '水利系统',
  '电信机房',
  '电力能源',
  '装饰',
  '面板',
  '风力系统',
]

const byId = new Map(MATERIAL_CATALOG.map((item) => [item.id, item]))

export function findMaterial(id: string): MaterialItem | undefined {
  return byId.get(id)
}

export function materialSrc(file: string): string {
  return '/library/' + file.split('/').map((part) => encodeURIComponent(part)).join('/')
}

/** 小图按原尺寸放置，大图把长边收到 240，避免一张背景铺满整页 */
export function libraryPlaceSize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const long = Math.max(w, h)
  const scale = long <= 200 ? 1 : 240 / long
  return {
    width: Math.max(16, Math.round(w * scale)),
    height: Math.max(16, Math.round(h * scale)),
  }
}

export function readMaterialDrop(event: DragEvent): MaterialItem | null {
  const id = event.dataTransfer?.getData(MATERIAL_DND) || ''
  if (!id) return null
  return byId.get(id) ?? null
}
