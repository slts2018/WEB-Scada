import { buildApp } from './app.js'
import { config } from './config.js'
import { closeInflux } from './db/influx.js'
import { closeMysql } from './db/mysql.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`web-scada server listening on http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

async function shutdown() {
  await app.close()
  await closeInflux()
  await closeMysql()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
