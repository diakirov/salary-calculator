import { loadConfig, saveConfig } from '../config-store.js'
import { rateLimitKey } from '../lib/auth.js'
import { sortVersions } from '../engine/resolveVersion.js'
import { appendAudit, diffObjects } from '../lib/logfile.js'

/** Аудит зміни конфігу: в основний лог і в append-only audit.jsonl. */
function audit(req, entry) {
  const full = { ts: new Date().toISOString(), role: req.session.role, ...entry }
  req.log.info({ audit: true, ...full }, `конфіг: ${entry.action}`)
  appendAudit(full)
}

/** Помилки валідації конфігу → 422 з текстом; усе інше (fs тощо) → нагору, у generic 500. */
function saveOr422(reply, config) {
  try {
    saveConfig(config)
    return null
  } catch (e) {
    if (e.code === 'INVALID_CONFIG') return reply.code(422).send({ error: e.message })
    throw e
  }
}

export default async function adminRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.session?.admin) {
      // security-подія: не-адмін в адмін-зоні
      req.log.warn({ security: true, event: 'forbidden-admin', role: req.session?.role ?? null, url: req.url }, 'спроба адмін-зони')
      reply.code(403).send({ error: 'Лише для адміністратора' })
    }
  })

  const writeLimit = { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } }

  // Повний конфіг — з реальними числами; це і є екран редагування.
  app.get(
    '/api/admin/config',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: rateLimitKey } } },
    async () => loadConfig()
  )

  /**
   * Нова версія ставок «застосувати з дати». Стара версія лишається
   * недоторканою — історичні місяці не поїдуть заднім числом.
   * Якщо версія з таким effectiveFrom вже існує — це виправлення
   * майбутньої (ще не чинної) версії, її можна замінити.
   */
  app.post(
    '/api/admin/versions',
    {
      config: writeLimit,
      schema: {
        body: {
          type: 'object',
          required: ['effectiveFrom', 'label', 'version'],
          properties: {
            effectiveFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-01$' },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            version: { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const { effectiveFrom, label, version } = req.body
      const config = structuredClone(loadConfig())
      const todayKey = new Date().toISOString().slice(0, 10)

      const existing = config.rateVersions.find((v) => v.effectiveFrom === effectiveFrom)
      if (existing && existing.effectiveFrom <= todayKey) {
        return reply.code(409).send({
          error: 'Ця версія вже чинна — редагувати її не можна, створи нову з майбутньої дати',
        })
      }

      const id = effectiveFrom.slice(0, 7)
      const next = { ...version, id, label, effectiveFrom }
      // База для аудит-діфу: замінена версія, а для нової — попередня за датою.
      const baseline = existing ?? sortVersions(config.rateVersions).filter((v) => v.effectiveFrom < effectiveFrom).at(-1) ?? {}
      // Одразу в хронологічному порядку: на ньому тримаються і резолв, і списки в UI.
      config.rateVersions = sortVersions([...config.rateVersions.filter((v) => v.effectiveFrom !== effectiveFrom), next])

      if (saveOr422(reply, config)) return
      audit(req, {
        action: existing ? 'version.replace' : 'version.create',
        versionId: id,
        effectiveFrom,
        changes: diffObjects(baseline, next),
      })
      return { ok: true, id }
    }
  )

  /** Норма годин на рік: додає/замінює рік, інші роки не чіпає. */
  app.post(
    '/api/admin/norm-hours',
    {
      config: writeLimit,
      schema: {
        body: {
          type: 'object',
          required: ['year', 'schedules'],
          properties: {
            year: { type: 'string', pattern: '^\\d{4}$' },
            schedules: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                minItems: 12,
                maxItems: 12,
                items: { type: ['number', 'null'] },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { year, schedules } = req.body
      const config = structuredClone(loadConfig())
      const before = loadConfig().normHours[year] ?? null
      config.normHours[year] = schedules
      if (saveOr422(reply, config)) return
      audit(req, { action: 'norm-hours.set', year, changes: diffObjects(before ?? {}, schedules) })
      return { ok: true }
    }
  )
}
