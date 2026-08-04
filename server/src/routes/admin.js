import { loadConfig, saveConfig } from '../config-store.js'

export default async function adminRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin/')) return
    if (!req.session?.admin) {
      reply.code(403).send({ error: 'Лише для адміністратора' })
    }
  })

  // Повний конфіг — з реальними числами; це і є екран редагування.
  app.get('/api/admin/config', async () => loadConfig())

  /**
   * Нова версія ставок «застосувати з дати». Стара версія лишається
   * недоторканою — історичні місяці не поїдуть заднім числом.
   * Якщо версія з таким effectiveFrom вже існує — це виправлення
   * майбутньої (ще не чинної) версії, її можна замінити.
   */
  app.post(
    '/api/admin/versions',
    {
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
      config.rateVersions = [...config.rateVersions.filter((v) => v.effectiveFrom !== effectiveFrom), next]

      try {
        saveConfig(config)
      } catch (e) {
        return reply.code(422).send({ error: e.message })
      }
      return { ok: true, id }
    }
  )

  /** Норма годин на рік: додає/замінює рік, інші роки не чіпає. */
  app.post(
    '/api/admin/norm-hours',
    {
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
      config.normHours[year] = schedules
      try {
        saveConfig(config)
      } catch (e) {
        return reply.code(422).send({ error: e.message })
      }
      return { ok: true }
    }
  )
}
