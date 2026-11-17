<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiListLogs, type AppLogItem } from '@/shared/api/client'
import { ensureOutputLogSync } from '@/stores/outputLog'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const items = ref<AppLogItem[]>([])
const total = ref(0)
const filePath = ref('')
const sources = ref<string[]>([])

const level = ref<'all' | 'info' | 'success' | 'warn' | 'error'>('all')
const source = ref('all')
const range = ref<[Date, Date] | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

const levelLabel: Record<string, string> = {
  info: '信息',
  success: '成功',
  warn: '警告',
  error: '错误',
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

const sourceOptions = computed(() => {
  const set = new Set(sources.value)
  if (source.value !== 'all') set.add(source.value)
  return ['all', ...[...set].filter((s) => s && s !== 'all')]
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const from = range.value?.[0] ? range.value[0].getTime() : undefined
    const to = range.value?.[1] ? range.value[1].getTime() : undefined
    const res = await apiListLogs({
      from,
      to,
      level: level.value === 'all' ? undefined : level.value,
      source: source.value === 'all' ? undefined : source.value,
      limit: 1000,
      offset: 0,
    })
    items.value = res.items || []
    total.value = res.total ?? items.value.length
    if (res.filePath) filePath.value = res.filePath
    if (res.sources?.length) sources.value = res.sources
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载日志失败'
  } finally {
    loading.value = false
  }
}

function goDesigner() {
  void router.push('/designer')
}

onMounted(() => {
  ensureOutputLogSync()
  void load()
  timer = setInterval(() => void load(), 3000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  timer = null
})
</script>

<template>
  <div class="logs-page">
    <header class="head">
      <div class="brand">
        <span class="logo">SCADA</span>
        <h1>日志管理</h1>
      </div>
      <el-button size="small" @click="goDesigner">返回设计端</el-button>
    </header>

    <p class="file-hint">
      日志文件：<code>{{ filePath || '（服务端未连接时无法显示路径）' }}</code>
    </p>

    <section class="filters">
      <el-date-picker
        v-model="range"
        type="datetimerange"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        range-separator="至"
        value-format=""
        :clearable="true"
        style="width: 380px"
        @change="load"
      />
      <el-select v-model="level" style="width: 120px" @change="load">
        <el-option label="全部级别" value="all" />
        <el-option label="信息" value="info" />
        <el-option label="成功" value="success" />
        <el-option label="警告" value="warn" />
        <el-option label="错误" value="error" />
      </el-select>
      <el-select v-model="source" style="width: 160px" filterable @change="load">
        <el-option
          v-for="s in sourceOptions"
          :key="s"
          :label="s === 'all' ? '全部来源' : s"
          :value="s"
        />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">刷新</el-button>
      <span class="count">共 {{ total }} 条</span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="table-wrap">
      <el-table :data="items" height="100%" size="small" stripe empty-text="暂无日志">
        <el-table-column label="时间" width="210">
          <template #default="{ row }">{{ formatTime(row.time) }}</template>
        </el-table-column>
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <span class="lvl" :class="row.level">{{ levelLabel[row.level] || row.level }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="120" />
        <el-table-column prop="message" label="内容" min-width="280" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px 20px 12px;
  box-sizing: border-box;
  background: var(--scada-bg, #0b0d11);
  color: var(--scada-text, #e5e7eb);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.logo {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--scada-accent, #3d8bfd);
}

h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.file-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--scada-muted, #9aa3b2);
}

.file-hint code {
  color: #e5e7eb;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.count {
  font-size: 12px;
  color: var(--scada-muted, #9aa3b2);
}

.error {
  color: #f87171;
  font-size: 13px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
}

.lvl {
  font-weight: 600;
}
.lvl.info {
  color: #e5e7eb;
}
.lvl.success {
  color: #4ade80;
}
.lvl.warn {
  color: #fbbf24;
}
.lvl.error {
  color: #f87171;
}
</style>
