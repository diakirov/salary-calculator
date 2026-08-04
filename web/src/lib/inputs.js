/**
 * Філософія валідації: не приймати некоректне введення, а не виправляти потім.
 * Зайвий символ просто не потрапляє в поле.
 */

/**
 * Години: до 3 цілих цифр, дробова лише .0/.5.
 * Кейс промаху повз крапку: 4-та цифра без роздільника приймається лише
 * якщо це 0 або 5 → `1765 → 176.5`, `1760 → 176`, `1763 → лишається 176`.
 */
export function normalizeHours(raw, prev) {
  let cleaned = raw.replace(/\s/g, '').replace(/[,/]/g, '.').replace(/[^0-9.]/g, '')
  const dotIdx = cleaned.indexOf('.')
  if (dotIdx !== -1) {
    const intPart = cleaned.slice(0, dotIdx).replace(/\./g, '').slice(0, 3)
    let decPart = cleaned.slice(dotIdx + 1).replace(/\./g, '')
    if (decPart.length > 1) decPart = decPart[0]
    if (decPart && decPart !== '0' && decPart !== '5') return prev
    if (decPart === '0') return intPart
    return decPart ? `${intPart}.${decPart}` : `${intPart}.`
  }
  if (cleaned.length <= 3) return cleaned
  if (cleaned.length === 4) {
    const last = cleaned[3]
    const head = cleaned.slice(0, 3)
    if (last === '0') return head
    if (last === '5') return `${head}.5`
    return prev
  }
  return prev
}

/** Тільки цифри, обрізка по довжині. */
export function normalizeDigits(raw, maxLen) {
  let cleaned = raw.replace(/\D/g, '')
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen)
  return cleaned
}

/** Гроші: цілі гривні, до 6 цифр. 0 вводиться; скидання у підказку — на blur. */
export function normalizeMoney(raw) {
  return normalizeDigits(raw, 6)
}

export function parseNum(str) {
  if (str === '' || str == null) return null
  const n = parseFloat(String(str).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function fmtMoney(n) {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('uk-UA')} ₴`
}

export const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
]
