/**
 * Логи для адмінки: зрізи за останні N годин + журнал змін конфігу.
 *
 * Сценарій кнопки: щось зламалось → адмін з телефона тисне «зберегти зріз» →
 * на волюмі зʼявляється файл, з яким можна спокійно розібратись увечері.
 * Зрізи не видаляються автоматично ніколи; при перевищенні лімітів збереження
 * все одно відбувається, а UI отримує пропозицію видалити найстаріший файл.
 */
import fs from 'node:fs'
import path from 'node:path'
import { rateLimitKey } from '../lib/auth.js'
import {
  fileLoggingAvailable, saveSnapshot, listSnapshots, deleteSnapshot,
  isValidSnapshotName, snapshotDir, readAudit, SNAPSHOT_LIMITS,
} from '../lib/logfile.js'

export default async function logsRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.session?.admin) {
      req.log.warn({ security: true, event: 'forbidden-admin', role: req.session?.role ?? null, url: req.url }, 'спроба адмін-зони')
      reply.code(403).send({ error: 'Лише для адміністратора' })
    }
  })

  const writeLimit = { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } }

  /** 503 з людським поясненням, поки волюм не належить користувачу контейнера. */
  function requireFiles(reply) {
    if (fileLoggingAvailable()) return false
    reply.code(503).send({
      error: 'Файлові логи недоступні: теці логів на сервері бракує прав на запис. Це відома умова — потрібен chown волюма, він у списку відкладених серверних дій.',
    })
    return true
  }

  app.get('/api/admin/logs', async (req, reply) => {
    if (requireFiles(reply)) return
    const files = listSnapshots()
    return {
      files,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
      limits: SNAPSHOT_LIMITS,
    }
  })

  app.post(
    '/api/admin/logs/snapshot',
    {
      config: writeLimit,
      schema: {
        body: {
          type: 'object',
          required: ['hours'],
          properties: { hours: { type: 'integer', minimum: 1, maximum: 168 } },
        },
      },
    },
    async (req, reply) => {
      if (requireFiles(reply)) return
      const result = saveSnapshot(req.body.hours)
      req.log.info({ audit: true, action: 'logs.snapshot', hours: req.body.hours, file: result.name }, 'збережено зріз логів')
      return result
    }
  )

  app.get('/api/admin/logs/:name', async (req, reply) => {
    if (requireFiles(reply)) return
    const { name } = req.params
    if (!isValidSnapshotName(name)) return reply.code(404).send({ error: 'Не знайдено' })
    const p = path.join(snapshotDir(), name)
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Не знайдено' })
    reply.header('Content-Type', 'application/jsonl')
    reply.header('Content-Disposition', `attachment; filename="${name}"`)
    return fs.createReadStream(p)
  })

  app.delete('/api/admin/logs/:name', { config: writeLimit }, async (req, reply) => {
    if (requireFiles(reply)) return
    if (!deleteSnapshot(req.params.name)) return reply.code(404).send({ error: 'Не знайдено' })
    req.log.info({ audit: true, action: 'logs.snapshot-delete', file: req.params.name }, 'видалено зріз логів')
    return { ok: true }
  })

  /** Журнал змін конфігу — для вкладки «Історія» в адмінці. */
  app.get('/api/admin/audit', async (req, reply) => {
    if (requireFiles(reply)) return
    return { entries: readAudit(200).reverse() } // найновіші згори
  })
}
