<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  AnimationColorRange,
  AnimationLink,
  AnimationLinkType,
  BindableProp,
  EventAction,
  EventBinding,
  EventTrigger,
  PropBinding,
} from '@web-scada/core'
import {
  ANIMATION_LINK_TREE,
  EVENT_TRIGGER_OPTIONS,
  OBJECT3D_LINK_TREE,
  animationLinkTypeLabel,
  listNavigationPages,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { createAnimationLink, createBinding } from '@/shared/runtime/bindingEngine'
import { isObject3DLinkType } from '@/shared/runtime/bindingEngine3d'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'
import HelpTip from '@/components/designer/HelpTip.vue'

const project = useProjectStore()
const tags = useTagStore()

/** 2D 图元或 3D 对象（与当前页选中一致） */
const is3d = computed(() => Boolean(project.activePage3d && project.selectedObject3d))
const target = computed(() => (is3d.value ? project.selectedObject3d : project.selectedWidget))
const pages = computed(() => listNavigationPages(project.document))

const dialogVisible = computed({
  get: () => project.animationConnectionOpen,
  set: (v: boolean) => {
    if (v) project.openAnimationConnection(project.animationConnectionTab)
    else project.closeAnimationConnection()
  },
})

/** 当前编辑的动画类型（左侧树选中） */
const activeType = ref<AnimationLinkType | 'property' | 'event'>('hide')

const links = computed(() => target.value?.animationLinks ?? [])

const activeLink = computed(() => {
  if (!target.value || activeType.value === 'property' || activeType.value === 'event') return null
  return links.value.find((l) => l.type === activeType.value) ?? null
})

const activeRangeLink = computed(() => {
  const link = activeLink.value
  if (!link || !isRangeLinkType(link.type)) return null
  return link as Extract<AnimationLink, { inMin: number }>
})

const linkTree = computed(() => (is3d.value ? OBJECT3D_LINK_TREE : ANIMATION_LINK_TREE))

const linkLabelMode = computed(() => (is3d.value ? '3d' : '2d') as '2d' | '3d')

/** 当前动画类型的备注（标题旁 ?） */
const activeLinkTip = computed(() => {
  const t = activeLink.value?.type
  if (!t) return ''
  if (t === 'dragH' || t === 'dragV' || t === 'dragZ') {
    return is3d.value
      ? '运行端拖拽对象写变量（多轴时：默认 X，Shift=Y，Alt=Z）；建议同时配置同向位移以便回显。'
      : '运行端拖拽图元，按像素偏移写入变量；建议同时配置同向「水平/垂直移动」以便回显。'
  }
  if (t === 'valueIn' || t === 'digitalIn' || t === 'textIn') {
    return '运行端点击图元写入绑定变量（模拟量/字符串弹出输入框）。'
  }
  if (t === 'enable') {
    return '按变量控制图元是否可点击/拖拽（禁止使能）。'
  }
  return ''
})

/** 量程表单：输出步长（3D 位移/缩放 0.01，旋转按度 1） */
const rangeStep = computed(() => {
  const t = activeRangeLink.value?.type
  if (!is3d.value || !t) return 1
  if (t === 'rotX' || t === 'rotY' || t === 'rotZ') return 1
  if (
    t === 'moveH' ||
    t === 'moveV' ||
    t === 'moveZ' ||
    t === 'width' ||
    t === 'height' ||
    t === 'scaleZ' ||
    t === 'dragH' ||
    t === 'dragV' ||
    t === 'dragZ'
  ) {
    return 0.01
  }
  return 1
})

function isRangeLinkType(type: AnimationLinkType): boolean {
  return (
    type === 'moveH' ||
    type === 'moveV' ||
    type === 'moveZ' ||
    type === 'width' ||
    type === 'height' ||
    type === 'scaleZ' ||
    type === 'rotX' ||
    type === 'rotY' ||
    type === 'rotZ' ||
    type === 'fillH' ||
    type === 'fillV' ||
    type === 'dragH' ||
    type === 'dragV' ||
    type === 'dragZ'
  )
}

const bindableProps = computed((): Array<{ value: BindableProp; label: string }> => {
  if (!is3d.value) {
    return [
      { value: 'text', label: '文本' },
      { value: 'value', label: '值/状态' },
      { value: 'fill', label: '填充色' },
      { value: 'stroke', label: '描边色' },
      { value: 'visible', label: '可见' },
      { value: 'opacity', label: '透明度' },
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'rotation', label: '旋转' },
    ]
  }
  const base: Array<{ value: BindableProp; label: string }> = [
    { value: 'color', label: '颜色' },
    { value: 'visible', label: '可见' },
    { value: 'opacity', label: '透明度' },
    { value: 'x', label: '位置X' },
    { value: 'y', label: '位置Y' },
    { value: 'z', label: '位置Z' },
  ]
  const panelOnly = Boolean(project.selectedObject3d?.panel) && !project.selectedObject3d?.modelResourceId
  if (panelOnly) return base
  return [
    ...base,
    { value: 'rotX', label: '旋转X' },
    { value: 'rotY', label: '旋转Y' },
    { value: 'rotZ', label: '旋转Z' },
    { value: 'scaleX', label: '缩放X' },
    { value: 'scaleY', label: '缩放Y' },
    { value: 'scaleZ', label: '缩放Z' },
  ]
})

watch(
  () => project.animationConnectionOpen,
  (open) => {
    if (!open) return
    if (project.animationConnectionTab === 'property') {
      activeType.value = 'property'
      return
    }
    if (project.animationConnectionTab === 'event') {
      activeType.value = 'event'
      return
    }
    const first = links.value[0]
    activeType.value = first?.type ?? 'hide'
  },
)

function patchLinks(next: AnimationLink[]) {
  if (!target.value) return
  if (is3d.value) project.updateObject3d(target.value.id, { animationLinks: next })
  else project.updateWidget(target.value.id, { animationLinks: next })
}

function patchBindings(next: PropBinding[]) {
  if (!target.value) return
  if (is3d.value) project.updateObject3d(target.value.id, { bindings: next })
  else project.updateWidget(target.value.id, { bindings: next })
}

function patchEvents(next: EventBinding[]) {
  if (!target.value) return
  if (is3d.value) project.updateObject3d(target.value.id, { events: next })
  else project.updateWidget(target.value.id, { events: next })
}

function hasLink(type: AnimationLinkType) {
  return links.value.some((l) => l.type === type)
}

/** 左侧绿点：仅「已配置且激活」时显示 */
function hasActiveLink(type: AnimationLinkType) {
  return links.value.some((l) => l.type === type && l.enabled)
}

function selectType(type: AnimationLinkType) {
  activeType.value = type
  if (!target.value) return
  if (is3d.value && !isObject3DLinkType(type)) return
  if (hasLink(type)) return
  const tagId = tags.metas[0]?.tagId
  if (!tagId) return
  const link = createAnimationLink(type, tagId)
  if (is3d.value) {
    if (link.type === 'moveH' || link.type === 'moveV' || link.type === 'moveZ') {
      link.outMin = 0
      link.outMax = 1
    }
    if (link.type === 'width' || link.type === 'height' || link.type === 'scaleZ' || link.type === 'fillH' || link.type === 'fillV') {
      link.outMin = 0.2
      link.outMax = 2
    }
    if (link.type === 'dragH' || link.type === 'dragV' || link.type === 'dragZ') {
      link.outMin = -2
      link.outMax = 2
    }
    if (link.type === 'rotX' || link.type === 'rotY' || link.type === 'rotZ') {
      link.outMin = 0
      link.outMax = 360
    }
  }
  patchLinks([...links.value, link])
}

function ensureLink(): AnimationLink | null {
  return activeLink.value
}

function updateActiveLink(partial: Partial<AnimationLink>) {
  if (!target.value || !activeLink.value) return
  const id = activeLink.value.id
  patchLinks(links.value.map((l) => (l.id === id ? ({ ...l, ...partial } as AnimationLink) : l)))
}

function removeActiveLink() {
  if (!target.value || !activeLink.value) return
  patchLinks(links.value.filter((l) => l.id !== activeLink.value!.id))
}

function updateRangeField(
  key: 'inMin' | 'inMax' | 'outMin' | 'outMax' | 'direction',
  value: number | string | undefined,
) {
  const link = ensureLink()
  if (!link || !('inMin' in link)) return
  if (key === 'direction') {
    updateActiveLink({ direction: value === 'end' ? 'end' : 'start' })
    return
  }
  updateActiveLink({ [key]: Number(value) || 0 })
}

function updateColorRange(index: number, next: Partial<AnimationColorRange>) {
  const link = ensureLink()
  if (!link || (link.type !== 'colorFill' && link.type !== 'colorStroke' && link.type !== 'colorFill2'))
    return
  const ranges = link.ranges.map((r, i) => (i === index ? { ...r, ...next } : r))
  updateActiveLink({ ranges })
}

function addColorRange() {
  const link = ensureLink()
  if (!link || (link.type !== 'colorFill' && link.type !== 'colorStroke' && link.type !== 'colorFill2'))
    return
  updateActiveLink({
    ranges: [...link.ranges, { min: 0, max: 50, color: '#3d8bfd', blink: false }],
  })
}

function removeColorRange(index: number) {
  const link = ensureLink()
  if (!link || (link.type !== 'colorFill' && link.type !== 'colorStroke' && link.type !== 'colorFill2'))
    return
  updateActiveLink({ ranges: link.ranges.filter((_, i) => i !== index) })
}

function addBinding() {
  const tagId = tags.metas[0]?.tagId
  if (!target.value || !tagId) return
  const prop: BindableProp = is3d.value ? 'color' : 'text'
  patchBindings([...target.value.bindings, createBinding(prop, tagId, is3d.value ? undefined : 'fixed:1')])
}

function updateBinding(index: number, next: Partial<PropBinding>) {
  if (!target.value) return
  patchBindings(target.value.bindings.map((b, i) => (i === index ? { ...b, ...next } : b)))
}

function removeBinding(index: number) {
  if (!target.value) return
  patchBindings(target.value.bindings.filter((_, i) => i !== index))
}

function addNavigateEvent() {
  if (!target.value) return
  const pageId = pages.value.find((p) => p.id !== project.activePageId)?.id || pages.value[0]?.id
  if (!pageId) return
  const event: EventBinding = {
    id: `evt_${Date.now()}`,
    trigger: 'click',
    actions: [{ type: 'navigate', pageId }],
  }
  patchEvents([...target.value.events, event])
}

function addWriteEvent() {
  if (!target.value) return
  const tag = tags.metas.find((m) => m.writable)
  if (!tag) return
  const event: EventBinding = {
    id: `evt_${Date.now()}`,
    trigger: 'click',
    actions: [
      {
        type: 'writeTag',
        tagId: tag.tagId,
        value: tag.dataType === 'bool' ? true : 1,
        confirm: false,
      },
    ],
  }
  patchEvents([...target.value.events, event])
}

function addRunScriptEvent() {
  if (!target.value) return
  const scriptId = project.document.scripts[0]?.id
  if (!scriptId) return
  const event: EventBinding = {
    id: `evt_${Date.now()}`,
    trigger: 'click',
    actions: [{ type: 'runScript', scriptId }],
  }
  patchEvents([...target.value.events, event])
}

function addOpenDialogEvent() {
  if (!target.value) return
  const pageId =
    pages.value.find((p) => p.type === '2d' && p.id !== project.activePageId)?.id ||
    pages.value.find((p) => p.type === '2d')?.id
  if (!pageId) return
  const event: EventBinding = {
    id: `evt_${Date.now()}`,
    trigger: 'click',
    actions: [{ type: 'openDialog', dialogId: pageId }],
  }
  patchEvents([...target.value.events, event])
}

function updateEventTrigger(index: number, trigger: EventTrigger) {
  if (!target.value) return
  const events = target.value.events.map((evt, i) => (i === index ? { ...evt, trigger } : evt))
  patchEvents(events)
}

function updateEventAction(eventIndex: number, actionIndex: number, next: Partial<EventAction>) {
  if (!target.value) return
  const events = target.value.events.map((evt, i) => {
    if (i !== eventIndex) return evt
    const actions = evt.actions.map((a, j) =>
      j === actionIndex ? ({ ...a, ...next } as EventAction) : a,
    )
    return { ...evt, actions }
  })
  patchEvents(events)
}

function removeEvent(index: number) {
  if (!target.value) return
  patchEvents(target.value.events.filter((_, i) => i !== index))
}

function outLabel(type: AnimationLinkType): string {
  if (is3d.value) {
    if (type === 'moveH' || type === 'dragH') return '位移 X'
    if (type === 'moveV' || type === 'dragV') return '位移 Y'
    if (type === 'moveZ' || type === 'dragZ') return '位移 Z'
    if (type === 'width') return '缩放 X'
    if (type === 'height') return '缩放 Y'
    if (type === 'scaleZ') return '缩放 Z'
    if (type === 'rotX') return '旋转 X（度）'
    if (type === 'rotY') return '旋转 Y（度）'
    if (type === 'rotZ') return '旋转 Z（度）'
    if (type === 'fillH' || type === 'fillV') return '缩放倍率'
    return '输出'
  }
  if (type === 'moveH' || type === 'dragH') return '向右移动像素'
  if (type === 'moveV' || type === 'dragV') return '向下移动像素（负值向上）'
  if (type === 'width') return '宽度'
  if (type === 'height') return '高度'
  if (type === 'fillH' || type === 'fillV') return '对应填充百分比'
  return '输出'
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="动画连接"
    width="780px"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    class="anim-connection-dialog"
  >
    <div v-if="target" class="layout">
      <aside class="tree">
        <div v-for="group in linkTree" :key="group.group" class="group">
          <div class="group-name">{{ group.group }}</div>
          <button
            v-for="item in group.items"
            :key="item.type"
            type="button"
            class="tree-item"
            :class="{
              active: activeType === item.type,
              configured: hasActiveLink(item.type),
            }"
            @click="selectType(item.type)"
          >
            <span>{{ item.label }}</span>
            <span v-if="hasActiveLink(item.type)" class="dot" />
          </button>
        </div>
        <div class="group">
          <div class="group-name">控件绑定</div>
          <button
            type="button"
            class="tree-item"
            :class="{ active: activeType === 'property' }"
            @click="activeType = 'property'"
          >
            属性绑定
          </button>
          <button
            type="button"
            class="tree-item"
            :class="{ active: activeType === 'event' }"
            @click="activeType = 'event'"
          >
            事件绑定
          </button>
        </div>
      </aside>

      <section class="form">
        <template v-if="activeType === 'property'">
          <div class="form-head">
            <span>属性绑定</span>
            <el-button size="small" @click="addBinding">添加</el-button>
          </div>
          <div v-if="!target.bindings.length" class="empty">尚未绑定属性</div>
          <div v-for="(b, i) in target.bindings" :key="b.id" class="card row">
            <el-select
              size="small"
              popper-class="anim-connection-select-dropdown"
              :model-value="b.prop"
              @update:model-value="(v: BindableProp) => updateBinding(i, { prop: v })"
            >
              <el-option
                v-for="p in bindableProps"
                :key="p.value"
                :label="p.label"
                :value="p.value"
              />
            </el-select>
            <el-select
              size="small"
              filterable
              popper-class="anim-connection-select-dropdown"
              :model-value="b.tagId"
              @update:model-value="(v: string) => updateBinding(i, { tagId: v })"
            >
              <el-option
                v-for="item in tags.list"
                :key="item.meta.tagId"
                :label="formatTagOptionLabel(item.meta, item.value?.quality)"
                :value="item.meta.tagId"
              />
            </el-select>
            <el-button size="small" text type="danger" @click="removeBinding(i)">删</el-button>
          </div>
        </template>

        <template v-else-if="activeType === 'event'">
          <div class="form-head">
            <span>事件绑定</span>
            <div class="event-actions">
              <el-button size="small" @click="addNavigateEvent">页面跳转</el-button>
              <el-button size="small" @click="addWriteEvent">变量赋值</el-button>
              <el-button
                size="small"
                :disabled="!project.document.scripts.length"
                @click="addRunScriptEvent"
              >
                执行脚本
              </el-button>
              <el-button size="small" @click="addOpenDialogEvent">打开对话框</el-button>
            </div>
          </div>
          <div v-if="!target.events.length" class="empty">无事件（点击触发）</div>
          <div v-for="(evt, i) in target.events" :key="evt.id" class="card col">
            <div class="row">
              <el-select
                size="small"
                popper-class="anim-connection-select-dropdown"
                :model-value="evt.trigger"
                style="width: 120px"
                @update:model-value="(v: EventTrigger) => updateEventTrigger(i, v)"
              >
                <el-option
                  v-for="opt in EVENT_TRIGGER_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <el-button size="small" text type="danger" @click="removeEvent(i)">删</el-button>
            </div>
            <div v-for="(action, j) in evt.actions" :key="j" class="row">
              <template v-if="action.type === 'navigate'">
                <span>跳转</span>
                <el-select
                  size="small"
                  popper-class="anim-connection-select-dropdown"
                  :model-value="action.pageId"
                  @update:model-value="(v: string) => updateEventAction(i, j, { pageId: v })"
                >
                  <el-option v-for="p in pages" :key="p.id" :label="p.name" :value="p.id" />
                </el-select>
              </template>
              <template v-else-if="action.type === 'writeTag'">
                <span>写值</span>
                <el-select
                  size="small"
                  filterable
                  popper-class="anim-connection-select-dropdown"
                  :model-value="action.tagId"
                  @update:model-value="(v: string) => updateEventAction(i, j, { tagId: v })"
                >
                  <el-option
                    v-for="item in tags.list.filter((t) => t.meta.writable)"
                    :key="item.meta.tagId"
                    :label="formatTagOptionLabel(item.meta, item.value?.quality)"
                    :value="item.meta.tagId"
                  />
                </el-select>
                <el-input
                  size="small"
                  :model-value="String(action.value)"
                  style="width: 72px"
                  @update:model-value="
                    (v: string) =>
                      updateEventAction(i, j, {
                        value:
                          v === 'true'
                            ? true
                            : v === 'false'
                              ? false
                              : Number.isNaN(Number(v))
                                ? v
                                : Number(v),
                      })
                  "
                />
                <el-checkbox
                  :model-value="Boolean(action.confirm)"
                  @update:model-value="(v: boolean | string | number) => updateEventAction(i, j, { confirm: Boolean(v) })"
                >
                  弹窗二次确认
                </el-checkbox>
              </template>
              <template v-else-if="action.type === 'runScript'">
                <span>脚本</span>
                <el-select
                  size="small"
                  filterable
                  popper-class="anim-connection-select-dropdown"
                  :model-value="action.scriptId"
                  @update:model-value="(v: string) => updateEventAction(i, j, { scriptId: v })"
                >
                  <el-option
                    v-for="s in project.document.scripts"
                    :key="s.id"
                    :label="s.name"
                    :value="s.id"
                  />
                </el-select>
              </template>
              <template v-else-if="action.type === 'openDialog'">
                <span>对话框页</span>
                <el-select
                  size="small"
                  filterable
                  popper-class="anim-connection-select-dropdown"
                  :model-value="action.dialogId"
                  @update:model-value="(v: string) => updateEventAction(i, j, { dialogId: v })"
                >
                  <el-option
                    v-for="p in pages.filter((x) => x.type === '2d')"
                    :key="p.id"
                    :label="p.name"
                    :value="p.id"
                  />
                </el-select>
              </template>
            </div>
          </div>
        </template>

        <template v-else-if="activeLink">
          <div class="form-head">
            <span class="cfg-label">
              {{ animationLinkTypeLabel(activeLink.type, linkLabelMode) }}
              <HelpTip :content="activeLinkTip" />
            </span>
            <div class="head-actions">
              <el-checkbox
                :model-value="activeLink.enabled"
                @update:model-value="(v: boolean | string | number) => updateActiveLink({ enabled: Boolean(v) })"
              >
                激活
              </el-checkbox>
              <el-button size="small" text type="danger" @click="removeActiveLink">清除</el-button>
            </div>
          </div>

          <label class="field">
            <span>绑定变量</span>
            <el-select
              size="small"
              filterable
              popper-class="anim-connection-select-dropdown"
              :model-value="activeLink.tagId"
              @update:model-value="(v: string) => updateActiveLink({ tagId: v })"
            >
              <el-option
                v-for="item in tags.list"
                :key="item.meta.tagId"
                :label="formatTagOptionLabel(item.meta, item.value?.quality)"
                :value="item.meta.tagId"
              />
            </el-select>
          </label>

          <template v-if="activeLink.type === 'hide'">
            <label class="field">
              <span>隐藏条件</span>
              <el-checkbox
                :model-value="activeLink.trueShow"
                @update:model-value="(v: boolean | string | number) => updateActiveLink({ trueShow: Boolean(v) })"
              >
                true 时显示，false 时隐藏
              </el-checkbox>
            </label>
          </template>

          <template v-else-if="activeRangeLink">
            <div class="field-row">
              <label class="field">
                <span>变量最小值</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :step="rangeStep"
                  :model-value="activeRangeLink.inMin"
                  @update:model-value="(v: number | undefined) => updateRangeField('inMin', v)"
                />
              </label>
              <label class="field">
                <span>变量最大值</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :step="rangeStep"
                  :model-value="activeRangeLink.inMax"
                  @update:model-value="(v: number | undefined) => updateRangeField('inMax', v)"
                />
              </label>
            </div>
            <div class="field-row">
              <label class="field">
                <span>{{ outLabel(activeRangeLink.type) }}（最小）</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :step="rangeStep"
                  :model-value="activeRangeLink.outMin"
                  @update:model-value="(v: number | undefined) => updateRangeField('outMin', v)"
                />
              </label>
              <label class="field">
                <span>{{ outLabel(activeRangeLink.type) }}（最大）</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :step="rangeStep"
                  :model-value="activeRangeLink.outMax"
                  @update:model-value="(v: number | undefined) => updateRangeField('outMax', v)"
                />
              </label>
            </div>
            <label v-if="activeRangeLink.type === 'fillV'" class="field">
              <span>填充方向</span>
              <el-radio-group
                size="small"
                :model-value="activeRangeLink.direction ?? 'start'"
                @update:model-value="(v: string) => updateRangeField('direction', v)"
              >
                <el-radio-button value="start">由下到上</el-radio-button>
                <el-radio-button value="end">由上到下</el-radio-button>
              </el-radio-group>
            </label>
            <label v-else-if="activeRangeLink.type === 'fillH'" class="field">
              <span>填充方向</span>
              <el-radio-group
                size="small"
                :model-value="activeRangeLink.direction ?? 'start'"
                @update:model-value="(v: string) => updateRangeField('direction', v)"
              >
                <el-radio-button value="start">由左到右</el-radio-button>
                <el-radio-button value="end">由右到左</el-radio-button>
              </el-radio-group>
            </label>
          </template>

          <template
            v-else-if="
              activeLink.type === 'colorFill' ||
              activeLink.type === 'colorStroke' ||
              activeLink.type === 'colorFill2'
            "
          >
            <div class="form-head sub">
              <span>颜色分段</span>
              <el-button size="small" @click="addColorRange">插入行</el-button>
            </div>
            <div v-for="(r, i) in activeLink.ranges" :key="i" class="card col">
              <div class="row">
                <span>等于</span>
                <el-input
                  size="small"
                  style="width: 72px"
                  :model-value="r.equals === undefined ? '' : String(r.equals)"
                  placeholder="可选"
                  @update:model-value="
                    (v: string) =>
                      updateColorRange(i, {
                        equals:
                          v === ''
                            ? undefined
                            : v === 'true'
                              ? true
                              : v === 'false'
                                ? false
                                : Number.isNaN(Number(v))
                                  ? v
                                  : Number(v),
                      })
                  "
                />
                <span>min</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :model-value="r.min"
                  @update:model-value="(v: number | undefined) => updateColorRange(i, { min: v ?? undefined })"
                />
                <span>max</span>
                <el-input-number
                  size="small"
                  controls-position="right"
                  :model-value="r.max"
                  @update:model-value="(v: number | undefined) => updateColorRange(i, { max: v ?? undefined })"
                />
              </div>
              <div class="row">
                <span>颜色</span>
                <el-color-picker
                  size="small"
                  :model-value="r.color"
                  @update:model-value="(v: string | null) => updateColorRange(i, { color: v || '#3d8bfd' })"
                />
                <el-checkbox
                  :model-value="Boolean(r.blink)"
                  @update:model-value="(v: boolean | string | number) => updateColorRange(i, { blink: Boolean(v) })"
                >
                  闪烁
                </el-checkbox>
                <el-button size="small" text type="danger" @click="removeColorRange(i)">删</el-button>
              </div>
            </div>
          </template>

          <template v-else-if="activeLink.type === 'valueOut' || activeLink.type === 'textOut'">
            <label class="field">
              <span>显示格式</span>
              <el-select
                size="small"
                clearable
                popper-class="anim-connection-select-dropdown"
                :model-value="activeLink.format"
                @update:model-value="(v: string) => updateActiveLink({ format: v || undefined })"
              >
                <el-option label="默认" value="" />
                <el-option label="一位小数" value="fixed:1" />
                <el-option label="两位小数" value="fixed:2" />
                <el-option label="布尔 ON/OFF" value="bool" />
              </el-select>
            </label>
          </template>

          <template
            v-else-if="
              activeLink.type === 'valueIn' ||
              activeLink.type === 'digitalIn' ||
              activeLink.type === 'textIn'
            "
          >
            <label class="field">
              <el-checkbox
                :model-value="activeLink.confirm !== false"
                @update:model-value="(v: boolean | string | number) => updateActiveLink({ confirm: Boolean(v) })"
              >
                弹窗二次确认
              </el-checkbox>
            </label>
            <label v-if="activeLink.type === 'digitalIn'" class="field">
              <span>数字量模式</span>
              <el-radio-group
                size="small"
                :model-value="activeLink.digitalMode ?? 'toggle'"
                @update:model-value="
                  (v: string) =>
                    updateActiveLink({ digitalMode: v as 'toggle' | 'on' | 'off' })
                "
              >
                <el-radio-button value="toggle">翻转</el-radio-button>
                <el-radio-button value="on">置 ON</el-radio-button>
                <el-radio-button value="off">置 OFF</el-radio-button>
              </el-radio-group>
            </label>
          </template>

          <template v-else-if="activeLink.type === 'enable'">
            <label class="field">
              <el-checkbox
                :model-value="activeLink.trueEnable"
                @update:model-value="(v: boolean | string | number) => updateActiveLink({ trueEnable: Boolean(v) })"
              >
                变量为真时允许操作（取消则：为真时禁止）
              </el-checkbox>
            </label>
          </template>
        </template>

        <div v-else class="empty">选择左侧动画类型开始配置（需先有变量）</div>
      </section>
    </div>
    <div v-else class="empty pad">请先选中一个图元</div>
    <template #footer>
      <el-button type="primary" @click="dialogVisible = false">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 12px;
  min-height: 420px;
}

.tree {
  border: 1px solid var(--scada-border);
  border-radius: 6px;
  background: var(--scada-bg);
  padding: 8px;
  overflow: auto;
  max-height: 480px;
}

.group {
  margin-bottom: 10px;
}

.group-name {
  font-size: 11px;
  color: var(--scada-muted);
  padding: 2px 6px 4px;
}

.tree-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--scada-text);
  text-align: left;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.tree-item:hover {
  background: rgba(61, 139, 253, 0.12);
}

.tree-item.active {
  background: rgba(61, 139, 253, 0.22);
  color: #93c5fd;
}

.tree-item.configured {
  font-weight: 600;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
}

.form {
  border: 1px solid var(--scada-border);
  border-radius: 6px;
  background: var(--scada-bg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  max-height: 480px;
  color: var(--scada-text);
}

.form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: var(--scada-text);
}

.form-head.sub {
  font-weight: 500;
  font-size: 12px;
  color: var(--scada-muted);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.event-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--scada-muted);
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.card {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--scada-border);
  border-radius: 6px;
  background: var(--scada-panel);
  color: var(--scada-text);
}

.card.col {
  flex-direction: column;
  align-items: stretch;
}

.row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
}

.empty.pad {
  padding: 24px;
}

.cfg-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>

