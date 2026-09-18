import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { config } from '../config.js'

export function isAuthEnabled(): boolean {
  return Boolean(config.auth.apiToken)
}

export function extractRequestToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null
  }
  const header = req.headers['x-scada-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  const q = (req.query as { token?: string } | undefined)?.token
  if (typeof q === 'string' && q.trim()) return q.trim()
  return null
}

export function tokenMatches(token: string | null | undefined): boolean {
  if (!isAuthEnabled()) return true
  return Boolean(token && token === config.auth.apiToken)
}

/** 鉴权开启时仍允许匿名访问的读路径（Runtime / 健康检查） */
function isPublicRoute(method: string, pathname: string): boolean {
  if (pathname === '/api/health') return true
  if (method !== 'GET') return false
  if (pathname.startsWith('/api/files/')) return true
  if (pathname === '/api/ws/tags') return true
  if (pathname === '/api/tags' || pathname === '/api/tags/values') return true
  if (/^\/api\/tags\/[^/]+\/history$/.test(pathname)) return true
  if (pathname === '/api/projects' || /^\/api\/projects\/[^/]+$/.test(pathname)) return true
  if (pathname === '/api/publishes' || pathname === '/api/publishes/latest') return true
  if (/^\/api\/publishes\/[^/]+$/.test(pathname)) return true
  if (pathname === '/api/devices') return true
  if (pathname === '/api/settings/database') return true
  return false
}

function requestPathname(url: string): string {
  const q = url.indexOf('?')
  return q >= 0 ? url.slice(0, q) : url
}

/**
 * 最小鉴权：SCADA_API_TOKEN 为空则全放行；
 * 有 Token 时保护写值 / 库配置 / 工程变更等。
 */
export const authPlugin: FastifyPluginAsync = async (app) => {
  if (config.auth.required && !config.auth.apiToken) {
    throw new Error('SCADA_AUTH_REQUIRED=true but SCADA_API_TOKEN is empty')
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!isAuthEnabled()) return
    const pathname = requestPathname(req.url)
    if (isPublicRoute(req.method, pathname)) return
    if (!tokenMatches(extractRequestToken(req))) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.log.info(
    {
      authEnabled: isAuthEnabled(),
      authRequired: config.auth.required,
    },
    'api auth status',
  )
}
