import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versionStatus, resolveVersion, versionSpan } from '../src/engine/resolveVersion.js'

const versions = [
  { id: 'v1', effectiveFrom: '2026-03-01' },
  { id: 'v2', effectiveFrom: '2026-06-01' },
  { id: 'v3', effectiveFrom: '2026-09-01' },
]

test('резолв версії за місяцем', () => {
  assert.equal(resolveVersion({ versions, monthKey: '2026-03' }).id, 'v1')
  assert.equal(resolveVersion({ versions, monthKey: '2026-05' }).id, 'v1')
  assert.equal(resolveVersion({ versions, monthKey: '2026-06' }).id, 'v2')
  assert.equal(resolveVersion({ versions, monthKey: '2026-12' }).id, 'v3')
  // до першої версії — найраніша
  assert.equal(resolveVersion({ versions, monthKey: '2026-01' }).id, 'v1')
  // явний вибір перемагає
  assert.equal(resolveVersion({ versions, monthKey: '2026-03', versionId: 'v3' }).id, 'v3')
})

test('пʼять станів попередження', () => {
  const t = (monthKey, todayKey) => versionStatus({ versions, monthKey, todayKey })

  // сьогодні 15.05: травень актуальний, але v2 вже заведена й почне діяти 01.06
  assert.equal(t('2026-05', '2026-05-15'), 'upcoming-exists')
  // сьогодні 15.05, дивимось червень: його версія ще не чинна
  assert.equal(t('2026-06', '2026-05-15'), 'not-yet-active')
  // сьогодні 02.06: червень уже актуальний, наступна версія v3 ще попереду
  assert.equal(t('2026-06', '2026-06-02'), 'upcoming-exists')
  // сьогодні 02.06, дивимось травень: рахуємо за старими даними
  assert.equal(t('2026-05', '2026-06-02'), 'historical')
  // сьогодні 15.10 (v3 чинна, новіших немає): жовтень чистий
  assert.equal(t('2026-10', '2026-10-15'), 'current')
  // місяць до першої версії
  assert.equal(t('2026-01', '2026-10-15'), 'before-first')
})

test('період дії версії', () => {
  assert.deepEqual(versionSpan(versions, 'v1'), { from: '2026-03-01', to: '2026-05-31' })
  assert.deepEqual(versionSpan(versions, 'v3'), { from: '2026-09-01', to: null })
})
