import { useProjectStore } from '@/stores/project'

export type OpenRuntimeFrom = 'preview' | 'designer'

const RUNTIME_WINDOW_NAME = 'web_scada_runtime'
const RUNTIME_BOOT_KEY = 'scada.runtime.boot'

/**
 * 以当前设计工程为准同步发布包，再以独立弹窗打开运行端（仅画布）。
 */
export async function syncCurrentProjectAndOpenRuntime(
  _router: unknown,
  from: OpenRuntimeFrom = 'designer',
  opts?: { showGrid?: boolean },
): Promise<{ publishVersion: string; projectName: string }> {
  const project = useProjectStore()
  const keepPageId = project.activePageId
  const pkg = await project.publish()
  if (keepPageId && project.document.pages.some((p) => p.id === keepPageId)) {
    project.setActivePage(keepPageId)
  }

  const active = project.activePage
  const pageW = active && 'width' in active ? Number(active.width) || 1920 : 1920
  const pageH = active && 'height' in active ? Number(active.height) || 1080 : 1080

  const availW = window.screen.availWidth || pageW
  const availH = window.screen.availHeight || pageH
  const width = Math.min(Math.max(pageW, 320), availW)
  const height = Math.min(Math.max(pageH, 240), availH)
  const screenExt = window.screen as Screen & { availLeft?: number; availTop?: number }
  const left = Math.max(0, Math.round((availW - width) / 2 + (screenExt.availLeft || 0)))
  const top = Math.max(0, Math.round((availH - height) / 2 + (screenExt.availTop || 0)))

  const base = import.meta.env.BASE_URL || '/'
  const path = `${base}runtime`.replace(/\/{2,}/g, '/')
  const qs = new URLSearchParams()
  qs.set('from', from)
  qs.set('projectId', pkg.manifest.projectId)
  qs.set('v', pkg.manifest.publishVersion)
  qs.set('publishedAt', String(pkg.manifest.publishedAt))
  if (keepPageId) qs.set('page', keepPageId)
  qs.set('showGrid', opts?.showGrid ? '1' : '0')
  qs.set('_ts', String(Date.now()))

  // 跨窗口通知：即使同名窗未整页刷新，运行端也能收到新版本
  try {
    localStorage.setItem(
      RUNTIME_BOOT_KEY,
      JSON.stringify({
        projectId: pkg.manifest.projectId,
        publishVersion: pkg.manifest.publishVersion,
        publishedAt: pkg.manifest.publishedAt,
        pageId: keepPageId ?? null,
        showGrid: opts?.showGrid === true,
        at: Date.now(),
      }),
    )
  } catch {
    /* ignore quota / private mode */
  }

  const href = `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}?${qs.toString()}`
  const features = [
    `popup=yes`,
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'scrollbars=yes',
    'resizable=yes',
  ].join(',')

  const win = window.open(href, RUNTIME_WINDOW_NAME, features)
  if (!win) {
    throw new Error('浏览器拦截了弹窗，请允许本站点弹出窗口后再试')
  }
  try {
    // 同名窗体务必换址；不要只 focus，否则仍显示上次发布内容
    win.location.replace(href)
  } catch {
    try {
      win.location.href = href
    } catch {
      /* ignore */
    }
  }
  try {
    win.focus()
  } catch {
    /* ignore */
  }

  return {
    publishVersion: pkg.manifest.publishVersion,
    projectName: pkg.manifest.projectName,
  }
}

export { RUNTIME_BOOT_KEY }
