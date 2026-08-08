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

/**
 * Чому набране відхилилось — коли це схоже на час.
 *
 * `normalizeHours` мовчить: символ просто не зʼявляється, і людина не
 * розуміє, чому «0,5» ставиться, а «0,3» ні (скарга з практики).
 * Найімовірніша причина такого набору — запис годин через двокрапку:
 * «10,30» це 10 год 30 хв, тобто 10.5. Саме цей випадок і озвучуємо.
 *
 * Мовчимо там, де здогад був би вигадкою: цифри 6–9 у хвилинах не бувають,
 * а промах повз крапку (`1763`) — це не час. Загального «так не можна»
 * тут немає навмисно: правило пояснюється в іншому місці, не над полем.
 *
 * @returns {{ text: string, value: string } | null}
 */
export function hoursTimeHint(raw, prev) {
  if (normalizeHours(raw, prev) !== prev || raw === prev) return null

  const cleaned = raw.replace(/\s/g, '').replace(/[,/]/g, '.').replace(/[^0-9.]/g, '')
  const dotIdx = cleaned.indexOf('.')
  if (dotIdx === -1) return null

  const hoursPart = cleaned.slice(0, dotIdx).replace(/\./g, '').slice(0, 3)
  const digit = cleaned.slice(dotIdx + 1).replace(/\./g, '')[0]
  if (!hoursPart || !/^[1-4]$/.test(digit)) return null

  const minutes = Number(digit) * 10
  // 10 хв ближче до цілої години, 20–40 — до половини
  const value = minutes < 15 ? hoursPart : `${hoursPart}.5`
  return { text: `${hoursPart},${digit}0 — це ${hoursPart} год ${minutes} хв? Тоді ${value}`, value }
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

// Показ копійок — глобальний режим відображення (кнопка «,00» у шапці).
// На розрахунок не впливає; без копійок гроші округлюються ЗАВЖДИ ВНИЗ
// (рішення власника: краще показати менше, ніж пообіцяти зайве).
let centsDisplay = false

export function setCentsDisplay(on) {
  centsDisplay = !!on
}

export function fmtMoney(n) {
  if (n == null) return '—'
  if (centsDisplay) {
    return `${n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`
  }
  return `${Math.floor(n).toLocaleString('uk-UA')} ₴`
}

export const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
]
