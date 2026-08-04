/**
 * Тести рушія на ПРИКЛАДНОМУ конфізі (вигадані числа) — живуть у публічному
 * репо й ганяються в CI. Реальні числа звіряє payslips.test.js локально.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculate, round2 } from '../src/engine/calculate.js'
import { assertValidConfig } from '../src/config-store.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const example = JSON.parse(fs.readFileSync(path.join(here, '../../config.example.json'), 'utf-8'))
const rates = example.rateVersions[0]

const base = {
  profileId: 'role-a', stageId: 'main', zoneId: 3, qualId: 1,
  workedHours: 176, knowledge: false, nightHours: 0, x2Hours: 0, tenureYears: 0, extras: {},
}

test('приклад конфігу валідний', () => {
  assertValidConfig(example)
})

test('години = нормі → брутто = ставка + надбавка за рівень', () => {
  const r = calculate({ rates, normHours: 176, input: base })
  assert.equal(r.gross, 53000) // 50000 + 3000
  assert.equal(r.net, round2(53000 * (1 - rates.taxRate)))
})

test('пропорція від відпрацьованих годин', () => {
  const r = calculate({ rates, normHours: 176, input: { ...base, workedHours: 88 } })
  assert.equal(r.rows.find((x) => x.id === 'salary').amount, 25000)
})

test('знання додає 1 годину', () => {
  const r = calculate({ rates, normHours: 176, input: { ...base, knowledge: true } })
  assert.equal(r.effectiveHours, 177)
})

test('квал: на degradeAtZone платиться за нижчою ставкою, нижче minZone — нуль', () => {
  const atDegrade = calculate({ rates, normHours: 176, input: { ...base, qualId: 3 } })
  assert.equal(atDegrade.rows.find((x) => x.id === 'qual').amount, 2000) // сума 2-го
  assert.match(atDegrade.qualNote, /оплачується як/)

  const belowMin = calculate({ rates, normHours: 176, input: { ...base, qualId: 3, zoneId: 4 } })
  assert.equal(belowMin.rows.find((x) => x.id === 'qual'), undefined)
  assert.match(belowMin.qualNote, /не виплачується/)
})

test('вислуга: відсоток за рік від tenureBaseIncome, стеля з конфігу', () => {
  const oneYear = calculate({ rates, normHours: 176, input: { ...base, tenureYears: 1 } })
  assert.equal(oneYear.rows.find((x) => x.id === 'tenure').amount, 3000) // 60000×0.05

  const capped = calculate({ rates, normHours: 176, input: { ...base, tenureYears: 99 } })
  assert.equal(capped.rows.find((x) => x.id === 'tenure').amount, 60000 * 0.05 * 30)
})

test('нічні — від ставки з множником; подвоєні — від ставки з надбавкою за рівень', () => {
  const r = calculate({ rates, normHours: 176, input: { ...base, nightHours: 10, x2Hours: 4 } })
  assert.equal(r.rows.find((x) => x.id === 'night').amount, round2((50000 / 176) * 10 * 0.2))
  assert.equal(r.rows.find((x) => x.id === 'x2').amount, round2((53000 / 176) * 4))
})

test('чисті extras: додаються після податку, від\'ємні віднімаються', () => {
  const r = calculate({ rates, normHours: 176, input: { ...base, extras: { bonus: 3, reimbursement: 500, deduction: 200 } } })
  assert.equal(r.netExtras.find((x) => x.id === 'bonus').amount, 900)
  assert.equal(r.totalNet, round2(r.net + 900 + 500 - 200))
  // лічильник зверху обрізається по max
  const clamped = calculate({ rates, normHours: 176, input: { ...base, extras: { bonus: 9 } } })
  assert.equal(clamped.netExtras.find((x) => x.id === 'bonus').amount, 5 * 300)
})

test('taxable extra потрапляє в брутто', () => {
  const withTaxable = {
    ...rates,
    profiles: {
      ...rates.profiles,
      'role-a': {
        ...rates.profiles['role-a'],
        extras: [{ id: 'dop', label: 'Надбавка', kind: 'money', taxable: true, sign: 1 }],
      },
    },
  }
  const r = calculate({ rates: withTaxable, normHours: 176, input: { ...base, extras: { dop: 1000 } } })
  assert.equal(r.gross, 54000)
})

test('другий етап профілю: інші надбавки за рівень', () => {
  const lt3 = calculate({ rates, normHours: 176, input: { ...base, profileId: 'role-b', stageId: 'stage-1' } })
  const gte3 = calculate({ rates, normHours: 176, input: { ...base, profileId: 'role-b', stageId: 'stage-2' } })
  assert.equal(lt3.rows.find((x) => x.id === 'zone').amount, 3000)
  assert.equal(gte3.rows.find((x) => x.id === 'zone').amount, 5000)
})

test('нічних більше, ніж відпрацьованих → помилка розрахунку', () => {
  assert.throws(
    () => calculate({ rates, normHours: 176, input: { ...base, workedHours: 10, nightHours: 11 } }),
    (e) => e.code === 'NIGHT_GT_WORKED'
  )
  // знання додає годину — 11 нічних при 10+знання проходить
  calculate({ rates, normHours: 176, input: { ...base, workedHours: 10, knowledge: true, nightHours: 11 } })
})

test('подвоєних більше за 2×відпрацьовані → помилка розрахунку', () => {
  assert.throws(
    () => calculate({ rates, normHours: 176, input: { ...base, workedHours: 10, x2Hours: 21 } }),
    (e) => e.code === 'X2_GT_WORKED'
  )
})

test('відʼємний оподатковуваний extra зменшує брутто', () => {
  const plain = calculate({ rates, normHours: 176, input: base })
  const r = calculate({ rates, normHours: 176, input: { ...base, extras: { fine: 300 } } })
  const row = r.rows.find((x) => x.id === 'fine')
  if (row) {
    assert.equal(row.amount, -300)
    assert.equal(r.gross, round2(plain.gross - 300))
  } else {
    // у прикладному конфізі немає оподатковуваного відʼємного extra —
    // перевіряємо на синтетичному профілі, щоб гілка не лишалась без тесту
    const custom = structuredClone(rates)
    custom.profiles['role-a'].extras = [
      { id: 'fine', label: 'Утримання (тест)', kind: 'money', taxable: true, sign: -1 },
    ]
    const r2 = calculate({ rates: custom, normHours: 176, input: { ...base, extras: { fine: 300 } } })
    assert.equal(r2.rows.find((x) => x.id === 'fine').amount, -300)
    assert.equal(r2.gross, round2(plain.gross - 300))
  }
})

test('валідація extras: невідомий kind, count без amount, кривий sign — відхиляються', () => {
  const broken = (patch) => {
    const c = structuredClone(example)
    c.rateVersions[0].profiles['role-a'].extras = [
      { id: 'x', label: 'X', taxable: true, ...patch },
    ]
    return c
  }
  assert.throws(() => assertValidConfig(broken({ kind: 'weird' })), /kind/)
  assert.throws(() => assertValidConfig(broken({ kind: 'count' })), /amount/)
  assert.throws(() => assertValidConfig(broken({ sign: 100 })), /sign/)
  assert.throws(() => assertValidConfig(broken({ max: 2.5 })), /max/)
  assertValidConfig(broken({ kind: 'count', amount: 300, max: 5 })) // здоровий — проходить
})
