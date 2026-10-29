import type { TagMeta } from '@web-scada/core'

/** 编辑端 Tag 下拉统一展示：分组 · 名称 */
export function formatTagOptionLabel(meta: TagMeta): string {
  const parts: string[] = []
  if (meta.group) parts.push(`[${meta.group}]`)
  parts.push(meta.name)
  return parts.join(' · ')
}

export function qualityTagType(q?: string | null): 'success' | 'danger' | 'info' | 'warning' {
  if (q === 'Good') return 'success'
  if (q === 'Bad') return 'danger'
  if (q === 'Offline') return 'info'
  return 'warning'
}
