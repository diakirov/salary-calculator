/**
 * salary-calculator server.
 *
 * Бекенд існує рівно з однієї причини: реальні ставки не мають потрапляти
 * в браузер. Тому браузер шле вхідні дані, сервер повертає розклад сум.
 */
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config-store.js'
import { COOKIE_NAME, readSession } from './lib/auth.js'
import authRoutes from './routes/auth.js'
import calcRoutes from './routes/calc.js'
import adminRoutes from './routes/admin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// trustProxy НЕ true: X-Forwarded-For віримо лише локальному проксі (Caddy через
// docker-міст), інакше клієнт підробкою заголовка обходить rate-limit за IP.
const app = Fastify({ logger: true, trustProxy: 'loopback, uniquelocal' })

await app.register(cookie)
await app.register(rateLimit, { global: false })
await app.register(compress) // Caddy у цій інсталяції не стискає — стискаємо самі

// 5xx назовні — лише узагальнений текст: у err.message бувають шляхи
// файлової системи та деталі оточення. Все справжнє — у лог.
app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500
  if (status < 500) return reply.code(status).send({ error: err.message })
  req.log.error(err)
  return reply.code(500).send({ error: 'Внутрішня помилка' })
})

// Заголовки безпеки тут, а не в reverse proxy: Caddyfile на сервері спільний
// з іншими сервісами, а ці правила — властивість застосунку.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React ставить inline style-атрибути
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')
app.addHook('onSend', async (req, reply) => {
  reply.header('Strict-Transport-Security', 'max-age=15552000')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'no-referrer')
  reply.header('Content-Security-Policy', CSP)
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
})

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
    // v10: setHeaders отримує Reply, не сирий res
    setHeaders(reply) {
      reply.header('Cache-Control', 'private, max-age=3600')
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
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    decorateReply: !fs.existsSync(brandingDir),
    // v10: setHeaders отримує Reply, не сирий res
    setHeaders(reply, filePath) {
      // Хешовані бандли — назавжди; шрифти незмінні — надовго; решта — ревалідація.
      if (/[/\\]assets[/\\]/.test(filePath)) reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      else if (/[/\\]fonts[/\\]/.test(filePath)) reply.header('Cache-Control', 'public, max-age=2592000')
      else reply.header('Cache-Control', 'no-cache')
    },
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/branding/')) {
      return reply.code(404).send({ error: 'Не знайдено' })
    }
    return reply.sendFile('index.html', webDist)
  })
}

const port = Number(process.env.PORT || 8080)
await app.listen({ port, host: '0.0.0.0' })
