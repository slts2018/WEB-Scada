import type { QualityCode, TagMeta } from '@web-scada/core'

/** 编辑端 Tag 下拉统一展示：分组 · 名称 · 读写 · 质量 */
export function formatTagOptionLabel(
  meta: TagMeta,
  quality?: QualityCode | string | null,
): string {
  const parts: string[] = []
  if (meta.group) parts.push(`[${meta.group}]`)
  parts.push(`${meta.name} (${meta.tagId})`)
  parts.push(meta.writable ? '读写' : '只读')
  if (quality) parts.push(String(quality))
  return parts.join(' · ')
}

export function qualityTagType(q?: string | null): 'success' | 'danger' | 'info' | 'warning' {
  if (q === 'Good') return 'success'
  if (q === 'Bad') return 'danger'
  if (q === 'Offline') return 'info'
  return 'warning'
}
