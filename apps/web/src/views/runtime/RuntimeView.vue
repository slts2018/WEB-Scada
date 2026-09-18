<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Canvas2DRuntime from '@/components/runtime/Canvas2DRuntime.vue'
import Canvas3DRuntime from '@/components/runtime/Canvas3DRuntime.vue'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { useOutputLogStore } from '@/stores/outputLog'
import {
  loadLatestPublishPackage,
  loadPublishPackage,
  getStorageMode,
} from '@/shared/storage/repository'
import { RUNTIME_BOOT_KEY } from '@/shared/runtime/openRuntime'
import type { Page2D, Page3D } from '@web-scada/core'

const route = useRoute()
const router = useRouter()
const project = useProjectStore()
const tags = useTagStore()
const log = useOutputLogStore()

const ready = ref(false)
const loadError = ref('')
/** 每次成功加载发布包后更新，强制重挂画布（同页编辑后否则会显示旧画面） */
const runtimeRev = ref('')
/** openDialog：以 2D 页面作为对话框画面 */
const dialogPageId = ref<string | null>(null)
/** 运行端 3D 地面网格（由设计端「进入运行」询问传入） */
const showGrid = ref(false)
let bootGen = 0

function readShowGridFromQuery(): boolean {
  const q = route.query.showGrid
  if (typeof q === 'string') return q === '1' || q === 'true'
  return false
}

function syncShowGridFromRoute() {
  showGrid.value = readShowGridFromQuery()
}

const dialogPage = computed(() => {
  if (!dialogPageId.value) return null
  const page = project.document.pages.find((p) => p.id === dialogPageId.value)
  return page?.type === '2d' ? (page as Page2D) : null
})

const active2dPage = computed(() => {
  const page = project.activePage
  return page?.type === '2d' ? (page as Page2D) : null
})
const active3dPage = computed(() => {
  const page = project.activePage
  return page?.type === '3d' ? (page as Page3D) : null
})

function openRuntimeDialog(pageId: string) {
  dialogPageId.value = pageId
}

function closeRuntimeDialog() {
  dialogPageId.value = null
}

/** 只认 URL / 发布包里的真实页面 id，不用加载前空工程的临时 id */
function resolveRuntimePageId(preferred: string | null | undefined): string | null {
  const pages = project.document.pages
  if (!pages.length) return null
  if (preferred && pages.some((p) => p.id === preferred)) return preferred
  const home = project.document.homePageId
  if (home && pages.some((p) => p.id === home)) return home
  const first2d = pages.find((p) => p.type === '2d')
  return first2d?.id ?? pages[0]?.id ?? null
}

function applyPageQuery() {
  const pageId = typeof route.query.page === 'string' ? route.query.page : null
  const resolved = resolveRuntimePageId(pageId)
  if (resolved && project.activePageId !== resolved) project.setActivePage(resolved)
}

function expectedPublishMeta() {
  const v = typeof route.query.v === 'string' ? route.query.v : ''
  const publishedAt = typeof route.query.publishedAt === 'string' ? route.query.publishedAt : ''
  return { v, publishedAt }
}

async function ensurePublished() {
  const gen = ++bootGen
  loadError.value = ''
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  const fromDesigner = from === 'preview' || from === 'designer'
  const projectId =
    (typeof route.query.projectId === 'string' && route.query.projectId) ||
    project.document.meta.id ||
    null
  const queryPageId = typeof route.query.page === 'string' ? route.query.page : null
  const expect = expectedPublishMeta()

  const finish = async (reason: string, name: string, version: string, publishedAt?: number) => {
    if (gen !== bootGen) return
    const keepPageId = resolveRuntimePageId(queryPageId)
    if (keepPageId) project.setActivePage(keepPageId)
    applyPageQuery()
    runtimeRev.value = `${version}:${publishedAt ?? Date.now()}`
    log.success(`${reason} ${name} v${version}`, '运行端')
    await router.replace({
      path: '/runtime',
      query: {
        ...(keepPageId ? { page: keepPageId } : {}),
        ...(projectId ? { projectId } : {}),
        v: version,
        ...(publishedAt ? { publishedAt: String(publishedAt) } : {}),
      },
    })
  }

  const loadByProject = async () => {
    if (!projectId) return null
    return loadPublishPackage(projectId)
  }

  // 设计端打开 / 带版本号 / 有 projectId：拉最新发布包
  if (fromDesigner || expect.v || projectId) {
    let pkg = (await loadByProject()) ?? (await loadLatestPublishPackage())
    if (gen !== bootGen) return
    if (pkg && expect.v && pkg.manifest.publishVersion !== expect.v && fromDesigner) {
      await new Promise((r) => setTimeout(r, 120))
      pkg = (await loadByProject()) ?? pkg
      if (gen !== bootGen) return
    }
    if (pkg) {
      project.loadPublished(pkg)
      await finish(
        '加载发布包',
        pkg.manifest.projectName,
        pkg.manifest.publishVersion,
        pkg.manifest.publishedAt,
      )
      return
    }
  }

  if (project.document.pages.length > 0) {
    const pkg = await project.publish()
    if (gen !== bootGen) return
    await finish(
      '同步当前工程',
      pkg.manifest.projectName,
      pkg.manifest.publishVersion,
      pkg.manifest.publishedAt,
    )
    return
  }

  await project.hydrateFromStorage()
  if (gen !== bootGen) return
  if (project.document.pages.length > 0) {
    if (!project.published || project.dirty) {
      const pkg = await project.publish()
      if (gen !== bootGen) return
      await finish(
        '冷启动同步发布',
        pkg.manifest.projectName,
        pkg.manifest.publishVersion,
        pkg.manifest.publishedAt,
      )
    } else {
      await finish(
        '已加载工程',
        project.published.manifest.projectName,
        project.published.manifest.publishVersion,
        project.published.manifest.publishedAt,
      )
    }
    return
  }

  const remote = await loadLatestPublishPackage()
  if (gen !== bootGen) return
  if (remote) {
    project.loadPublished(remote)
    await finish(
      '加载发布包',
      remote.manifest.projectName,
      remote.manifest.publishVersion,
      remote.manifest.publishedAt,
    )
    return
  }

  loadError.value = '没有可运行的发布包，请先在设计端点击「运行」'
}

function onStorage(e: StorageEvent) {
  if (e.key !== RUNTIME_BOOT_KEY || !e.newValue) return
  try {
    const boot = JSON.parse(e.newValue) as {
      projectId?: string
      publishVersion?: string
      publishedAt?: number
      pageId?: string | null
      showGrid?: boolean
    }
    const q: Record<string, string> = {
      from: 'designer',
      _ts: String(Date.now()),
    }
    if (boot.projectId) q.projectId = boot.projectId
    if (boot.publishVersion) q.v = boot.publishVersion
    if (boot.publishedAt) q.publishedAt = String(boot.publishedAt)
    if (boot.pageId) q.page = boot.pageId
    q.showGrid = boot.showGrid ? '1' : '0'
    void router.replace({ path: '/runtime', query: q }).then(() => ensurePublished())
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  try {
    syncShowGridFromRoute()
    await ensurePublished()
    if (!loadError.value) {
      document.title = `${project.document.meta.name || '运行'} · 运行`
      await tags.hydrateFromServer()
      tags.connectRealtime()
      log.info(
        `存储模式：${getStorageMode() === 'api' ? '服务端' : '本地'}；变量：${tags.mode === 'live' ? '服务端' : 'Mock'}`,
        '运行端',
      )
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '运行端加载失败'
    ElMessage.error(loadError.value)
  } finally {
    ready.value = true
  }
  window.addEventListener('storage', onStorage)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
})

watch(
  () =>
    [
      typeof route.query.page === 'string' ? route.query.page : '',
      typeof route.query.projectId === 'string' ? route.query.projectId : '',
      typeof route.query.from === 'string' ? route.query.from : '',
      typeof route.query.v === 'string' ? route.query.v : '',
      typeof route.query.publishedAt === 'string' ? route.query.publishedAt : '',
      typeof route.query.showGrid === 'string' ? route.query.showGrid : '',
      typeof route.query._ts === 'string' ? route.query._ts : '',
    ] as const,
  async (cur, prev) => {
    if (!ready.value) return
    if (!prev) return
    if (cur.every((v, i) => v === prev[i])) return
    syncShowGridFromRoute()
    try {
      await ensurePublished()
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : '运行端刷新失败'
    }
  },
)
</script>

<template>
  <div class="runtime-only">
    <div v-if="!ready" class="boot">加载中…</div>
    <div v-else-if="loadError" class="boot error">{{ loadError }}</div>
    <template v-else>
      <Canvas2DRuntime
        v-if="active2dPage"
        :key="active2dPage.id + ':' + runtimeRev"
        :page="active2dPage"
        :show-hud="false"
        @open-dialog="openRuntimeDialog"
      />
      <Canvas3DRuntime
        v-else-if="active3dPage"
        :key="active3dPage.id + ':' + runtimeRev + ':g' + (showGrid ? '1' : '0')"
        :page="active3dPage"
        :show-hud="false"
        :show-grid="showGrid"
        @open-dialog="openRuntimeDialog"
      />
      <div v-else class="boot">请选择页面</div>

      <div v-if="dialogPage" class="runtime-dialog-mask" @click.self="closeRuntimeDialog">
        <div class="runtime-dialog">
          <header class="runtime-dialog-head">
            <span>{{ dialogPage.name }}</span>
            <el-button size="small" text @click="closeRuntimeDialog">关闭</el-button>
          </header>
          <div class="runtime-dialog-body">
            <Canvas2DRuntime
              :key="dialogPage.id + ':' + runtimeRev"
              embedded
              :show-hud="false"
              :page="dialogPage"
              @open-dialog="openRuntimeDialog"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.runtime-only {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: #0b0d11;
  overflow: hidden;
}

.boot {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--scada-muted, #9aa3b2);
  font-size: 14px;
}

.boot.error {
  color: #fca5a5;
  padding: 24px;
  text-align: center;
}

.runtime-dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
}

.runtime-dialog {
  width: min(960px, 92vw);
  height: min(640px, 86vh);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--scada-border, #2a3140);
  border-radius: 8px;
  background: #0f1218;
  overflow: hidden;
}

.runtime-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--scada-border, #2a3140);
  color: var(--scada-text, #e8eaed);
  font-size: 13px;
}

.runtime-dialog-body {
  flex: 1;
  min-height: 0;
}
</style>
