<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import 'monaco-editor-css'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import { useProjectStore } from '@/stores/project'
import { ElMessage } from 'element-plus'
import { runScriptSource } from '@/shared/runtime/scriptEngine'
import { useTagStore } from '@/stores/tag'
import { useOutputLogStore } from '@/stores/outputLog'

;(globalThis as typeof globalThis & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

const project = useProjectStore()
const tags = useTagStore()
const log = useOutputLogStore()

const host = ref<HTMLDivElement | null>(null)
const activeScriptId = ref<string | null>(null)
const intervalMs = ref<number | undefined>(undefined)
const intervalEnabled = ref(true)
const lastRun = ref<{
  ok: boolean
  error?: string
  logs: string[]
  at: number
} | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

const activeScript = () =>
  project.document.scripts.find((s) => s.id === activeScriptId.value) ?? null

const attachedHint = computed(() => {
  const id = activeScriptId.value
  if (!id) return ''
  const pages = project.document.pages.filter((p) => p.scriptIds?.includes(id))
  if (!pages.length) return '未挂到任何页面'
  return `已挂：${pages.map((p) => p.name).join('、')}`
})

function ensureSelection() {
  if (!project.document.scripts.length) {
    activeScriptId.value = null
    return
  }
  if (!activeScriptId.value || !activeScript()) {
    activeScriptId.value = project.document.scripts[0].id
  }
}

function syncScheduleFromScript() {
  const script = activeScript()
  intervalMs.value = script?.intervalMs
  intervalEnabled.value = script?.intervalEnabled !== false
}

function loadIntoEditor() {
  const script = activeScript()
  if (!editor || !script) return
  editor.setValue(script.source)
  syncScheduleFromScript()
}

function onAdd() {
  const script = project.addScript()
  activeScriptId.value = script.id
  loadIntoEditor()
  lastRun.value = null
  ElMessage.success('已新建脚本')
}

function onSave() {
  const script = activeScript()
  if (!script || !editor) return
  const ms = intervalMs.value
  project.updateScript(script.id, {
    source: editor.getValue(),
    intervalMs: ms != null && ms >= 100 ? Math.floor(ms) : null,
    intervalEnabled: intervalEnabled.value,
  })
  ElMessage.success('脚本已保存')
  log.success(`保存脚本：${script.name}`, '设计端')
}

function onAttach() {
  const script = activeScript()
  if (!script) return
  project.attachScriptToActivePage(script.id)
  ElMessage.success(`已挂到页面：${project.activePage?.name}`)
}

function onRemove() {
  const script = activeScript()
  if (!script) return
  project.removeScript(script.id)
  ensureSelection()
  loadIntoEditor()
  lastRun.value = null
}

function onRun() {
  const script = activeScript()
  if (!script || !editor) return
  const source = editor.getValue()
  const localLogs: string[] = []
  const result = runScriptSource(source, {
    getTag: (id) => tags.getValue(id)?.value,
    writeTag: (id, value) => {
      void tags.writeValue(id, value as never)
    },
    log: (msg) => {
      const text = String(msg)
      localLogs.push(text)
      log.info(text, '脚本试跑')
    },
    context: {
      mode: 'try',
      scriptId: script.id,
      scriptName: script.name,
      pageId: project.activePageId || undefined,
      trigger: 'try',
    },
  })
  lastRun.value = {
    ok: result.ok,
    error: result.error,
    logs: result.logs.length ? result.logs : localLogs,
    at: Date.now(),
  }
  if (result.ok) {
    ElMessage.success('试跑成功（见下方与输出栏）')
    log.success(`试跑成功：${script.name}`, '脚本试跑')
  } else {
    ElMessage.error(`试跑失败：${result.error}`)
    log.error(`试跑失败：${script.name} — ${result.error}`, '脚本试跑')
  }
}

onMounted(() => {
  ensureSelection()
  syncScheduleFromScript()
  if (!host.value) return
  editor = monaco.editor.create(host.value, {
    value: activeScript()?.source ?? '',
    language: 'javascript',
    theme: 'vs-dark',
    minimap: { enabled: false },
    fontSize: 13,
    automaticLayout: true,
  })
})

watch(activeScriptId, () => {
  loadIntoEditor()
  lastRun.value = null
})

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})
</script>

<template>
  <div class="script-editor">
    <div class="toolbar">
      <el-select v-model="activeScriptId" size="small" placeholder="选择脚本" style="width: 160px">
        <el-option
          v-for="s in project.document.scripts"
          :key="s.id"
          :label="s.name"
          :value="s.id"
        />
      </el-select>
      <el-button size="small" @click="onAdd">新建</el-button>
      <el-button size="small" type="success" :disabled="!activeScriptId" @click="onSave">
        保存
      </el-button>
      <el-button size="small" :disabled="!activeScriptId" @click="onAttach">挂到当前页</el-button>
      <el-button size="small" type="primary" :disabled="!activeScriptId" @click="onRun">
        试跑
      </el-button>
      <el-button size="small" type="danger" plain :disabled="!activeScriptId" @click="onRemove">
        删除
      </el-button>
    </div>

    <div v-if="activeScriptId" class="schedule">
      <el-checkbox v-model="intervalEnabled">周期调度</el-checkbox>
      <span class="muted">间隔(ms)</span>
      <el-input-number
        v-model="intervalMs"
        size="small"
        :min="100"
        :max="3600000"
        :step="500"
        controls-position="right"
        placeholder="不调度"
        :disabled="!intervalEnabled"
      />
      <span class="hint">{{ attachedHint }} · ≥100ms 时页面驻留期间周期执行</span>
    </div>

    <div class="api-hint">
      API：<code>getTag</code> / <code>writeTag</code> / <code>log</code> /
      <code>context</code>（scriptId、pageId、widgetId、trigger、mode）
    </div>

    <div v-if="!project.document.scripts.length" class="empty">暂无脚本，点击「新建」</div>
    <div v-show="project.document.scripts.length" ref="host" class="monaco" />

    <div v-if="lastRun" class="run-panel" :class="lastRun.ok ? 'ok' : 'err'">
      <div class="run-head">
        <span>{{ lastRun.ok ? '试跑成功' : '试跑失败' }}</span>
        <span class="muted">{{ new Date(lastRun.at).toLocaleTimeString() }}</span>
      </div>
      <div v-if="lastRun.error" class="run-error">{{ lastRun.error }}</div>
      <pre v-if="lastRun.logs.length" class="run-logs">{{ lastRun.logs.join('\n') }}</pre>
      <div v-else class="muted">无 log 输出</div>
    </div>
  </div>
</template>

<style scoped>
.script-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 280px;
  gap: 6px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.schedule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.api-hint {
  font-size: 11px;
  color: var(--scada-muted);
}

.api-hint code {
  color: #7dd3fc;
}

.hint,
.muted {
  color: var(--scada-muted);
  font-size: 11px;
}

.monaco {
  flex: 1;
  min-height: 160px;
  border: 1px solid var(--scada-border);
  border-radius: 6px;
  overflow: hidden;
}

.empty {
  padding: 20px;
  color: var(--scada-muted);
  font-size: 12px;
}

.run-panel {
  max-height: 120px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--scada-border);
  font-size: 12px;
}

.run-panel.ok {
  border-color: #166534;
  background: rgba(22, 101, 52, 0.15);
}

.run-panel.err {
  border-color: #991b1b;
  background: rgba(127, 29, 29, 0.2);
}

.run-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-weight: 600;
}

.run-error {
  color: #fca5a5;
  margin-bottom: 4px;
}

.run-logs {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #cbd5e1;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
}
</style>
