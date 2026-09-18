import type { FastifyPluginAsync } from 'fastify'
import {
  applyDbSettingsUpdate,
  savePersistedSettings,
  toPublicSettings,
  type DbSettingsUpdate,
} from '../config.js'
import { getInfluxStatus, initInflux, testInfluxConnection } from '../db/influx.js'
import { getMysqlStatus, initMysql, testMysqlConnection } from '../db/mysql.js'
import {
  ensureDevicesTable,
  seedDevicesIfEmpty,
} from '../db/devices.js'
import { ensureTagsTable, seedTagsIfEmpty } from '../db/tags.js'
import { reloadTagRuntime } from '../services/tagRuntime.js'

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings/database', async () => ({
    settings: toPublicSettings(),
    status: {
      mysql: getMysqlStatus(),
      influx: getInfluxStatus(),
      storage: getMysqlStatus().ready ? 'mysql' : 'file',
    },
  }))

  app.put<{ Body: DbSettingsUpdate }>('/api/settings/database', async (req, reply) => {
    const body = req.body
    if (!body || (!body.mysql && !body.influx)) {
      return reply.code(400).send({ error: 'invalid_settings_body' })
    }
    applyDbSettingsUpdate(body)
    await savePersistedSettings()
    const mysqlOkAfter = await initMysql()
    const influxOkAfter = await initInflux()
    if (mysqlOkAfter) {
      await ensureDevicesTable()
      await seedDevicesIfEmpty()
      await ensureTagsTable()
      await seedTagsIfEmpty()
    }
    await reloadTagRuntime()
    return {
      ok: true,
      mysqlOk: mysqlOkAfter,
      influxOk: influxOkAfter,
      settings: toPublicSettings(),
      status: {
        mysql: getMysqlStatus(),
        influx: getInfluxStatus(),
        storage: getMysqlStatus().ready ? 'mysql' : 'file',
      },
    }
  })

  app.post<{ Body: DbSettingsUpdate }>('/api/settings/database/test', async (req) => {
    const body = req.body || {}
    const mysql = await testMysqlConnection(body.mysql)
    const influx = await testInfluxConnection(body.influx)
    return { mysql, influx }
  })
}
