/**
 * Авторизація: один пароль = одна роль. Без вибору ролі в UI —
 * ввів пароль, отримав свій набір калькуляторів.
 *
 * Перелік ролей і те, які профілі кожна бачить, задається в конфізі
 * (ключ `roles`), а не тут: це дані розгортання, а не логіка. Хеш пароля
 * ролі береться з env за іменем `AUTH_<РОЛЬ>_HASH`.
 *
 * Сесія — підписаний cookie (httpOnly, Secure, SameSite=Lax).
 */
import crypto from 'node:crypto'
import argon2 from 'argon2'
import { loadConfig } from '../config-store.js'

/** Ролі з конфігу. loadConfig кешований, тож виклик дешевий. */
export function roles() {
  return loadConfig().roles ?? {}
}

const SESSION_TTL_S = 60 * 60 * 24 * 30 // 30 днів

function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET має бути ≥32 символів')
  return s
}

function roleHashes() {
  const out = {}
  for (const id of Object.keys(roles())) {
    out[id] = process.env[`AUTH_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HASH`]
  }
  return out
}

/** Пароль → роль або null. Перебираємо всі ролі, щоб час не виказував, який хеш збігся першим. */
export async function verifyPassword(password) {
  let matched = null
  for (const [role, hash] of Object.entries(roleHashes())) {
    if (!hash) continue
    try {
      if (await argon2.verify(hash, password)) matched = role
    } catch {
      // некоректний хеш в env — вважаємо непідходящим
    }
  }
  return matched
}

export function issueSession(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_TTL_S * 1000 })).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function readSession(token) {
  if (!token || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const role = roles()[data.role]
    if (!role || data.exp < Date.now()) return null
    return { role: data.role, ...role }
  } catch {
    return null
  }
}

export const COOKIE_NAME = 'sc_session'

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_S,
}
