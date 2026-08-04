import { loadConfig, getNormHours } from '../config-store.js'
import { calculate, CalcError } from '../engine/calculate.js'
import { resolveVersion } from '../engine/resolveVersion.js'
import { profilesView, versionStatusFor } from '../lib/publicView.js'
import { rateLimitKey } from '../lib/auth.js'

const todayKey = () => new Date().toISOString().slice(0, 10)

export default async function calcRoutes(app) {
  app.get('/api/profiles', async (req) => {
    return profilesView(loadConfig(), req.session)
  })

  app.post(
    '/api/calc',
    {
      config: {
        // Людина з дебаунсом 180 мс так не настукає; перебір сітки ставок — так.
        rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: rateLimitKey },
      },
      schema: {
        body: {
          type: 'object',
          required: ['profileId', 'year', 'month', 'schedule', 'zoneId'],
          properties: {
            profileId: { type: 'string' },
            stageId: { type: 'string' },
            year: { type: 'integer', minimum: 2000, maximum: 2100 },
            month: { type: 'integer', minimum: 0, maximum: 11 },
            schedule: { type: 'string' },
            zoneId: { type: 'integer' },
            qualId: { type: 'integer' },
            workedHours: { type: 'number', minimum: 0, maximum: 800 },
            knowledge: { type: 'boolean' },
            nightHours: { type: 'number', minimum: 0, maximum: 800 },
            x2Hours: { type: 'number', minimum: 0, maximum: 1600 },
            tenureYears: { type: 'integer', minimum: 0, maximum: 99 },
            extras: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 999999 } },
            versionId: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { profileId, year, month, schedule, versionId } = req.body

      if (!req.session.profiles.includes(profileId)) {
        return reply.code(403).send({ error: 'Цей калькулятор недоступний для вашої ролі' })
      }

      const config = loadConfig()
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

      const normHours = getNormHours(config, { year, monthIndex: month, schedule })
      if (!normHours) {
        return reply.code(422).send({ error: `Норма годин для ${schedule} ${monthKey} не задана` })
      }

      let rates
      try {
        rates = resolveVersion({ versions: config.rateVersions, monthKey, versionId })
      } catch (e) {
        return reply.code(422).send({ error: e.message })
      }

      try {
        const result = calculate({
          rates,
          normHours,
          input: { ...req.body, workedHours: req.body.workedHours ?? normHours },
        })
        return {
          ...result,
          version: { id: rates.id, label: rates.label, effectiveFrom: rates.effectiveFrom },
          versionStatus: versionId ? 'explicit' : versionStatusFor(config, monthKey, todayKey()),
        }
      } catch (e) {
        if (e instanceof CalcError) return reply.code(422).send({ error: e.message, code: e.code })
        throw e
      }
    }
  )
}
