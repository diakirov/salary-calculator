import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function nextMonthFirst() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 1)
  return d.toISOString().slice(0, 8) + '01'
}

/**
 * Адмінка: редагування ставок «застосувати з дати».
 * Редактор рекурсивно рендерить числа з останньої версії — покриває податок,
 * ставки, надбавки й коефіцієнти без окремої форми під кожне поле.
 * Збереження створює НОВУ версію; чинні версії недоторкані.
 */
export default function Admin({ onBack }) {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonthFirst())
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState(null) // {kind:'ok'|'error', text}
  const [normYear, setNormYear] = useState('')
  const [normDraft, setNormDraft] = useState(null)

  useEffect(() => {
    api.adminConfig().then((c) => {
      setConfig(c)
      const latest = [...c.rateVersions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1)
      const { id, label: _l, effectiveFrom: _e, ...editable } = structuredClone(latest)
      setDraft(editable)
    })
  }, [])

  const versions = useMemo(
    () => (config ? [...config.rateVersions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) : []),
    [config]
  )

  if (!config || !draft) return null

  async function save() {
    setStatus(null)
    try {
      await api.adminSaveVersion({ effectiveFrom, label: label || `Ставки з ${fmtDate(effectiveFrom)}`, version: draft })
      const c = await api.adminConfig()
      setConfig(c)
      setStatus({ kind: 'ok', text: `Збережено — почне діяти з ${fmtDate(effectiveFrom)}` })
    } catch (e) {
      setStatus({ kind: 'error', text: e.message })
    }
  }

  async function saveNorm() {
    setStatus(null)
    try {
      await api.adminSaveNormHours({ year: normYear, schedules: normDraft })
      const c = await api.adminConfig()
      setConfig(c)
      setNormYear('')
      setNormDraft(null)
      setStatus({ kind: 'ok', text: `Норму годин на ${normYear} збережено` })
    } catch (e) {
      setStatus({ kind: 'error', text: e.message })
    }
  }

  function startNormYear() {
    const year = String(Number(Object.keys(config.normHours).sort().at(-1)) + 1)
    setNormYear(year)
    const schedules = {}
    for (const s of Object.keys(Object.values(config.normHours)[0])) {
      schedules[s] = Array(12).fill(null)
    }
    setNormDraft(schedules)
  }

  return (
    <div className="sc-page">
      <div className="sc-shell">
        <div className="sc-header">
          <div>
            <h1>Адмінка</h1>
            <p>Нова версія ставок — старі місяці рахуються за старими даними</p>
          </div>
          <div className="sc-header-right">
            <button className="sc-link-btn" onClick={onBack}>← До калькулятора</button>
          </div>
        </div>

        {status && <div className={status.kind === 'ok' ? 'sc-ok' : 'sc-error'}>{status.text}</div>}

        <div className="sc-admin-grid">
          <div className="sc-panel">
            <h2>Нова версія ставок</h2>
            <div className="sc-fields-2">
              <div className="sc-field">
                <label>Застосувати з (1-ше число)</label>
                <input
                  type="text"
                  value={effectiveFrom}
                  placeholder="2026-09-01"
                  onChange={(e) => setEffectiveFrom(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
                />
              </div>
              <div className="sc-field">
                <label>Назва (наприклад «Підвищення +10%»)</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <NumberTree node={draft} onChange={setDraft} path={[]} />
            </div>
            <div className="sc-hero-actions">
              <button className="sc-btn" onClick={save}>Створити версію</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="sc-panel">
              <h2>Версії</h2>
              <div className="sc-versions-list">
                {versions.map((v) => (
                  <div className="sc-version-item" key={v.id}>
                    <span>{v.label}</span>
                    <span style={{ color: 'var(--sc-muted)' }}>з {fmtDate(v.effectiveFrom)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="sc-panel">
              <h2>Норма годин</h2>
              {Object.entries(config.normHours).map(([year, schedules]) => (
                <div key={year} style={{ marginBottom: 6 }}>
                  <div className="sc-admin-section-title">{year}</div>
                  {Object.entries(schedules).map(([s, months]) => (
                    <div key={s} className="sc-hint">
                      {s}: {months.map((m) => m ?? '—').join(' · ')}
                    </div>
                  ))}
                </div>
              ))}

              {!normDraft ? (
                <div className="sc-hero-actions">
                  <button className="sc-btn ghost" onClick={startNormYear}>Додати рік</button>
                </div>
              ) : (
                <>
                  <div className="sc-field" style={{ marginTop: 8 }}>
                    <label>Рік</label>
                    <input type="text" value={normYear} onChange={(e) => setNormYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                  </div>
                  {Object.entries(normDraft).map(([s, months]) => (
                    <div key={s} style={{ marginTop: 6 }}>
                      <div className="sc-admin-section-title">{s}</div>
                      <div className="sc-norm-grid">
                        {months.map((m, i) => (
                          <input
                            key={i}
                            type="text"
                            value={m ?? ''}
                            placeholder={`${i + 1}`}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                              setNormDraft((prev) => {
                                const next = structuredClone(prev)
                                next[s][i] = v === '' ? null : Number(v)
                                return next
                              })
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="sc-hero-actions">
                    <button className="sc-btn" onClick={saveNorm}>Зберегти рік</button>
                    <button className="sc-btn ghost" onClick={() => { setNormDraft(null); setNormYear('') }}>Скасувати</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const LABELS = {
  taxRate: 'Податкова ставка (частка)',
  nightMultiplier: 'Нічна надбавка (частка)',
  tenurePercentPerYear: 'Стаж, % за рік (частка)',
  maxTenureYears: 'Стеля стажу, років',
  baseSalary: 'Оклад',
  tenureBaseIncome: 'База надбавки за вислугу',
  premium: 'Премія',
  bonus: 'Надбавка',
  amount: 'Сума',
  max: 'Максимум',
  profiles: 'Профілі',
  stages: 'Стажі',
  zones: 'Зони',
  qualLevels: 'Кваліфікації',
  extras: 'Додаткові рядки',
}

/** Рекурсивний редактор чисел. Рядки/булеві — лише читання, структура незмінна. */
function NumberTree({ node, onChange, path }) {
  if (Array.isArray(node)) {
    return node.map((item, i) => {
      const title = item?.label ?? item?.name ?? item?.id ?? i
      return (
        <div key={i}>
          <div className="sc-admin-section-title">{String(title)}</div>
          <div className="sc-admin-branch">
            <NumberTree
              node={item}
              path={[...path, i]}
              onChange={(next) => onChange(node.map((x, j) => (j === i ? next : x)))}
            />
          </div>
        </div>
      )
    })
  }

  if (node && typeof node === 'object') {
    return Object.entries(node).map(([key, value]) => {
      if (key.startsWith('$') || key === 'color' || key === 'id' || key === 'minZone' || key === 'degradeAtZone' || key === 'degradeTo' || key === 'sign') return null
      if (typeof value === 'number') {
        return (
          <div className="sc-admin-leaf" key={key}>
            <label>{LABELS[key] ?? key}</label>
            <input
              type="text"
              inputMode="decimal"
              value={String(value)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.]/g, '')
                const n = raw === '' ? 0 : parseFloat(raw)
                if (Number.isFinite(n)) onChange({ ...node, [key]: n })
              }}
            />
          </div>
        )
      }
      if (value && typeof value === 'object') {
        const isPlainSection = ['profiles'].includes(key) || Array.isArray(value) || typeof value === 'object'
        return (
          <div key={key}>
            <div className="sc-admin-section-title">
              {LABELS[key] ?? value?.name ?? key}
            </div>
            <div className="sc-admin-branch">
              <NumberTree node={value} path={[...path, key]} onChange={(next) => onChange({ ...node, [key]: next })} />
            </div>
          </div>
        )
      }
      return null
    })
  }

  return null
}
