/**
 * 面板编辑器：Widget2D 创建 / 属性读写辅助（不回写旧 items）
 */
import type { Widget2D } from '@web-scada/core'
import {
  clampPanelItemRect,
  createWidget2D,
  isPanelWidgetType,
  panelWidgetPrimaryTagId,
  panelWidgetWriteAction,
  type PanelWidgetType,
  setPanelWidgetValueTag,
  setPanelWidgetWriteTag,
} from '@web-scada/core'

export type PanelEditorWidgetType = PanelWidgetType

export function panelWidgetTypeLabel(type: string): string {
  const map: Record<string, string> = {
    text: '文本',
    value: '数值',
    button: '按钮',
    image: '图片',
    rect: '矩形',
    roundRect: '圆角矩形',
    switch: '开关',
    lamp: '指示灯',
  }
  return map[type] || type
}

export function panelWidgetTypeShort(type: string): string {
  const map: Record<string, string> = {
    text: 'T',
    value: 'Val',
    button: 'Btn',
    image: 'Img',
    rect: 'Rect',
    roundRect: 'RRect',
    switch: 'Sw',
    lamp: 'Lamp',
  }
  return map[type] || '?'
}

export function panelWidgetDisplayName(w: Widget2D, index: number): string {
  if (w.type === 'text') return String(w.props.text || w.name || `文本${index + 1}`)
  if (w.type === 'value') return String(w.props.label || w.name || `数值${index + 1}`)
  if (w.type === 'button') return String(w.props.text || w.name || `按钮${index + 1}`)
  if (w.type === 'image') return String(w.name || `图片${index + 1}`)
  if (w.type === 'switch') return String(w.props.label || w.name || `开关${index + 1}`)
  if (w.type === 'lamp') return String(w.name || `指示灯${index + 1}`)
  return w.name || `${panelWidgetTypeLabel(w.type)}${index + 1}`
}

export function createPanelEditorWidget(
  type: string,
  opts: {
    at?: { x: number; y: number }
    panelW: number
    panelH: number
    count: number
    defaultTagId?: string
  },
): Widget2D | null {
  if (!isPanelWidgetType(type)) return null
  const defaults: Partial<Record<PanelWidgetType, { width: number; height: number }>> = {
    text: { width: 100, height: 22 },
    value: { width: 148, height: 48 },
    button: { width: 88, height: 28 },
    image: { width: 72, height: 72 },
    rect: { width: 80, height: 48 },
    roundRect: { width: 80, height: 48 },
    switch: { width: 120, height: 32 },
    lamp: { width: 28, height: 28 },
  }
  const size = defaults[type] ?? { width: 100, height: 48 }
  const x = opts.at ? opts.at.x - size.width / 2 : 10 + (opts.count % 4) * 12
  const y = opts.at ? opts.at.y - size.height / 2 : 10 + opts.count * 18
  const rect = clampPanelItemRect(
    { x, y, width: size.width, height: size.height },
    opts.panelW,
    opts.panelH,
    { width: 1, height: 1 },
  )

  let w = createWidget2D(type, {
    name: `${panelWidgetTypeLabel(type)}${opts.count + 1}`,
    transform: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  })

  if (type === 'text') {
    w.props = { ...w.props, text: `文本${opts.count + 1}` }
    w.style = { ...w.style, fontSize: 12, fill: '#e8eaed' }
  } else if (type === 'value') {
    w.props = { ...w.props, label: `数值${opts.count + 1}`, value: '--', unit: '', decimals: 1 }
    w.style = {
      ...w.style,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      fontSize: 12,
      textColor: '#f8fafc',
      labelColor: '#94a3b8',
    }
    if (opts.defaultTagId) w = setPanelWidgetValueTag(w, opts.defaultTagId)
  } else if (type === 'button') {
    w.props = { ...w.props, text: `按钮${opts.count + 1}` }
    w.style = {
      ...w.style,
      fill: 'rgba(14, 116, 144, 0.45)',
      stroke: 'rgba(56, 189, 248, 0.55)',
      strokeWidth: 1,
      cornerRadius: 0,
      fontSize: 12,
      textColor: '#e0f2fe',
    }
    w = setPanelWidgetWriteTag(w, {
      tagId: opts.defaultTagId || '',
      value: 1,
      confirm: true,
    })
  } else if (type === 'image') {
    w.props = { ...w.props, resourceId: '', src: '' }
  } else if (type === 'switch') {
    w.props = { ...w.props, label: `开关${opts.count + 1}`, on: false }
    if (opts.defaultTagId) {
      w = setPanelWidgetValueTag(w, opts.defaultTagId)
      w = setPanelWidgetWriteTag(w, { tagId: opts.defaultTagId, value: true, confirm: true })
    }
  } else if (type === 'lamp') {
    w.props = { ...w.props, on: false }
    if (opts.defaultTagId) w = setPanelWidgetValueTag(w, opts.defaultTagId)
  }

  return w
}

export function widgetFontSize(w: Widget2D, fallback: number): number {
  const fs = w.style.fontSize
  return typeof fs === 'number' && fs > 0 ? fs : fallback
}

export function widgetColor(w: Widget2D): string | undefined {
  if (w.type === 'text') {
    return typeof w.style.fill === 'string' ? w.style.fill : undefined
  }
  if (w.type === 'value' || w.type === 'button') {
    return typeof w.style.textColor === 'string' ? w.style.textColor : undefined
  }
  if (w.type === 'rect' || w.type === 'roundRect' || w.type === 'lamp') {
    return typeof w.style.fill === 'string' ? w.style.fill : undefined
  }
  return undefined
}

export function setWidgetColor(w: Widget2D, color: string | undefined): Widget2D {
  if (w.type === 'text') {
    const style = { ...w.style }
    if (color) style.fill = color
    else delete style.fill
    return { ...w, style }
  }
  if (w.type === 'value' || w.type === 'button') {
    const style = { ...w.style }
    if (color) style.textColor = color
    else delete style.textColor
    return { ...w, style }
  }
  if (w.type === 'rect' || w.type === 'roundRect' || w.type === 'lamp') {
    const style = { ...w.style }
    if (color) style.fill = color
    else delete style.fill
    return { ...w, style }
  }
  return w
}

export function setWidgetFontSize(w: Widget2D, fontSize: number | undefined): Widget2D {
  const style = { ...w.style }
  if (fontSize != null && fontSize > 0) style.fontSize = fontSize
  else delete style.fontSize
  return { ...w, style }
}

export function widgetPrimaryText(w: Widget2D): string {
  if (w.type === 'text') return String(w.props.text ?? '')
  if (w.type === 'value' || w.type === 'switch') return String(w.props.label ?? '')
  if (w.type === 'button') return String(w.props.text ?? '')
  return w.name || ''
}

export function setWidgetPrimaryText(w: Widget2D, text: string): Widget2D {
  if (w.type === 'text') return { ...w, props: { ...w.props, text }, name: text || w.name }
  if (w.type === 'value' || w.type === 'switch') {
    return { ...w, props: { ...w.props, label: text }, name: text || w.name }
  }
  if (w.type === 'button') return { ...w, props: { ...w.props, text }, name: text || w.name }
  return { ...w, name: text || w.name }
}

export function widgetTagId(w: Widget2D): string {
  return panelWidgetPrimaryTagId(w) || ''
}

export function setWidgetTagId(w: Widget2D, tagId: string): Widget2D {
  if (w.type === 'button') {
    const write = panelWidgetWriteAction(w)
    return setPanelWidgetWriteTag(w, {
      tagId,
      value: write?.value ?? 1,
      confirm: write?.confirm !== false,
    })
  }
  if (w.type === 'switch') {
    let next = setPanelWidgetValueTag(w, tagId)
    const write = panelWidgetWriteAction(w)
    next = setPanelWidgetWriteTag(next, {
      tagId,
      value: write?.value ?? true,
      confirm: write?.confirm !== false,
    })
    return next
  }
  if (w.type === 'value' || w.type === 'lamp') {
    return setPanelWidgetValueTag(w, tagId)
  }
  return w
}

export function widgetWriteValue(w: Widget2D): string | number | boolean {
  return panelWidgetWriteAction(w)?.value ?? 1
}

export function widgetWriteConfirm(w: Widget2D): boolean {
  return panelWidgetWriteAction(w)?.confirm !== false
}

export function setWidgetWriteValue(w: Widget2D, value: string | number | boolean): Widget2D {
  const tagId = panelWidgetWriteAction(w)?.tagId || ''
  return setPanelWidgetWriteTag(w, {
    tagId,
    value,
    confirm: widgetWriteConfirm(w),
  })
}

export function setWidgetWriteConfirm(w: Widget2D, confirm: boolean): Widget2D {
  const write = panelWidgetWriteAction(w)
  return setPanelWidgetWriteTag(w, {
    tagId: write?.tagId || '',
    value: write?.value ?? 1,
    confirm,
  })
}

export function parseWriteValue(raw: string): string | number | boolean {
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t)
  return raw
}
