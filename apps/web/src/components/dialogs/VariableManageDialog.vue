<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DeviceMeta, DeviceProtocol, TagMeta } from '@web-scada/core'
import { useTagStore } from '@/stores/tag'
import { useDeviceStore } from '@/stores/device'
import { qualityTagType } from '@/shared/runtime/tagLabel'

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
  address: '',
  description: '',
})

const deviceForm = reactive({
  deviceId: '',
  name: '',
  protocol: 'mock' as DeviceProtocol,
  channel: '',
  enabled: true,
  description: '',
})

const protocolOptions: Array<{ value: DeviceProtocol; label: string }> = [
  { value: 'mock', label: 'Mock（模拟设备）' },
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'opcua', label: 'OPC UA' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'http', label: 'HTTP' },
  { value: 'other', label: '其他' },
]

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
  form.address = ''
  form.description = ''
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
  form.address = meta.address || ''
  form.description = meta.description || ''
  editorOpen.value = true
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
      group: form.group.trim() || undefined,
      dataType: form.dataType,
      unit: form.unit.trim() || undefined,
      writable: form.writable,
      deviceId: form.deviceId.trim(),
      address: form.address.trim() || undefined,
      description: form.description.trim() || undefined,
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
  deviceForm.deviceId = ''
  deviceForm.name = ''
  deviceForm.protocol = 'mock'
  deviceForm.channel = ''
  deviceForm.enabled = true
  deviceForm.description = ''
  deviceEditorOpen.value = true
}

function openEditDevice(meta: DeviceMeta) {
  editingDeviceId.value = meta.deviceId
  deviceForm.deviceId = meta.deviceId
  deviceForm.name = meta.name
  deviceForm.protocol = meta.protocol
  deviceForm.channel = meta.channel || ''
  deviceForm.enabled = meta.enabled
  deviceForm.description = meta.description || ''
  deviceEditorOpen.value = true
}

async function saveDeviceEditor() {
  if (!deviceForm.deviceId.trim() || !deviceForm.name.trim()) {
    ElMessage.warning('设备 ID 与名称必填')
    return
  }
  saving.value = true
  try {
    const payload: DeviceMeta = {
      deviceId: deviceForm.deviceId.trim(),
      name: deviceForm.name.trim(),
      protocol: deviceForm.protocol,
      channel: deviceForm.channel.trim() || undefined,
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

        <el-table v-loading="loading" :data="filteredTags" stripe height="400" size="small">
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
              <span class="val">{{ row.value?.value }}</span>
              <span v-if="row.meta.unit" class="unit">{{ row.meta.unit }}</span>
            </template>
          </el-table-column>
          <el-table-column label="质量" width="96">
            <template #default="{ row }">
              <el-tag size="small" :type="qualityTagType(row.value?.quality)">
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
        <el-table v-loading="loading" :data="devices.items" stripe height="400" size="small">
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
    width="560px"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="form">
      <label>
        <span>名称</span>
        <el-input v-model="form.name" />
      </label>
      <label>
        <span>分组</span>
        <el-input v-model="form.group" placeholder="如 工艺 / 设备" list="tag-group-suggest" />
        <datalist id="tag-group-suggest">
          <option v-for="g in groupOptions" :key="g" :value="g" />
        </datalist>
      </label>
      <label>
        <span>类型</span>
        <el-select v-model="form.dataType">
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
      <label>
        <span>设备（必填）</span>
        <el-select v-model="form.deviceId" filterable placeholder="请选择所属设备">
          <el-option
            v-for="d in devices.items"
            :key="d.deviceId"
            :label="`${d.name} (${d.deviceId})${d.enabled ? '' : ' · 停用'}`"
            :value="d.deviceId"
          />
        </el-select>
      </label>
      <label>
        <span>地址</span>
        <el-input v-model="form.address" placeholder="如 DB1.DBD0 / 40001" />
      </label>
      <label class="wide">
        <span>描述</span>
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </label>
      <div class="rw-row">
        <el-checkbox v-model="form.writable">可写（允许运行端写值）</el-checkbox>
        <el-tag size="small" :type="form.writable ? 'warning' : 'info'" effect="plain">
          {{ form.writable ? '读写' : '只读' }}
        </el-tag>
      </div>
    </div>
    <template #footer>
      <el-button @click="editorOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEditor">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="deviceEditorOpen"
    :title="editingDeviceId ? '编辑设备' : '新建设备'"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="form">
      <label>
        <span>设备 ID</span>
        <el-input
          v-model="deviceForm.deviceId"
          :disabled="Boolean(editingDeviceId)"
          placeholder="如 demo.plc"
        />
      </label>
      <label>
        <span>名称</span>
        <el-input v-model="deviceForm.name" />
      </label>
      <label>
        <span>协议</span>
        <el-select v-model="deviceForm.protocol">
          <el-option
            v-for="p in protocolOptions"
            :key="p.value"
            :label="p.label"
            :value="p.value"
          />
        </el-select>
      </label>
      <label>
        <span>通道</span>
        <el-input v-model="deviceForm.channel" placeholder="host:port / topic / URL" />
      </label>
      <label class="wide">
        <span>描述</span>
        <el-input v-model="deviceForm.description" type="textarea" :rows="2" />
      </label>
      <el-checkbox v-model="deviceForm.enabled">启用</el-checkbox>
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

.form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--scada-muted);
}

.form label.wide {
  grid-column: 1 / -1;
}

.rw-row {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.hidden-file {
  display: none;
}
</style>
