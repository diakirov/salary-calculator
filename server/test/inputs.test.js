/**
 * Тести клієнтських нормалізаторів вводу.
 *
 * `web/src/lib/inputs.js` — чистий ESM без імпортів, тож його можна ганяти
 * тим самим `node --test`, що й сервер, не заводячи окремого раннера для web.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHours, hoursTimeHint } from '../../web/src/lib/inputs.js'

test('normalizeHours: дробова лише .0/.5, промах повз крапку — 4-та цифра', () => {
  assert.equal(normalizeHours('10.5', '10.'), '10.5')
  assert.equal(normalizeHours('10.0', '10.'), '10')
  assert.equal(normalizeHours('10.3', '10.'), '10.') // відхилено, поле не змінюється
  assert.equal(normalizeHours('1765', '176'), '176.5')
  assert.equal(normalizeHours('1763', '176'), '176')
})

test('hoursTimeHint: озвучує лише те, що схоже на час', () => {
  assert.equal(hoursTimeHint('10.3', '10.').value, '10.5') // 30 хв → половина
  assert.equal(hoursTimeHint('10.2', '10.').value, '10.5') // 20 хв → теж половина
  assert.equal(hoursTimeHint('10.4', '10.').value, '10.5')
  assert.equal(hoursTimeHint('10.1', '10.').value, '10') // 10 хв ближче до цілої
  assert.match(hoursTimeHint('10.3', '10.').text, /10,30 — це 10 год 30 хв\? Тоді 10\.5/)
})

test('hoursTimeHint: мовчить там, де здогад був би вигадкою', () => {
  assert.equal(hoursTimeHint('10.5', '10.'), null) // прийнято — пояснювати нічого
  assert.equal(hoursTimeHint('10.0', '10.'), null)
  assert.equal(hoursTimeHint('10.7', '10.'), null) // 70 хвилин не буває
  assert.equal(hoursTimeHint('10.9', '10.'), null)
  assert.equal(hoursTimeHint('1763', '176'), null) // промах повз крапку — це не час
  assert.equal(hoursTimeHint('176', '176'), null) // нічого не змінилось
  assert.equal(hoursTimeHint('.3', '.'), null) // годин ще немає — нема про що питати
})
