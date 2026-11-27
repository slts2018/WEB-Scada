/**
 * 图元标题只显示属性里的名称，不自动把绑定变量 id 接到标题后面。
 *
 * 演示目录里不少图元的 props.title 已被写成「历史趋势 sim.hr0/hr1/hr2」
 * 或「基础折线图 sim.hr0/sim.hr1/sim.hr2」这类后缀；显示时去掉这段，
 * 图例系列名（模拟HR0 等）保持不变。
 */
export function looksLikeBoundTagSuffix(text: string): boolean {
  const parts = String(text || '')
    .trim()
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return false
  const tagLike = (part: string) =>
    /^[A-Za-z_][\w-]*\.[A-Za-z_][\w.-]*$/.test(part) || /^[A-Za-z_][\w-]*$/.test(part)
  if (!parts.every(tagLike)) return false
  if (parts.length === 1) return parts[0].includes('.')
  // 避免把「分组 A/B」这类标题误剪掉：要么带设备前缀的点号，要么每段都像 HR0
  return parts.some((part) => part.includes('.')) || parts.every((part) => /\d/.test(part) && part.length >= 2)
}

export function stripBoundTagTitleSuffix(title: string): string {
  const trimmed = String(title || '').trim()
  const matched = /^(.*?)(?:\s+)([A-Za-z_][\w.-]*(?:\/[A-Za-z_][\w.-]*)+)$/.exec(trimmed)
  if (!matched) return trimmed
  const head = matched[1].trim()
  const suffix = matched[2].trim()
  if (!head || !looksLikeBoundTagSuffix(suffix)) return trimmed
  return head
}

/** 图表标题：只要属性名称，不要自动拼接的变量 id。 */
export function chartWidgetTitle(opts: {
  name?: string
  title?: unknown
  fallback?: string
}): string {
  const fallback = String(opts.fallback ?? '').trim()
  const name = String(opts.name ?? '').trim()
  const raw = String(opts.title ?? '').trim()
  const cleaned = stripBoundTagTitleSuffix(raw)
  if (cleaned) return cleaned
  if (name) return name
  return fallback
}
