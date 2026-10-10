<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  AnimationLinkInput,
  AnimationLinkRange,
  EventBinding,
  EventTrigger,
  Object3DNode,
  Page3D,
  Widget2D,
} from '@web-scada/core'
import { panelWidgetWriteAction, resolvePanelWidgets } from '@web-scada/core'
import { createScene3D, type Scene3DBundle } from '@/shared/three/createScene3D'
import {
  collectPage3DTagIds,
  resolveObject3DVisual,
} from '@/shared/runtime/bindingEngine3d'
import { isWidgetRuntimeEnabled, resolveWidgetVisual } from '@/shared/runtime/bindingEngine'
import {
  findObject3dDeep,
  locateObject3d,
  object3dPanelSignature,
  object3dTreeSignature,
  walkObject3dTree,
} from '@/shared/project/object3dTree'
import { useTagStore } from '@/stores/tag'
import { useProjectStore } from '@/stores/project'
import { useOutputLogStore } from '@/stores/outputLog'
import WriteTagDialog from '@/components/dialogs/WriteTagDialog.vue'
import { runPageScripts, runScriptSource, startPageScriptSchedules } from '@/shared/runtime/scriptEngine'

const props = withDefaults(
  defineProps<{
    page: Page3D
    /** 嵌入 2D 画面时：不抢占 Tag 订阅 / 不显示 HUD */
    embedded?: boolean
    /**
     * 是否允许点击交互（默认 true）。
     * 注意：Vue 对 Boolean prop 缺省会强制变成 false，父组件不传时必须靠这里的显式默认值，
     * 否则独立 3D 运行页会完全没有点击 / 写值（Orbit 旋转仍然正常，极易被误判成「手势冲突」）。
     */
    interactive?: boolean
    /** 是否显示底部 HUD（全屏运行标签页关闭） */
    showHud?: boolean
    /** 地面网格；默认 false（运行端） */
    showGrid?: boolean
  }>(),
  { interactive: true },
)

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

/** 交互诊断：地址栏带 ?diag3d=1 时开启，帮助定位「点不出效果」卡在哪一步 */
const diag3d = (() => {
  try {
    return new URLSearchParams(window.location.search).get('diag3d') === '1'
  } catch {
    return false
  }
})()
const diagText = ref('')

function pushDiag(line: string) {
  if (!diag3d) return
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const rows = [...(diagText.value ? diagText.value.split('\n') : []), `${t} ${line}`]
  diagText.value = rows.slice(-8).join('\n')
  console.info('[scada-3d][diag]', line)
}

function objectLabel(id: string | null | undefined): string {
  if (!id) return '—'
  const obj = findObject3dDeep(livePageObjects(), id) ?? resolveEventTarget(id)
  return obj ? obj.name || obj.id : id
}

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
  const msg = res.message || (res.ok ? '写值成功' : '写值失败')
  ElMessage[res.ok ? 'success' : 'error'](msg)
  if (res.ok) log.success(`写值 ${tagId} = ${String(value)}`, '运行端')
  else log.error(msg, '运行端')
  pushDiag(`写值 ${tagId} = ${String(value)} → ${res.ok ? '成功' : msg}`)
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
  // 以工程文档里的页面为准：props.page 可能是旧引用，会让「使能」判断失真
  walkObject3dTree(livePageObjects(), (obj) => {
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
      scene.refreshPanel(obj.id, (id) => tags.getValue(id))
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
    tags.setPageSubscription(collectPage3DTagIds(props.page, resolvePanelPage2d))
  }
  refreshVisuals()
  stopSchedules?.()
  const api = makeScriptApi({ trigger: 'load' })
  runPageScripts(props.page, api)
  stopSchedules = startPageScriptSchedules(props.page, api)
}

async function handleAnimationInput(objectId: string) {
  const obj = findObject3dDeep(livePageObjects(), objectId)
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
        const ok = await confirmWrite(link.tagId, next)
        if (!ok) continue
      }
      await doWrite(link.tagId, next)
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

function resolvePanelPage2d(page2dId: string) {
  const page = project.document.pages.find((p) => p.id === page2dId && p.type === '2d')
  return page && page.type === '2d' ? page : null
}

function findPanelWidget(objectId: string, widgetId: string): Widget2D | undefined {
  const obj = findObject3dDeep(props.page.objects, objectId)
  if (!obj?.panel) return undefined
  const pid = obj.panel.page2dId?.trim()
  if (pid) {
    const page2d = resolvePanelPage2d(pid)
    if (page2d) {
      return page2d.layers.flatMap((l) => l.widgets).find((w) => w.id === widgetId)
    }
  }
  return resolvePanelWidgets(obj.panel).find((w) => w.id === widgetId)
}

async function runPanelWidgetEventActions(
  objectId: string,
  widgetId: string,
  events: EventBinding[],
) {
  const widget = findPanelWidget(objectId, widgetId)
  if (!widget) return
  const resolved = resolveWidgetVisual(widget, (id) => tags.getValue(id))
  if (!isWidgetRuntimeEnabled(resolved.widget)) {
    ElMessage.warning('图元当前禁止操作')
    return
  }
  for (const evt of events) {
    for (const action of evt.actions) {
      if (action.type === 'navigate') {
        project.setActivePage(action.pageId)
        ElMessage.success('已切换页面')
        log.info(`跳转页面：${action.pageId}`, '运行端')
      } else if (action.type === 'writeTag') {
        if (action.confirm) {
          const ok = await confirmWrite(action.tagId, action.value)
          if (!ok) continue
        }
        await doWrite(action.tagId, action.value)
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
            widgetId,
            trigger: evt.trigger,
            scriptId: script.id,
            scriptName: script.name,
          }),
        )
        log.info(`执行脚本：${script.name}（${evt.trigger}）`, '运行端')
      }
    }
  }
}

async function handlePanelWidgetEvent(
  objectId: string,
  widgetId: string,
  trigger: EventTrigger,
  events: EventBinding[],
) {
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  const matched = events.filter((e) => e.trigger === trigger)
  if (!matched.length) {
    // 无事件时兼容旧开关/按钮写值
    if (trigger === 'click') {
      const widget = findPanelWidget(objectId, widgetId)
      if (widget) await handlePanelButtonLegacy(objectId, widget)
    }
    return
  }
  await runPanelWidgetEventActions(objectId, widgetId, matched)
}

async function handlePanelWidgetAnimationInput(objectId: string, widgetId: string) {
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  const widget = findPanelWidget(objectId, widgetId)
  if (!widget) return
  const resolved = resolveWidgetVisual(widget, (id) => tags.getValue(id))
  if (!isWidgetRuntimeEnabled(resolved.widget)) {
    ElMessage.warning('图元当前禁止操作')
    return
  }
  const links = (widget.animationLinks ?? []).filter(
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
        const ok = await confirmWrite(link.tagId, next)
        if (!ok) continue
      }
      await doWrite(link.tagId, next)
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

async function handlePanelButtonLegacy(objectId: string, widget: Widget2D) {
  if (interactiveMap.get(objectId) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  if (widget.type === 'switch') {
    const tagId =
      panelWidgetWriteAction(widget)?.tagId ||
      widget.bindings?.find((b) => b.prop === 'value' || b.prop === 'text')?.tagId
    if (!tagId) {
      ElMessage.warning('开关未绑定 Tag')
      return
    }
    const cur = tags.getValue(tagId)?.value
    const next = !Boolean(cur)
    const confirm = panelWidgetWriteAction(widget)?.confirm !== false
    if (confirm) {
      const ok = await askWrite(tagId, next, { mode: 'confirm', valueType: 'boolean' })
      if (ok === null) return
      await doWrite(tagId, Boolean(ok))
    } else {
      await doWrite(tagId, next)
    }
    return
  }
  const write = panelWidgetWriteAction(widget)
  if (!write?.tagId) return
  if (write.confirm) {
    const ok = await askWrite(write.tagId, write.value, { mode: 'confirm' })
    if (ok === null) return
    await doWrite(write.tagId, ok)
  } else {
    await doWrite(write.tagId, write.value)
  }
}

/** 以工程文档中的页面为准，避免 props.page 引用陈旧导致「有事件却判没有」 */
function livePageObjects(): Object3DNode[] {
  const live = project.document.pages.find((p) => p.id === props.page.id && p.type === '3d') as
    | Page3D
    | undefined
  return live?.objects ?? props.page.objects
}

/** 是否有「单击/双击」业务：事件或输入型动画连接（valueIn/digitalIn/textIn） */
function objectHasClickAction(obj: Object3DNode): boolean {
  if ((obj.events ?? []).some((e) => e.trigger === 'click' || e.trigger === 'dblclick')) return true
  return (obj.animationLinks ?? []).some(
    (l) => l.enabled && (l.type === 'valueIn' || l.type === 'digitalIn' || l.type === 'textIn'),
  )
}

/** 拖拽写值连接（轻点不触发业务，只有拖拽才写值） */
function objectHasDragLink(obj: Object3DNode): boolean {
  return (obj.animationLinks ?? []).some(
    (l) => l.enabled && (l.type === 'dragH' || l.type === 'dragV' || l.type === 'dragZ'),
  )
}

function resolveEventTarget(objectId: string): Object3DNode | null {
  const roots = livePageObjects()
  let loc = locateObject3d(roots, objectId)
  if (!loc) return findObject3dDeep(roots, objectId)
  let cur: Object3DNode | null = loc.list[loc.index]
  let parent = loc.parent
  while (cur) {
    if (objectHasClickAction(cur)) return cur
    if (!parent) break
    const up = locateObject3d(roots, parent.id)
    cur = parent
    parent = up?.parent ?? null
  }
  return loc.list[loc.index]
}

function isObjectClickable(objectId: string): boolean {
  if (interactiveMap.get(objectId) === false) return false
  const obj = resolveEventTarget(objectId)
  if (!obj) return false
  if (interactiveMap.get(obj.id) === false) return false
  return objectHasClickAction(obj)
}

async function confirmWrite(tagId: string, value: string | number | boolean): Promise<boolean> {
  try {
    pushDiag(`弹写值确认框：${tagId} = ${String(value)}`)
    await ElMessageBox.confirm(`确认写入「${tagId}」= ${String(value)}？`, '写值确认', {
      type: 'warning',
      confirmButtonText: '确认写入',
      cancelButtonText: '取消',
      appendTo: document.body,
      customClass: 'scada-runtime-write-confirm',
      closeOnClickModal: false,
    })
    pushDiag(`确认框结果：用户确认 ${tagId} = ${String(value)}`)
    return true
  } catch {
    pushDiag('确认框结果：用户取消')
    return false
  }
}

async function handleObjectTrigger(objectId: string, trigger: 'click' | 'dblclick') {
  const obj = resolveEventTarget(objectId)
  if (!obj) {
    ElMessage.warning('未命中可操作对象')
    return
  }
  if (interactiveMap.get(objectId) === false || interactiveMap.get(obj.id) === false) {
    ElMessage.warning('对象当前禁止操作')
    return
  }
  const matched = (obj.events ?? []).filter((e) => e.trigger === trigger)
  const hasAnimInput =
    trigger === 'click' &&
    (obj.animationLinks ?? []).some(
      (l) =>
        l.enabled && (l.type === 'valueIn' || l.type === 'digitalIn' || l.type === 'textIn'),
    )
  if (!matched.length && !hasAnimInput) {
    if (trigger === 'dblclick') return
    pushDiag(`业务：${obj.name || obj.id} 没有单击事件（发布包可能陈旧，请重新「进入运行」）`)
    if (objectHasDragLink(obj)) return
    ElMessage.info(`已点中「${obj.name || obj.id}」，但没有单击事件（请重新「进入运行」）`)
    return
  }
  if (hasAnimInput) await handleAnimationInput(obj.id)
  if (matched.length) await runEvents(matched, trigger)
}

function resolveDragLinks(objectId: string) {
  const obj = findObject3dDeep(livePageObjects(), objectId)
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
  for (const evt of events) {
    if (evt.trigger !== trigger) continue
    for (const action of evt.actions) {
      if (action.type === 'writeTag') {
        if (!action.tagId?.trim()) {
          ElMessage.warning('写值事件未选择变量')
          continue
        }
        if (action.confirm) {
          const ok = await confirmWrite(action.tagId, action.value)
          if (!ok) continue
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
  pushDiag(`场景已挂载：点击交互=${canInteract ? '开' : '关'} · 对象 ${props.page.objects.length} 个`)
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
          isObjectClickable,
          onRuntimeInteract: (info) => {
            if (info.phase === 'down') {
              pushDiag(
                info.hitId
                  ? `按下命中「${objectLabel(info.hitId)}」· 可点击=${info.clickable ? '是' : '否'} · 拖拽写=${info.dragLinks ? '是' : '否'}`
                  : '按下未命中物体（空白处只旋转）',
              )
              return
            }
            const verdict =
              info.verdict === 'tap'
                ? '轻点 → 触发业务'
                : info.verdict === 'rotate'
                  ? '旋转 → 不触发业务'
                  : '忽略本次手势'
            pushDiag(`${verdict}｜${info.reason ?? ''}`)
          },
          resolveDragLinks,
          onDragWrite: (_id, _axis, tagId, value) => {
            const rounded = Math.round(value * 1000) / 1000
            void doWrite(tagId, rounded)
          },
          onPanelWidgetEvent: (objectId, widgetId, trigger, events) => {
            void handlePanelWidgetEvent(objectId, widgetId, trigger, events)
          },
          onPanelAnimationInput: (objectId, widgetId) => {
            void handlePanelWidgetAnimationInput(objectId, widgetId)
          },
          onPanelDragWrite: (_objectId, _widgetId, _axis, tagId, value) => {
            const rounded = Math.round(value * 1000) / 1000
            void doWrite(tagId, rounded)
          },
          resolvePage2d: resolvePanelPage2d,
        }
      : {
          resolvePage2d: resolvePanelPage2d,
        },
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
  () => object3dPanelSignature(props.page.objects, project.document.pages),
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
    <div v-if="diag3d" class="diag3d">
      <div class="diag3d-title">3D 交互诊断（?diag3d=1）｜轻点=业务 · 左键拖=旋转</div>
      <div v-if="!diagText" class="diag3d-line">尚无交互记录</div>
      <div v-else class="diag3d-line">{{ diagText }}</div>
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

.diag3d {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 40;
  max-width: min(560px, 90%);
  padding: 8px 10px;
  border: 1px solid rgba(120, 180, 255, 0.35);
  border-radius: 6px;
  background: rgba(8, 12, 20, 0.82);
  color: #cfe3ff;
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.55;
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-all;
}

.diag3d-title {
  margin-bottom: 4px;
  color: #8fb4e8;
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

<style>
/* MessageBox 挂到 body，提高运行弹窗内层级 */
.scada-runtime-write-confirm {
  z-index: 50000 !important;
}
.scada-runtime-write-confirm + .el-overlay,
.el-overlay:has(.scada-runtime-write-confirm) {
  z-index: 49999 !important;
}
</style>
