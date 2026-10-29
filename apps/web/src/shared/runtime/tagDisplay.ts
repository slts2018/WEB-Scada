import { formatTrendNumber, type TrendValueFormat, type Widget2D } from '@web-scada/core'
import { useTagStore } from '@/stores/tag'

/** 曲线和数值类控件的显示格式：单位和小数位都在变量上，留空小数位 = 按量级自适应。 */
export function tagDisplayFormat(tagId: string): TrendValueFormat {
  if (!tagId) return {}
  try {
    const meta = useTagStore().metas.find((item) => item.tagId === tagId)
    if (!meta) return {}
    const unit = typeof meta.unit === 'string' && meta.unit.trim() ? meta.unit.trim() : undefined
    const raw = meta.decimals
    const decimals =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.min(6, Math.max(0, Math.trunc(raw)))
        : undefined
    return { unit, decimals }
  } catch {
    return {}
  }
}

/** 数值 / 仪表 / 文本上绑的那个变量。 */
export function widgetValueTagId(widget: Pick<Widget2D, 'animationLinks' | 'bindings'>): string {
  for (const link of widget.animationLinks ?? []) {
    if (link.enabled === false || !link.tagId) continue
    if (link.type === 'valueOut' || link.type === 'textOut') return link.tagId
  }
  for (const binding of widget.bindings ?? []) {
    if (binding.tagId && (binding.prop === 'value' || binding.prop === 'text')) return binding.tagId
  }
  return ''
}

/** 按变量小数位格式化。没绑变量、或变量没填小数位时按量级自适应。 */
export function formatTagNumber(value: number, tagId: string): string {
  return formatTrendNumber(value, tagDisplayFormat(tagId).decimals)
}
