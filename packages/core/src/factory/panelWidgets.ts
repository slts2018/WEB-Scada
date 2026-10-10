/**
 * 3D 跟镜头面板：旧 items → Widget2D 迁移与规范化。
 * 源数据 / 落盘仅为 widgets；items 只读兼容，规范化后清除。
 */
import type { EventBinding } from '../types/event'
import type { PropBinding } from '../types/binding'
import type {
  Object3DNode,
  Object3DPanel,
  Object3DPanelItem,
  Widget2D,
} from '../types/project'
import { BUILTIN_WIDGETS, createWidget2D, type BuiltinWidgetType } from './widget'
import {
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
  defaultPanelItemSize,
  resolvePanelItemRect,
} from './panelLayout'

/** 面板支持的 2D 控件：BUILTIN 全开，排除 scene3d（禁止 3D 套 3D） */
export const PANEL_WIDGET_TYPES = BUILTIN_WIDGETS.map((w) => w.type).filter(
  (t): t is Exclude<BuiltinWidgetType, 'scene3d'> => t !== 'scene3d',
)

export type PanelWidgetType = (typeof PANEL_WIDGET_TYPES)[number]

export function isPanelWidgetType(type: string): type is PanelWidgetType {
  return (PANEL_WIDGET_TYPES as readonly string[]).includes(type)
}

function newBindId() {
  return `bind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function newEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/** 旧 panel item → Widget2D */
export function panelItemToWidget(item: Object3DPanelItem, index: number): Widget2D {
  const rect = resolvePanelItemRect(item, index)
  const transform = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  }

  if (item.type === 'label') {
    const w = createWidget2D('text', {
      name: item.text || '文本',
      transform,
      style: {
        fill: item.color || '#e8eaed',
        opacity: 1,
        fontSize: item.fontSize ?? 12,
        align: 'left',
      },
      props: { text: item.text || '' },
    })
    w.id = item.id
    return w
  }

  if (item.type === 'value') {
    const bindings: PropBinding[] = item.tagId
      ? [{ id: newBindId(), prop: 'value', tagId: item.tagId }]
      : []
    const w = createWidget2D('value', {
      name: item.text || '数值',
      transform,
      style: {
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        textColor: item.color || '#f8fafc',
        labelColor: '#94a3b8',
        fontSize: item.fontSize ?? 12,
      },
      props: { label: item.text || '数值', value: '--', unit: '', decimals: 1 },
    })
    w.id = item.id
    w.bindings = bindings
    return w
  }

  if (item.type === 'button') {
    const events: EventBinding[] = item.tagId
      ? [
          {
            id: newEventId(),
            trigger: 'click',
            actions: [
              {
                type: 'writeTag',
                tagId: item.tagId,
                value: item.writeValue ?? 1,
                confirm: item.confirm !== false,
              },
            ],
          },
        ]
      : []
    const w = createWidget2D('button', {
      name: item.text || '按钮',
      transform,
      style: {
        fill: 'rgba(14, 116, 144, 0.45)',
        stroke: 'rgba(56, 189, 248, 0.55)',
        strokeWidth: 1,
        opacity: 1,
        cornerRadius: 0,
        fontSize: item.fontSize ?? 12,
        textColor: item.color || '#e0f2fe',
      },
      props: { text: item.text || '按钮' },
    })
    w.id = item.id
    w.events = events
    return w
  }

  // image
  const w = createWidget2D('image', {
    name: item.text || '图片',
    transform,
    style: { opacity: 1 },
    props: { resourceId: item.resourceId || '', src: '' },
  })
  w.id = item.id
  return w
}

export function panelItemsToWidgets(items: Object3DPanelItem[]): Widget2D[] {
  return items.map((it, i) => panelItemToWidget(it, i))
}

/** 从 button 控件取出写值动作（供运行时） */
export function panelWidgetWriteAction(widget: Widget2D): {
  tagId: string
  value: string | number | boolean
  confirm: boolean
} | null {
  for (const evt of widget.events ?? []) {
    if (evt.trigger !== 'click') continue
    for (const action of evt.actions ?? []) {
      if (action.type === 'writeTag' && action.tagId) {
        return {
          tagId: action.tagId,
          value: action.value,
          confirm: action.confirm !== false,
        }
      }
    }
  }
  return null
}

/** 数值 / 开关 / 灯 等绑定的 Tag（优先 value/text 绑定） */
export function panelWidgetValueTagId(widget: Widget2D): string | undefined {
  const b = (widget.bindings ?? []).find((x) => x.prop === 'value' || x.prop === 'text')
  return b?.tagId || undefined
}

/** 控件主 Tag：绑定优先，否则写值事件 */
export function panelWidgetPrimaryTagId(widget: Widget2D): string | undefined {
  return panelWidgetValueTagId(widget) || panelWidgetWriteAction(widget)?.tagId || undefined
}

/** 设置 / 替换控件的 value 绑定 Tag */
export function setPanelWidgetValueTag(widget: Widget2D, tagId: string): Widget2D {
  const rest = (widget.bindings ?? []).filter((b) => b.prop !== 'value' && b.prop !== 'text')
  const bindings = tagId
    ? [...rest, { id: newBindId(), prop: 'value' as const, tagId }]
    : rest
  return { ...widget, bindings }
}

/** 设置按钮 / 开关的 click→writeTag */
export function setPanelWidgetWriteTag(
  widget: Widget2D,
  opts: { tagId: string; value?: string | number | boolean; confirm?: boolean },
): Widget2D {
  const other = (widget.events ?? []).filter((e) => e.trigger !== 'click')
  if (!opts.tagId) return { ...widget, events: other }
  return {
    ...widget,
    events: [
      ...other,
      {
        id: newEventId(),
        trigger: 'click',
        actions: [
          {
            type: 'writeTag',
            tagId: opts.tagId,
            value: opts.value ?? (widget.type === 'switch' ? true : 1),
            confirm: opts.confirm !== false,
          },
        ],
      },
    ],
  }
}

/**
 * Widget2D → 旧 item（仅可逆子集；兼容工具用，规范化不再回写 items）。
 * @deprecated
 */
export function widgetToPanelItem(widget: Widget2D): Object3DPanelItem | null {
  const t = widget.transform
  const base = {
    id: widget.id,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    fontSize: typeof widget.style.fontSize === 'number' ? widget.style.fontSize : undefined,
  }

  if (widget.type === 'text') {
    const color =
      typeof widget.style.fill === 'string' && widget.style.fill !== 'transparent'
        ? widget.style.fill
        : undefined
    return {
      ...base,
      type: 'label',
      text: String(widget.props.text ?? widget.name ?? ''),
      color,
    }
  }

  if (widget.type === 'value') {
    const color =
      typeof widget.style.textColor === 'string' ? widget.style.textColor : undefined
    return {
      ...base,
      type: 'value',
      text: String(widget.props.label ?? widget.name ?? '数值'),
      tagId: panelWidgetValueTagId(widget) || '',
      color,
    }
  }

  if (widget.type === 'button') {
    const write = panelWidgetWriteAction(widget)
    const color =
      typeof widget.style.textColor === 'string' ? widget.style.textColor : undefined
    return {
      ...base,
      type: 'button',
      text: String(widget.props.text ?? widget.name ?? '按钮'),
      tagId: write?.tagId || '',
      writeValue: write?.value ?? 1,
      confirm: write ? write.confirm : true,
      color,
    }
  }

  if (widget.type === 'image') {
    return {
      ...base,
      type: 'image',
      text: widget.name || '图片',
      resourceId: String(widget.props.resourceId || ''),
    }
  }

  return null
}

/** @deprecated 规范化不再回写 items */
export function widgetsToPanelItems(widgets: Widget2D[]): Object3DPanelItem[] {
  const out: Object3DPanelItem[] = []
  for (const w of widgets) {
    const item = widgetToPanelItem(w)
    if (item) out.push(item)
  }
  return out
}

/** 解析面板应渲染的 widgets（优先 widgets，否则从旧 items 迁移） */
export function resolvePanelWidgets(panel?: Object3DPanel | null): Widget2D[] {
  if (!panel) return []
  if (panel.widgets && panel.widgets.length > 0) return panel.widgets
  if (panel.items && panel.items.length > 0) return panelItemsToWidgets(panel.items)
  return []
}

/**
 * 规范化面板尺寸与旧 widgets/items。
 * page2dId 由工程级 migratePanelPagesInDocument 补齐；此处保留已有 page2dId。
 */
export function normalizeObject3DPanel(panel: Object3DPanel): Object3DPanel {
  const width = panel.width ?? DEFAULT_PANEL_CONTENT_WIDTH
  const height = panel.height ?? DEFAULT_PANEL_CONTENT_HEIGHT
  let widgets: Widget2D[] | undefined
  if (panel.widgets && panel.widgets.length > 0) {
    widgets = panel.widgets
  } else if (panel.items && panel.items.length > 0) {
    widgets = panelItemsToWidgets(panel.items)
  } else if (panel.page2dId) {
    widgets = undefined
  } else {
    widgets = []
  }
  const next: Object3DPanel = {
    ...panel,
    width,
    height,
    objectFit: panel.objectFit ?? 'none',
    page2dId: panel.page2dId?.trim() || undefined,
  }
  if (widgets) next.widgets = widgets
  else delete next.widgets
  delete next.items
  return next
}

/** 遍历工程内所有 3D 面板并规范化 */
export function normalizeObject3dPanelsInTree(objects: Object3DNode[]): void {
  for (const obj of objects) {
    if (obj.panel) obj.panel = normalizeObject3DPanel(obj.panel)
    if (obj.children?.length) normalizeObject3dPanelsInTree(obj.children)
  }
}

/** 默认面板内容（仅 widgets） */
export function createDefaultPanelWidgets(title = '操作面板'): Widget2D[] {
  const labelSize = defaultPanelItemSize('label')
  const buttonSize = defaultPanelItemSize('button')
  const text = createWidget2D('text', {
    name: '文本',
    transform: {
      x: 10,
      y: 12,
      width: labelSize.width,
      height: labelSize.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    style: { fill: '#e8eaed', opacity: 1, fontSize: 12, align: 'left' },
    props: { text: title || '文本' },
  })
  const btn = createWidget2D('button', {
    name: '写值',
    transform: {
      x: 10,
      y: 48,
      width: buttonSize.width,
      height: buttonSize.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    style: {
      fill: 'rgba(14, 116, 144, 0.45)',
      stroke: 'rgba(56, 189, 248, 0.55)',
      strokeWidth: 1,
      opacity: 1,
      cornerRadius: 0,
      fontSize: 12,
      textColor: '#e0f2fe',
    },
    props: { text: '写值' },
  })
  btn.events = [
    {
      id: newEventId(),
      trigger: 'click',
      actions: [{ type: 'writeTag', tagId: '', value: 1, confirm: true }],
    },
  ]
  return [text, btn]
}
