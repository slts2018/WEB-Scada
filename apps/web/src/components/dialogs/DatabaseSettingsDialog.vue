<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  apiGetDatabaseSettings,
  apiSaveDatabaseSettings,
  apiTestDatabaseSettings,
  type DbStatusSnapshot,
} from '@/shared/api/client'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
}>()

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const status = ref<DbStatusSnapshot | null>(null)

const form = reactive({
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'web_scada',
    fallbackToFile: true,
  },
  influx: {
    url: 'http://127.0.0.1:8086',
    token: '',
    org: 'web-scada',
    bucket: 'tags',
    measurement: 'tag_value',
    required: false,
  },
})

const hints = reactive({
  mysqlPassword: '',
  influxToken: '',
})

async function load() {
  loading.value = true
  try {
    const res = await apiGetDatabaseSettings()
    status.value = res.status
    form.mysql.host = res.settings.mysql.host
    form.mysql.port = res.settings.mysql.port
    form.mysql.user = res.settings.mysql.user
    form.mysql.database = res.settings.mysql.database
    form.mysql.fallbackToFile = res.settings.mysql.fallbackToFile
    form.mysql.password = ''
    form.influx.url = res.settings.influx.url
    form.influx.org = res.settings.influx.org
    form.influx.bucket = res.settings.influx.bucket
    form.influx.measurement = res.settings.influx.measurement
    form.influx.required = res.settings.influx.required
    form.influx.token = ''
    hints.mysqlPassword = res.settings.mysql.passwordSet
      ? `已配置（${res.settings.mysql.passwordMasked}），留空则不修改`
      : '尚未配置'
    hints.influxToken = res.settings.influx.tokenSet
      ? `已配置（${res.settings.influx.tokenMasked}），留空则不修改`
      : '尚未配置'
  } catch {
    ElMessage.error('无法读取数据库配置，请确认后端已启动')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
  },
)

function close() {
  emit('update:modelValue', false)
}

function payload() {
  return {
    mysql: {
      host: form.mysql.host.trim(),
      port: Number(form.mysql.port) || 3306,
      user: form.mysql.user.trim(),
      database: form.mysql.database.trim(),
      fallbackToFile: form.mysql.fallbackToFile,
      ...(form.mysql.password ? { password: form.mysql.password } : {}),
    },
    influx: {
      url: form.influx.url.trim(),
      org: form.influx.org.trim(),
      bucket: form.influx.bucket.trim(),
      measurement: form.influx.measurement.trim(),
      required: form.influx.required,
      ...(form.influx.token ? { token: form.influx.token } : {}),
    },
  }
}

async function onTest() {
  testing.value = true
  try {
    const res = await apiTestDatabaseSettings(payload())
    if (res.mysql.ok) ElMessage.success('MySQL 连接成功')
    else ElMessage.error(`MySQL 失败：${res.mysql.error || 'unknown'}`)
    if (res.influx.ok) ElMessage.success('InfluxDB 连接成功')
    else ElMessage.warning(`InfluxDB 失败：${res.influx.error || 'unknown'}`)
  } catch {
    ElMessage.error('测试请求失败')
  } finally {
    testing.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    const res = await apiSaveDatabaseSettings(payload())
    status.value = res.status
    if (res.mysqlOk) ElMessage.success('已保存并重连 MySQL')
    else ElMessage.warning(`MySQL 未就绪：${res.status.mysql.error || 'unknown'}`)
    if (res.influxOk) ElMessage.success('已保存并重连 InfluxDB')
    else ElMessage.warning(`InfluxDB 未就绪：${res.status.influx.error || '未配置'}`)
    await load()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="数据库配置"
    width="720px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="body">
      <div class="status-row">
        <el-tag :type="status?.mysql.ready ? 'success' : 'danger'" size="small">
          MySQL {{ status?.mysql.ready ? '已连接' : '未连接' }}
        </el-tag>
        <el-tag :type="status?.influx.ready ? 'success' : 'warning'" size="small">
          InfluxDB {{ status?.influx.ready ? '已连接' : '未连接' }}
        </el-tag>
        <el-tag size="small" type="info">存储：{{ status?.storage || '-' }}</el-tag>
      </div>

      <el-divider content-position="left">MySQL（配置库）</el-divider>
      <div class="grid">
        <label>
          <span>主机</span>
          <el-input v-model="form.mysql.host" />
        </label>
        <label>
          <span>端口</span>
          <el-input-number v-model="form.mysql.port" :min="1" :max="65535" controls-position="right" />
        </label>
        <label>
          <span>用户</span>
          <el-input v-model="form.mysql.user" />
        </label>
        <label>
          <span>密码</span>
          <el-input
            v-model="form.mysql.password"
            type="password"
            show-password
            :placeholder="hints.mysqlPassword"
          />
        </label>
        <label class="wide">
          <span>数据库</span>
          <el-input v-model="form.mysql.database" />
        </label>
        <label class="wide check">
          <el-checkbox v-model="form.mysql.fallbackToFile">MySQL 不可用时回退本地文件</el-checkbox>
        </label>
      </div>

      <el-divider content-position="left">InfluxDB（时序数据）</el-divider>
      <div class="grid">
        <label class="wide">
          <span>URL</span>
          <el-input v-model="form.influx.url" placeholder="http://127.0.0.1:8086" />
        </label>
        <label class="wide">
          <span>Token</span>
          <el-input
            v-model="form.influx.token"
            type="password"
            show-password
            :placeholder="hints.influxToken"
          />
        </label>
        <label>
          <span>Org</span>
          <el-input v-model="form.influx.org" />
        </label>
        <label>
          <span>Bucket</span>
          <el-input v-model="form.influx.bucket" />
        </label>
        <label>
          <span>Measurement</span>
          <el-input v-model="form.influx.measurement" />
        </label>
        <label class="check">
          <el-checkbox v-model="form.influx.required">启动时强制要求 Influx</el-checkbox>
        </label>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button :loading="testing" @click="onTest">测试连接</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存并重连</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  min-height: 240px
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--scada-muted);
}

label.wide {
  grid-column: 1 / -1;
}

label.check {
  justify-content: end;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>
