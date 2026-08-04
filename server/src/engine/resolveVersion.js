/**
 * Резолв версії ставок за місяцем розрахунку.
 *
 * Ставки міняються з певної дати (завжди 1-ше число). Старі місяці рахуються
 * за версією, що діяла тоді; конфіг зберігає всі версії, нічого не
 * перезаписуючи. Статуси попереджень — для смуги над результатом.
 */

/** @returns {'current'|'upcoming-exists'|'not-yet-active'|'historical'|'before-first'} */
export function versionStatus({ versions, monthKey, todayKey }) {
  const sorted = sortVersions(versions)
  const monthStart = `${monthKey}-01`
  const applicable = pickForMonth(sorted, monthKey)
  const current = pickForMonth(sorted, todayKey.slice(0, 7))

  if (!applicable) return 'before-first'
  if (applicable.effectiveFrom > todayKey) return 'not-yet-active'
  if (current && applicable.id !== current.id) return 'historical'
  const upcoming = sorted.find((v) => v.effectiveFrom > todayKey && v.effectiveFrom > monthStart)
  if (upcoming) return 'upcoming-exists'
  return 'current'
}

/**
 * Версія для місяця: найпізніший effectiveFrom ≤ 1-го числа місяця.
 * Для місяців до найпершої версії — найраніша (з попередженням у статусі).
 */
export function resolveVersion({ versions, monthKey, versionId }) {
  const sorted = sortVersions(versions)
  if (sorted.length === 0) throw new Error('У конфізі немає жодної версії ставок')

  if (versionId) {
    const explicit = sorted.find((v) => v.id === versionId)
    if (!explicit) throw new Error(`Немає версії ставок ${versionId}`)
    return explicit
  }
  return pickForMonth(sorted, monthKey) ?? sorted[0]
}

/** Період дії версії — для підписів «діяла з … по …». */
export function versionSpan(versions, id) {
  const sorted = sortVersions(versions)
  const idx = sorted.findIndex((v) => v.id === id)
  if (idx === -1) return null
  const next = sorted[idx + 1]
  return {
    from: sorted[idx].effectiveFrom,
    to: next ? dayBefore(next.effectiveFrom) : null, // null = досі чинна
  }
}

function sortVersions(versions) {
  return [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

function pickForMonth(sorted, monthKey) {
  const monthStart = `${monthKey}-01`
  let found = null
  for (const v of sorted) {
    if (v.effectiveFrom <= monthStart) found = v
  }
  return found
}

function dayBefore(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
