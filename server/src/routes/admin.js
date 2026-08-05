import { loadConfig, saveConfig, listBackups, readBackup } from '../config-store.js'
import { rateLimitKey } from '../lib/auth.js'
import { sortVersions, dayBefore } from '../engine/resolveVersion.js'
import { appendAudit, diffObjects } from '../lib/logfile.js'

const todayKey = () => new Date().toISOString().slice(0, 10)

/** «з … по …» для попередження про перерахунок минулих місяців. */
function affectedSpan(versions, effectiveFrom) {
  const next = sortVersions(versions).find((v) => v.effectiveFrom > effectiveFrom)
  return { from: effectiveFrom, to: next ? dayBefore(next.effectiveFrom) : null }
}

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
   * Нова версія ставок «застосувати з дати».
   *
   * Майбутня дата — вільно (це основний сценарій «підвищення з 1-го числа»);
   * заміна ще не чинної версії — теж вільно. А от дата в минулому чи поточному
   * місяці (ретро-вставка, внесення історії ЗП) перераховує вже пораховані
   * місяці — тому вимагає dryRun-прегляду і явного confirm; без нього 409.
   * Редагування ВЖЕ наявної чинної/минулої версії — окремий PUT нижче.
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
            confirm: { type: 'boolean' },
            dryRun: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { effectiveFrom, label, version, confirm, dryRun } = req.body
      const config = structuredClone(loadConfig())

      const existing = config.rateVersions.find((v) => v.effectiveFrom === effectiveFrom)
      if (existing && existing.effectiveFrom <= todayKey()) {
        return reply.code(409).send({
          error: 'Версія з цією датою вже чинна — виправлення наявної версії робиться через її редагування',
        })
      }

      const id = effectiveFrom.slice(0, 7)
      const next = { ...version, id, label, effectiveFrom }
      // База для діфу: замінена версія, а для нової — попередня за датою.
      // id/label/effectiveFrom — ідентичність НОВОЇ версії, а не «зміни» старої:
      // у діфі вони лише збивають з пантелику («2026-03 → 2026-05» читається
      // як правка старої версії, якої не відбувається).
      const strip = ({ id: _i, label: _l, effectiveFrom: _e, ...rest }) => rest
      const baseline = existing ?? sortVersions(config.rateVersions).filter((v) => v.effectiveFrom < effectiveFrom).at(-1) ?? {}
      const changes = diffObjects(strip(baseline), strip(next))

      const retro = !existing && effectiveFrom <= todayKey()
      const span = affectedSpan(config.rateVersions, effectiveFrom)
      const warning = retro
        ? `Створюється НОВА версія: діятиме з ${span.from} по ${span.to ?? 'сьогодні'}, і ці місяці перерахуються за нею. ` +
          `Попередні версії не змінюються${baseline.label ? `; нижче — відмінності від «${baseline.label}»` : ''}.`
        : null

      if (dryRun) return { changes, warning, requiresConfirm: retro }
      if (retro && !confirm) {
        return reply.code(409).send({ error: 'Ретро-вставка потребує явного підтвердження', warning, changes })
      }

      // Одразу в хронологічному порядку: на ньому тримаються і резолв, і списки в UI.
      config.rateVersions = sortVersions([...config.rateVersions.filter((v) => v.effectiveFrom !== effectiveFrom), next])

      if (saveOr422(reply, config)) return
      audit(req, {
        action: existing ? 'version.replace' : retro ? 'version.retro-create' : 'version.create',
        versionId: id,
        effectiveFrom,
        changes,
      })
      return { ok: true, id }
    }
  )

  /**
   * Редагування наявної версії — включно з чинною і минулими.
   * Для чинної/минулої: спершу dryRun (діф «було → стало» + попередження про
   * період перерахунку), збереження лише з confirm; без нього — 409.
   * Майбутня (ще не чинна) редагується вільно. Дата версії не змінюється.
   */
  app.put(
    '/api/admin/versions/:id',
    {
      config: writeLimit,
      schema: {
        body: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { type: 'object' },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            confirm: { type: 'boolean' },
            dryRun: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { version, label, confirm, dryRun } = req.body
      const config = structuredClone(loadConfig())
      const existing = config.rateVersions.find((v) => v.id === req.params.id)
      if (!existing) return reply.code(404).send({ error: 'Немає такої версії' })

      const next = { ...version, id: existing.id, label: label ?? existing.label, effectiveFrom: existing.effectiveFrom }
      // id і дата незмінні за визначенням — у діфі лише змістовні поля (label включно)
      const stripImmutable = ({ id: _i, effectiveFrom: _e, ...rest }) => rest
      const changes = diffObjects(stripImmutable(existing), stripImmutable(next))
      const active = existing.effectiveFrom <= todayKey()
      const span = affectedSpan(config.rateVersions.filter((v) => v.id !== existing.id), existing.effectiveFrom)
      const warning = active
        ? `Версія вже діяла: зміняться розрахунки місяців з ${span.from} по ${span.to ?? 'сьогодні'}`
        : null

      if (dryRun) return { changes, warning, requiresConfirm: active }
      if (changes.length === 0) return { ok: true, id: existing.id, unchanged: true }
      if (active && !confirm) {
        return reply.code(409).send({ error: 'Редагування чинної чи минулої версії потребує явного підтвердження', warning, changes })
      }

      config.rateVersions = sortVersions(config.rateVersions.map((v) => (v.id === existing.id ? next : v)))
      if (saveOr422(reply, config)) return
      audit(req, { action: 'version.edit', versionId: existing.id, effectiveFrom: existing.effectiveFrom, changes })
      return { ok: true, id: existing.id }
    }
  )

  /** Бекапи конфігу (пишуться перед кожним збереженням) — список для відкату. */
  app.get('/api/admin/backups', async () => ({ backups: listBackups() }))

  /**
   * Відкат до бекапа. Той самий протокол: dryRun → діф, збереження лише з
   * confirm. Поточний стан перед відкатом сам стає бекапом — відкат відкату
   * можливий завжди.
   */
  app.post(
    '/api/admin/rollback',
    {
      config: writeLimit,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', maxLength: 80 },
            confirm: { type: 'boolean' },
            dryRun: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { name, confirm, dryRun } = req.body
      let snapshot
      try {
        snapshot = readBackup(name)
      } catch (e) {
        if (e.code === 'INVALID_CONFIG') {
          return reply.code(422).send({ error: `Бекап не проходить валідацію (${e.message}) — відкат до нього неможливий` })
        }
        throw e
      }
      if (!snapshot) return reply.code(404).send({ error: 'Немає такого бекапа' })

      const current = loadConfig()
      const changes = diffObjects(current, snapshot)
      if (dryRun) return { changes, requiresConfirm: true }
      if (changes.length === 0) return { ok: true, unchanged: true }
      if (!confirm) return reply.code(409).send({ error: 'Відкат потребує явного підтвердження', changes })

      if (saveOr422(reply, snapshot)) return
      audit(req, { action: 'config.rollback', backup: name, changes })
      return { ok: true }
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
