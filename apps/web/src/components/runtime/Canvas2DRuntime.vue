<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  AnimationLinkInput,
  EventBinding,
  EventTrigger,
  Page2D,
  Page3D,
  Widget2D,
} from '@web-scada/core'
import { trendCurves } from '@web-scada/core'
import { createRuntimeStage, type RuntimeStageBundle } from '@/shared/konva/createRuntimeStage'
import {
  collectPageTagIds,
  isWidgetRuntimeEnabled,
  resolveWidgetVisual,
} from '@/shared/runtime/bindingEngine'
import { collectPage3DTagIds } from '@/shared/runtime/bindingEngine3d'
import { runPageScripts, runScriptSource, startPageScriptSchedules } from '@/shared/runtime/scriptEngine'
import { useTagStore } from '@/stores/tag'
import { useProjectStore } from '@/stores/project'
import { useOutputLogStore } from '@/stores/outputLog'
import WriteTagDialog from '@/components/dialogs/WriteTagDialog.vue'
import Canvas3DRuntime from '@/components/runtime/Canvas3DRuntime.vue'
import { object3dTreeSignature } from '@/shared/project/object3dTree'
import { historyPagerClientRect, historySearchClientRect } from '@/shared/runtime/alarmHistoryQuery'
import { trendToolbarClientRect } from '@/shared/runtime/trendHistoryQuery'
import AlarmHistorySearchBar from '@/components/runtime/AlarmHistorySearchBar.vue'
import TrendHistoryToolbar from '@/components/runtime/TrendHistoryToolbar.vue'
import AlarmHistoryPager from '@/components/runtime/AlarmHistoryPager.vue'

const props = defineProps<{
  page: Page2D
  /** 嵌入对话框时不抢全局订阅清理策略 */
  embedded?: boolean
  /** 是否显示底部 HUD（全屏运行标签页关闭） */
  showHud?: boolean
}>()

const emit = defineEmits<{
  quality: [summary: { good: number; bad: number; uncertain: number; offline: number }]
  openDialog: [pageId: string]
}>()

const host = ref<HTMLDivElement | null>(null)
const tags = useTagStore()
const project = useProjectStore()
const log = useOutputLogStore()

let bundle: RuntimeStageBundle | null = null
let removeListener: (() => void) | null = null
let stopSchedules: (() => void) | null = null
/** valueChange 上一帧采样 */
const lastTagSnapshot = new Map<string, string>()

type Scene3dSlot = {
  widgetId: string
  page: Page3D
  interactive: boolean
  /** 与图元绘制顺序一致，叠在 Konva 之下时用于多三维互压 */
  zIndex: number
  rect: { x: number; y: number; width: number; height: number }
}

const scene3dSlots = ref<Scene3dSlot[]>([])

type HistoryBar = {
  id: string
  x: number
  y: number
  w: number
  h: number
  px: number
  py: number
  pw: number
  ph: number
}
const historyBars = ref<HistoryBar[]>([])

function syncHistoryBars() {
  if (!bundle || !host.value) {
    historyBars.value = []
    return
  }
  const board = host.value.parentElement
  const hostBox = host.value.getBoundingClientRect()
  const boardBox = board?.getBoundingClientRect()
  const origin = {
    x: boardBox ? hostBox.left - boardBox.left : 0,
    y: boardBox ? hostBox.top - boardBox.top : 0,
  }
  const next: HistoryBar[] = []
  for (const layer of props.page.layers) {
    if (!layer.visible) continue
    for (const widget of layer.widgets) {
    if (widget.type !== 'alarmHistory' || widget.visible === false) continue
    const node = bundle.stage.findOne(`#${widget.id}`)
    if (!node) continue
    const rect = historySearchClientRect(
      (p) => node.getAbsoluteTransform().point(p),
      widget,
      origin,
    )
    const pager = historyPagerClientRect(
      (p) => node.getAbsoluteTransform().point(p),
      widget,
      origin,
    )
    next.push({
      id: widget.id,
      ...rect,
      px: pager.x,
      py: pager.y,
      pw: pager.w,
      ph: pager.h,
    })
    }
  }
  historyBars.value = next
}

/** 历史趋势工具栏：按图元矩形定位（与"历史报警"的搜索条同一套做法） */
type TrendBar = {
  id: string
  preset: string
  tagIds: string[]
  allowEdit: boolean
  x: number
  y: number
  w: number
  h: number
}
const trendBars = ref<TrendBar[]>([])

function syncTrendBars() {
  if (!bundle || !host.value) {
    trendBars.value = []
    return
  }
  const board = host.value.parentElement
  const hostBox = host.value.getBoundingClientRect()
  const boardBox = board?.getBoundingClientRect()
  const origin = {
    x: boardBox ? hostBox.left - boardBox.left : 0,
    y: boardBox ? hostBox.top - boardBox.top : 0,
  }
  const next: TrendBar[] = []
  for (const layer of props.page.layers) {
    if (!layer.visible) continue
    for (const widget of layer.widgets) {
      if (widget.type !== 'trendHistory' || widget.visible === false) continue
      if (widget.props.showToolbar === false) continue
      const node = bundle.stage.findOne(`#${widget.id}`)
      if (!node) continue
      const rect = trendToolbarClientRect((p) => node.getAbsoluteTransform().point(p), widget, origin)
      next.push({
        id: widget.id,
        preset: String(widget.props.range ?? '-1h'),
        tagIds: trendCurves(widget.props).map((curve) => curve.tagId).filter(Boolean),
        allowEdit: widget.props.allowTimeEdit !== false,
        ...rect,
      })
    }
  }
  trendBars.value = next
}

function onHistorySearch() {
  refreshAllVisuals()
}

const writeDialogVisible = ref(false)
const writeTagId = ref('')
const writeValue = ref<string | number | boolean>('')
const writeMode = ref<'confirm' | 'edit'>('confirm')
const writeValueType = ref<'number' | 'boolean' | 'string'>('number')
let writeResolver: ((value: string | number | boolean | null) => void) | null = null

function allWidgets(page: Page2D): Widget2D[] {
  return page.layers.flatMap((l) => l.widgets)
}

function findWidget(id: string): Widget2D | undefined {
  return allWidgets(props.page).find((w) => w.id === id)
}

function resolveScene3dPage(page3dId: string): Page3D | null {
  if (!page3dId) return null
  const page = project.document.pages.find((p) => p.id === page3dId)
  return page && page.type === '3d' ? page : null
}

function collectEmbedded3dTagIds(page: Page2D): string[] {
  const ids = new Set<string>()
  for (const widget of allWidgets(page)) {
    if (widget.type !== 'scene3d' || widget.visible === false) continue
    const page3d = resolveScene3dPage(String(widget.props.page3dId || ''))
    if (!page3d) continue
    for (const id of collectPage3DTagIds(page3d)) ids.add(id)
  }
  return [...ids]
}

function syncScene3dOverlays() {
  if (!bundle) {
    scene3dSlots.value = []
    return
  }
  const next: Scene3dSlot[] = []
  let paintOrder = 0
  for (const widget of allWidgets(props.page)) {
    paintOrder += 1
    if (widget.type !== 'scene3d' || widget.visible === false) continue
    const page3d = resolveScene3dPage(String(widget.props.page3dId || ''))
    if (!page3d) continue
    const rect = bundle.getWidgetClientRect(widget.id)
    if (!rect) continue
    const interactive = widget.props.interactive !== false
    next.push({
      widgetId: widget.id,
      page: page3d,
      interactive,
      // 可交互：盖过 .host(z=10000)，否则模型点选进不了 WebGL（Konva 热区/转发不可靠）
      // 仅展示：仍垫在 Konva 下作背景
      zIndex: interactive ? 10000 + paintOrder : paintOrder,
      rect,
    })
  }
  scene3dSlots.value = next
}

function tagSnapshot(tagId: string): string {
  const t = tags.getValue(tagId)
  return `${String(t?.value)}|${t?.quality ?? ''}|${t?.timestamp ?? 0}`
}

function refreshAllVisuals() {
  if (!bundle) return
  let good = 0
  let bad = 0
  let uncertain = 0
  let offline = 0
  for (const widget of allWidgets(props.page)) {
    const resolved = resolveWidgetVisual(widget, (id) => tags.getValue(id))
    if (resolved.quality === 'Bad') bad += 1
    else if (resolved.quality === 'Uncertain') uncertain += 1
    else if (resolved.quality === 'Offline') offline += 1
    else good += 1
    bundle.applyVisual(widget.id, resolved.widget, { blink: resolved.blink })
  }
  emit('quality', { good, bad, uncertain, offline })
  syncScene3dOverlays()
  syncHistoryBars()
  syncTrendBars()
}

function firePageTrigger(trigger: 'load' | 'unload') {
  for (const widget of allWidgets(props.page)) {
    const events = (widget.events ?? []).filter((e) => e.trigger === trigger)
    if (events.length) void runEventActions(widget.id, events)
  }
}

function checkValueChangeEvents() {
  for (const widget of allWidgets(props.page)) {
    const vcEvents = (widget.events ?? []).filter((e) => e.trigger === 'valueChange')
    if (!vcEvents.length) continue
    const tagIds = new Set<string>()
    for (const link of widget.animationLinks ?? []) tagIds.add(link.tagId)
    for (const b of widget.bindings ?? []) tagIds.add(b.tagId)
    for (const a of widget.animations ?? []) tagIds.add(a.tagId)
    for (const evt of vcEvents) {
      for (const action of evt.actions) {
        if (action.type === 'writeTag') tagIds.add(action.tagId)
      }
    }
    let changed = false
    for (const tagId of tagIds) {
      const snap = tagSnapshot(tagId)
      const key = `${widget.id}:${tagId}`
      const prev = lastTagSnapshot.get(key)
      if (prev !== undefined && prev !== snap) changed = true
      lastTagSnapshot.set(key, snap)
    }
    if (changed) void runEventActions(widget.id, vcEvents)
  }
}

function makeScriptApi(partial?: { widgetId?: string; trigger?: string; scriptId?: string; scriptName?: string }) {
  return {
    getTag: (id: string) => tags.getValue(id)?.value,
    writeTag: (id: string, value: unknown) => {
      void tags.writeValue(id, value as never)
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

function setupSubscription(page: Page2D) {
  const ids = [...new Set([...collectPageTagIds(page), ...collectEmbedded3dTagIds(page)])]
  tags.setPageSubscription(ids)
  lastTagSnapshot.clear()
  for (const widget of allWidgets(page)) {
    for (const link of widget.animationLinks ?? []) {
      lastTagSnapshot.set(`${widget.id}:${link.tagId}`, tagSnapshot(link.tagId))
    }
    for (const b of widget.bindings ?? []) {
      lastTagSnapshot.set(`${widget.id}:${b.tagId}`, tagSnapshot(b.tagId))
    }
    for (const a of widget.animations ?? []) {
      lastTagSnapshot.set(`${widget.id}:${a.tagId}`, tagSnapshot(a.tagId))
    }
  }
  refreshAllVisuals()
  stopSchedules?.()
  const api = makeScriptApi({ trigger: 'load' })
  runPageScripts(page, api)
  stopSchedules = startPageScriptSchedules(page, api)
  void nextTick(() => syncScene3dOverlays())
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

function onWriteConfirm(value: string | number | boolean) {
  writeResolver?.(value)
  writeResolver = null
}

function onWriteCancel() {
  writeResolver?.(null)
  writeResolver = null
}

async function doWrite(tagId: string, value: string | number | boolean) {
  const res = await tags.writeValue(tagId, value)
  ElMessage[res.ok ? 'success' : 'error'](res.message)
  if (res.ok) log.success(`写值 ${tagId} = ${String(value)}`, '运行端')
  else log.error(res.message, '运行端')
}

async function runEventActions(widgetId: string, events: EventBinding[]) {
  const widget = findWidget(widgetId)
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
        let value = action.value
        if (action.confirm) {
          const ok = await askWrite(action.tagId, action.value, { mode: 'confirm' })
          if (ok === null) continue
          value = ok
        }
        await doWrite(action.tagId, value)
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

async function handleWidgetEvent(widgetId: string, trigger: EventTrigger, events: EventBinding[]) {
  const matched = events.filter((e) => e.trigger === trigger)
  if (!matched.length) return
  await runEventActions(widgetId, matched)
}

async function handleAnimationInput(widgetId: string) {
  const widget = findWidget(widgetId)
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

async function handleDragWrite(
  _widgetId: string,
  _axis: 'h' | 'v',
  tagId: string,
  value: number,
) {
  const rounded = Math.round(value * 1000) / 1000
  const res = await tags.writeValue(tagId, rounded)
  if (res.ok) log.info(`拖拽写值 ${tagId} = ${rounded}`, '运行端')
  else log.error(res.message, '运行端')
}

onMounted(() => {
  if (!host.value) return
  bundle = createRuntimeStage(host.value, props.page, {
    onWidgetEvent: (id, trigger, events) => {
      void handleWidgetEvent(id, trigger, events)
    },
    onAnimationInput: (id) => {
      void handleAnimationInput(id)
    },
    onDragWrite: (id, axis, tagId, value) => {
      void handleDragWrite(id, axis, tagId, value)
    },
    onAlarmAck: (alarmId) => {
      void tags.ackAlarm(alarmId).then((res) => {
        if (!res.ok) ElMessage.error(res.message)
      })
    },
  }, { chartInteraction: true })
  bundle.setViewChangeListener(() => {
    syncScene3dOverlays()
    syncHistoryBars()
  syncTrendBars()
  })
  setupSubscription(props.page)
  if (!props.embedded) tags.connectRealtime()
  removeListener = tags.addListener(() => {
    refreshAllVisuals()
    checkValueChangeEvents()
  })
})

watch(
  () => props.page.id,
  () => {
    if (!bundle) return
    firePageTrigger('unload')
    stopSchedules?.()
    stopSchedules = null
    bundle.setPage(props.page)
    setupSubscription(props.page)
  },
)

watch(
  () => props.page.layers,
  () => {
    if (!bundle) return
    bundle.setPage(props.page)
    setupSubscription(props.page)
  },
  { deep: true },
)

onUnmounted(() => {
  firePageTrigger('unload')
  writeResolver?.(null)
  writeResolver = null
  stopSchedules?.()
  stopSchedules = null
  removeListener?.()
  removeListener = null
  bundle?.setViewChangeListener(null)
  scene3dSlots.value = []
  if (!props.embedded) {
    tags.clearPageSubscription()
    tags.stopMockStream()
  }
  bundle?.dispose()
  bundle = null
})
</script>

<template>
  <div class="runtime-board">
    <div ref="host" class="host" />
    <AlarmHistorySearchBar
      v-for="bar in historyBars"
      :key="bar.id"
      class="history-search"
      :widget-id="bar.id"
      :style="{ left: bar.x + 'px', top: bar.y + 'px', width: bar.w + 'px', height: bar.h + 'px' }"
      @change="onHistorySearch"
    />
    <TrendHistoryToolbar
      v-for="bar in trendBars"
      :key="bar.id + ':toolbar'"
      class="history-search"
      :widget-id="bar.id"
      :preset="bar.preset"
      :tag-ids="bar.tagIds"
      :allow-edit="bar.allowEdit"
      :style="{ left: bar.x + 'px', top: bar.y + 'px', width: bar.w + 'px', height: bar.h + 'px' }"
      @change="onHistorySearch"
    />
    <AlarmHistoryPager
      v-for="bar in historyBars"
      :key="bar.id + ':page'"
      class="history-search"
      :widget-id="bar.id"
      :style="{ left: bar.px + 'px', top: bar.py + 'px', width: bar.pw + 'px', height: bar.ph + 'px' }"
      @change="onHistorySearch"
    />
    <div
      v-for="slot in scene3dSlots"
      :key="slot.widgetId + ':' + slot.page.id"
      class="scene3d-overlay"
      :style="{
        left: slot.rect.x + 'px',
        top: slot.rect.y + 'px',
        width: slot.rect.width + 'px',
        height: slot.rect.height + 'px',
        zIndex: slot.zIndex,
        pointerEvents: slot.interactive ? 'auto' : 'none',
      }"
    >
      <Canvas3DRuntime
        :key="slot.widgetId + ':' + slot.page.id + ':' + object3dTreeSignature(slot.page.objects)"
        embedded
        :page="slot.page"
        :interactive="slot.interactive"
        @open-dialog="(id) => emit('openDialog', id)"
      />
    </div>
    <div v-if="!embedded && showHud !== false" class="hud">
      <span>{{ page.name }}</span>
      <span>{{ page.width }} × {{ page.height }}</span>
      <span>实时驱动 · 点击/双击事件 · 拖拽写值</span>
    </div>
    <WriteTagDialog
      v-model="writeDialogVisible"
      :tag-id="writeTagId"
      :value="writeValue"
      :mode="writeMode"
      :value-type="writeValueType"
      @confirm="onWriteConfirm"
      @cancel="onWriteCancel"
    />
  </div>
</template>

<style scoped>
.runtime-board {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0b0d11;
}

.host {
  position: absolute;
  inset: 0;
  z-index: 10000;
  width: 100%;
  height: 100%;
  background: transparent;
}

.history-search {
  position: absolute;
  z-index: 10001;
}

.scene3d-overlay {
  position: absolute;
  /* zIndex 由 slot 写入：可交互 > host(10000)，仅展示 < host */
  z-index: 1;
  overflow: hidden;
  pointer-events: auto;
  box-sizing: border-box;
  border: none;
  border-radius: 0;
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
  background: rgba(15, 18, 28, 0.85);
  color: #9aa3b2;
  font-size: 12px;
  pointer-events: none;
  z-index: 3;
}
</style>
