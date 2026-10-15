/** 布尔值的显示文案。空文本时用 fallback，不改变 true/false 本身。 */
export function formatBoolText(
  value: unknown,
  labels?: { onText?: string; offText?: string } | null,
  fallback: { on: string; off: string } = { on: 'true', off: 'false' },
): string | null {
  let on: boolean | null = null
  if (typeof value === 'boolean') on = value
  else if (value === 1 || value === '1' || value === 'true') on = true
  else if (value === 0 || value === '0' || value === 'false') on = false
  if (on === null) return null
  const custom = (on ? labels?.onText : labels?.offText)?.trim()
  if (custom) return custom
  return on ? fallback.on : fallback.off
}
