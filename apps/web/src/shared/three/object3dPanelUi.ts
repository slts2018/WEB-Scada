/**
 * 3D 跟镜头 HTML 面板 DOM（挂到 CSS2DObject.element）
 * 结构：host（CSS2D 定位）→ world-scale（按相机距离缩放）→ panel（内容）
 * 内容区为自由坐标布局（absolute），兼容旧工程无 x/y 时的流式兜底。
 */
import type { Object3DNode, Object3DPanel, Object3DPanelItem } from '@web-scada/core'
import {
  defaultPanelFontSize,
  resolvePanelContentSize,
  resolvePanelItemRect,
  resolvePanelTitleBarHeight,
} from '@web-scada/core'

const STYLE_ID = 'scada-3d-panel-style'

export function ensureObject3dPanelStyles() {
  if (typeof document === 'undefined') return
  const css = `
/* CSS2DObject 根节点：定位由渲染器写 transform，世界缩放写在子层 */
.scada-3d-panel-host {
  pointer-events: none;
}
.scada-3d-panel__world-scale {
  /* 与 CSS2D center(0.5,1) 一致：从底边中心缩放，贴合锚点 */
  transform-origin: 50% 100%;
  will-change: transform;
}
.scada-3d-panel {
  box-sizing: border-box;
  position: relative;
  min-width: 0;
  padding: 0;
  border-radius: 0;
  border: none;
  background: rgba(15, 18, 26, 0.92);
  color: #e8edf7;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: none;
  pointer-events: auto;
  user-select: none;
  overflow: hidden;
}
.scada-3d-panel__title {
  box-sizing: border-box;
  min-height: 14px;
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  font-size: 1em;
  font-weight: 600;
  color: #7dd3fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scada-3d-panel__stage {
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
}
.scada-3d-panel__item {
  position: absolute;
  box-sizing: border-box;
  margin: 0;
}
.scada-3d-panel__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  width: 100%;
  height: 100%;
  font-size: inherit;
}
.scada-3d-panel__label {
  color: #94a3b8;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scada-3d-panel__value {
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scada-3d-panel__text {
  color: #cbd5e1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: inherit;
}
.scada-3d-panel__btn {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 8px;
  border-radius: 0;
  border: 1px solid rgba(56, 189, 248, 0.55);
  background: rgba(14, 116, 144, 0.45);
  color: #e0f2fe;
  cursor: pointer;
  font-size: 1em;
  font-family: inherit;
  line-height: 1.2;
}
.scada-3d-panel__btn:hover {
  background: rgba(14, 116, 144, 0.75);
}
.scada-3d-panel__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.scada-3d-panel--designer .scada-3d-panel__btn {
  cursor: default;
}
/* 手柄开启时：面板内容穿透，避免大面板挡住 TransformControls；顶边仍可点选/双击编辑 */
.scada-3d-panel--designer.scada-3d-panel--pass-gizmo {
  pointer-events: none;
}
.scada-3d-panel__hit {
  display: none;
}
.scada-3d-panel--designer.scada-3d-panel--pass-gizmo .scada-3d-panel__hit {
  display: block;
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 10px;
  z-index: 5;
  pointer-events: auto;
  cursor: pointer;
}
.scada-3d-panel__img-wrap {
  width: 100%;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scada-3d-panel__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.scada-3d-panel__img-placeholder {
  color: #64748b;
  font-size: 0.92em;
  padding: 4px;
  text-align: center;
}
/* 文本/数值/按钮：填充方式（图片走 object-fit） */
.scada-3d-panel__item[data-content-fit='none'],
.scada-3d-panel__item[data-content-fit='contain'],
.scada-3d-panel__item[data-content-fit='cover'],
.scada-3d-panel__item[data-content-fit='fill'] {
  overflow: hidden;
}
.scada-3d-panel__item[data-content-fit='cover'] .scada-3d-panel__text,
.scada-3d-panel__item[data-content-fit='cover'] .scada-3d-panel__row,
.scada-3d-panel__item[data-content-fit='cover'] .scada-3d-panel__btn {
  transform-origin: center center;
}
.scada-3d-panel__item[data-content-fit='fill'] .scada-3d-panel__text,
.scada-3d-panel__item[data-content-fit='fill'] .scada-3d-panel__row,
.scada-3d-panel__item[data-content-fit='fill'] .scada-3d-panel__btn {
  transform-origin: 0 0;
}
.scada-3d-panel__fit-inner {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  min-width: 0;
}
.scada-3d-panel__row > .scada-3d-panel__fit-inner {
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
`
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}

export function formatPanelTagDisplay(value: unknown): string {
  if (value == null) return '--'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--'
    const abs = Math.abs(value)
    if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toPrecision(4)
    const s = value.toFixed(3)
    return s.replace(/\.?0+$/, '')
  }
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  const s = String(value)
  return s.length ? s : '--'
}

export type Object3dPanelDomHandlers = {
  /** 设计端：点面板选中锚点对象 */
  onSelect?: (objectId: string) => void
  /** 设计端：双击面板打开编辑器 */
  onEdit?: (objectId: string) => void
  /** 运行端：点按钮 */
  onButton?: (objectId: string, item: Object3DPanelItem) => void
  /** 设计端禁用按钮真实写值 */
  designerMode?: boolean
  /** 解析面板内图片资源 URL */
  resolveResourceUrl?: (resourceId: string) => string | undefined
}

function stopNav(e: Event) {
  e.stopPropagation()
}

/** 标题字号与标题栏高度；未设字号时字号继承面板默认，栏高随面板尺寸自动缩放 */
export function applyPanelTitleTypography(
  titleEl: HTMLElement,
  panel?: Pick<Object3DPanel, 'titleFontSize' | 'width' | 'height'> | null,
) {
  const { width, height } = resolvePanelContentSize(panel?.width, panel?.height)
  const fs = panel?.titleFontSize
  if (fs != null && fs > 0) {
    titleEl.style.fontSize = `${fs}px`
  } else {
    titleEl.style.fontSize = ''
  }
  titleEl.style.height = `${resolvePanelTitleBarHeight(width, height, fs)}px`
}

/** 面板背景图；无资源时恢复默认纯色 */
export function applyPanelBackground(
  el: HTMLElement,
  panel?: Pick<Object3DPanel, 'backgroundResourceId'> | null,
  resolveResourceUrl?: (resourceId: string) => string | undefined,
) {
  const id = panel?.backgroundResourceId?.trim()
  const url = id && resolveResourceUrl ? resolveResourceUrl(id) : undefined
  if (url) {
    const safe = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    el.style.backgroundImage = `url("${safe}")`
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center'
    el.style.backgroundRepeat = 'no-repeat'
    el.style.backgroundColor = 'rgba(15, 18, 26, 0.92)'
  } else {
    el.style.backgroundImage = ''
    el.style.backgroundSize = ''
    el.style.backgroundPosition = ''
    el.style.backgroundRepeat = ''
    el.style.backgroundColor = ''
  }
}

/** 控件字号/颜色；未设置时继承面板按尺寸算出的默认字号 */
export function applyPanelItemTypography(el: HTMLElement, item: Object3DPanelItem) {
  if (item.fontSize != null && item.fontSize > 0) {
    el.style.fontSize = `${item.fontSize}px`
  } else {
    el.style.fontSize = ''
  }
  const color = item.color?.trim()
  if (color) {
    el.style.color = color
    el.querySelectorAll(
      '.scada-3d-panel__label, .scada-3d-panel__value, .scada-3d-panel__text, .scada-3d-panel__btn',
    ).forEach((node) => {
      ;(node as HTMLElement).style.color = color
    })
  } else {
    el.style.color = ''
    el.querySelectorAll(
      '.scada-3d-panel__label, .scada-3d-panel__value, .scada-3d-panel__text, .scada-3d-panel__btn',
    ).forEach((node) => {
      ;(node as HTMLElement).style.color = ''
    })
  }
}

/** 面板内容填充方式；缺省 none（原始大小） */
export type PanelObjectFit = 'none' | 'contain' | 'cover' | 'fill'

export function resolvePanelObjectFit(
  panel?: Pick<{ objectFit?: PanelObjectFit }, 'objectFit'> | null,
): PanelObjectFit {
  const fit = panel?.objectFit
  if (fit === 'none' || fit === 'cover' || fit === 'fill' || fit === 'contain') return fit
  return 'none'
}

/** @deprecated 使用 resolvePanelObjectFit */
export function resolvePanelItemObjectFit(
  source?: Pick<{ objectFit?: PanelObjectFit }, 'objectFit'> | null,
): PanelObjectFit {
  return resolvePanelObjectFit(source)
}

/** @deprecated 使用 resolvePanelObjectFit */
export function resolvePanelImageObjectFit(
  source?: Pick<{ objectFit?: PanelObjectFit }, 'objectFit'> | null,
): PanelObjectFit {
  return resolvePanelObjectFit(source)
}

function resetContentFitTransform(el: HTMLElement) {
  el.querySelectorAll(
    '.scada-3d-panel__btn, .scada-3d-panel__fit-inner',
  ).forEach((node) => {
    const n = node as HTMLElement
    n.style.transform = ''
    n.style.width = ''
    n.style.height = ''
    n.style.position = ''
    n.style.left = ''
    n.style.top = ''
  })
}

/** 文本/数值的定位根不能直接 scale，包一层再缩放（勿把编辑器缩放手柄包进去） */
function ensureFitInner(el: HTMLElement): HTMLElement {
  let inner = el.querySelector(':scope > .scada-3d-panel__fit-inner') as HTMLElement | null
  if (!inner) {
    inner = document.createElement('div')
    inner.className = 'scada-3d-panel__fit-inner'
    el.insertBefore(inner, el.firstChild)
  }
  // 把误进 inner 的手柄挪回根节点；只把真实内容放进 inner
  ;[...inner.querySelectorAll(':scope > .panel-resize-handle')].forEach((h) => {
    el.appendChild(h)
  })
  ;[...el.childNodes].forEach((child) => {
    if (child === inner) return
    if (child instanceof HTMLElement && child.classList.contains('panel-resize-handle')) return
    if (child instanceof HTMLElement && child.classList.contains('scada-3d-panel__fit-inner')) return
    inner!.appendChild(child)
  })
  return inner
}

/**
 * 按面板填充方式，对面板内控件应用 contain/cover/fill。
 * 图片：CSS object-fit；文本/数值/按钮：缩放内容铺满控件矩形。
 */
export function applyPanelItemContentFit(
  el: HTMLElement,
  item: Object3DPanelItem,
  panelFit: PanelObjectFit = 'none',
) {
  const fit = panelFit
  el.dataset.contentFit = fit

  if (item.type === 'image') {
    resetContentFitTransform(el)
    const img = el.matches('img') ? el : el.querySelector('img')
    if (img instanceof HTMLImageElement) {
      // none 时图片按原尺寸会被裁切；默认改为 contain 完整显示
      img.style.objectFit = fit === 'none' ? 'contain' : fit
    }
    return
  }

  resetContentFitTransform(el)
  // 原始大小 / 适应：不拉伸文字与按钮
  if (fit === 'none' || fit === 'contain') return

  let content =
    (el.querySelector(':scope > .scada-3d-panel__btn') as HTMLElement | null) ||
    (el.querySelector(':scope > .scada-3d-panel__fit-inner') as HTMLElement | null)

  if (
    !content &&
    (el.classList.contains('scada-3d-panel__text') || el.classList.contains('scada-3d-panel__row'))
  ) {
    content = ensureFitInner(el)
  }
  if (!content) return

  const boxW = el.clientWidth || parseFloat(el.style.width) || 1
  const boxH = el.clientHeight || parseFloat(el.style.height) || 1

  content.style.width = 'auto'
  content.style.height = 'auto'
  content.style.transform = 'none'
  content.style.position = 'static'
  const natW = Math.max(1, content.scrollWidth || content.offsetWidth || boxW)
  const natH = Math.max(1, content.scrollHeight || content.offsetHeight || boxH)

  if (fit === 'fill') {
    content.style.width = `${natW}px`
    content.style.height = `${natH}px`
    content.style.transformOrigin = '0 0'
    content.style.transform = `scale(${boxW / natW}, ${boxH / natH})`
    return
  }

  // cover：等比放大铺满，居中裁剪
  const s = Math.max(boxW / natW, boxH / natH)
  content.style.width = `${natW}px`
  content.style.height = `${natH}px`
  content.style.position = 'absolute'
  content.style.left = '50%'
  content.style.top = '50%'
  content.style.transformOrigin = 'center center'
  content.style.transform = `translate(-50%, -50%) scale(${s})`
}

/** @deprecated 使用 applyPanelItemContentFit */
export function applyPanelImageObjectFit(
  el: HTMLElement,
  item: Object3DPanelItem,
  panelFit: PanelObjectFit = 'none',
) {
  applyPanelItemContentFit(el, item, panelFit)
}

function applyItemRect(el: HTMLElement, item: Object3DPanelItem, index: number) {
  const rect = resolvePanelItemRect(item, index)
  el.style.left = `${rect.x}px`
  el.style.top = `${rect.y}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
  el.style.zIndex = String(index + 1)
}

export function buildObject3dPanelElement(
  node: Object3DNode,
  handlers: Object3dPanelDomHandlers = {},
): HTMLDivElement {
  ensureObject3dPanelStyles()
  const panel = node.panel
  const host = document.createElement('div')
  host.className = 'scada-3d-panel-host'
  host.dataset.objectId = node.id

  const scaleWrap = document.createElement('div')
  scaleWrap.className = 'scada-3d-panel__world-scale'

  const el = document.createElement('div')
  el.className = 'scada-3d-panel' + (handlers.designerMode ? ' scada-3d-panel--designer' : '')
  const { width, height: stageH } = resolvePanelContentSize(panel?.width, panel?.height)
  el.style.width = `${width}px`
  el.style.fontSize = `${defaultPanelFontSize(width, stageH)}px`
  applyPanelBackground(el, panel, handlers.resolveResourceUrl)

  el.addEventListener('pointerdown', (e) => {
    stopNav(e)
    handlers.onSelect?.(node.id)
  })
  el.addEventListener('dblclick', (e) => {
    stopNav(e)
    e.preventDefault()
    if (handlers.designerMode) handlers.onEdit?.(node.id)
  })
  el.addEventListener('wheel', stopNav, { passive: true })

  // 无标题栏；设计端手柄穿透时保留顶边点选条
  if (handlers.designerMode) {
    const hit = document.createElement('div')
    hit.className = 'scada-3d-panel__hit'
    hit.title = '双击编辑面板'
    el.appendChild(hit)
  }

  const stage = document.createElement('div')
  stage.className = 'scada-3d-panel__stage'
  stage.style.width = `${width}px`
  stage.style.height = `${stageH}px`
  el.appendChild(stage)

  const panelFit = resolvePanelObjectFit(panel)
  ;(panel?.items ?? []).forEach((item, index) => {
    if (item.type === 'label') {
      const wrap = document.createElement('div')
      wrap.className = 'scada-3d-panel__item scada-3d-panel__text'
      wrap.dataset.itemId = item.id
      wrap.textContent = item.text || ''
      applyItemRect(wrap, item, index)
      applyPanelItemTypography(wrap, item)
      applyPanelItemContentFit(wrap, item, panelFit)
      stage.appendChild(wrap)
      return
    }
    if (item.type === 'value') {
      const row = document.createElement('div')
      row.className = 'scada-3d-panel__item scada-3d-panel__row'
      row.dataset.itemId = item.id
      const lab = document.createElement('span')
      lab.className = 'scada-3d-panel__label'
      lab.textContent = item.text || item.tagId || '数值'
      const val = document.createElement('span')
      val.className = 'scada-3d-panel__value'
      val.dataset.role = 'value'
      val.textContent = '--'
      row.append(lab, val)
      applyItemRect(row, item, index)
      applyPanelItemTypography(row, item)
      applyPanelItemContentFit(row, item, panelFit)
      stage.appendChild(row)
      return
    }
    if (item.type === 'button') {
      const itemHost = document.createElement('div')
      itemHost.className = 'scada-3d-panel__item'
      itemHost.dataset.itemId = item.id
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'scada-3d-panel__btn'
      btn.textContent = item.text || '按钮'
      btn.disabled = handlers.designerMode === true || !item.tagId
      btn.addEventListener('pointerdown', stopNav)
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        stopNav(e)
        if (handlers.designerMode) {
          handlers.onSelect?.(node.id)
          return
        }
        handlers.onButton?.(node.id, item)
      })
      itemHost.appendChild(btn)
      applyItemRect(itemHost, item, index)
      applyPanelItemTypography(itemHost, item)
      applyPanelItemContentFit(itemHost, item, panelFit)
      stage.appendChild(itemHost)
      return
    }
    if (item.type === 'image') {
      const wrap = document.createElement('div')
      wrap.className = 'scada-3d-panel__item scada-3d-panel__img-wrap'
      wrap.dataset.itemId = item.id
      const url = item.resourceId ? handlers.resolveResourceUrl?.(item.resourceId) : undefined
      if (url) {
        const img = document.createElement('img')
        img.className = 'scada-3d-panel__img'
        img.alt = item.text || '图片'
        img.draggable = false
        img.src = url
        wrap.appendChild(img)
      } else {
        const ph = document.createElement('div')
        ph.className = 'scada-3d-panel__img-placeholder'
        ph.textContent = item.text || '未选图片'
        wrap.appendChild(ph)
      }
      applyItemRect(wrap, item, index)
      applyPanelItemContentFit(wrap, item, panelFit)
      stage.appendChild(wrap)
    }
  })

  scaleWrap.appendChild(el)
  host.appendChild(scaleWrap)
  return host
}

export function setObject3dPanelValues(root: HTMLElement, values: Record<string, string>) {
  for (const [itemId, text] of Object.entries(values)) {
    const cell = root.querySelector(
      `[data-item-id="${CSS.escape(itemId)}"] [data-role="value"]`,
    )
    if (cell) cell.textContent = text
  }
}

export function panelValuesFromTags(
  node: Object3DNode,
  getTagValue: (tagId: string) => unknown,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of node.panel?.items ?? []) {
    if (item.type !== 'value') continue
    if (!item.tagId) {
      out[item.id] = '--'
      continue
    }
    out[item.id] = formatPanelTagDisplay(getTagValue(item.tagId))
  }
  return out
}
