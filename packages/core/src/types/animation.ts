export type AnimationKind = 'state' | 'numeric'

export interface StateAnimationRule {
  id: string
  kind: 'state'
  tagId: string
  /** 目标属性，如 visible / fill / blink */
  target: string
  ranges: Array<{
    min?: number | boolean | string
    max?: number | boolean | string
    equals?: number | boolean | string
    apply: Record<string, unknown>
  }>
}

export interface NumericAnimationRule {
  id: string
  kind: 'numeric'
  tagId: string
  target: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'fillRatio'
  inMin: number
  inMax: number
  outMin: number
  outMax: number
}

export type AnimationRule = StateAnimationRule | NumericAnimationRule
