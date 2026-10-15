/**
 * 3D 跟镜头 HTML 面板 DOM（挂到 CSS2DObject.element）
 * 结构：host（CSS2D 定位）→ world-scale（按相机距离缩放）→ panel（内容）
 * 内容区为 Konva Stage（完整 2D 绑定/事件）；scene3d 控件忽略。
 */
import type {
  EventBinding,
  EventTrigger,
  Object3DNode,
  Object3DPanel,
  Object3DPanelItem,
  Page2D,
  TagValue,
  Widget2D,
} from '@web-scada/core'
import {
  defaultPanelFontSize,
  panelWidgetValueTagId,
  resolvePanelContentSize,
  resolvePanelTitleBarHeight,
  resolvePanelWidgets,
} from '@web-scada/core'
import {
  mountPanelKonvaRuntime,
  type PanelKonvaRuntime,
} from '@/shared/three/panelKonvaRuntime'
import {
  getPanelTrendToolbarLayer,
  mountPanelTrendToolbars,
} from '@/shared/three/panelTrendToolbars'

const panelKonvaByHost = new WeakMap<HTMLElement, PanelKonvaRuntime>()

const STYLE_ID = 'scada-3d-panel-style'

export function ensureObject3dPanelStyles() {
  if (typeof document === 'undefined') return
  const css = `
/* CSS2DObject 根节点：定位由渲染器写 transform，世界缩放写在子层 */
.scada-3d-panel-host {
  pointer-events: none;
}
.scada-3d-panel__world-scale {
  /* 距离缩放用 zoom（见 createScene3D.updatePanelWorldScales），勿再套 transform:scale */
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
  /* 面板底板穿透，避免挡住模型单击；可点控件再开 auto */
  pointer-events: none;
  user-select: none;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.scada-3d-panel__title,
.scada-3d-panel__stage,
.scada-3d-panel__btn,
.scada-3d-panel__switch {
  pointer-events: auto;
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
/* 世界 zoom 放大时尽量用高分位图，避免浏览器二次柔化 */
.scada-3d-panel__konva canvas {
  image-rendering: auto;
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
.scada-3d-panel__rect {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}
.scada-3d-panel__switch {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: #e2e8f0;
  font: inherit;
}
.scada-3d-panel__switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: #475569;
  border: 1px solid #94a3b8;
  transition: background 0.15s ease;
}
.scada-3d-panel__item[data-on='1'] .scada-3d-panel__switch-track {
  background: #22c55e;
}
.scada-3d-panel__switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #f8fafc;
  transition: left 0.15s ease;
}
.scada-3d-panel__item[data-on='1'] .scada-3d-panel__switch-knob {
  left: 22px;
}
.scada-3d-panel__switch-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.scada-3d-panel__lamp {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid #14532d;
  background: #334155;
  box-shadow: none;
}
.scada-3d-panel__item[data-on='1'] .scada-3d-panel__lamp {
  background: #22c55e;
  box-shadow: 0 0 14px #22c55e;
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
  /** 运行端：点按钮（兼容旧回调） */
  onButton?: (objectId: string, widget: Widget2D) => void
  /** 运行端：完整 2D 事件 */
  onWidgetEvent?: (
    objectId: string,
    widgetId: string,
    trigger: EventTrigger,
    events: EventBinding[],
  ) => void
  onAnimationInput?: (objectId: string, widgetId: string) => void
  onDragWrite?: (
    objectId: string,
    widgetId: string,
    axis: 'h' | 'v',
    tagId: string,
    value: number,
  ) => void
  /** 设计端禁用写值交互 */
  designerMode?: boolean
  /** 解析面板内图片资源 URL */
  resolveResourceUrl?: (resourceId: string) => string | undefined
  /** 解析 panel.page2dId */
  resolvePage2d?: (page2dId: string) => Page2D | null | undefined
}

function findPanelHost(root: HTMLElement): HTMLElement | null {
  if (root.classList.contains('scada-3d-panel-host')) return root
  return root.closest('.scada-3d-panel-host') as HTMLElement | null
}

/**
 * 面板内是否有真正接事件的控件（按钮/开关/输入连接/拖拽写值）。
 * 必须问已经挂好的 Konva 运行时：面板内容可能来自 page2dId 绑定的 2D 页，
 * 只看 panel.widgets 会漏判（漏判会把可点面板整块穿透，按钮就点不动了）。
 */
export function panelRuntimeIsInteractive(root: HTMLElement): boolean {
  const host = findPanelHost(root)
  const rt = host ? panelKonvaByHost.get(host) : undefined
  if (!rt) return false
  type KonvaNodeWithListeners = { listening: () => boolean; eventListeners?: Record<string, unknown> }
  return rt.bundle.widgetLayer.getChildren().some((node) => {
    const n = node as unknown as KonvaNodeWithListeners
    if (typeof n.listening !== 'function' || !n.listening()) return false
    const listeners = n.eventListeners
    if (!listeners) return false
    return Object.values(listeners).some((list) => Array.isArray(list) && list.length > 0)
  })
}

export function getPanelKonvaRuntime(root: HTMLElement): PanelKonvaRuntime | undefined {
  const host = findPanelHost(root)
  return host ? panelKonvaByHost.get(host) : undefined
}

export function disposePanelKonvaRuntime(root: HTMLElement) {
  const host = findPanelHost(root)
  if (!host) return
  // 工具条是 Vue 应用，必须先卸载（否则组件里的键盘监听/订阅会留在后台）
  getPanelTrendToolbarLayer(host)?.dispose()
  const rt = panelKonvaByHost.get(host)
  rt?.dispose()
  panelKonvaByHost.delete(host)
}

export function refreshPanelKonvaVisuals(
  root: HTMLElement,
  getTag: (id: string) => TagValue | undefined,
) {
  getPanelKonvaRuntime(root)?.refresh(getTag)
  // 图元矩形可能因为面板内容/尺寸变化而变（工具条要跟着挪）
  const host = findPanelHost(root)
  if (host) getPanelTrendToolbarLayer(host)?.refresh()
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

  if (handlers.designerMode) {
    const hit = document.createElement('div')
    hit.className = 'scada-3d-panel__hit'
    hit.title = '双击编辑面板内容'
    el.appendChild(hit)
  }

  const stage = document.createElement('div')
  stage.className = 'scada-3d-panel__stage scada-3d-panel__konva'
  stage.style.width = `${width}px`
  stage.style.height = `${stageH}px`
  el.appendChild(stage)

  const runtime = mountPanelKonvaRuntime(stage, node.id, panel, {
    readOnly: handlers.designerMode === true,
    resolveResourceUrl: handlers.resolveResourceUrl,
    resolvePage2d: handlers.resolvePage2d,
    onWidgetEvent: (widgetId, trigger, events) => {
      if (handlers.onWidgetEvent) {
        handlers.onWidgetEvent(node.id, widgetId, trigger, events)
        return
      }
      // 无完整事件处理器时回退旧按钮回调
      if (trigger === 'click') {
        const widget = runtime.widgets.find((w) => w.id === widgetId)
        if (widget) handlers.onButton?.(node.id, widget)
      }
    },
    onAnimationInput: (widgetId) => {
      handlers.onAnimationInput?.(node.id, widgetId)
    },
    onDragWrite: (widgetId, axis, tagId, value) => {
      handlers.onDragWrite?.(node.id, widgetId, axis, tagId, value)
    },
    onAlarmAck: (alarmId) => {
      if (handlers.designerMode) return
      void import('@/stores/tag').then(({ useTagStore }) => {
        void useTagStore().ackAlarm(alarmId)
      })
    },
  })
  panelKonvaByHost.set(host, runtime)
  // 面板里的历史趋势也挂同一套工具条（区间 / 缩放 / 跟随 / 采样间隔 / 点表 / 导出 / 快捷键）。
  // 设计端场景是只读预览，不挂 —— 那里改区间没有意义。
  if (!handlers.designerMode) mountPanelTrendToolbars(el, runtime)

  scaleWrap.appendChild(el)
  host.appendChild(scaleWrap)
  return host
}

export type PanelWidgetRuntimeState = {
  valueText?: string
  on?: boolean
}

export function setObject3dPanelValues(
  root: HTMLElement,
  values: Record<string, string | PanelWidgetRuntimeState>,
) {
  // Konva 路径由 refreshPanelKonvaVisuals 负责；此处仅兼容旧 DOM
  if (getPanelKonvaRuntime(root)) return
  for (const [itemId, raw] of Object.entries(values)) {
    const el = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`) as HTMLElement | null
    if (!el) continue
    const st: PanelWidgetRuntimeState =
      typeof raw === 'string' ? { valueText: raw } : raw
    if (st.valueText != null) {
      const cell = el.querySelector('[data-role="value"]')
      if (cell) cell.textContent = st.valueText
    }
    if (st.on != null) {
      el.dataset.on = st.on ? '1' : '0'
      const lamp = el.querySelector('.scada-3d-panel__lamp') as HTMLElement | null
      if (lamp) {
        if (st.on) {
          lamp.style.background = ''
          lamp.style.boxShadow = ''
        } else {
          lamp.style.background = '#334155'
          lamp.style.boxShadow = 'none'
        }
      }
    }
  }
}

export function panelValuesFromTags(
  node: Object3DNode,
  getTagValue: (tagId: string) => unknown,
): Record<string, PanelWidgetRuntimeState> {
  const out: Record<string, PanelWidgetRuntimeState> = {}
  for (const widget of resolvePanelWidgets(node.panel)) {
    if (widget.type === 'value') {
      const tagId = panelWidgetValueTagId(widget)
      out[widget.id] = {
        valueText: tagId ? formatPanelTagDisplay(getTagValue(tagId)) : '--',
      }
      continue
    }
    if (widget.type === 'switch' || widget.type === 'lamp') {
      const tagId = panelWidgetValueTagId(widget)
      if (!tagId) {
        out[widget.id] = {
          on: widget.props.on === true || widget.props.on === 'true' || widget.props.on === 1,
        }
        continue
      }
      out[widget.id] = { on: Boolean(getTagValue(tagId)) }
    }
  }
  return out
}
