<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { AlarmLevel, AlarmLimitCode, DeviceMeta, DeviceProtocol, SimMode, TagAlarmConfig, TagHistoryConfig, TagMeta, TagSimulation, TagValue } from '@web-scada/core'
import { defaultTagSimulation, formatBoolText, simModeOptions } from '@web-scada/core'
import HelpTip from '@/components/designer/HelpTip.vue'
import { useTagStore } from '@/stores/tag'
import { useDeviceStore } from '@/stores/device'
import { qualityTagType } from '@/shared/runtime/tagLabel'
import { ApiError, apiCreateAlarm, apiDeleteAlarm, apiListAlarms, apiUpdateAlarm } from '@/shared/api/client'
import {
  emptyConnFields,
  formatDeviceChannel,
  parseDeviceChannel,
  type DeviceConnFields,
} from '@/shared/device/deviceChannel'
import {
  emptyTagAddrFields,
  formatTagAddress,
  MODBUS_AREA_OPTIONS,
  parseTagAddress,
  type TagAddrFields,
} from '@/shared/device/tagAddress'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
}>()

const tags = useTagStore()
const devices = useDeviceStore()
const loading = ref(false)
const saving = ref(false)
const mainTab = ref<'tags' | 'devices'>('tags')
const groupFilter = ref<string>('__all__')
const editorOpen = ref(false)
const editorTab = ref<'basic' | 'sim' | 'alarm' | 'history'>('basic')
const editingId = ref<string | null>(null)
const deviceEditorOpen = ref(false)
const editingDeviceId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const form = reactive({
  tagId: '',
  name: '',
  group: '',
  dataType: 'float' as TagMeta['dataType'],
  unit: '',
  writable: false,
  deviceId: '',
  description: '',
})

/** 按所选设备协议拆开的地址字段（保存时拼回 address） */
const tagAddr = reactive<TagAddrFields>(emptyTagAddrFields())

const sim = reactive({
  enabled: true,
  mode: 'walk' as SimMode,
  periodSec: 1,
  min: null as number | null,
  max: null as number | null,
  step: 1,
  options: '待机\n运行\n停止',
})

const io = reactive({
  onText: '',
  offText: '',
  scanPeriodMs: 1000,
  pushEnabled: false,
  pushPeriodMs: 1000,
  archive: 'legacy' as 'legacy' | 'off' | 'change' | 'interval',
  historyIntervalMs: 1000,
  deadband: 0,
})

const deviceForm = reactive({
  deviceId: '',
  name: '',
  protocol: 'mock' as DeviceProtocol,
  enabled: true,
  description: '',
})

/** 按协议拆开的连接字段（保存时拼回 channel） */
const deviceConn = reactive<DeviceConnFields>(emptyConnFields())

const protocolOptions: Array<{ value: DeviceProtocol; label: string }> = [
  { value: 'mock', label: 'Mock（模拟设备）' },
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'opcua', label: 'OPC UA' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'http', label: 'HTTP' },
  { value: 'mcd4000', label: 'MCD4000（数据中台）' },
  { value: 'other', label: '其他' },
]

function applyConnFromChannel(protocol: DeviceProtocol, channel?: string) {
  Object.assign(deviceConn, parseDeviceChannel(protocol, channel))
}

/** 切换协议：清空为该协议默认字段（避免把 Modbus 的 host:port 误当成 OPC 端点） */
function onProtocolChange(v: DeviceProtocol) {
  deviceForm.protocol = v
  applyConnFromChannel(v, undefined)
}

function protocolLabel(protocol: string) {
  return protocolOptions.find((p) => p.value === protocol)?.label ?? protocol
}

const groupOptions = computed(() => {
  const set = new Set<string>()
  for (const item of tags.list) {
    const g = item.meta.group?.trim()
    if (g) set.add(g)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

const filteredTags = computed(() => {
  if (groupFilter.value === '__all__') return tags.list
  if (groupFilter.value === '__none__') {
    return tags.list.filter((t) => !t.meta.group?.trim())
  }
  return tags.list.filter((t) => t.meta.group === groupFilter.value)
})

function close() {
  emit('update:modelValue', false)
}

function deviceName(deviceId?: string) {
  if (!deviceId) return '-'
  return devices.getById(deviceId)?.name || deviceId
}

/** 变量编辑器当前所选设备协议 */
const formDeviceProtocol = computed<DeviceProtocol>(() => {
  const d = devices.getById(form.deviceId)
  return d?.protocol ?? 'other'
})

function applyTagAddr(protocol: DeviceProtocol, address?: string) {
  Object.assign(tagAddr, parseTagAddress(protocol, address))
}

/** 切换所属设备：按新协议重置地址字段 */
function onTagDeviceChange(deviceId: string) {
  form.deviceId = deviceId
  const protocol = devices.getById(deviceId)?.protocol ?? 'other'
  if (protocol !== 'mock' && editorTab.value === 'sim') editorTab.value = 'basic'
  applyTagAddr(protocol, undefined)
}

async function refresh() {
  loading.value = true
  try {
    await Promise.all([tags.hydrateFromServer(), devices.hydrateFromServer()])
    tags.connectRealtime()
  } catch {
    ElMessage.warning('无法连接服务端，显示本地 Mock')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void refresh()
  },
)

function generateTagId() {
  const existing = new Set(tags.metas.map((m) => m.tagId))
  for (let i = 0; i < 20; i++) {
    const id = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    if (!existing.has(id)) return id
  }
  return `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function generateDeviceId() {
  const existing = new Set(devices.items.map((d) => d.deviceId))
  for (let i = 0; i < 20; i++) {
    const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    if (!existing.has(id)) return id
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function loadSimForm(saved?: TagSimulation | null) {
  const defaults = defaultTagSimulation({
    tagId: form.tagId || 'tag',
    dataType: form.dataType,
    unit: form.unit,
    writable: form.writable,
  })
  sim.enabled = saved ? saved.enabled : defaults.enabled
  sim.mode = saved?.mode && simModeOptions(form.dataType).some((item) => item.value === saved.mode)
    ? saved.mode
    : defaults.mode ?? 'walk'
  sim.periodSec = saved?.periodSec || defaults.periodSec
  sim.min = saved ? (saved.min ?? null) : (defaults.min ?? null)
  sim.max = saved ? (saved.max ?? null) : (defaults.max ?? null)
  sim.step = saved?.step ?? defaults.step ?? 1
  sim.options = saved?.options || defaults.options || '待机\n运行\n停止'
}

function onSimTypeChange() {
  loadSimForm(null)
}

function clampMs(value: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1000
  return Math.min(86_400_000, Math.max(200, Math.round(n)))
}

function loadIoForm(meta?: TagMeta | null) {
  io.onText = meta?.onText ?? ''
  io.offText = meta?.offText ?? ''
  io.scanPeriodMs = meta?.scanPeriodMs ?? 1000
  io.pushEnabled = meta?.pushEnabled === true
  io.pushPeriodMs = meta?.pushPeriodMs ?? 1000
  const history = meta?.history
  if (!history || history.enabled == null) io.archive = 'legacy'
  else if (!history.enabled) io.archive = 'off'
  else if (history.mode === 'interval') io.archive = 'interval'
  else io.archive = 'change'
  io.historyIntervalMs = history?.intervalMs ?? 1000
  io.deadband = history?.deadband ?? 0
}

function historyPayload(): TagHistoryConfig {
  if (io.archive === 'legacy') return { mode: 'legacy' }
  if (io.archive === 'off') return { enabled: false }
  const numeric = form.dataType === 'int' || form.dataType === 'float'
  return {
    enabled: true,
    mode: io.archive,
    intervalMs: clampMs(io.historyIntervalMs),
    deadband: numeric ? Math.max(0, Number(io.deadband) || 0) : 0,
  }
}

function displayValue(row: { meta: TagMeta; value?: TagValue }) {
  const value = row.value?.value
  if (value == null) return '-'
  if (row.meta.dataType === 'bool') return formatBoolText(value, row.meta) ?? String(value)
  return String(value)
}

function simulationPayload(): TagSimulation | undefined {
  if (formDeviceProtocol.value !== 'mock') return undefined
  const numeric = form.dataType === 'int' || form.dataType === 'float'
  const period = Number(sim.periodSec)
  return {
    enabled: sim.enabled,
    mode: sim.mode,
    periodSec: Number.isFinite(period) ? Math.min(3600, Math.max(1, period)) : 1,
    min: numeric && sim.min != null ? Number(sim.min) : undefined,
    max: numeric && sim.max != null ? Number(sim.max) : undefined,
    step: numeric && sim.step != null ? Number(sim.step) : undefined,
    options: form.dataType === 'string' ? sim.options.trim() || undefined : undefined,
  }
}

function openCreate() {
  if (!devices.items.length) {
    ElMessage.warning('请先创建设备，变量必须绑定设备')
    mainTab.value = 'devices'
    return
  }
  editingId.value = null
  form.tagId = generateTagId()
  form.name = ''
  form.group = groupFilter.value.startsWith('__') ? '' : groupFilter.value
  form.dataType = 'float'
  form.unit = ''
  form.writable = false
  form.deviceId = devices.enabledItems[0]?.deviceId || devices.items[0]?.deviceId || ''
  form.description = ''
  applyTagAddr(formDeviceProtocol.value, undefined)
  loadSimForm(null)
  loadIoForm(null)
  editorTab.value = 'basic'
  alarmItems.value = []
  resetAlarmForm()
  editorOpen.value = true
}

function openEdit(meta: TagMeta) {
  editingId.value = meta.tagId
  form.tagId = meta.tagId
  form.name = meta.name
  form.group = meta.group || ''
  form.dataType = meta.dataType
  form.unit = meta.unit || ''
  form.writable = meta.writable
  form.deviceId = meta.deviceId || devices.enabledItems[0]?.deviceId || devices.items[0]?.deviceId || ''
  form.description = meta.description || ''
  applyTagAddr(
    devices.getById(form.deviceId)?.protocol ?? 'other',
    meta.address,
  )
  loadSimForm(meta.simulation)
  loadIoForm(meta)
  editorTab.value = 'basic'
  resetAlarmForm()
  editorOpen.value = true
  void loadAlarms()
}

async function saveEditor() {
  if (!editingId.value && !form.tagId.trim()) {
    form.tagId = generateTagId()
  }
  if (!form.tagId.trim() || !form.name.trim()) {
    ElMessage.warning('名称必填')
    return
  }
  if (!form.deviceId.trim()) {
    ElMessage.warning('必须绑定设备')
    return
  }
  saving.value = true
  try {
    const payload: TagMeta = {
      tagId: form.tagId.trim(),
      name: form.name.trim(),
      group: (form.group ?? '').trim() || undefined,
      dataType: form.dataType,
      unit: form.unit.trim() || undefined,
      writable: form.writable,
      deviceId: form.deviceId.trim(),
      address: formatTagAddress(formDeviceProtocol.value, tagAddr),
      description: form.description.trim() || undefined,
      simulation: simulationPayload(),
      onText: form.dataType === 'bool' ? io.onText.trim() : '',
      offText: form.dataType === 'bool' ? io.offText.trim() : '',
      scanPeriodMs: clampMs(io.scanPeriodMs),
      pushEnabled: io.pushEnabled,
      pushPeriodMs: clampMs(io.pushPeriodMs),
      history: historyPayload(),
    }
    if (editingId.value) {
      await tags.updateTag(editingId.value, payload)
      ElMessage.success('已更新变量')
    } else {
      await tags.createTag(payload)
      ElMessage.success('已新建变量')
    }
    editorOpen.value = false
  } catch (err) {
    const body =
      err && typeof err === 'object' && 'body' in err
        ? (err as { body?: { error?: string } }).body
        : undefined
    if (body?.error === 'device_id_required') ElMessage.error('必须绑定设备')
    else if (body?.error === 'device_not_found') ElMessage.error('所选设备不存在')
    else ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(tagId: string) {
  try {
    await tags.removeTag(tagId)
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

function openCreateDevice() {
  editingDeviceId.value = null
  deviceForm.deviceId = generateDeviceId()
  deviceForm.name = ''
  deviceForm.protocol = 'mock'
  deviceForm.enabled = true
  deviceForm.description = ''
  applyConnFromChannel('mock', undefined)
  deviceEditorOpen.value = true
}

function openEditDevice(meta: DeviceMeta) {
  editingDeviceId.value = meta.deviceId
  deviceForm.deviceId = meta.deviceId
  deviceForm.name = meta.name
  deviceForm.protocol = meta.protocol
  deviceForm.enabled = meta.enabled
  deviceForm.description = meta.description || ''
  applyConnFromChannel(meta.protocol, meta.channel)
  deviceEditorOpen.value = true
}

async function saveDeviceEditor() {
  if (!deviceForm.name.trim()) {
    ElMessage.warning('名称必填')
    return
  }
  if (!editingDeviceId.value && !deviceForm.deviceId.trim()) {
    deviceForm.deviceId = generateDeviceId()
  }
  saving.value = true
  try {
    const payload: DeviceMeta = {
      deviceId: deviceForm.deviceId.trim(),
      name: deviceForm.name.trim(),
      protocol: deviceForm.protocol,
      channel: formatDeviceChannel(deviceForm.protocol, deviceConn),
      enabled: deviceForm.enabled,
      description: deviceForm.description.trim() || undefined,
    }
    if (editingDeviceId.value) {
      await devices.updateDevice(editingDeviceId.value, payload)
      ElMessage.success('已更新设备')
    } else {
      await devices.createDevice(payload)
      ElMessage.success('已新建设备')
    }
    deviceEditorOpen.value = false
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function removeDevice(deviceId: string) {
  const linked = tags.metas.filter((m) => m.deviceId === deviceId).length
  if (linked > 0) {
    ElMessage.warning(`仍有 ${linked} 个变量绑定该设备，请先改绑到其他设备`)
    return
  }
  try {
    await devices.removeDevice(deviceId)
    ElMessage.success('已删除设备')
  } catch {
    ElMessage.error('删除失败')
  }
}

function exportJson() {
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    devices: devices.items,
    tags: tags.metas,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `scada-tags-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 JSON')
}

function exportCsv() {
  const header = [
    'tagId',
    'name',
    'group',
    'dataType',
    'unit',
    'writable',
    'deviceId',
    'address',
    'description',
  ]
  const rows = tags.metas.map((m) =>
    [
      m.tagId,
      m.name,
      m.group ?? '',
      m.dataType,
      m.unit ?? '',
      m.writable ? '1' : '0',
      m.deviceId,
      m.address ?? '',
      (m.description ?? '').replace(/\r?\n/g, ' '),
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(','),
  )
  const csv = `\uFEFF${header.join(',')}\n${rows.join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `scada-tags-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 CSV')
}

function triggerImport() {
  importInput.value?.click()
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

async function importFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const text = await file.text()
  let tagList: TagMeta[] = []
  let deviceList: DeviceMeta[] = []

  try {
    if (file.name.toLowerCase().endsWith('.csv')) {
      const lines = text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      if (lines.length < 2) throw new Error('empty_csv')
      const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
      const idx = (name: string) => header.indexOf(name)
      for (const line of lines.slice(1)) {
        const cells = parseCsvLine(line)
        const tagId = cells[idx('tagid')]?.trim()
        const name = cells[idx('name')]?.trim()
        const deviceId = cells[idx('deviceid')]?.trim()
        if (!tagId || !name || !deviceId) continue
        const dataType = (cells[idx('datatype')]?.trim() || 'float') as TagMeta['dataType']
        tagList.push({
          tagId,
          name,
          group: cells[idx('group')]?.trim() || undefined,
          dataType: ['bool', 'int', 'float', 'string'].includes(dataType) ? dataType : 'float',
          unit: cells[idx('unit')]?.trim() || undefined,
          writable: ['1', 'true', 'yes', '读写'].includes(
            (cells[idx('writable')] || '').trim().toLowerCase(),
          ),
          deviceId,
          address: cells[idx('address')]?.trim() || undefined,
          description: cells[idx('description')]?.trim() || undefined,
        })
      }
    } else {
      const json = JSON.parse(text) as {
        tags?: TagMeta[]
        devices?: DeviceMeta[]
      }
      tagList = Array.isArray(json.tags) ? json.tags : Array.isArray(json) ? (json as TagMeta[]) : []
      deviceList = Array.isArray(json.devices) ? json.devices : []
    }
  } catch {
    ElMessage.error('文件解析失败，请使用导出的 JSON/CSV')
    return
  }

  if (!tagList.length && !deviceList.length) {
    ElMessage.warning('文件中没有可导入项')
    return
  }

  saving.value = true
  let ok = 0
  let fail = 0
  try {
    for (const d of deviceList) {
      if (!d.deviceId || !d.name) continue
      try {
        const existing = devices.getById(d.deviceId)
        if (existing) await devices.updateDevice(d.deviceId, d)
        else await devices.createDevice({ ...d, enabled: d.enabled !== false, protocol: d.protocol || 'mock' })
        ok += 1
      } catch {
        fail += 1
      }
    }
    for (const t of tagList) {
      if (!t.tagId || !t.name || !t.dataType || !t.deviceId?.trim()) {
        fail += 1
        continue
      }
      try {
        const existing = tags.metas.find((m) => m.tagId === t.tagId)
        if (existing) await tags.updateTag(t.tagId, t)
        else await tags.createTag(t)
        ok += 1
      } catch {
        fail += 1
      }
    }
    await refresh()
    ElMessage[fail ? 'warning' : 'success'](`导入完成：成功 ${ok}，失败 ${fail}`)
  } finally {
    saving.value = false
  }
}

const alarmItems = ref<TagAlarmConfig[]>([])
const alarmSaving = ref(false)
const editingAlarmId = ref<string | null>(null)
type AlarmMode = 'on' | 'off' | 'limit' | 'target' | 'rate' | 'match' | 'mismatch' | 'quality'

const alarmForm = reactive({
  name: '',
  enabled: true,
  level: 'alarm' as AlarmLevel,
  mode: 'limit' as AlarmMode,
  limit: 'H' as AlarmLimitCode,
  threshold: 0,
  deadband: 0,
  target: 0,
  windowSec: 10,
  expectText: '',
  quality: 'Bad' as 'Bad' | 'Offline',
  delaySec: 0,
})

const alarmDataType = computed(() => {
  if (!editingId.value) return form.dataType
  return tags.metas.find((m) => m.tagId === editingId.value)?.dataType ?? form.dataType
})

const alarmKindOptions = computed(() => {
  const dt = alarmDataType.value
  if (dt === 'bool') {
    return [
      { value: 'on' as const, label: '开报警' },
      { value: 'off' as const, label: '关报警' },
      { value: 'quality' as const, label: '质量' },
    ]
  }
  if (dt === 'int' || dt === 'float') {
    return [
      { value: 'limit' as const, label: '上下限报警' },
      { value: 'target' as const, label: '目标报警' },
      { value: 'rate' as const, label: '变化率报警' },
      { value: 'quality' as const, label: '质量' },
    ]
  }
  return [
    { value: 'match' as const, label: '匹配报警' },
    { value: 'mismatch' as const, label: '失配报警' },
    { value: 'quality' as const, label: '质量' },
  ]
})

const alarmHighGrade = computed(() =>
  alarmForm.mode === 'on' ||
  alarmForm.mode === 'off' ||
  alarmForm.mode === 'target' ||
  alarmForm.mode === 'rate' ||
  alarmForm.mode === 'match' ||
  alarmForm.mode === 'mismatch',
)

function resetAlarmForm() {
  const first = alarmKindOptions.value[0]?.value ?? 'quality'
  alarmForm.name = ''
  alarmForm.enabled = true
  alarmForm.level = 'alarm'
  alarmForm.mode = first
  alarmForm.limit = 'H'
  alarmForm.threshold = 0
  alarmForm.deadband = 0
  alarmForm.target = 0
  alarmForm.windowSec = 10
  alarmForm.expectText = ''
  alarmForm.quality = 'Bad'
  alarmForm.delaySec = 0
  editingAlarmId.value = null
}

function onAlarmMode(mode: AlarmMode) {
  alarmForm.mode = mode
  if (mode !== 'limit' && (alarmForm.limit === 'L' || alarmForm.limit === 'LL')) {
    alarmForm.limit = 'H'
  }
}

function modeOf(row: TagAlarmConfig): AlarmMode {
  if (row.kind === 'bool') return row.boolValue === false ? 'off' : 'on'
  if (row.kind === 'target' || row.kind === 'rate' || row.kind === 'match' || row.kind === 'mismatch' || row.kind === 'quality' || row.kind === 'limit') {
    return row.kind
  }
  return 'quality'
}

async function loadAlarms() {
  if (!editingId.value || tags.mode !== 'live') {
    alarmItems.value = []
    return
  }
  try {
    alarmItems.value = (await apiListAlarms(editingId.value)).items ?? []
  } catch {
    alarmItems.value = []
    ElMessage.error('读取报警失败')
  }
}

function editAlarm(row: TagAlarmConfig) {
  editingAlarmId.value = row.alarmId
  alarmForm.name = row.name
  alarmForm.enabled = row.enabled
  alarmForm.level = row.level
  alarmForm.mode = modeOf(row)
  alarmForm.limit = row.limit === 'HH' || row.limit === 'H' || row.limit === 'L' || row.limit === 'LL' ? row.limit : 'H'
  alarmForm.threshold = row.threshold ?? 0
  alarmForm.deadband = row.deadband ?? 0
  alarmForm.target = row.target ?? 0
  alarmForm.windowSec = row.windowSec ?? 10
  alarmForm.expectText = row.expectText ?? ''
  alarmForm.quality = row.quality ?? 'Bad'
  alarmForm.delaySec = row.delaySec ?? 0
}

function gradeLabel(code?: string) {
  if (code === 'HH') return '高高'
  if (code === 'H') return '高'
  if (code === 'L') return '低'
  if (code === 'LL') return '低低'
  return '高'
}

function alarmDetail(row: TagAlarmConfig): string {
  const grade = gradeLabel(row.limit)
  if (row.kind === 'limit') return `上下限 ${grade} ${row.threshold ?? ''} 死区 ${row.deadband ?? 0}`
  if (row.kind === 'bool') return `${row.boolValue === false ? '关报警' : '开报警'} ${grade}`
  if (row.kind === 'target') return `目标 ${row.target ?? ''} ±${row.threshold ?? ''} ${grade}`
  if (row.kind === 'rate') return `${row.windowSec ?? ''}秒变化 ${row.threshold ?? ''} ${grade}`
  if (row.kind === 'match') return `匹配「${row.expectText ?? ''}」${grade}`
  if (row.kind === 'mismatch') return `失配「${row.expectText ?? ''}」${grade}`
  return `质量 ${row.quality ?? ''}`
}

function alarmLevelLabel(level: AlarmLevel): string {
  if (level === 'info') return '提示'
  if (level === 'fault') return '故障'
  return '报警'
}

function alarmErrorText(err: unknown): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const code = (err.body as { error?: string }).error
    if (code === 'alarm_exists') return '同一种报警已经存在'
    if (code === 'alarm_type_mismatch') return '报警类型和变量类型不一致'
    if (code === 'tag_not_found') return '变量不存在'
  }
  return '保存报警失败'
}

async function saveAlarm() {
  if (!editingId.value) return
  const name = alarmForm.name.trim()
  if (!name) {
    ElMessage.warning('请填写报警名称')
    return
  }
  const num = (value: number) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    return alarmDataType.value === 'int' ? Math.round(n) : n
  }
  const grade: AlarmLimitCode = alarmForm.limit === 'L' || alarmForm.limit === 'LL' ? 'H' : alarmForm.limit
  const body: TagAlarmConfig = {
    alarmId: editingAlarmId.value ?? '',
    tagId: editingId.value,
    name,
    enabled: alarmForm.enabled,
    level: alarmForm.level,
    kind: 'quality',
    delaySec: Number(alarmForm.delaySec) || 0,
  }
  if (alarmForm.mode === 'on' || alarmForm.mode === 'off') {
    body.kind = 'bool'
    body.boolValue = alarmForm.mode === 'on'
    body.limit = grade === 'HH' ? 'HH' : 'H'
  } else if (alarmForm.mode === 'limit') {
    body.kind = 'limit'
    body.limit = alarmForm.limit
    body.threshold = num(alarmForm.threshold)
    body.deadband = Math.max(0, num(alarmForm.deadband))
  } else if (alarmForm.mode === 'target') {
    body.kind = 'target'
    body.limit = grade === 'HH' ? 'HH' : 'H'
    body.target = num(alarmForm.target)
    body.threshold = Math.max(0, num(alarmForm.threshold))
    body.deadband = Math.max(0, num(alarmForm.deadband))
  } else if (alarmForm.mode === 'rate') {
    body.kind = 'rate'
    body.limit = grade === 'HH' ? 'HH' : 'H'
    body.threshold = Math.max(0, num(alarmForm.threshold))
    body.deadband = Math.max(0, num(alarmForm.deadband))
    body.windowSec = Math.min(86400, Math.max(1, Number(alarmForm.windowSec) || 1))
  } else if (alarmForm.mode === 'match' || alarmForm.mode === 'mismatch') {
    body.kind = alarmForm.mode
    body.limit = grade === 'HH' ? 'HH' : 'H'
    body.expectText = alarmForm.expectText
  } else {
    body.kind = 'quality'
    body.quality = alarmForm.quality
  }
  alarmSaving.value = true
  try {
    if (editingAlarmId.value) await apiUpdateAlarm(editingAlarmId.value, { ...body, alarmId: editingAlarmId.value })
    else await apiCreateAlarm(body)
    ElMessage.success('已保存报警')
    resetAlarmForm()
    await loadAlarms()
  } catch (err) {
    ElMessage.error(alarmErrorText(err))
  } finally {
    alarmSaving.value = false
  }
}

async function removeAlarm(alarmId: string) {
  try {
    await apiDeleteAlarm(alarmId)
    if (editingAlarmId.value === alarmId) resetAlarmForm()
    await loadAlarms()
  } catch {
    ElMessage.error('删除报警失败')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="变量 / 设备"
    width="980px"
    align-center
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-tabs v-model="mainTab">
      <el-tab-pane label="变量表" name="tags">
        <div class="toolbar">
          <el-tag size="small" :type="tags.mode === 'live' ? 'success' : 'warning'">
            {{ tags.mode === 'live' ? '服务端' : '本地 Mock' }}
          </el-tag>
          <el-tag size="small" :type="tags.connected ? 'success' : 'info'">
            WS {{ tags.connected ? '已连接' : '未连接' }}
          </el-tag>
          <el-select v-model="groupFilter" size="small" style="width: 140px" placeholder="分组">
            <el-option label="全部分组" value="__all__" />
            <el-option label="未分组" value="__none__" />
            <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
          </el-select>
          <div class="spacer" />
          <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
          <el-button size="small" @click="exportCsv">导出 CSV</el-button>
          <el-button size="small" @click="exportJson">导出 JSON</el-button>
          <el-button size="small" :loading="saving" @click="triggerImport">导入</el-button>
          <el-button size="small" type="primary" @click="openCreate">新建变量</el-button>
          <input
            ref="importInput"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            class="hidden-file"
            @change="importFile"
          />
        </div>

        <el-table v-loading="loading" :data="filteredTags" height="400" size="small">
          <el-table-column label="分组" width="90">
            <template #default="{ row }">{{ row.meta.group || '-' }}</template>
          </el-table-column>
          <el-table-column prop="meta.name" label="名称" min-width="90" />
          <el-table-column prop="meta.dataType" label="类型" width="70" />
          <el-table-column label="设备" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">{{ deviceName(row.meta.deviceId) }}</template>
          </el-table-column>
          <el-table-column label="地址" min-width="90" show-overflow-tooltip>
            <template #default="{ row }">{{ row.meta.address || '-' }}</template>
          </el-table-column>
          <el-table-column label="当前值" min-width="100">
            <template #default="{ row }">
              <span class="val">{{ displayValue(row) }}</span>
              <span v-if="row.meta.unit" class="unit">{{ row.meta.unit }}</span>
            </template>
          </el-table-column>
          <el-table-column label="质量" width="96">
            <template #default="{ row }">
              <el-tag
                v-if="devices.getById(row.meta.deviceId)?.protocol !== 'mcd4000'"
                size="small"
                :type="qualityTagType(row.value?.quality)"
              >
                {{ row.value?.quality || '-' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="读写" width="64">
            <template #default="{ row }">
              <el-tag size="small" :type="row.meta.writable ? 'warning' : 'info'" effect="plain">
                {{ row.meta.writable ? '读写' : '只读' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openEdit(row.meta)">编辑</el-button>
              <el-button size="small" text type="danger" @click="remove(row.meta.tagId)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="设备通道" name="devices">
        <div class="toolbar">
          <el-tag size="small" :type="devices.mode === 'live' ? 'success' : 'warning'">
            {{ devices.mode === 'live' ? '服务端' : '本地 Mock' }}
          </el-tag>
          <span class="hint">设备元数据存 MySQL；真采集协议对接见后续 IO 阶段</span>
          <div class="spacer" />
          <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
          <el-button size="small" type="primary" @click="openCreateDevice">新建设备</el-button>
        </div>
        <el-table v-loading="loading" :data="devices.items" height="400" size="small">
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column prop="deviceId" label="设备 ID" min-width="120" show-overflow-tooltip />
          <el-table-column label="协议" width="150">
            <template #default="{ row }">{{ protocolLabel(row.protocol) }}</template>
          </el-table-column>
          <el-table-column prop="channel" label="通道" min-width="140" show-overflow-tooltip />
          <el-table-column label="启用" width="70">
            <template #default="{ row }">{{ row.enabled ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openEditDevice(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="removeDevice(row.deviceId)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button type="primary" @click="close">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="editorOpen"
    :title="editingId ? '编辑变量' : '新建变量'"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
  >
    <el-tabs v-model="editorTab">
      <el-tab-pane label="基本" name="basic">
    <div class="form">
      <label>
        <span>名称</span>
        <el-input v-model="form.name" />
      </label>
      <label>
        <span>分组</span>
        <el-select
          v-model="form.group"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择已有分组，或输入新建"
        >
          <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
        </el-select>
      </label>
      <label>
        <span>类型</span>
        <el-select v-model="form.dataType" @change="onSimTypeChange">
          <el-option label="bool" value="bool" />
          <el-option label="int" value="int" />
          <el-option label="float" value="float" />
          <el-option label="string" value="string" />
        </el-select>
      </label>
      <label>
        <span>单位</span>
        <el-input v-model="form.unit" placeholder="可选" />
      </label>
      <label class="wide">
        <span class="cfg-label">
          设备（必填）
          <HelpTip content="变量地址格式随设备协议变化；换设备会重置地址表单。" />
        </span>
        <el-select
          filterable
          placeholder="请选择所属设备"
          :model-value="form.deviceId"
          @update:model-value="(v: string) => onTagDeviceChange(v)"
        >
          <el-option
            v-for="d in devices.items"
            :key="d.deviceId"
            :label="`${d.name} · ${protocolLabel(d.protocol)}${d.enabled ? '' : ' · 停用'}`"
            :value="d.deviceId"
          />
        </el-select>
      </label>

      <!-- Mock -->
      <template v-if="formDeviceProtocol === 'mock'">
        <label class="wide">
          <span class="cfg-label">
            模拟键
            <HelpTip content="可选备注名；Mock 设备不依赖真实点位地址。" />
          </span>
          <el-input v-model="tagAddr.raw" placeholder="可选，如 level / pump_run" />
        </label>
      </template>

      <!-- Modbus TCP -->
      <template v-else-if="formDeviceProtocol === 'modbus_tcp'">
        <label>
          <span class="cfg-label">
            寄存器区
            <HelpTip content="线圈/离散输入/输入寄存器/保持寄存器。" />
          </span>
          <el-select v-model="tagAddr.mbArea">
            <el-option
              v-for="a in MODBUS_AREA_OPTIONS"
              :key="a.value"
              :label="a.label"
              :value="a.value"
            />
          </el-select>
        </label>
        <label>
          <span class="cfg-label">
            偏移地址
            <HelpTip content="从 0 起的偏移；保存为 holding:0 这类格式。" />
          </span>
          <el-input v-model="tagAddr.mbOffset" placeholder="如 0 / 8" />
        </label>
      </template>

      <!-- OPC UA -->
      <template v-else-if="formDeviceProtocol === 'opcua'">
        <label class="wide">
          <span class="cfg-label">
            NodeId
            <HelpTip content="OPC UA 节点，如 ns=2;s=Tank.Level 或 i=2258。" />
          </span>
          <el-input v-model="tagAddr.nodeId" placeholder="ns=2;s=Tank.Level" />
        </label>
      </template>

      <!-- MQTT -->
      <template v-else-if="formDeviceProtocol === 'mqtt'">
        <label class="wide">
          <span class="cfg-label">
            Topic
            <HelpTip content="本变量对应的 MQTT 主题；可与设备级 Topic 组合（由后续 IO 解释）。" />
          </span>
          <el-input v-model="tagAddr.topic" placeholder="plant/line1/level" />
        </label>
      </template>

      <!-- HTTP -->
      <template v-else-if="formDeviceProtocol === 'http'">
        <label class="wide">
          <span class="cfg-label">
            路径 / JSON Path
            <HelpTip content="相对 Base URL 的路径，或响应体取值路径，如 /tags/level、$.data.value。" />
          </span>
          <el-input v-model="tagAddr.path" placeholder="/tags/level 或 $.data.value" />
        </label>
      </template>

      <!-- MCD4000：Sensor + Field → API Sensors/Fields -->
      <template v-else-if="formDeviceProtocol === 'mcd4000'">
        <label>
          <span class="cfg-label">
            Sensor
            <HelpTip content="请求体 Sensors 数组项，如 Motor_CE_X、001、dev1。" />
          </span>
          <el-input v-model="tagAddr.sensor" placeholder="Motor_CE_X" />
        </label>
        <label>
          <span class="cfg-label">
            Field
            <HelpTip content="请求体 Fields 数组项，如 p_1X、wave、TISA6116实时值。" />
          </span>
          <el-input v-model="tagAddr.field" placeholder="p_1X" />
        </label>
      </template>

      <!-- 其他 -->
      <template v-else>
        <label class="wide">
          <span class="cfg-label">
            地址
            <HelpTip content="自定义协议点位地址，原样保存。" />
          </span>
          <el-input v-model="tagAddr.raw" placeholder="自定义点位地址" />
        </label>
      </template>

      <label class="wide">
        <span>描述</span>
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </label>
      <label class="wide check-row">
        <span>读写</span>
        <el-checkbox v-model="form.writable">可写（允许运行端写值）</el-checkbox>
      </label>
      <template v-if="form.dataType === 'bool'">
        <label>
          <span class="cfg-label">
            ON 文本
            <HelpTip content="只改画面和报警条文里的文字，不改变 true/false。动画和写值仍用布尔值。留空则显示 true。" />
          </span>
          <el-input v-model="io.onText" placeholder="true" maxlength="64" />
        </label>
        <label>
          <span class="cfg-label">
            OFF 文本
            <HelpTip content="为 false 时显示的文字。留空则显示 false。" />
          </span>
          <el-input v-model="io.offText" placeholder="false" maxlength="64" />
        </label>
      </template>
      <label>
        <span class="cfg-label">
          扫描周期（毫秒）
          <HelpTip content="模拟设备两次采样的最小间隔。仿真周期更长时，仍按仿真周期变化。其它协议先只保存，采集仍用设备自己的轮询。" />
        </span>
        <el-input-number v-model="io.scanPeriodMs" :min="200" :max="86400000" :step="100" controls-position="right" />
      </label>
      <label class="wide check-row">
        <span class="cfg-label">
          推送
          <HelpTip content="关闭时值一变就推给画面。打开后，在周期内只推最后一次。报警仍按采样立刻判断。" />
        </span>
        <el-checkbox v-model="io.pushEnabled">按周期合并推送</el-checkbox>
      </label>
      <label v-if="io.pushEnabled">
        <span>推送周期（毫秒）</span>
        <el-input-number v-model="io.pushPeriodMs" :min="200" :max="86400000" :step="100" controls-position="right" />
      </label>
    </div>
      </el-tab-pane>
      <el-tab-pane v-if="formDeviceProtocol === 'mock'" label="模拟" name="sim">
        <div class="form">
          <label class="wide check-row">
            <span class="cfg-label">
              启用
              <HelpTip content="关闭后保持当前值。可写变量默认关闭，避免盖掉运行端写入。" />
            </span>
            <el-checkbox v-model="sim.enabled">按类型自动变化</el-checkbox>
          </label>
          <label>
            <span>仿真类型</span>
            <el-select v-model="sim.mode">
              <el-option
                v-for="opt in simModeOptions(form.dataType)"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </label>
          <label>
            <span>{{ sim.mode === 'sine' ? '波形周期（秒）' : '周期（秒）' }}</span>
            <el-input-number v-model="sim.periodSec" :min="1" :max="3600" :step="1" controls-position="right" />
          </label>
          <template v-if="form.dataType === 'int' || form.dataType === 'float'">
            <label>
              <span>下限</span>
              <el-input-number v-model="sim.min" :value-on-clear="null" controls-position="right" />
            </label>
            <label>
              <span>上限</span>
              <el-input-number v-model="sim.max" :value-on-clear="null" controls-position="right" />
            </label>
            <label v-if="sim.mode === 'walk' || sim.mode === 'ramp'">
              <span>{{ sim.mode === 'ramp' || form.dataType === 'int' ? '步进' : '幅度' }}</span>
              <el-input-number v-model="sim.step" :min="0" controls-position="right" />
            </label>
          </template>
          <label v-else-if="form.dataType === 'string'" class="wide">
            <span class="cfg-label">
              候选值
              <HelpTip content="一行一个。顺序轮换时每个周期切到下一条，随机则从中抽一条。" />
            </span>
            <el-input v-model="sim.options" type="textarea" :rows="3" placeholder="待机&#10;运行&#10;停止" />
          </label>
        </div>
      </el-tab-pane>
      <el-tab-pane label="报警" name="alarm">
        <p v-if="!editingId" class="hint">先保存变量，再配置报警。</p>
        <p v-else-if="tags.mode !== 'live'" class="hint">报警配置需要连接服务端。</p>
        <template v-else>
          <p v-if="form.dataType !== alarmDataType" class="hint">
            变量类型已改，请先在「基本」里保存，报警仍按已保存的类型配置。
          </p>
          <el-table :data="alarmItems" size="small" empty-text="还没有报警" max-height="180">
            <el-table-column prop="name" label="名称" min-width="100" />
            <el-table-column label="级别" width="72">
              <template #default="{ row }">{{ alarmLevelLabel(row.level) }}</template>
            </el-table-column>
            <el-table-column label="条件" min-width="140">
              <template #default="{ row }">{{ alarmDetail(row) }}</template>
            </el-table-column>
            <el-table-column label="延时" width="72">
              <template #default="{ row }">{{ row.delaySec }}s</template>
            </el-table-column>
            <el-table-column label="启用" width="64">
              <template #default="{ row }">{{ row.enabled ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="editAlarm(row)">编辑</el-button>
                <el-button size="small" text type="danger" @click="removeAlarm(row.alarmId)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="form alarm-form">
            <label>
              <span>名称</span>
              <el-input v-model="alarmForm.name" placeholder="如 液位偏高" />
            </label>
            <label>
              <span>级别</span>
              <el-select v-model="alarmForm.level">
                <el-option label="提示" value="info" />
                <el-option label="报警" value="alarm" />
                <el-option label="故障" value="fault" />
              </el-select>
            </label>
            <label>
              <span>种类</span>
              <el-select v-model="alarmForm.mode" @change="onAlarmMode">
                <el-option v-for="opt in alarmKindOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </label>
            <label>
              <span>延时（秒）</span>
              <el-input-number v-model="alarmForm.delaySec" :min="0" :max="86400" :step="1" controls-position="right" />
            </label>
            <label v-if="alarmHighGrade">
              <span class="cfg-label">
                档位
                <HelpTip content="高和高高可以各配一条。布尔和字符串没有低、低低。" />
              </span>
              <el-select v-model="alarmForm.limit">
                <el-option label="高高" value="HH" />
                <el-option label="高" value="H" />
              </el-select>
            </label>
            <template v-if="alarmForm.mode === 'limit'">
              <label>
                <span>限值</span>
                <el-select v-model="alarmForm.limit">
                  <el-option label="高高" value="HH" />
                  <el-option label="高" value="H" />
                  <el-option label="低" value="L" />
                  <el-option label="低低" value="LL" />
                </el-select>
              </label>
              <label>
                <span>阈值</span>
                <el-input-number v-model="alarmForm.threshold" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
              <label>
                <span>死区</span>
                <el-input-number v-model="alarmForm.deadband" :min="0" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
            </template>
            <template v-else-if="alarmForm.mode === 'target'">
              <label>
                <span>目标值</span>
                <el-input-number v-model="alarmForm.target" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
              <label>
                <span class="cfg-label">
                  允许偏差
                  <HelpTip content="偏离目标超过这个范围就报警。" />
                </span>
                <el-input-number v-model="alarmForm.threshold" :min="0" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
              <label>
                <span>死区</span>
                <el-input-number v-model="alarmForm.deadband" :min="0" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
            </template>
            <template v-else-if="alarmForm.mode === 'rate'">
              <label>
                <span>时间（秒）</span>
                <el-input-number v-model="alarmForm.windowSec" :min="1" :max="86400" :step="1" controls-position="right" />
              </label>
              <label>
                <span class="cfg-label">
                  变化量
                  <HelpTip content="这段时间内变化超过这个量就报警。" />
                </span>
                <el-input-number v-model="alarmForm.threshold" :min="0" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
              <label>
                <span>死区</span>
                <el-input-number v-model="alarmForm.deadband" :min="0" :precision="alarmDataType === 'int' ? 0 : undefined" controls-position="right" />
              </label>
            </template>
            <label v-else-if="alarmForm.mode === 'match' || alarmForm.mode === 'mismatch'" class="wide">
              <span>{{ alarmForm.mode === 'match' ? '等于文本' : '期望文本' }}</span>
              <el-input v-model="alarmForm.expectText" maxlength="255" :placeholder="alarmForm.mode === 'match' ? '等于这段文字时报警' : '不是这段文字时报警'" />
            </label>
            <label v-else-if="alarmForm.mode === 'quality'">
              <span>质量</span>
              <el-select v-model="alarmForm.quality">
                <el-option label="Bad" value="Bad" />
                <el-option label="Offline" value="Offline" />
              </el-select>
            </label>
            <label class="check-row">
              <span>启用</span>
              <el-checkbox v-model="alarmForm.enabled">启用这条报警</el-checkbox>
            </label>
          </div>
          <div class="alarm-actions">
            <el-button @click="resetAlarmForm">清空</el-button>
            <el-button type="primary" :loading="alarmSaving" @click="saveAlarm">
              {{ editingAlarmId ? '保存修改' : '添加' }}
            </el-button>
          </div>
        </template>
      </el-tab-pane>
      <el-tab-pane label="历史" name="history">
        <div class="form">
          <label class="wide">
            <span class="cfg-label">
              存档方式
              <HelpTip content="默认：写值和质量变化记一条，模拟抖动不记。变化存按死区记。周期存按间隔记最后值。关闭后只在质量好坏切换时记一条。" />
            </span>
            <el-select v-model="io.archive">
              <el-option label="默认（写值时记录）" value="legacy" />
              <el-option label="变化存" value="change" />
              <el-option label="周期存" value="interval" />
              <el-option label="关闭" value="off" />
            </el-select>
          </label>
          <label v-if="io.archive === 'interval'">
            <span>存档周期（毫秒）</span>
            <el-input-number v-model="io.historyIntervalMs" :min="200" :max="86400000" :step="100" controls-position="right" />
          </label>
          <label v-if="io.archive === 'change' && (form.dataType === 'int' || form.dataType === 'float')">
            <span class="cfg-label">
              死区
              <HelpTip content="变化量小于死区不记。0 表示数值一变就记。布尔和字符串忽略死区。" />
            </span>
            <el-input-number v-model="io.deadband" :min="0" controls-position="right" />
          </label>
          <p v-if="io.archive === 'legacy'" class="hint">不填配置时沿用现在的记录方式。模拟设备的自动变化不会写入历史。</p>
          <p v-else-if="io.archive === 'off'" class="hint">不再按值变化记历史。质量从好变坏、从坏变好仍会记一条。</p>
          <p v-else-if="io.archive === 'change'" class="hint">值变化达到死区就记一条。布尔和字符串任意变化都记。</p>
          <p v-else class="hint">到点记下当时的值，中间没有变化也会记。</p>
        </div>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button @click="editorOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEditor">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="deviceEditorOpen"
    :title="editingDeviceId ? '编辑设备' : '新建设备'"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="form">
      <label v-if="editingDeviceId">
        <span class="cfg-label">
          设备 ID
          <HelpTip content="创建后不可修改；新建时由系统自动生成。" />
        </span>
        <el-input :model-value="deviceForm.deviceId" disabled />
      </label>
      <label :class="{ wide: !editingDeviceId }">
        <span>名称</span>
        <el-input v-model="deviceForm.name" placeholder="如 演示 PLC" />
      </label>
      <label class="wide">
        <span class="cfg-label">
          协议
          <HelpTip content="Mock / MCD4000 已接运行时取值；Modbus/OPC/MQTT/HTTP 目前仅保存连接元数据。" />
        </span>
        <el-select
          :model-value="deviceForm.protocol"
          @update:model-value="(v: DeviceProtocol) => onProtocolChange(v)"
        >
          <el-option
            v-for="p in protocolOptions"
            :key="p.value"
            :label="p.label"
            :value="p.value"
          />
        </el-select>
      </label>

      <!-- Mock：无需连接 -->
      <el-alert
        v-if="deviceForm.protocol === 'mock'"
        class="wide proto-alert"
        type="info"
        :closable="false"
        show-icon
        title="不用填连接。每个变量在编辑页里配置是否模拟、周期和范围。"
      />

      <!-- Modbus TCP -->
      <template v-else-if="deviceForm.protocol === 'modbus_tcp'">
        <label>
          <span class="cfg-label">
            主机
            <HelpTip content="PLC / 网关 IP 或主机名。" />
          </span>
          <el-input v-model="deviceConn.host" placeholder="127.0.0.1" />
        </label>
        <label>
          <span class="cfg-label">
            端口
            <HelpTip content="Modbus TCP 默认 502。" />
          </span>
          <el-input v-model="deviceConn.port" placeholder="502" />
        </label>
      </template>

      <!-- OPC UA -->
      <template v-else-if="deviceForm.protocol === 'opcua'">
        <label class="wide">
          <span class="cfg-label">
            Endpoint
            <HelpTip content="OPC UA 服务器地址，如 opc.tcp://192.168.1.10:4840。" />
          </span>
          <el-input v-model="deviceConn.endpoint" placeholder="opc.tcp://host:4840" />
        </label>
      </template>

      <!-- MQTT -->
      <template v-else-if="deviceForm.protocol === 'mqtt'">
        <label>
          <span class="cfg-label">
            Broker
            <HelpTip content="MQTT Broker 主机名或 IP。" />
          </span>
          <el-input v-model="deviceConn.host" placeholder="127.0.0.1" />
        </label>
        <label>
          <span class="cfg-label">
            端口
            <HelpTip content="MQTT 默认 1883（TLS 常用 8883）。" />
          </span>
          <el-input v-model="deviceConn.port" placeholder="1883" />
        </label>
        <label class="wide">
          <span class="cfg-label">
            Topic
            <HelpTip content="订阅/发布主题，可含通配符（由后续 IO 解释）。" />
          </span>
          <el-input v-model="deviceConn.topic" placeholder="plant/line1/#" />
        </label>
      </template>

      <!-- HTTP -->
      <template v-else-if="deviceForm.protocol === 'http'">
        <label class="wide">
          <span class="cfg-label">
            Base URL
            <HelpTip content="HTTP API 根地址，如 http://192.168.1.10:8080/api。" />
          </span>
          <el-input v-model="deviceConn.baseUrl" placeholder="http://host:8080/api" />
        </label>
      </template>

      <!-- MCD4000 / 数据中台 -->
      <template v-else-if="deviceForm.protocol === 'mcd4000'">
        <el-alert
          class="wide proto-alert"
          type="success"
          :closable="false"
          show-icon
          title="运行端会按下方参数轮询数据中台最新值；该 API 仅查询，写值不会下发现场。"
        />
        <label class="wide">
          <span class="cfg-label">
            Base URL
            <HelpTip
              content="数据中台根地址（不含具体接口路径），如 http://192.168.1.10:5000。查询走 /api/InfluxdbReadWrite/*。"
            />
          </span>
          <el-input v-model="deviceConn.baseUrl" placeholder="http://host:5000" />
        </label>
        <label>
          <span class="cfg-label">
            DeviceId
            <HelpTip content="4000 序列号（API DeviceId），如 GSN-202507200001。" />
          </span>
          <el-input v-model="deviceConn.mcdDeviceId" placeholder="GSN-202507200001" />
        </label>
        <label>
          <span class="cfg-label">
            UnitId
            <HelpTip content='可为空字符串 ""。PLC/振动请求都会带 UnitId 字段。' />
          </span>
          <el-input v-model="deviceConn.unitId" placeholder='可空，如 ""' />
        </label>
        <label class="wide">
          <span class="cfg-label">
            数据源
            <HelpTip
              content="plc → QueryAllPLCDatas（DeviceId/UnitId/Sensors/Fields/StartTime/FuncName=last）；vib/arm 见文档。"
            />
          </span>
          <el-select v-model="deviceConn.mcdSource">
            <el-option value="vib" label="振动（QueryDataByInterval）" />
            <el-option value="plc" label="PLC（QueryAllPLCDatas）" />
            <el-option value="arm" label="ARM（QueryAllARMDatas）" />
          </el-select>
        </label>
      </template>

      <!-- 其他 -->
      <template v-else>
        <label class="wide">
          <span class="cfg-label">
            连接串
            <HelpTip content="自定义协议的连接信息，原样保存。" />
          </span>
          <el-input v-model="deviceConn.raw" placeholder="自定义连接信息" />
        </label>
      </template>

      <label class="wide">
        <span>描述</span>
        <el-input v-model="deviceForm.description" type="textarea" :rows="2" />
      </label>
      <label class="wide check-row">
        <span>状态</span>
        <el-checkbox v-model="deviceForm.enabled">启用</el-checkbox>
      </label>
    </div>
    <template #footer>
      <el-button @click="deviceEditorOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveDeviceEditor">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 12px;
  color: var(--scada-muted);
}

.val {
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}

.unit {
  margin-left: 4px;
  color: var(--scada-muted);
  font-size: 12px;
}

.form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form > label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--scada-muted);
}

.form > label.wide {
  grid-column: 1 / -1;
}

.alarm-form {
  margin-top: 16px;
}

.alarm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.form > label.check-row :deep(.el-checkbox) {
  display: inline-flex;
  align-items: center;
  height: auto;
  margin-right: 0;
}

.form > label.check-row :deep(.el-checkbox__label) {
  color: var(--scada-text);
}

.cfg-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

.proto-alert {
  grid-column: 1 / -1;
}

.form > .wide,
.form > .proto-alert {
  grid-column: 1 / -1;
}

.hidden-file {
  display: none;
}
</style>
