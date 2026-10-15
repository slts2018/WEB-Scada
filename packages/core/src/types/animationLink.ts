/** Flight-SCADA 风格「动画连接」条目 */

export type AnimationLinkType =
  | 'moveH'
  | 'moveV'
  | 'moveZ'
  | 'hide'
  | 'height'
  | 'width'
  | 'scaleZ'
  | 'rotX'
  | 'rotY'
  | 'rotZ'
  | 'colorFill'
  | 'colorStroke'
  | 'colorFill2'
  | 'fillH'
  | 'fillV'
  | 'valueOut'
  | 'textOut'
  | 'valueIn'
  | 'digitalIn'
  | 'textIn'
  | 'dragH'
  | 'dragV'
  | 'dragZ'
  | 'enable'
  | 'flow'

export interface AnimationLinkBase {
  id: string
  type: AnimationLinkType
  /** 是否启用（对应 Flight「是否激活相关配置」） */
  enabled: boolean
  tagId: string
}

/** 量程映射类：移动 / 尺寸 / 旋转 / 百分比填充 / 拖拽写值 */
export interface AnimationLinkRange extends AnimationLinkBase {
  type:
    | 'moveH'
    | 'moveV'
    | 'moveZ'
    | 'height'
    | 'width'
    | 'scaleZ'
    | 'rotX'
    | 'rotY'
    | 'rotZ'
    | 'fillH'
    | 'fillV'
    | 'dragH'
    | 'dragV'
    | 'dragZ'
  inMin: number
  inMax: number
  outMin: number
  outMax: number
  /** 填充方向：fillH=左右，fillV=上下 */
  direction?: 'start' | 'end'
}

/** 图形隐藏 */
export interface AnimationLinkHide extends AnimationLinkBase {
  type: 'hide'
  /** true 时显示、false 时隐藏（可关掉表示反转） */
  trueShow: boolean
}

export interface AnimationColorRange {
  min?: number
  max?: number
  equals?: number | boolean | string
  color: string
  blink?: boolean
}

/** 颜色变化（填充色 / 边线 / 填充色2） */
export interface AnimationLinkColor extends AnimationLinkBase {
  type: 'colorFill' | 'colorStroke' | 'colorFill2'
  ranges: AnimationColorRange[]
}

/** 数值/文本输出显示 */
export interface AnimationLinkTextOut extends AnimationLinkBase {
  type: 'valueOut' | 'textOut'
  /** 如 fixed:1 / bool */
  format?: string
}

/** 点击输入写值（模拟量 / 数字量 / 字符串） */
export interface AnimationLinkInput extends AnimationLinkBase {
  type: 'valueIn' | 'digitalIn' | 'textIn'
  /** 写前确认 */
  confirm?: boolean
  /** 数字量：toggle 翻转；on/off 写固定值 */
  digitalMode?: 'toggle' | 'on' | 'off'
}

/**
 * 管道流动（3D 专用）：变量 → 速度系数，条纹沿物体「最长轴」滚动。
 * 模型没有 UV 也能用（用世界坐标沿轴向生成伪 UV），所以 CAD 直出的直管可以直接绑。
 */
export interface AnimationLinkFlow extends AnimationLinkBase {
  type: 'flow'
  /** 变量量程下限 */
  inMin: number
  /** 变量量程上限 */
  inMax: number
  /** 量程映射出的速度系数下限（一般 0） */
  outMin: number
  /** 量程映射出的速度系数上限（一般 1） */
  outMax: number
  /** 满速时的流动速度（米/秒）；负值 = 反向 */
  speed: number
  /** 条纹间隔（米）；缺省按管径自动（约 6 倍最小边，0.03~0.6m） */
  stripe?: number
  /** 条纹颜色；缺省青色 #67e8f9 */
  color?: string
  /** 条纹宽度占比 0.05~0.9；缺省 0.42 */
  duty?: number
  /** 流向轴：auto = 物体局部最长轴（推荐，直管不用配） */
  axis?: 'auto' | 'x' | 'y' | 'z'
  /**
   * 样式：
   * - skin（默认）：**贴皮箭头** —— 在管壁**左右两侧**各贴一个「长杆 + 三角头」的箭头，
   *   随管壁弯曲，正面/侧面都看得见（不会侧看成一条线）
   * - ribbon：浮在管子上方的平面箭头（只适合俯视角度看）
   * - chevron：发光「»」双斜箭（贴管壁，亮芯 + 光晕）
   * - arrow：锥形箭头（整圈包裹的实心箭头）
   * - stripe：条纹
   */
  style?: 'skin' | 'ribbon' | 'chevron' | 'arrow' | 'stripe'
  /** 斜箭 Stroke 粗细 0.06~0.5（绕管角度比例）；默认 0.22 */
  thick?: number
  /** 浮空箭头长度（米）；缺省 = 0.62 × 间隔 */
  size?: number
  /** 浮空箭头不透明度 0.15~1；默认 0.85 */
  alpha?: number
  /**
   * 光晕强度 0~1；**默认 0（不要光晕）**。
   * =0 时箭头是纯色平面（和参考图一致）；调大才会有"亮芯 + 外圈柔光"。
   */
  glow?: number
  /**
   * 箭头横向张开 0.3~1：1 = 整圈包裹（任何视角都看得见，默认），
   * 越小越像贴在管子一侧的箭头。
   */
  width?: number
}

/** 禁止使能：按变量控制是否可交互 */
export interface AnimationLinkEnable extends AnimationLinkBase {
  type: 'enable'
  /** true：变量为真时允许操作；false：变量为真时禁止操作 */
  trueEnable: boolean
}

export type AnimationLink =
  | AnimationLinkRange
  | AnimationLinkHide
  | AnimationLinkColor
  | AnimationLinkTextOut
  | AnimationLinkInput
  | AnimationLinkEnable
  | AnimationLinkFlow

/** 需要运行时点击/拖拽交互的动画类型 */
export const INTERACTIVE_LINK_TYPES: AnimationLinkType[] = [
  'valueIn',
  'digitalIn',
  'textIn',
  'dragH',
  'dragV',
  'dragZ',
]

/** 动画连接类型树（设计端 2D，对齐 Flight 动画连接面板） */
export const ANIMATION_LINK_TREE: Array<{
  group: string
  items: Array<{ type: AnimationLinkType; label: string }>
}> = [
  {
    group: '输入输出',
    items: [
      { type: 'valueOut', label: '数值显示' },
      { type: 'textOut', label: '文本显示' },
      { type: 'valueIn', label: '模拟量输入' },
      { type: 'digitalIn', label: '数字量输入' },
      { type: 'textIn', label: '字符串输入' },
    ],
  },
  {
    group: '目标移动',
    items: [
      { type: 'moveH', label: '水平移动' },
      { type: 'moveV', label: '垂直移动' },
    ],
  },
  {
    group: '尺寸',
    items: [
      { type: 'hide', label: '图形隐藏' },
      { type: 'height', label: '高度变化' },
      { type: 'width', label: '宽度变化' },
    ],
  },
  {
    group: '颜色变化',
    items: [
      { type: 'colorFill', label: '填充色' },
      { type: 'colorStroke', label: '边线' },
      { type: 'colorFill2', label: '填充色2' },
    ],
  },
  {
    group: '百分比填充',
    items: [
      { type: 'fillH', label: '水平百分比' },
      { type: 'fillV', label: '垂直百分比' },
    ],
  },
  {
    group: '鼠标动作',
    items: [
      { type: 'dragH', label: '水平拖拽' },
      { type: 'dragV', label: '垂直拖拽' },
      { type: 'enable', label: '禁止使能' },
    ],
  },
]

/**
 * 3D 动画连接树（独立文案：位移 XYZ、缩放含长度、旋转）。
 * fillH/fillV 不进树（与缩放重复），旧数据仍可运行。
 */
export const OBJECT3D_LINK_TREE: Array<{
  group: string
  items: Array<{ type: AnimationLinkType; label: string }>
}> = [
  {
    group: '输入',
    items: [
      { type: 'valueIn', label: '模拟量输入' },
      { type: 'digitalIn', label: '数字量输入' },
      { type: 'textIn', label: '字符串输入' },
    ],
  },
  {
    group: '位移',
    items: [
      { type: 'moveH', label: '位移 X' },
      { type: 'moveV', label: '位移 Y' },
      { type: 'moveZ', label: '位移 Z' },
    ],
  },
  {
    group: '缩放',
    items: [
      { type: 'hide', label: '隐藏' },
      { type: 'width', label: '缩放 X（宽）' },
      { type: 'height', label: '缩放 Y（高）' },
      { type: 'scaleZ', label: '缩放 Z（长）' },
    ],
  },
  {
    group: '旋转',
    items: [
      { type: 'rotX', label: '旋转 X' },
      { type: 'rotY', label: '旋转 Y' },
      { type: 'rotZ', label: '旋转 Z' },
    ],
  },
  {
    group: '颜色',
    items: [
      { type: 'colorFill', label: '主体色' },
      { type: 'colorStroke', label: '发光' },
      { type: 'colorFill2', label: '辅色' },
    ],
  },
  {
    group: '流动',
    items: [{ type: 'flow', label: '管道流动' }],
  },
  {
    group: '鼠标动作',
    items: [
      { type: 'dragH', label: '拖拽 X' },
      { type: 'dragV', label: '拖拽 Y' },
      { type: 'dragZ', label: '拖拽 Z' },
      { type: 'enable', label: '使能' },
    ],
  },
]

export function animationLinkTypeLabel(
  type: AnimationLinkType,
  mode: '2d' | '3d' = '2d',
): string {
  const primary = mode === '3d' ? OBJECT3D_LINK_TREE : ANIMATION_LINK_TREE
  const secondary = mode === '3d' ? ANIMATION_LINK_TREE : OBJECT3D_LINK_TREE
  for (const g of primary) {
    const hit = g.items.find((i) => i.type === type)
    if (hit) return hit.label
  }
  for (const g of secondary) {
    const hit = g.items.find((i) => i.type === type)
    if (hit) return hit.label
  }
  return type
}
