/**
 * Звірка рушія з реальними розрахунковими листами.
 *
 * Фікстури лежать у test/fixtures/private/ (гітігнорено): реальні суми —
 * такий самий секрет, як конфіг. Без файлу тести пропускаються, тому в CI
 * на публічному репо цей файл просто відсутній і сьют зелений.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculate } from '../src/engine/calculate.js'
import { resolveVersion } from '../src/engine/resolveVersion.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(here, 'fixtures/private/payslips.json')
const configPath = process.env.CONFIG_PATH || path.join(here, '../../config/config.json')

const hasPrivate = fs.existsSync(fixturePath) && fs.existsSync(configPath)

test('розрахункові листи сходяться до копійки', { skip: !hasPrivate && 'приватні фікстури відсутні' }, () => {
  const { cases } = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  for (const c of cases) {
    const rates = resolveVersion({ versions: config.rateVersions, monthKey: c.monthKey })
    const [year, month] = c.monthKey.split('-').map(Number)
    const normHours = config.normHours[year]['2/2'][month - 1]

    const result = calculate({ rates, normHours, input: c.input })

    for (const [rowId, expected] of Object.entries(c.expected.rows)) {
      const actual = result.rows.find((r) => r.id === rowId)?.amount
      assert.ok(actual != null, `${c.name}: рядок ${rowId} відсутній`)
      assert.ok(Math.abs(actual - expected) <= 0.011, `${c.name}: ${rowId} = ${actual}, очікували ${expected}`)
    }

    // Внутрішня замкненість: брутто = сума оподатковуваних рядків. Саме цей
    // клас розбіжностей (рядок, що оминає брутто) колись пройшов непоміченим.
    const rowSum = result.rows.reduce((s, r) => s + r.amount, 0)
    assert.ok(Math.abs(result.gross - rowSum) <= 0.005, `${c.name}: gross ${result.gross} ≠ Σрядків ${rowSum}`)
  }
})

test('цільові доходи: години = нормі → середній рівень дає ціль', { skip: !hasPrivate && 'приватні фікстури відсутні' }, () => {
  const { targets } = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const rates = resolveVersion({ versions: config.rateVersions, monthKey: targets.monthKey })

  for (const [profileId, t] of Object.entries(targets.profiles)) {
    const result = calculate({
      rates,
      normHours: targets.normHours,
      input: {
        profileId, stageId: t.stageId, zoneId: targets.zoneId, qualId: 1,
        workedHours: targets.normHours, knowledge: false, extras: {},
      },
    })
    assert.ok(Math.abs(result.gross - t.gross) <= 1, `${profileId}: gross = ${result.gross}, ціль ${t.gross}`)
  }
})
