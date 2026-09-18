import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import fs from 'node:fs'
import path from 'node:path'
import { config, loadPersistedSettings } from './config.js'
import { getInfluxStatus, initInflux } from './db/influx.js'
import { getMysqlStatus, initMysql } from './db/mysql.js'
import { ensureDevicesTable, seedDevicesIfEmpty } from './db/devices.js'
import { ensureTagsTable, seedTagsIfEmpty } from './db/tags.js'
import { ensureResourcesDir, getResourcesAbsoluteRoot } from './services/resources.js'
import { reloadTagRuntime, startTagRuntime, stopTagRuntime } from './services/tagRuntime.js'
import { initStore } from './store.js'
import { getWebRoot } from './paths.js'
import { authPlugin } from './plugins/auth.js'
import { healthRoutes } from './routes/health.js'
import { settingsRoutes } from './routes/settings.js'
import { projectRoutes } from './routes/projects.js'
import { publishRoutes } from './routes/publishes.js'
import { deviceRoutes } from './routes/devices.js'
import { tagRoutes } from './routes/tags.js'
import { resourceRoutes } from './routes/resources.js'

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: true,
  })
  await app.register(multipart, {
    limits: {
      // 工程导入 zip 含 CAD 模型，放宽到 200MB
      fileSize: 200 * 1024 * 1024,
      files: 1,
    },
  })
  await app.register(websocket)

  await loadPersistedSettings()
  const mysqlOk = await initMysql()
  const influxOk = await initInflux()
  await initStore()
  await ensureResourcesDir()

  await app.register(fastifyStatic, {
    root: getResourcesAbsoluteRoot(),
    prefix: '/api/files/',
    decorateReply: false,
  })

  if (mysqlOk) {
    await ensureDevicesTable()
    await seedDevicesIfEmpty()
    await ensureTagsTable()
    await seedTagsIfEmpty()
  } else if (config.mysql.fallbackToFile) {
    // 无 MySQL：设备/变量与工程一样落到 data/*.json
    await seedDevicesIfEmpty()
    await seedTagsIfEmpty()
    app.log.info('MySQL unavailable — tags/devices using data/ file fallback')
  }
  await reloadTagRuntime()
  startTagRuntime()

  app.log.info(
    {
      mysqlOk,
      influxOk,
      mysql: getMysqlStatus(),
      influx: getInfluxStatus(),
      tagDeviceStore: mysqlOk ? 'mysql' : config.mysql.fallbackToFile ? 'file' : 'none',
    },
    'database status',
  )

  if (!mysqlOk && !config.mysql.fallbackToFile) {
    throw new Error(`MySQL required but unavailable: ${getMysqlStatus().error}`)
  }
  if (!influxOk && config.influx.required) {
    throw new Error(`InfluxDB required but unavailable: ${getInfluxStatus().error}`)
  }

  app.addHook('onClose', async () => {
    stopTagRuntime()
  })

  await app.register(authPlugin)
  await app.register(healthRoutes)
  await app.register(settingsRoutes)
  await app.register(projectRoutes)
  await app.register(publishRoutes)
  await app.register(deviceRoutes)
  await app.register(tagRoutes)
  await app.register(resourceRoutes)

  const webRoot = getWebRoot()
  const webIndex = path.join(webRoot, 'index.html')
  if (fs.existsSync(webIndex)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not_found' })
    })
    app.log.info({ webRoot }, 'serving designer/runtime SPA')
  }

  return app
}
