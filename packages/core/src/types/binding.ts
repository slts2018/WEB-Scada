/** 图元属性绑定：把画面属性挂到 Tag */
export type BindableProp =
  | 'text'
  | 'value'
  | 'fill'
  | 'stroke'
  | 'visible'
  | 'opacity'
  | 'x'
  | 'y'
  | 'z'
  | 'rotation'
  | 'rotX'
  | 'rotY'
  | 'rotZ'
  | 'scaleX'
  | 'scaleY'
  | 'scaleZ'
  | 'color'

export interface PropBinding {
  id: string
  prop: BindableProp
  tagId: string
  /** 可选表达式/格式，如小数位、布尔反转 */
  format?: string
}
