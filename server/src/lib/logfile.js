/**
 * Файлові логи в LOG_DIR (у проді — /data/logs, всередині волюма).
 *
 * Причина існування: stdout контейнера збирає docker у json-file на хості,
 * і зсередини контейнера той файл недосяжний — а кнопка «зберегти зріз логів»
 * в адмінці має працювати без доступу до хоста. Тож пишемо додатковий потік:
 *  - app-YYYY-MM-DD.log — добові файли, авточистка старших 7 днів / понад 40 МБ
 *    (це робоча копія стріму, її прунити можна і треба);
 *  - audit.jsonl — журнал змін конфігу, append-only, НЕ ротується і не чиститься;
 *  - snapshots/ — зрізи, зроблені кнопкою; їх не видаляє ніхто, крім людини.
 *
 * Якщо тека недоступна (у проді /data ще належить root — chown відкладено),
 * модуль деградує: файловий потік вимикається, лишається stdout, а стан
 * видно через fileLoggingAvailable() — адмінка чесно скаже, чому кнопка не працює.
 */
import fs from 'node:fs'
import path from 'node:path'

const KEEP_DAYS = 7
const KEEP_TOTAL_BYTES = 40 * 1024 * 1024

let logDir = null // null = файлові логи недоступні
let currentDate = null
let currentFd = null

export function initLogDir(dir) {
  try {
    fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true })
    // перевірка на запис одразу, а не на першому лог-рядку
    fs.accessSync(dir, fs.constants.W_OK)
    logDir = dir
    return true
  } catch {
    logDir = null
    return false
  }
}

export const fileLoggingAvailable = () => logDir != null
export const getLogDir = () => logDir

function dateKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10)
}

function rotateIfNeeded() {
  const today = dateKey()
  if (today === currentDate && currentFd != null) return
  if (currentFd != null) fs.closeSync(currentFd)
  currentDate = today
  currentFd = fs.openSync(path.join(logDir, `app-${today}.log`), 'a')
  pruneDailyFiles()
}

function pruneDailyFiles() {
  const entries = fs
    .readdirSync(logDir)
    .filter((n) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    .sort() // імена = дати, лексикографічно == хронологічно
    .map((n) => {
      const p = path.join(logDir, n)
      return { name: n, path: p, size: fs.statSync(p).size }
    })

  const cutoff = dateKey(Date.now() - KEEP_DAYS * 86400_000)
  let total = entries.reduce((s, e) => s + e.size, 0)
  for (const e of entries) {
    const isCurrent = e.name === `app-${currentDate}.log`
    const tooOld = e.name.slice(4, 14) < cutoff
    if (!isCurrent && (tooOld || total > KEEP_TOTAL_BYTES)) {
      try { fs.unlinkSync(e.path); total -= e.size } catch { /* не критично */ }
    }
  }
}

/** Потік для pino: пише і в stdout, і в добовий файл (якщо доступний). */
export function makeLogStream() {
  return {
    write(chunk) {
      process.stdout.write(chunk)
      if (logDir == null) return
      try {
        rotateIfNeeded()
        fs.writeSync(currentFd, chunk)
      } catch {
        // файлова частина відвалилась (диск/права) — не валимо процес через лог
        logDir = null
      }
    },
  }
}

/** Append-only журнал змін конфігу. Повертає false, якщо файлові логи недоступні. */
export function appendAudit(entry) {
  if (logDir == null) return false
  try {
    fs.appendFileSync(path.join(logDir, 'audit.jsonl'), JSON.stringify(entry) + '\n')
    return true
  } catch {
    return false
  }
}

export function readAudit(limit = 200) {
  if (logDir == null) return []
  const p = path.join(logDir, 'audit.jsonl')
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean)
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
}

/**
 * Пласкі шляхи «було → стало» між двома обʼєктами. Для аудиту правок конфігу:
 * показує рівно ті поля, що змінились, а не два простирадла JSON.
 */
export function diffObjects(before, after, cap = 200) {
  const changes = []
  const walk = (a, b, prefix) => {
    if (changes.length >= cap) return
    if (a === b) return
    const isObjA = a !== null && typeof a === 'object'
    const isObjB = b !== null && typeof b === 'object'
    if (!isObjA || !isObjB) {
      if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: prefix || '(корінь)', from: a ?? null, to: b ?? null })
      return
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[key], b[key], prefix ? `${prefix}.${key}` : String(key))
    }
  }
  walk(before ?? {}, after ?? {}, '')
  return changes
}

// ── Зрізи ────────────────────────────────────────────────────────────────

const SNAPSHOT_NAME = /^snapshot-[0-9T\-]+Z-\d+h\.jsonl$/
export const SNAPSHOT_LIMITS = { maxCount: 20, maxTotalBytes: 50 * 1024 * 1024 }

export function snapshotDir() {
  return logDir ? path.join(logDir, 'snapshots') : null
}

export function listSnapshots() {
  const dir = snapshotDir()
  if (!dir || !fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => SNAPSHOT_NAME.test(n))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n))
      return { name: n, size: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isValidSnapshotName(name) {
  return SNAPSHOT_NAME.test(name)
}

/**
 * Зріз за останні N годин: збирає рядки з добових файлів, фільтрує за pino
 * `time`, пише окремий файл у snapshots/. Потік логів і ротацію не чіпає.
 * Ліміти НЕ блокують збереження: при перевищенні повертаємо overLimit і
 * найстаріший файл — рішення про видалення завжди за людиною.
 */
export function saveSnapshot(hours) {
  const dir = snapshotDir()
  if (!dir) return null
  const cutoff = Date.now() - hours * 3600_000

  const days = new Set([dateKey(cutoff), dateKey()])
  // покриваємо і проміжні дні для зрізів > 24 год
  for (let t = cutoff; t < Date.now(); t += 86400_000) days.add(dateKey(t))

  const out = []
  for (const day of [...days].sort()) {
    const p = path.join(logDir, `app-${day}.log`)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        if (JSON.parse(line).time >= cutoff) out.push(line)
      } catch { /* не-JSON рядок — пропускаємо */ }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `snapshot-${stamp}-${hours}h.jsonl`
  fs.writeFileSync(path.join(dir, name), out.join('\n') + (out.length ? '\n' : ''))

  const all = listSnapshots()
  const total = all.reduce((s, f) => s + f.size, 0)
  const overLimit = all.length > SNAPSHOT_LIMITS.maxCount || total > SNAPSHOT_LIMITS.maxTotalBytes
  return {
    name,
    lines: out.length,
    size: all.find((f) => f.name === name)?.size ?? 0,
    overLimit,
    oldest: overLimit ? all[0] : null,
  }
}

export function deleteSnapshot(name) {
  const dir = snapshotDir()
  if (!dir || !isValidSnapshotName(name)) return false
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  return true
}
