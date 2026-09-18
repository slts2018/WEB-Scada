import type { FastifyPluginAsync } from 'fastify'
import { getInfluxStatus } from '../db/influx.js'
import { getMysqlStatus } from '../db/mysql.js'
import { listTagMetas } from '../db/tags.js'
import { config } from '../config.js'
import { isAuthEnabled } from '../plugins/auth.js'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async () => ({
    ok: true,
    service: 'web-scada-server',
    time: Date.now(),
    mysql: getMysqlStatus(),
    influx: getInfluxStatus(),
    storage: getMysqlStatus().ready ? 'mysql' : 'file',
    tags: (await listTagMetas()).length,
    auth: {
      enabled: isAuthEnabled(),
      required: config.auth.required,
    },
  }))
}
