<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  BindableProp,
  EventAction,
  EventBinding,
  EventTrigger,
  Object3DPanel,
  Page3DPresentation,
  PropBinding,
  StateAnimationRule,
} from '@web-scada/core'
import {
  animationLinkTypeLabel,
  createDefaultObject3DPanel,
  DEFAULT_PAGE3D_PRESENTATION,
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
  EVENT_TRIGGER_OPTIONS,
  MAX_PANEL_CONTENT_SIZE,
  MIN_PANEL_CONTENT_HEIGHT,
  MIN_PANEL_CONTENT_WIDTH,
  patchObject3dSizeMeters,
  resolvePage3DPresentation,
  resolvePanelContentSize,
  sizeMetersFromObject3d,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { createBinding, createStateAnimation } from '@/shared/runtime/bindingEngine'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'

const project = useProjectStore()
const tags = useTagStore()
const obj = computed(() => project.selectedObject3d)
const multiCount = computed(() => project.selectedObject3dIds.length)
const page3d = computed(() => project.activePage3d)
const scenePres = computed(() => resolvePage3DPresentation(page3d.value?.presentation))

/** 纯面板：无模型，属性栏不显示旋转，缩放改控面板宽高 */
const isPanelOnly = computed(
  () => Boolean(obj.value?.panel) && !obj.value?.modelResourceId,
)

const pages2d = computed(() => project.document.pages.filter((p) => p.type === '2d'))

const animLinks = computed(() => obj.value?.animationLinks ?? [])

const bindableProps = computed(() => {
  const base: Array<{ value: BindableProp; label: string }> = [
    { value: 'color', label: '颜色' },
    { value: 'visible', label: '可见' },
    { value: 'opacity', label: '透明度' },
    { value: 'x', label: '位置X' },
    { value: 'y', label: '位置Y' },
    { value: 'z', label: '位置Z' },
  ]
  if (isPanelOnly.value) return base
  return [
    ...base,
    { value: 'rotX', label: '旋转X' },
    { value: 'rotY', label: '旋转Y' },
    { value: 'rotZ', label: '旋转Z' },
    // 属性绑定仍写 transform.scale（Three 倍率）；米制尺寸请在上方「缩放（米）」编辑
    { value: 'scaleX', label: '缩放倍率X' },
    { value: 'scaleY', label: '缩放倍率Y' },
    { value: 'scaleZ', label: '缩放倍率Z' },
  ]
})

const sizeMeters = computed(() =>
  obj.value ? sizeMetersFromObject3d(obj.value) : ([0, 0, 0] as [number, number, number]),
)

function patch(partial: Partial<NonNullable<typeof obj.value>>) {
  if (!obj.value) return
  project.updateObject3d(obj.value.id, partial as never)
}

function patchPresentation(partial: Partial<Page3DPresentation>) {
  project.updatePage3dPresentation(partial)
}

function formatCam(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : '--'
}

function captureDefaultCamera() {
  project.requestScene3dCamera('capture')
}

function applyDefaultCamera() {
  if (!page3d.value?.camera) {
    ElMessage.warning('尚未保存默认视角，请先「设为默认视角」')
    return
  }
  project.requestScene3dCamera('apply')
}

function resetPresentationDefaults() {
  project.updatePage3dPresentation({ ...DEFAULT_PAGE3D_PRESENTATION })
  ElMessage.success('已恢复场景默认观感')
}

function groupMulti() {
  if (project.selectedObject3dIds.length < 2) {
    ElMessage.warning('请先多选至少 2 个对象')
    return
  }
  const g = project.groupSelectedObject3ds()
  if (!g) ElMessage.warning('只能组合同一层级下的对象')
  else ElMessage.success(`已组合为「${g.name}」`)
}

function updateTransform(
  axis: 'position' | 'rotation' | 'scale',
  index: 0 | 1 | 2,
  value: number,
) {
  if (!obj.value) return
  const next = [...obj.value.transform[axis]] as [number, number, number]
  next[index] = value
  patch({ transform: { ...obj.value.transform, [axis]: next } })
}

/** 缩放栏编辑的是轴向真实尺寸（米），三位小数 */
function updateSizeMeters(index: 0 | 1 | 2, value: number) {
  if (!obj.value) return
  const cur = sizeMetersFromObject3d(obj.value)
  const next: [number, number, number] = [...cur]
  next[index] = Math.max(0.001, Number.isFinite(value) ? value : 0.001)
  patch(patchObject3dSizeMeters(obj.value, next))
}

function updatePanelSize(wh: 'width' | 'height', value: number) {
  if (!obj.value?.panel) return
  const sized = resolvePanelContentSize(
    wh === 'width' ? value : obj.value.panel.width,
    wh === 'height' ? value : obj.value.panel.height,
  )
  patchPanel({ ...obj.value.panel, ...sized })
}

function addBinding() {
  if (!obj.value) return
  const tagId = tags.metas[0]?.tagId
  if (!tagId) return
  patch({ bindings: [...obj.value.bindings, createBinding('color', tagId)] })
}

function updateBinding(index: number, next: Partial<PropBinding>) {
  if (!obj.value) return
  const bindings = obj.value.bindings.map((b, i) => (i === index ? { ...b, ...next } : b))
  patch({ bindings })
}

function removeBinding(index: number) {
  if (!obj.value) return
  patch({ bindings: obj.value.bindings.filter((_, i) => i !== index) })
}

function addStateAnim() {
  if (!obj.value) return
  const tagId = tags.metas.find((m) => m.dataType === 'bool')?.tagId || tags.metas[0]?.tagId
  if (!tagId) return
  const anim: StateAnimationRule = createStateAnimation({
    tagId,
    target: 'fill',
    ranges: [
      { equals: true, apply: { fill: '#22c55e' } },
      { equals: false, apply: { fill: '#334155' } },
    ],
  })
  patch({ animations: [...obj.value.animations, anim] })
}

function removeAnim(index: number) {
  if (!obj.value) return
  patch({ animations: obj.value.animations.filter((_, i) => i !== index) })
}

function pushEvent(actions: EventAction[], trigger: EventTrigger = 'click') {
  if (!obj.value) return
  const event: EventBinding = {
    id: `evt_${Date.now()}`,
    trigger,
    actions,
  }
  patch({ events: [...obj.value.events, event] })
}

function addWriteEvent() {
  const tag = tags.metas.find((m) => m.writable)
  if (!tag) return
  pushEvent([{ type: 'writeTag', tagId: tag.tagId, value: true, confirm: true }])
}

function addNavigateEvent() {
  const pageId = project.document.pages[0]?.id
  if (!pageId) return
  pushEvent([{ type: 'navigate', pageId }])
}

function addOpenDialogEvent() {
  const pageId = pages2d.value[0]?.id
  if (!pageId) return
  pushEvent([{ type: 'openDialog', dialogId: pageId }])
}

function addRunScriptEvent() {
  const scriptId = project.document.scripts[0]?.id
  if (!scriptId) return
  pushEvent([{ type: 'runScript', scriptId }])
}

function updateEventTrigger(index: number, trigger: EventTrigger) {
  if (!obj.value) return
  const events = obj.value.events.map((e, i) => (i === index ? { ...e, trigger } : e))
  patch({ events })
}

function updateEventAction(eventIndex: number, actionIndex: number, next: Partial<EventAction>) {
  if (!obj.value) return
  const events = obj.value.events.map((evt, i) => {
    if (i !== eventIndex) return evt
    const actions = evt.actions.map((a, j) =>
      j === actionIndex ? ({ ...a, ...next } as EventAction) : a,
    )
    return { ...evt, actions }
  })
  patch({ events })
}

function removeEvent(index: number) {
  if (!obj.value) return
  patch({ events: obj.value.events.filter((_, i) => i !== index) })
}

function patchPanel(next: Object3DPanel | undefined) {
  patch({ panel: next })
}

function enablePanel() {
  if (!obj.value) return
  if (obj.value.panel) return
  patchPanel(createDefaultObject3DPanel(obj.value.name || '操作面板'))
}

function disablePanel() {
  patchPanel(undefined)
}

function openPanelEditor() {
  if (!obj.value) return
  if (!obj.value.panel) enablePanel()
  project.openObject3dPanelEditor()
}

function openModelEditor() {
  if (!obj.value) return
  if (isPanelOnly.value) {
    ElMessage.warning('纯面板对象请使用「编辑面板」')
    return
  }
  project.openObject3dModelEditor()
}

const panelSummary = computed(() => {
  const p = obj.value?.panel
  if (!p) return ''
  const title = p.title?.trim() || obj.value?.name || '面板'
  return `${title} · ${p.items.length} 个控件`
})
</script>

<template>
  <div v-if="multiCount > 1" class="prop3d">
    <div class="panel-title">已选 {{ multiCount }} 个对象</div>
    <p class="multi-hint">属性编辑针对主选（列表首项）。可批量复制 / 删除 / 组合。</p>
    <div class="ops">
      <el-button size="small" @click="project.duplicateObject3ds(project.selectedObject3dIds)">
        批量复制
      </el-button>
      <el-button size="small" @click="groupMulti">组合</el-button>
      <el-button
        size="small"
        type="danger"
        plain
        @click="project.removeObject3ds(project.selectedObject3dIds)"
      >
        批量删除
      </el-button>
    </div>
    <div v-if="obj" class="panel-title">主选：{{ obj.name }}</div>
  </div>
  <div v-if="obj" class="prop3d">
    <div class="panel-title">对象属性</div>
    <label>
      <span>名称</span>
      <el-input
        size="small"
        :model-value="obj.name"
        @update:model-value="(v: string) => patch({ name: v })"
      />
    </label>
    <label>
      <span>颜色</span>
      <el-color-picker
        size="small"
        :model-value="obj.style?.color || '#3d8bfd'"
        @update:model-value="(v: string | null) => v && patch({ style: { ...obj!.style, color: v } })"
      />
    </label>
    <div v-if="!isPanelOnly" class="panel-title row">
      <span>模型外观</span>
      <div class="link-adds">
        <el-button size="small" type="primary" @click="openModelEditor">编辑模型…</el-button>
      </div>
    </div>
    <p v-if="!isPanelOnly" class="multi-hint">
      可改颜色、金属度/粗糙度与贴图；修改后写入工程并实时预览。
    </p>
    <el-checkbox
      :model-value="obj.visible !== false"
      @update:model-value="(v: boolean | string | number) => patch({ visible: Boolean(v) })"
    >
      可见
    </el-checkbox>
    <el-checkbox
      :model-value="Boolean(obj.locked)"
      @update:model-value="(v: boolean | string | number) => patch({ locked: Boolean(v) })"
    >
      锁定变换
    </el-checkbox>

    <div class="panel-title">位置</div>
    <div class="xyz">
      <el-input-number
        v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
        :key="'p' + axis"
        size="small"
        :disabled="Boolean(obj.locked)"
        :model-value="obj.transform.position[i]"
        :step="0.1"
        controls-position="right"
        @update:model-value="(v: number | undefined) => updateTransform('position', i as 0 | 1 | 2, Number(v) || 0)"
      />
    </div>
    <template v-if="!isPanelOnly">
      <div class="panel-title">旋转（°）</div>
      <div class="xyz">
        <el-input-number
          v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
          :key="'r' + axis"
          size="small"
          :disabled="Boolean(obj.locked)"
          :model-value="obj.transform.rotation[i]"
          :step="1"
          controls-position="right"
          @update:model-value="(v: number | undefined) => updateTransform('rotation', i as 0 | 1 | 2, Number(v) || 0)"
        />
      </div>
      <div class="panel-title">缩放（米）</div>
      <p class="multi-hint">X/Y/Z 为各轴向真实尺寸；模型按毫米文件换算。</p>
      <div class="xyz">
        <el-input-number
          v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
          :key="'s' + axis"
          size="small"
          :disabled="Boolean(obj.locked)"
          :model-value="sizeMeters[i]"
          :step="0.001"
          :min="0.001"
          :precision="3"
          controls-position="right"
          @update:model-value="(v: number | undefined) => updateSizeMeters(i as 0 | 1 | 2, Number(v) || 0.001)"
        />
      </div>
    </template>
    <template v-else>
      <div class="panel-title">缩放（面板大小）</div>
      <div class="xyz panel-size">
        <label>
          <span>宽</span>
          <el-input-number
            size="small"
            :disabled="Boolean(obj.locked)"
            :model-value="obj.panel?.width ?? DEFAULT_PANEL_CONTENT_WIDTH"
            :min="MIN_PANEL_CONTENT_WIDTH"
            :max="MAX_PANEL_CONTENT_SIZE"
            :step="8"
            controls-position="right"
            @update:model-value="(v: number | undefined) => updatePanelSize('width', Number(v) || DEFAULT_PANEL_CONTENT_WIDTH)"
          />
        </label>
        <label>
          <span>高</span>
          <el-input-number
            size="small"
            :disabled="Boolean(obj.locked)"
            :model-value="obj.panel?.height ?? DEFAULT_PANEL_CONTENT_HEIGHT"
            :min="MIN_PANEL_CONTENT_HEIGHT"
            :max="MAX_PANEL_CONTENT_SIZE"
            :step="8"
            controls-position="right"
            @update:model-value="(v: number | undefined) => updatePanelSize('height', Number(v) || DEFAULT_PANEL_CONTENT_HEIGHT)"
          />
        </label>
      </div>
    </template>

    <div class="panel-title row">
      <span>跟镜头面板</span>
      <div class="link-adds">
        <el-button v-if="!obj.panel" size="small" type="primary" plain @click="enablePanel">
          启用
        </el-button>
        <template v-else>
          <el-button size="small" type="primary" @click="openPanelEditor">编辑面板…</el-button>
          <el-button size="small" plain @click="disablePanel">关闭</el-button>
        </template>
      </div>
    </div>
    <template v-if="obj.panel">
      <p class="multi-hint">{{ panelSummary }} · 始终朝向相机；双击场景面板也可打开编辑器。</p>
    </template>

    <div class="panel-title">动画连接</div>
    <div class="anim-summary">
      <el-button
        type="primary"
        size="small"
        style="width: 100%"
        @click="project.openAnimationConnection()"
      >
        动画连接…
      </el-button>
      <div v-if="animLinks.length" class="summary-list">
        <div v-for="l in animLinks" :key="l.id" class="summary-item">
          <span>{{ animationLinkTypeLabel(l.type, '3d') }}</span>
          <el-tag size="small" :type="l.enabled ? 'success' : 'info'">
            {{ l.enabled ? '已激活' : '未激活' }}
          </el-tag>
        </div>
      </div>
      <p v-else class="multi-hint">在弹窗中配置位移、颜色、拖拽写等连接</p>
    </div>

    <div class="panel-title row">
      <span>数据驱动</span>
      <el-button size="small" @click="addBinding">绑定</el-button>
    </div>
    <div v-for="(b, i) in obj.bindings" :key="b.id" class="card">
      <el-select
        size="small"
        :model-value="b.prop"
        @update:model-value="(v: BindableProp) => updateBinding(i, { prop: v })"
      >
        <el-option v-for="p in bindableProps" :key="p.value" :label="p.label" :value="p.value" />
      </el-select>
      <el-select
        size="small"
        filterable
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

    <div class="panel-title row">
      <span>动画</span>
      <el-button size="small" @click="addStateAnim">状态色</el-button>
    </div>
    <div v-for="(a, i) in obj.animations" :key="a.id" class="card">
      <el-tag size="small">{{ a.kind }}</el-tag>
      <span class="muted">{{ a.tagId }}</span>
      <el-button size="small" text type="danger" @click="removeAnim(i)">删</el-button>
    </div>

    <div class="panel-title row">
      <span>事件</span>
      <div class="link-adds">
        <el-button size="small" @click="addWriteEvent">写值</el-button>
        <el-button size="small" @click="addNavigateEvent">跳转</el-button>
        <el-button size="small" :disabled="!pages2d.length" @click="addOpenDialogEvent">
          对话框
        </el-button>
        <el-button
          size="small"
          :disabled="!project.document.scripts.length"
          @click="addRunScriptEvent"
        >
          脚本
        </el-button>
      </div>
    </div>
    <div v-for="(e, i) in obj.events" :key="e.id" class="card col">
      <div class="row tight">
        <el-select
          size="small"
          :model-value="e.trigger"
          style="width: 120px"
          @update:model-value="(v: EventTrigger) => updateEventTrigger(i, v)"
        >
          <el-option
            v-for="opt in EVENT_TRIGGER_OPTIONS.filter(
              (o) => o.value === 'click' || o.value === 'dblclick',
            )"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-button size="small" text type="danger" @click="removeEvent(i)">删</el-button>
      </div>
      <div v-for="(action, j) in e.actions" :key="j" class="action-row">
        <el-tag size="small">{{ action.type }}</el-tag>
        <template v-if="action.type === 'writeTag'">
          <el-select
            size="small"
            filterable
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
          <el-checkbox
            :model-value="Boolean(action.confirm)"
            @update:model-value="(v: boolean | string | number) => updateEventAction(i, j, { confirm: Boolean(v) })"
          >
            确认
          </el-checkbox>
        </template>
        <template v-else-if="action.type === 'navigate'">
          <el-select
            size="small"
            filterable
            :model-value="action.pageId"
            @update:model-value="(v: string) => updateEventAction(i, j, { pageId: v })"
          >
            <el-option
              v-for="p in project.document.pages"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
        </template>
        <template v-else-if="action.type === 'openDialog'">
          <el-select
            size="small"
            filterable
            :model-value="action.dialogId"
            @update:model-value="(v: string) => updateEventAction(i, j, { dialogId: v })"
          >
            <el-option v-for="p in pages2d" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </template>
        <template v-else-if="action.type === 'runScript'">
          <el-select
            size="small"
            filterable
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
      </div>
    </div>

    <div class="ops">
      <el-button size="small" @click="project.duplicateObject3d(obj.id)">复制</el-button>
      <el-button size="small" type="danger" plain @click="project.removeObject3d(obj.id)">
        删除对象
      </el-button>
    </div>
  </div>
  <div v-else-if="multiCount > 0" class="empty">
    选中对象未找到，请再点一次模型
  </div>
  <div v-else class="prop3d scene-edit">
    <div class="panel-title">编辑场景</div>
    <p class="scene-hint">未选中模型时编辑本页场景观感与默认相机（随工程保存）</p>

    <div class="panel-title">环境</div>
    <label class="row">
      <span>背景色</span>
      <el-color-picker
        size="small"
        :model-value="scenePres.background"
        @update:model-value="(v: string | null) => patchPresentation({ background: v || DEFAULT_PAGE3D_PRESENTATION.background })"
      />
    </label>
    <label class="row">
      <span>环境亮度</span>
      <el-slider
        class="scene-slider"
        :min="0"
        :max="2"
        :step="0.05"
        :model-value="scenePres.environmentIntensity"
        @update:model-value="(v: number | number[]) => patchPresentation({ environmentIntensity: Number(v) })"
      />
      <el-input-number
        size="small"
        :min="0"
        :max="2"
        :step="0.05"
        controls-position="right"
        :model-value="scenePres.environmentIntensity"
        @update:model-value="(v: number | undefined) => patchPresentation({ environmentIntensity: Number(v) || 0 })"
      />
    </label>
    <label class="row">
      <span>环境光</span>
      <el-slider
        class="scene-slider"
        :min="0"
        :max="2"
        :step="0.05"
        :model-value="scenePres.ambientIntensity"
        @update:model-value="(v: number | number[]) => patchPresentation({ ambientIntensity: Number(v) })"
      />
      <el-input-number
        size="small"
        :min="0"
        :max="2"
        :step="0.05"
        controls-position="right"
        :model-value="scenePres.ambientIntensity"
        @update:model-value="(v: number | undefined) => patchPresentation({ ambientIntensity: Number(v) || 0 })"
      />
    </label>

    <div class="panel-title">阳光与阴影</div>
    <label class="row">
      <span>开启太阳光</span>
      <el-checkbox
        :model-value="scenePres.sunEnabled"
        @update:model-value="(v: boolean | string | number) => patchPresentation({ sunEnabled: Boolean(v) })"
      />
    </label>
    <label class="row">
      <span>阳光亮度</span>
      <el-slider
        class="scene-slider"
        :min="0"
        :max="3"
        :step="0.05"
        :disabled="!scenePres.sunEnabled"
        :model-value="scenePres.sunIntensity"
        @update:model-value="(v: number | number[]) => patchPresentation({ sunIntensity: Number(v) })"
      />
      <el-input-number
        size="small"
        :min="0"
        :max="3"
        :step="0.05"
        controls-position="right"
        :disabled="!scenePres.sunEnabled"
        :model-value="scenePres.sunIntensity"
        @update:model-value="(v: number | undefined) => patchPresentation({ sunIntensity: Number(v) || 0 })"
      />
    </label>
    <label class="row">
      <span>产生阴影</span>
      <el-checkbox
        :model-value="scenePres.shadowsEnabled"
        :disabled="!scenePres.sunEnabled"
        @update:model-value="(v: boolean | string | number) => patchPresentation({ shadowsEnabled: Boolean(v) })"
      />
    </label>
    <label class="row">
      <span>阴影质量</span>
      <el-select
        size="small"
        :disabled="!scenePres.sunEnabled || !scenePres.shadowsEnabled"
        :model-value="scenePres.shadowMapSize"
        @update:model-value="(v: number) => patchPresentation({ shadowMapSize: v })"
      >
        <el-option label="低 (512)" :value="512" />
        <el-option label="中 (1024)" :value="1024" />
        <el-option label="高 (2048)" :value="2048" />
        <el-option label="极高 (4096)" :value="4096" />
      </el-select>
    </label>
    <label class="row">
      <span>阴影偏移</span>
      <el-input-number
        size="small"
        :step="0.0001"
        :disabled="!scenePres.sunEnabled || !scenePres.shadowsEnabled"
        controls-position="right"
        :model-value="scenePres.shadowBias"
        @update:model-value="(v: number | undefined) => patchPresentation({ shadowBias: Number(v) || 0 })"
      />
    </label>

    <div class="panel-title">相机</div>
    <div class="cam-readout">
      <template v-if="page3d?.camera">
        <div>
          位置
          <code>
            {{ formatCam(page3d.camera.position[0]) }},
            {{ formatCam(page3d.camera.position[1]) }},
            {{ formatCam(page3d.camera.position[2]) }}
          </code>
        </div>
        <div>
          目标
          <code>
            {{ formatCam(page3d.camera.target[0]) }},
            {{ formatCam(page3d.camera.target[1]) }},
            {{ formatCam(page3d.camera.target[2]) }}
          </code>
        </div>
      </template>
      <p v-else class="scene-hint">尚未保存默认视角</p>
    </div>
    <div class="ops">
      <el-button size="small" type="primary" @click="captureDefaultCamera">设为默认视角</el-button>
      <el-button size="small" @click="applyDefaultCamera">恢复默认视角</el-button>
    </div>

    <div class="ops">
      <el-button size="small" plain @click="resetPresentationDefaults">恢复观感默认值</el-button>
    </div>
  </div>
</template>

<style scoped>
.prop3d {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-title {
  margin-top: 4px;
  font-size: 12px;
  color: var(--scada-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.multi-hint {
  margin: 0;
  font-size: 11px;
  color: var(--scada-muted);
  line-height: 1.4;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

label {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--scada-muted);
}

.xyz {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

.xyz.panel-size {
  grid-template-columns: 1fr 1fr;
}

.xyz.panel-size > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--scada-muted);
}

.xyz :deep(.el-input-number) {
  width: 100%;
}

.card {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--scada-border);
  border-radius: 6px;
}

.card.col {
  flex-direction: column;
  align-items: stretch;
}

.row.tight {
  display: flex;
  gap: 6px;
  align-items: center;
}

.link-adds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.range-row,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.range-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.range-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.range-grid :deep(.el-input-number) {
  width: 100%;
}

.ops {
  display: flex;
  gap: 8px;
}

.anim-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 4px;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  background: #12151c;
  border: 1px solid var(--scada-border);
}

.muted {
  font-size: 11px;
  color: var(--scada-muted);
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
}

.scene-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--scada-muted);
  line-height: 1.4;
}

.scene-slider {
  flex: 1;
  min-width: 0;
  margin: 0 8px;
}

.cam-readout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--scada-muted);
}

.cam-readout code {
  color: #e2e8f0;
  font-size: 11px;
}

.scene-edit .row {
  gap: 8px;
}

.scene-edit .row > span:first-child {
  flex: 0 0 72px;
  width: 72px;
}

.scene-edit .row :deep(.el-input-number) {
  width: 96px;
  flex-shrink: 0;
}

.scene-edit .row :deep(.el-select) {
  width: 140px;
}
</style>
