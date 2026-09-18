<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  AnimationLinkInput,
  AnimationLinkRange,
  EventBinding,
  Object3DNode,
  Page3D,
} from '@web-scada/core'
import { createScene3D, type Scene3DBundle } from '@/shared/three/createScene3D'
import {
  collectPage3DTagIds,
  object3dHasInteractiveLinks,
  resolveObject3DVisual,
} from '@/shared/runtime/bindingEngine3d'
import { findObject3dDeep, object3dPanelSignature, object3dTreeSignature, walkObject3dTree } from '@/shared/project/object3dTree'
import { panelValuesFromTags } from '@/shared/three/object3dPanelUi'
import type { Object3DPanelItem } from '@web-scada/core'
import { useTagStore } from '@/stores/tag'
import { useProjectStore } from '@/stores/project'
import { useOutputLogStore } from '@/stores/outputLog'
import WriteTagDialog from '@/components/dialogs/WriteTagDialog.vue'
import { runPageScripts, runScriptSource, startPageScriptSchedules } from '@/shared/runtime/scriptEngine'

const props = defineProps<{
  page: Page3D
  /** 嵌入 2D 画面时：不抢占 Tag 订阅 / 不显示 HUD */
  embedded?: boolean
  /** 嵌入时是否允许点击交互（默认 true） */
  interactive?: boolean
  /** 是否显示底部 HUD（全屏运行标签页关闭） */
  showHud?: boolean
  /** 地面网格；默认 false（运行端） */
  showGrid?: boolean
}>()

const emit = defineEmits<{
  quality: [summary: { good: number; bad: number; uncertain: number; offline: number }]
  openDialog: [pageId: string]
}>()

const host = ref<HTMLDivElement | null>(null)
const tags = useTagStore()
const project = useProjectStore()
const log = useOutputLogStore()

let bundle: Scene3DBundle | null = null
let removeListener: (() => void) | null = null
let stopSchedules: (() => void) | null = null
/** 闪烁中的对象最近一次解析结果 */
const blinkVisuals = new Map<string, Object3DNode>()
/** 闪烁对象是否允许整模染色（与 colorTinted 同步） */
const blinkColorTinted = new Map<string, boolean>()
/** 使能状态：false 禁止点击事件 */
const interactiveMap = new Map<string, boolean>()
let blinkPhase = false
let blinkTimer: ReturnType<typeof setInterval> | null = null

const writeDialogVisible = ref(false)
const writeTagId = ref('')
const writeValue = ref<string | number | boolean>('')
const writeMode = ref<'confirm' | 'edit'>('confirm')
const writeValueType = ref<'number' | 'boolean' | 'string'>('number')
let writeResolver: ((value: string | number | boolean | null) => void) | null = null

function askWrite(
  tagId: string,
  value: string | number | boolean,
  opts?: { mode?: 'confirm' | 'edit'; valueType?: 'number' | 'boolean' | 'string' },
): Promise<string | number | boolean | null> {
  writeTagId.value = tagId
  writeValue.value = value
  writeMode.value = opts?.mode ?? 'confirm'
  writeValueType.value = opts?.valueType ?? 'number'
  writeDialogVisible.value = true
  return new Promise((resolve) => {
    writeResolver = resolve
  })
}

async function doWrite(tagId: string, value: string | number | boolean) {
  const res = await tags.writeValue(tagId, value)
  ElMessage[res.ok ? 'success' : 'error'](res.message)
  if (res.ok) log.success(`写值 ${tagId} = ${String(value)}`, '运行端')
  else log.error(res.message, '运行端')
}

function applyPulsedVisual(objectId: string, visual: Object3DNode) {
  if (!bundle) return
  const tint = { applyModelColor: blinkColorTinted.get(objectId) === true }
  if (!blinkPhase) {
    const base = visual.style?.opacity ?? 1
    bundle.applyVisual(
      objectId,
      {
        ...visual,
        style: { ...visual.style, opacity: Math.min(base, 0.28) },
      },
      tint,
    )
    return
  }
  bundle.applyVisual(objectId, visual, tint)
}

function syncBlinkLoop() {
  if (blinkVisuals.size > 0 && !blinkTimer) {
    blinkTimer = setInterval(() => {
      blinkPhase = !blinkPhase
      for (const [id, visual] of blinkVisuals) applyPulsedVisual(id, visual)
    }, 420)
  } else if (blinkVisuals.size === 0 && blinkTimer) {
    clearInterval(blinkTimer)
    blinkTimer = null
    blinkPhase = false
  }
}

function refreshVisuals() {
  if (!bundle) return
  const scene = bundle
  let good = 0
  let bad = 0
  let uncertain = 0
  let offline = 0
  blinkVisuals.clear()
  blinkColorTinted.clear()
  interactiveMap.clear()
  walkObject3dTree(props.page.objects, (obj) => {
    const resolved = resolveObject3DVisual(obj, (id) => tags.getValue(id))
    interactiveMap.set(obj.id, resolved.interactive)
    if (resolved.quality === 'Bad') bad += 1
    else if (resolved.quality === 'Uncertain') uncertain += 1
    else if (resolved.quality === 'Offline') offline += 1
    else good += 1
    if (resolved.blink) {
      blinkVisuals.set(obj.id, resolved.object)
      blinkColorTinted.set(obj.id, resolved.colorTinted)
      applyPulsedVisual(obj.id, resolved.object)
    } else {
      scene.applyVisual(obj.id, resolved.object, { applyModelColor: resolved.colorTinted })
    }
    if (obj.panel) {
      scene.setPanelValues(
        obj.id,
        panelValuesFromTags(obj, (id) => tags.getValue(id)?.value),
      )
    }
  })
  syncBlinkLoop()
  emit('quality', { good, bad, uncertain, offline })
}

function makeScriptApi(partial?: { widgetId?: string; trigger?: string; scriptId?: string; scriptName?: string }) {
  return {
    getTag: (id: string) => tags.getValue(id)?.value,
    writeTag: (id: string, value: unknown) => {
      void tags.writeValue(id, value as string | number | boolean | null)
    },
    log: (msg: unknown) => log.info(String(msg), '脚本'),
    context: {
      mode: 'runtime' as const,
      pageId: props.page.id,
      widgetId: partial?.widgetId,
      trigger: partial?.trigger,
      scriptId: partial?.scriptId,
      scriptName: partial?.scriptName,
    },
  }
}

function setupSubscription() {
  if (!props.embedded) {
    tags.setPageSubscription(collectPage3DTagIds(props.page))
  }
  refreshVisuals()
  stopSchedules?.()
  const api = makeScriptApi({ trigger: 'load' })
  runPageScripts(props.page, api)
  stopSchedules = startPageScriptSchedules(props.page, api)
}

async function handleAnimationInput(objectId: string) {
  const obj = findObject3dDeep(props.page.objects, objectId)
  if (!obj) return
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  const links = (obj.animationLinks ?? []).filter(
    (l): l is AnimationLinkInput =>
      l.enabled && (l.type === 'valueIn' || l.type === 'digitalIn' || l.type === 'textIn'),
  )
  for (const link of links) {
    if (link.type === 'digitalIn') {
      const cur = tags.getValue(link.tagId)?.value
      let next: boolean
      if (link.digitalMode === 'on') next = true
      else if (link.digitalMode === 'off') next = false
      else next = !Boolean(cur)
      if (link.confirm !== false) {
        const ok = await askWrite(link.tagId, next, { mode: 'confirm', valueType: 'boolean' })
        if (ok === null) continue
        await doWrite(link.tagId, Boolean(ok))
      } else {
        await doWrite(link.tagId, next)
      }
    } else if (link.type === 'valueIn') {
      const cur = tags.getValue(link.tagId)?.value
      const seed = typeof cur === 'number' ? cur : Number(cur) || 0
      const ok = await askWrite(link.tagId, seed, { mode: 'edit', valueType: 'number' })
      if (ok === null) continue
      await doWrite(link.tagId, Number(ok))
    } else if (link.type === 'textIn') {
      const cur = tags.getValue(link.tagId)?.value
      const seed = cur == null ? '' : String(cur)
      const ok = await askWrite(link.tagId, seed, { mode: 'edit', valueType: 'string' })
      if (ok === null) continue
      await doWrite(link.tagId, String(ok))
    }
  }
}

async function handlePanelButton(objectId: string, item: Object3DPanelItem) {
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  if (!item.tagId) {
    ElMessage.warning('按钮未绑定 Tag')
    return
  }
  const value = item.writeValue ?? true
  if (item.confirm !== false) {
    const ok = await askWrite(item.tagId, value, { mode: 'confirm' })
    if (ok === null) return
    await doWrite(item.tagId, ok)
  } else {
    await doWrite(item.tagId, value)
  }
}

async function handleObjectTrigger(objectId: string, trigger: 'click' | 'dblclick') {
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  const obj = findObject3dDeep(props.page.objects, objectId)
  if (!obj) return
  if (trigger === 'click' && object3dHasInteractiveLinks(obj)) {
    await handleAnimationInput(objectId)
  }
  if (!obj.events?.length) return
  await runEvents(obj.events, trigger)
}

function resolveDragLinks(objectId: string) {
  const obj = findObject3dDeep(props.page.objects, objectId)
  if (!obj || interactiveMap.get(objectId) === false) return null
  let h: AnimationLinkRange | undefined
  let v: AnimationLinkRange | undefined
  let d: AnimationLinkRange | undefined
  for (const link of obj.animationLinks ?? []) {
    if (!link.enabled) continue
    if (link.type === 'dragH') h = link
    if (link.type === 'dragV') v = link
    if (link.type === 'dragZ') d = link
  }
  if (!h && !v && !d) return null
  return {
    h: h
      ? { tagId: h.tagId, inMin: h.inMin, inMax: h.inMax, outMin: h.outMin, outMax: h.outMax }
      : undefined,
    v: v
      ? { tagId: v.tagId, inMin: v.inMin, inMax: v.inMax, outMin: v.outMin, outMax: v.outMax }
      : undefined,
    d: d
      ? { tagId: d.tagId, inMin: d.inMin, inMax: d.inMax, outMin: d.outMin, outMax: d.outMax }
      : undefined,
  }
}

async function runEvents(events: EventBinding[], trigger: 'click' | 'dblclick') {
  for (const evt of events.filter((e) => e.trigger === trigger)) {
    for (const action of evt.actions) {
      if (action.type === 'writeTag') {
        if (action.confirm) {
          const ok = await askWrite(action.tagId, action.value, { mode: 'confirm' })
          if (ok === null) continue
        }
        await doWrite(action.tagId, action.value)
      } else if (action.type === 'navigate') {
        project.setActivePage(action.pageId)
        log.info(`跳转页面：${action.pageId}`, '运行端')
      } else if (action.type === 'openDialog') {
        const page = project.document.pages.find((p) => p.id === action.dialogId && p.type === '2d')
        if (!page) {
          ElMessage.warning(`对话框页面不存在：${action.dialogId}`)
          continue
        }
        emit('openDialog', action.dialogId)
        log.info(`打开对话框页面：${page.name}`, '运行端')
      } else if (action.type === 'runScript') {
        const script = project.document.scripts.find((s) => s.id === action.scriptId)
        if (!script) {
          ElMessage.warning('脚本不存在')
          continue
        }
        runScriptSource(
          script.source,
          makeScriptApi({
            trigger: evt.trigger,
            scriptId: script.id,
            scriptName: script.name,
          }),
        )
        log.info(`执行脚本：${script.name}`, '运行端')
      }
    }
  }
}

async function reload() {
  if (!bundle) return
  await bundle.setPage(props.page, (id) => project.getResourceUrl(id))
  setupSubscription()
}

onMounted(async () => {
  if (!host.value) return
  const canInteract = props.interactive !== false
  bundle = createScene3D(
    host.value,
    canInteract
      ? {
          onObjectClick: (id) => {
            void handleObjectTrigger(id, 'click')
          },
          onObjectDblClick: (id) => {
            void handleObjectTrigger(id, 'dblclick')
          },
          resolveDragLinks,
          onDragWrite: (_id, _axis, tagId, value) => {
            const rounded = Math.round(value * 1000) / 1000
            void doWrite(tagId, rounded)
          },
          onPanelButton: (objectId, item) => {
            void handlePanelButton(objectId, item)
          },
        }
      : {},
    { showGrid: props.showGrid === true },
  )
  await reload()
  if (!props.embedded) tags.connectRealtime()
  removeListener = tags.addListener(() => refreshVisuals())
})

watch(
  () => props.page.id,
  async () => {
    await reload()
  },
)

watch(
  () => object3dTreeSignature(props.page.objects),
  async () => {
    await reload()
  },
)

watch(
  () => object3dPanelSignature(props.page.objects),
  () => {
    if (!bundle) return
    walkObject3dTree(props.page.objects, (obj) => {
      bundle!.syncPanel(obj.panel ? obj : { ...obj, panel: undefined })
    })
    refreshVisuals()
  },
)

onUnmounted(() => {
  writeResolver?.(null)
  writeResolver = null
  removeListener?.()
  removeListener = null
  stopSchedules?.()
  stopSchedules = null
  if (blinkTimer) {
    clearInterval(blinkTimer)
    blinkTimer = null
  }
  blinkVisuals.clear()
  blinkColorTinted.clear()
  if (!props.embedded) {
    tags.clearPageSubscription()
    tags.stopMockStream()
  }
  bundle?.dispose()
  bundle = null
})
</script>

<template>
  <div class="runtime3d" :class="{ embedded }">
    <div ref="host" class="host" />
    <div v-if="!embedded && showHud !== false" class="hud">
      <span>{{ page.name }}</span>
      <span>对象 {{ page.objects.length }}</span>
      <span>实时 3D · 点击交互</span>
    </div>
    <WriteTagDialog
      v-model="writeDialogVisible"
      :tag-id="writeTagId"
      :value="writeValue"
      :mode="writeMode"
      :value-type="writeValueType"
      @confirm="(v) => { writeResolver?.(v); writeResolver = null }"
      @cancel="writeResolver?.(null); writeResolver = null"
    />
  </div>
</template>

<style scoped>
.runtime3d {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0b0d11;
}

.runtime3d.embedded {
  background: transparent;
  overflow: hidden;
  border-radius: 2px;
}

.host {
  width: 100%;
  height: 100%;
}

.hud {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 12px;
  color: var(--scada-muted);
  pointer-events: none;
}
</style>
