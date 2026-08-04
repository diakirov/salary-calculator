import { verifyPassword, issueSession, COOKIE_NAME, cookieOptions } from '../lib/auth.js'

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
        return reply.code(401).send({ error: 'Невірний пароль' })
      }
      reply.setCookie(COOKIE_NAME, issueSession(role), cookieOptions)
      return { role }
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
