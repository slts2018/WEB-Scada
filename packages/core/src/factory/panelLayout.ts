import type { Object3DPanelItem } from '../types/project'

export type PanelItemRect = { x: number; y: number; width: number; height: number }

export const DEFAULT_PANEL_CONTENT_WIDTH = 400
export const DEFAULT_PANEL_CONTENT_HEIGHT = 280
/** 面板内容区最小宽高（px）；仅防 0/负值，允许小面板 */
export const MIN_PANEL_CONTENT_WIDTH = 24
export const MIN_PANEL_CONTENT_HEIGHT = 16
export const MAX_PANEL_CONTENT_SIZE = 1200

/** 解析并钳制面板内容区尺寸；缺省用设计稿默认值 */
export function resolvePanelContentSize(
  width?: number | null,
  height?: number | null,
): { width: number; height: number } {
  const rawW =
    width != null && Number.isFinite(width) && width > 0
      ? width
      : DEFAULT_PANEL_CONTENT_WIDTH
  const rawH =
    height != null && Number.isFinite(height) && height > 0
      ? height
      : DEFAULT_PANEL_CONTENT_HEIGHT
  return {
    width: Math.max(
      MIN_PANEL_CONTENT_WIDTH,
      Math.min(MAX_PANEL_CONTENT_SIZE, Math.round(rawW)),
    ),
    height: Math.max(
      MIN_PANEL_CONTENT_HEIGHT,
      Math.min(MAX_PANEL_CONTENT_SIZE, Math.round(rawH)),
    ),
  }
}

export function defaultPanelItemSize(type: Object3DPanelItem['type']): { width: number; height: number } {
  if (type === 'button') return { width: 88, height: 28 }
  if (type === 'value') return { width: 148, height: 24 }
  if (type === 'image') return { width: 72, height: 72 }
  return { width: 100, height: 22 }
}

/** 解析控件矩形；无坐标时按索引流式兜底（兼容旧工程） */
export function resolvePanelItemRect(item: Object3DPanelItem, index: number): PanelItemRect {
  const fallback = defaultPanelItemSize(item.type)
  const width = item.width != null && item.width > 0 ? item.width : fallback.width
  const height = item.height != null && item.height > 0 ? item.height : fallback.height
  if (item.x != null && item.y != null) {
    return { x: item.x, y: item.y, width, height }
  }
  return {
    x: 8,
    y: 8 + index * (height + 6),
    width,
    height,
  }
}

export function clampPanelItemRect(
  rect: PanelItemRect,
  panelWidth: number,
  panelHeight: number,
  minSize?: { width?: number; height?: number },
): PanelItemRect {
  // 仅防 0/负值，不再强制大最小框（小面板/细线图形需要自由尺寸）
  const minW = minSize?.width ?? 1
  const minH = minSize?.height ?? 1
  const width = Math.max(minW, Math.min(rect.width, panelWidth))
  const height = Math.max(minH, Math.min(rect.height, panelHeight))
  const x = Math.max(0, Math.min(rect.x, Math.max(0, panelWidth - width)))
  const y = Math.max(0, Math.min(rect.y, Math.max(0, panelHeight - height)))
  return { x, y, width, height }
}

/** 各类型统一按 1px 下限钳制；文本仍可用更小测量结果 */
export function clampPanelItemRectForType(
  type: Object3DPanelItem['type'],
  rect: PanelItemRect,
  panelWidth: number,
  panelHeight: number,
): PanelItemRect {
  void type
  return clampPanelItemRect(rect, panelWidth, panelHeight, { width: 1, height: 1 })
}

/**
 * 面板默认字号：相对 400×280 设计稿的 12px，随面板宽高同比缩放。
 * 取宽/高缩放较小者，避免扁面板文字过大。
 */
export function defaultPanelFontSize(panelWidth: number, panelHeight: number): number {
  const w = panelWidth > 0 ? panelWidth : DEFAULT_PANEL_CONTENT_WIDTH
  const h = panelHeight > 0 ? panelHeight : DEFAULT_PANEL_CONTENT_HEIGHT
  const byW = 12 * (w / DEFAULT_PANEL_CONTENT_WIDTH)
  const byH = 12 * (h / DEFAULT_PANEL_CONTENT_HEIGHT)
  const fs = Math.min(byW, byH)
  return Math.round(Math.max(6, Math.min(22, fs)) * 10) / 10
}

/** 设计稿（400×280）下的默认标题栏高度 */
export const DEFAULT_PANEL_TITLE_BAR_HEIGHT = 28

/**
 * 面板默认标题栏高度：相对 400×280 设计稿的 28px，随面板宽高同比缩放。
 */
export function defaultPanelTitleBarHeight(panelWidth: number, panelHeight: number): number {
  const w = panelWidth > 0 ? panelWidth : DEFAULT_PANEL_CONTENT_WIDTH
  const h = panelHeight > 0 ? panelHeight : DEFAULT_PANEL_CONTENT_HEIGHT
  const byW = DEFAULT_PANEL_TITLE_BAR_HEIGHT * (w / DEFAULT_PANEL_CONTENT_WIDTH)
  const byH = DEFAULT_PANEL_TITLE_BAR_HEIGHT * (h / DEFAULT_PANEL_CONTENT_HEIGHT)
  const th = Math.min(byW, byH)
  return Math.round(Math.max(14, Math.min(64, th)))
}

/**
 * 标题栏实际高度：随面板自动缩放；若设置了更大的标题字号，再抬高以免裁切。
 */
export function resolvePanelTitleBarHeight(
  panelWidth: number,
  panelHeight: number,
  titleFontSize?: number | null,
): number {
  const auto = defaultPanelTitleBarHeight(panelWidth, panelHeight)
  if (titleFontSize == null || titleFontSize <= 0) return auto
  return Math.max(auto, Math.ceil(titleFontSize * 1.45) + 6)
}
