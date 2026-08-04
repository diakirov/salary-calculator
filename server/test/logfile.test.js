/** Тести файлових логів: ротація, аудит, зрізи, діф. Все — у тимчасовій теці. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  initLogDir, fileLoggingAvailable, makeLogStream, appendAudit, readAudit,
  diffObjects, saveSnapshot, listSnapshots, deleteSnapshot, isValidSnapshotName,
} from '../src/lib/logfile.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-logs-'))

test('initLogDir: доступна тека вмикає файлові логи, недоступна — деградація', () => {
  assert.equal(initLogDir(path.join(tmp, 'no/such/parent/../../deep')), true) // mkdir -p створює
  const roDir = path.join(tmp, 'ro')
  fs.mkdirSync(roDir, { mode: 0o555 })
  assert.equal(initLogDir(path.join(roDir, 'logs')), false)
  assert.equal(fileLoggingAvailable(), false)
  fs.chmodSync(roDir, 0o755)
})

test('потік пише в добовий файл; зріз фільтрує за часом; ліміти не блокують', () => {
  const dir = path.join(tmp, 'logs')
  assert.equal(initLogDir(dir), true)

  const stream = makeLogStream()
  const now = Date.now()
  const old = now - 5 * 3600_000
  stream.write(JSON.stringify({ time: old, msg: 'старий' }) + '\n')
  stream.write(JSON.stringify({ time: now, msg: 'свіжий' }) + '\n')

  const today = new Date().toISOString().slice(0, 10)
  assert.ok(fs.existsSync(path.join(dir, `app-${today}.log`)), 'добовий файл існує')

  const snap = saveSnapshot(2) // 2 години — «старий» рядок (−5 год) не входить
  assert.equal(snap.lines, 1)
  assert.equal(snap.overLimit, false)
  const body = fs.readFileSync(path.join(dir, 'snapshots', snap.name), 'utf-8')
  assert.ok(body.includes('свіжий') && !body.includes('старий'))

  assert.equal(listSnapshots().length, 1)
  assert.equal(deleteSnapshot(snap.name), true)
  assert.equal(listSnapshots().length, 0)
})

test('імена зрізів: traversal і сторонні імена не проходять', () => {
  assert.equal(isValidSnapshotName('../../../etc/passwd'), false)
  assert.equal(isValidSnapshotName('app-2026-08-04.log'), false)
  assert.equal(isValidSnapshotName('snapshot-2026-08-04T10-00-00-000Z-24h.jsonl'), true)
  assert.equal(deleteSnapshot('../audit.jsonl'), false)
})

test('audit.jsonl: append і читання останніх записів', () => {
  appendAudit({ ts: '2026-08-04T10:00:00Z', role: 'admin', action: 'version.create' })
  appendAudit({ ts: '2026-08-04T11:00:00Z', role: 'admin', action: 'norm-hours.set' })
  const entries = readAudit()
  assert.equal(entries.length, 2)
  assert.equal(entries.at(-1).action, 'norm-hours.set')
})

test('diffObjects: точкові зміни, додавання, видалення, стеля', () => {
  const before = { taxRate: 0.23, profiles: { a: { baseSalary: 100, zones: [{ id: 1, premium: 5 }] } } }
  const after = { taxRate: 0.23, profiles: { a: { baseSalary: 120, zones: [{ id: 1, premium: 5 }], extra: 'x' } } }
  const changes = diffObjects(before, after)
  assert.deepEqual(changes, [
    { path: 'profiles.a.baseSalary', from: 100, to: 120 },
    { path: 'profiles.a.extra', from: null, to: 'x' },
  ])
  const many = diffObjects({}, Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])), 200)
  assert.equal(many.length, 200)
})
