export type EventTrigger =
  | 'click'
  | 'dblclick'
  | 'mousedown'
  | 'mouseup'
  | 'mouseEnter'
  | 'mouseLeave'
  | 'load'
  | 'unload'
  | 'valueChange'

export const EVENT_TRIGGER_OPTIONS: Array<{ value: EventTrigger; label: string }> = [
  { value: 'click', label: '单击' },
  { value: 'dblclick', label: '双击' },
  { value: 'mousedown', label: '按下' },
  { value: 'mouseup', label: '抬起' },
  { value: 'mouseEnter', label: '鼠标进入' },
  { value: 'mouseLeave', label: '鼠标离开' },
  { value: 'load', label: '页面加载' },
  { value: 'unload', label: '页面卸载' },
  { value: 'valueChange', label: '值变化' },
]

export type EventActionType = 'navigate' | 'openDialog' | 'writeTag' | 'runScript'

export interface NavigateAction {
  type: 'navigate'
  pageId: string
  params?: Record<string, string | number | boolean>
}

export interface WriteTagAction {
  type: 'writeTag'
  tagId: string
  value: boolean | number | string
  confirm?: boolean
}

export interface OpenDialogAction {
  type: 'openDialog'
  /** 打开的目标：2D 页面 id（作为对话框画面） */
  dialogId: string
  params?: Record<string, unknown>
}

export interface RunScriptAction {
  type: 'runScript'
  scriptId: string
}

export type EventAction = NavigateAction | WriteTagAction | OpenDialogAction | RunScriptAction

export interface EventBinding {
  id: string
  trigger: EventTrigger
  actions: EventAction[]
}
