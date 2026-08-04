/**
 * Сховище конфігу: читання, валідація, запис із бекапом.
 *
 * Реальний config.json живе поза репозиторієм (env CONFIG_PATH).
 * Кожен запис спочатку кладе бекап попереднього стану поруч у backups/,
 * потім атомарно замінює файл (tmp + rename).
 */
import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(process.cwd(), '../config/config.json')

let cached = null

export function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const parsed = JSON.parse(raw)
  assertValidConfig(parsed)
  cached = parsed
  return cached
}

export function saveConfig(next) {
  assertValidConfig(next)
  const dir = path.dirname(CONFIG_PATH)
  const backupsDir = path.join(dir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })

  if (fs.existsSync(CONFIG_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(CONFIG_PATH, path.join(backupsDir, `config-${stamp}.json`))
  }

  const tmp = path.join(dir, `.config-${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, CONFIG_PATH)
  cached = next
  return next
}

export function assertValidConfig(config) {
  if (!config || typeof config !== 'object') fail('конфіг не обʼєкт')
  if (!Array.isArray(config.rateVersions) || config.rateVersions.length === 0) fail('rateVersions порожній')

  // Ролі — дані розгортання: без них ніхто не зможе увійти, тож перевіряємо тут,
  // а не залишаємо на порожню відповідь при логіні.
  if (!config.roles || Object.keys(config.roles).length === 0) fail('roles порожній')
  for (const [rid, r] of Object.entries(config.roles)) {
    if (!Array.isArray(r.profiles) || r.profiles.length === 0) fail(`роль ${rid}: profiles порожній`)
  }

  const ids = new Set()
  for (const v of config.rateVersions) {
    if (!v.id) fail('версія без id')
    if (ids.has(v.id)) fail(`дубль версії ${v.id}`)
    ids.add(v.id)
    if (!/^\d{4}-\d{2}-01$/.test(v.effectiveFrom)) fail(`effectiveFrom має бути 1-м числом місяця: ${v.effectiveFrom}`)
    if (!(v.taxRate > 0 && v.taxRate < 1)) fail(`taxRate поза (0,1): ${v.taxRate}`)
    if (!(v.nightMultiplier >= 0)) fail('nightMultiplier відсутній')
    if (!(v.tenurePercentPerYear > 0)) fail('tenurePercentPerYear відсутній')
    if (!(v.maxTenureYears > 0)) fail('maxTenureYears відсутній')
    if (!v.profiles || Object.keys(v.profiles).length === 0) fail(`версія ${v.id} без профілів`)

    for (const [pid, p] of Object.entries(v.profiles)) {
      if (!(p.baseSalary > 0)) fail(`${pid}: baseSalary`)
      if (!Array.isArray(p.stages) || p.stages.length === 0) fail(`${pid}: stages`)
      for (const s of p.stages) {
        if (!Array.isArray(s.zones) || s.zones.length === 0) fail(`${pid}/${s.id}: zones`)
        for (const z of s.zones) {
          if (typeof z.premium !== 'number' || z.premium < 0) fail(`${pid}/${s.id}/зона ${z.id}: premium`)
        }
      }
      if (!Array.isArray(p.qualLevels) || p.qualLevels.length === 0) fail(`${pid}: qualLevels`)
      for (const extra of p.extras ?? []) {
        if (!extra.id || !extra.label) fail(`${pid}: extra без id/label`)
        if (typeof extra.taxable !== 'boolean') fail(`${pid}/${extra.id}: taxable має бути явним`)
        // Без цих перевірок count-extra без amount дає NaN у сумі — і Fastify
        // мовчки віддає null замість числа.
        if (extra.kind != null && extra.kind !== 'count' && extra.kind !== 'money') {
          fail(`${pid}/${extra.id}: kind має бути count або money`)
        }
        if (extra.kind === 'count' && !(typeof extra.amount === 'number' && extra.amount > 0)) {
          fail(`${pid}/${extra.id}: count-extra без додатного amount`)
        }
        if (extra.max != null && !(Number.isInteger(extra.max) && extra.max > 0)) {
          fail(`${pid}/${extra.id}: max має бути цілим додатним`)
        }
        if (extra.sign != null && extra.sign !== 1 && extra.sign !== -1) {
          fail(`${pid}/${extra.id}: sign має бути 1 або -1`)
        }
      }
    }
  }

  if (!config.normHours || Object.keys(config.normHours).length === 0) fail('normHours порожній')
  for (const [year, schedules] of Object.entries(config.normHours)) {
    for (const [schedule, months] of Object.entries(schedules)) {
      if (!Array.isArray(months) || months.length !== 12) fail(`normHours ${year}/${schedule}: не 12 місяців`)
      if (!months.every((m) => m === null || m > 0)) fail(`normHours ${year}/${schedule}: некоректні значення`)
    }
  }
}

export function getNormHours(config, { year, monthIndex, schedule }) {
  return config.normHours?.[year]?.[schedule]?.[monthIndex] ?? null
}

// ── Бекапи: список і читання для відкату з адмінки ───────────────────────

const BACKUP_NAME = /^config-[\dTZ-]+\.json$/

export function listBackups() {
  const dir = path.join(path.dirname(CONFIG_PATH), 'backups')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => BACKUP_NAME.test(n))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n))
      return { name: n, size: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name)) // найновіші згори
}

/** Прочитати бекап за імʼям. Кидає INVALID_CONFIG, якщо вміст не проходить валідацію. */
export function readBackup(name) {
  if (!BACKUP_NAME.test(name)) return null
  const p = path.join(path.dirname(CONFIG_PATH), 'backups', name)
  if (!fs.existsSync(p)) return null
  const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
  assertValidConfig(parsed)
  return parsed
}

function fail(msg) {
  const err = new Error(`Невалідний конфіг: ${msg}`)
  err.code = 'INVALID_CONFIG'
  throw err
}
