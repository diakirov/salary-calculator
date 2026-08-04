import React from 'react'

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/**
 * Смуга станів версії ставок. П'ять станів із плану + explicit (ручний вибір).
 * З'являється лише коли є що сказати — актуальний місяць без новин не шумить.
 */
export default function VersionBar({ result, versions, versionId, onPickVersion }) {
  if (!result) return null
  const status = result.versionStatus
  const current = result.version

  if (status === 'explicit') {
    return (
      <div className="sc-warnbar warn">
        <span>
          Рахуємо за версією «{current.label}» — обрано вручну.
        </span>
        <button className="sc-link-btn" onClick={() => onPickVersion(null)}>Повернути автоматичну</button>
      </div>
    )
  }

  if (status === 'current') return null

  if (status === 'upcoming-exists') {
    const upcoming = [...versions]
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .find((v) => v.effectiveFrom > current.effectiveFrom)
    if (!upcoming) return null
    return (
      <div className="sc-warnbar info">
        <span>З {fmtDate(upcoming.effectiveFrom)} буде оновлення ставок{upcoming.label ? ` — «${upcoming.label}»` : ''}.</span>
      </div>
    )
  }

  if (status === 'not-yet-active') {
    return (
      <div className="sc-warnbar info">
        <span>Ця ставка почне діяти з {fmtDate(current.effectiveFrom)}.</span>
      </div>
    )
  }

  if (status === 'historical' || status === 'before-first') {
    const span = versions.find((v) => v.id === current.id)?.span
    return (
      <div className="sc-warnbar warn">
        <span>
          {status === 'before-first'
            ? 'Точних ставок за цей період немає — рахуємо за найранішими відомими.'
            : `Рахуємо за ставками, що діяли з ${fmtDate(span?.from)}${span?.to ? ` по ${fmtDate(span.to)}` : ''}.`}
        </span>
        <select value={versionId ?? ''} onChange={(e) => onPickVersion(e.target.value || null)}>
          <option value="">Автоматично (за місяцем)</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} · з {fmtDate(v.effectiveFrom)}{v.span?.to ? ` по ${fmtDate(v.span.to)}` : ' — досі'}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return null
}
