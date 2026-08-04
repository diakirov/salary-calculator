/**
 * salary-calculator server.
 *
 * Бекенд існує рівно з однієї причини: реальні ставки не мають потрапляти
 * в браузер. Тому браузер шле вхідні дані, сервер повертає розклад сум.
 */
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config-store.js'
import { COOKIE_NAME, readSession, cookieOptions } from './lib/auth.js'
import authRoutes from './routes/auth.js'
import calcRoutes from './routes/calc.js'
import adminRoutes from './routes/admin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true, trustProxy: true })

await app.register(cookie)
await app.register(rateLimit, { global: false })

// Перевірка конфігу на старті — краще впасти одразу, ніж 500 на першому запиті.
loadConfig()

app.decorateRequest('session', null)
app.addHook('onRequest', async (req) => {
  req.session = readSession(req.cookies?.[COOKIE_NAME])
})

// Захист усього API, крім логіна
app.addHook('preHandler', async (req, reply) => {
  const open = req.url === '/api/login' || !req.url.startsWith('/api/')
  if (open) return
  if (!req.session) {
    reply.code(401).send({ error: 'Потрібен вхід' })
  }
})

await app.register(authRoutes)
await app.register(calcRoutes)
await app.register(adminRoutes)

// Брендинг (логотип, кіт, кольори) — теж поза репозиторієм, віддається лише
// авторизованим. BRANDING_DIR за замовчуванням поруч із конфігом.
const brandingDir = process.env.BRANDING_DIR || path.resolve(process.cwd(), '../branding')
if (fs.existsSync(brandingDir)) {
  await app.register(fastifyStatic, {
    root: brandingDir,
    prefix: '/branding/',
    decorateReply: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'private, max-age=3600')
    },
  })
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/branding/') && !req.session) {
      reply.code(401).send({ error: 'Потрібен вхід' })
    }
  })
}

// Фавікони — з приватного брендингу, але БЕЗ авторизації: браузер тягне їх
// ще на екрані логіна. Білий список імен, ніяких лістингів.
const faviconDir = path.join(brandingDir, 'favicon')
if (fs.existsSync(faviconDir)) {
  const faviconFiles = [
    'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
    'apple-touch-icon.png', 'android-chrome-192x192.png',
    'android-chrome-512x512.png', 'site.webmanifest',
  ]
  for (const name of faviconFiles) {
    if (!fs.existsSync(path.join(faviconDir, name))) continue
    app.get(`/${name}`, (req, reply) => reply.sendFile(name, faviconDir))
  }
}

// Ліверність для docker healthcheck: без авторизації, без даних конфігу —
// лише підтвердження, що процес живий і конфіг читається.
app.get('/healthz', async (req, reply) => {
  try {
    await loadConfig()
    return { ok: true }
  } catch {
    return reply.code(503).send({ ok: false })
  }
})

// Статика фронтенду (web/dist), SPA-fallback на index.html
const webDist = process.env.WEB_DIST || path.resolve(here, '../../web/dist')
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: !fs.existsSync(brandingDir) })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/branding/')) {
      return reply.code(404).send({ error: 'Не знайдено' })
    }
    return reply.sendFile('index.html', webDist)
  })
}

const port = Number(process.env.PORT || 8080)
await app.listen({ port, host: '0.0.0.0' })
