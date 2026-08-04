import { verifyPassword, issueSession, roles, COOKIE_NAME, cookieOptions } from '../lib/auth.js'

export default async function authRoutes(app) {
  app.post(
    '/api/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const role = await verifyPassword(req.body.password)
      if (!role) {
        // security-подія: сигнал для виявлення перебору (пароль не логуємо ніколи)
        req.log.warn({ security: true, event: 'login-failed', ip: req.ip }, 'невдалий вхід')
        return reply.code(401).send({ error: 'Невірний пароль' })
      }
      req.log.info({ security: true, event: 'login-ok', role }, 'вхід')
      reply.setCookie(COOKIE_NAME, issueSession(role), cookieOptions)
      // Та сама форма, що /api/me: клієнту після логіна не треба другий запит.
      const meta = roles()[role] ?? {}
      return { role, isAdmin: !!meta.admin, title: meta.title ?? null }
    }
  )

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    // title — підпис ролі для шапки; береться з конфігу, щоб інтерфейс
    // не знав назв ролей конкретного розгортання.
    return { role: req.session.role, isAdmin: req.session.admin, title: req.session.title ?? null }
  })
}
