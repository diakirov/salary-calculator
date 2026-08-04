import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { loadState, saveState, loadHistory, pushHistory, clearAll } from '../store.js'
import { normalizeHours, normalizeMoney, normalizeDigits, parseNum, fmtMoney, MONTH_NAMES } from '../lib/inputs.js'
import VersionBar from './VersionBar.jsx'

const now = new Date()

function emptyForm() {
  return {
    stageId: null,
    schedule: null,
    year: String(now.getFullYear()),
    month: now.getMonth(),
    workedHours: '',
    zoneId: 3,
    qualId: 1,
    tenureYears: '',
    knowledge: false,
    nightHours: '',
    x2Hours: '',
    extras: {},
  }
}

export default function Calculator({ auth, onLogout, onAdmin }) {
  const [meta, setMeta] = useState(null)
  const [profileId, setProfileId] = useState(null)
  const [forms, setForms] = useState({})
  const [versionId, setVersionId] = useState(null)
  const [showGross, setShowGross] = useState(() => !!loadState().showGross)
  const [result, setResult] = useState(null)
  const [calcError, setCalcError] = useState(null)
  const [history, setHistory] = useState(loadHistory)
  const debounce = useRef(null)
  const calcSeq = useRef(0) // захист від гонки: повільна стара відповідь не затирає нову

  // ── Завантаження метаданих і відновлення стану ──
  useEffect(() => {
    api.profiles().then((m) => {
      const saved = loadState()
      const ids = Object.keys(m.profiles)
      const pid = saved.lastProfile && ids.includes(saved.lastProfile) ? saved.lastProfile : ids[0]
      setMeta(m)
      setForms(saved.forms ?? {})
      setProfileId(pid)
    })
  }, [])

  const profile = meta?.profiles[profileId]
  const form = useMemo(() => {
    const f = forms[profileId] ?? emptyForm()
    const schedules = meta?.schedules ?? []
    return {
      ...f,
      schedule: f.schedule ?? schedules[0] ?? '2/2',
      stageId: f.stageId ?? profile?.stages.find((s) => s.default)?.id ?? profile?.stages[0]?.id,
    }
  }, [forms, profileId, meta, profile])

  // ── Збереження стану ──
  useEffect(() => {
    if (!profileId) return
    saveState({ lastProfile: profileId, forms, showGross })
  }, [profileId, forms, showGross])

  function patch(fields) {
    setForms((prev) => ({ ...prev, [profileId]: { ...form, ...fields } }))
    if ('month' in fields || 'year' in fields) setVersionId(null) // ручний вибір версії не липне
  }

  // ── Норма годин для плейсхолдера ──
  const normHours = meta?.normHours?.[form.year]?.[form.schedule]?.[form.month] ?? null

  // ── Валідація ──
  const worked = parseNum(form.workedHours)
  const night = parseNum(form.nightHours)
  const x2 = parseNum(form.x2Hours)
  const effWorked = worked ?? normHours ?? 0
  const errors = {}
  if (worked != null && worked > 350) errors.workedHours = 'Скільки-скільки? 🤨'
  if (night != null && night > effWorked) errors.nightHours = 'Не може бути більше, ніж відпрацьовані години 😅'
  // межа тут ширша, ніж для решти полів, але текст помилки той самий:
  // користувачу не потрібно знати внутрішню механіку множника
  if (x2 != null && x2 > effWorked * 2) errors.x2Hours = 'Не може бути більше, ніж відпрацьовані години 😅'
  const tenure = parseNum(form.tenureYears)
  const tenureHint = tenure != null && tenure >= 15 ? 'ого, та ти легенда! 🐾' : null

  // ── Розрахунок (дебаунс на сервер) ──
  useEffect(() => {
    if (!profile || normHours == null) {
      setResult(null)
      if (profile && normHours == null) setCalcError(`Норма годин для ${form.year} не задана`)
      return
    }
    if (Object.keys(errors).length > 0) return // тримаємо попередній результат, показуємо помилку поля

    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      const seq = ++calcSeq.current
      api
        .calc({
          profileId,
          stageId: form.stageId,
          year: Number(form.year),
          month: form.month,
          schedule: form.schedule,
          zoneId: form.zoneId,
          qualId: form.qualId,
          workedHours: worked ?? normHours,
          knowledge: form.knowledge,
          nightHours: night ?? 0,
          x2Hours: x2 ?? 0,
          tenureYears: Math.floor(tenure ?? 0),
          extras: Object.fromEntries(
            Object.entries(form.extras ?? {}).map(([k, v]) => [k, parseNum(v) ?? 0])
          ),
          ...(versionId ? { versionId } : {}),
        })
        .then((r) => { if (seq !== calcSeq.current) return; setResult(r); setCalcError(null) })
        .catch((e) => { if (seq !== calcSeq.current) return; setCalcError(e.message); if (e.status === 401) onLogout() })
    }, 180)
    return () => clearTimeout(debounce.current)
  }, [profileId, JSON.stringify(form), versionId, normHours])

  if (!meta || !profile) return null

  const zones = profile.zones[form.stageId] ?? []
  const total = result ? (showGross ? result.gross : result.totalNet) : null

  function saveToHistory() {
    if (!result) return
    const entry = {
      id: Date.now(),
      ts: new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      profileId,
      profileName: profile.name,
      totalNet: result.totalNet,
      gross: result.gross,
      form: { ...form },
    }
    setHistory(pushHistory(entry))
  }

  function restore(entry) {
    if (entry.profileId !== profileId && meta.profiles[entry.profileId]) setProfileId(entry.profileId)
    setForms((prev) => ({ ...prev, [entry.profileId]: { ...entry.form } }))
  }

  function resetAll() {
    clearAll()
    setForms({})
    setHistory([])
    setVersionId(null)
  }

  const profileIds = Object.keys(meta.profiles)

  return (
    <div className="sc-page">
      <div className="sc-shell">
        <div className="sc-header">
          <img src="/branding/header.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <div>
            <h1>Калькулятор ЗП</h1>
            <p>Внутрішній інструмент</p>
          </div>
          <div className="sc-header-right">
            {onAdmin && <button className="sc-link-btn" onClick={onAdmin}>Адмінка</button>}
            <button className="sc-link-btn" onClick={onLogout}>Вийти</button>
            <div className="sc-role">{auth.title ?? auth.role}</div>
          </div>
        </div>

        {profileIds.length > 1 && (
          <div className="sc-tabs">
            {profileIds.map((id) => (
              <button key={id} className={`sc-tab ${id === profileId ? 'active' : ''}`} onClick={() => setProfileId(id)}>
                {meta.profiles[id].name}
              </button>
            ))}
          </div>
        )}

        <VersionBar result={result} versions={meta.versions} versionId={versionId} onPickVersion={setVersionId} />

        <div className="sc-grid">
          {/* ── Ліва колонка: параметри ── */}
          <div>
            <div className="sc-panel">
              <h2>Параметри</h2>

              {profile.stages.length > 1 && (
                <div className="sc-field">
                  <label>Стаж на посаді</label>
                  <div className="sc-seg">
                    {profile.stages.map((s) => (
                      <button key={s.id} className={form.stageId === s.id ? 'active' : ''} onClick={() => patch({ stageId: s.id })}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="sc-fields-2">
                <div className="sc-field">
                  <label>Графік</label>
                  <div className="sc-seg">
                    {meta.schedules.map((s) => (
                      <button key={s} className={form.schedule === s ? 'active' : ''} onClick={() => patch({ schedule: s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sc-field">
                  <label>Рік</label>
                  <select value={form.year} onChange={(e) => patch({ year: e.target.value })}>
                    {meta.years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sc-fields-2" style={{ marginTop: 6 }}>
                <div className="sc-field">
                  <label>Місяць</label>
                  <select value={form.month} onChange={(e) => patch({ month: Number(e.target.value) })}>
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i}>{name}</option>
                    ))}
                  </select>
                </div>
                {profile.hasTenure && (
                  <div className="sc-field">
                    <label>Стаж, років</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.tenureYears}
                      placeholder="0"
                      onChange={(e) => patch({ tenureYears: normalizeDigits(e.target.value, 2) })}
                    />
                    {tenureHint && <div className="sc-hint">{tenureHint}</div>}
                  </div>
                )}
              </div>

              <div className="sc-field" style={{ marginTop: 6 }}>
                <label>Відпрацьовано годин {normHours != null ? `(норма ${normHours})` : ''}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.workedHours}
                  placeholder={normHours != null ? String(normHours) : '—'}
                  onChange={(e) => patch({ workedHours: normalizeHours(e.target.value, form.workedHours) })}
                />
                {errors.workedHours && <div className="sc-hint warn">{errors.workedHours}</div>}
              </div>

              <div className="sc-field">
                <label>Зона</label>
                <div className={`sc-chips ${zones.length === 3 ? 'q3' : ''}`}>
                  {zones.map((z) => (
                    <div key={z.id} className={`sc-chip ${form.zoneId === z.id ? 'active' : ''}`} onClick={() => patch({ zoneId: z.id })}>
                      <span className="sc-dot" style={{ background: z.color }} />
                      {z.label.replace(/^\d+ — /, '')}
                    </div>
                  ))}
                </div>
              </div>

              <div className="sc-field">
                <label>Кваліфікація</label>
                <div className="sc-chips q3">
                  {profile.qualLevels.map((q) => (
                    <div key={q.id} className={`sc-chip ${form.qualId === q.id ? 'active' : ''}`} onClick={() => patch({ qualId: q.id })}>
                      {q.label}
                    </div>
                  ))}
                </div>
                {result?.qualNote && <div className="sc-hint">{result.qualNote}</div>}
              </div>

              <div className="sc-field sc-toggle-row">
                <label style={{ marginBottom: 0 }}>Знання (+1 год до відпрацьованих)</label>
                <div className={`sc-switch ${form.knowledge ? 'on' : ''}`} onClick={() => patch({ knowledge: !form.knowledge })}>
                  <i />
                </div>
              </div>

              <div className="sc-fields-2" style={{ marginTop: 6 }}>
                <div className="sc-field">
                  <label>Нічні години</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.nightHours}
                    placeholder="0"
                    onChange={(e) => patch({ nightHours: normalizeHours(e.target.value, form.nightHours) })}
                  />
                  {errors.nightHours && <div className="sc-hint warn">{errors.nightHours}</div>}
                </div>
                <div className="sc-field">
                  <label>Години х2</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.x2Hours}
                    placeholder="0"
                    onChange={(e) => patch({ x2Hours: normalizeHours(e.target.value, form.x2Hours) })}
                  />
                  {errors.x2Hours && <div className="sc-hint warn">{errors.x2Hours}</div>}
                </div>
              </div>

              <ExtrasFields profile={profile} form={form} patch={patch} />

              <div className="sc-fields-2" style={{ marginTop: 6 }}>
                <div className="sc-field">
                  <label>Аванс</label>
                  <input type="text" disabled placeholder="Скоро" />
                </div>
                <div className="sc-field">
                  <label>Тривога</label>
                  <input type="text" disabled placeholder="Скоро" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Права колонка: результат ── */}
          <div>
            <div className="sc-hero">
              <img className="sc-hero-sticker" src="/branding/sticker.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              <div className="sc-hero-top">
                <span className="sc-hero-label">{showGross ? 'До податків' : 'На руки'}</span>
                <div className="sc-hero-toggle">
                  <span>До податків</span>
                  <div className={`sc-switch ${showGross ? 'on' : ''}`} onClick={() => setShowGross(!showGross)}>
                    <i />
                  </div>
                </div>
              </div>
              <div className="sc-hero-num">{calcError ? '—' : fmtMoney(total)}</div>
              <div className="sc-hero-sub">
                {calcError
                  ? calcError
                  : result
                    ? `Ставка ${fmtMoney(showGross ? result.hourlyRate : result.hourlyRate * (1 - result.taxRate))}/год · норма ${result.normHours} год${form.knowledge ? ` · ${result.effectiveHours} год зі знанням` : ''}`
                    : '…'}
              </div>
              <div className="sc-hero-actions">
                <button className="sc-btn" onClick={saveToHistory} disabled={!result}>Зберегти в історію</button>
                <button className="sc-btn ghost" onClick={resetAll}>Скинути</button>
              </div>
            </div>

            <div className="sc-panel">
              <h2>Деталізація</h2>
              <Breakdown result={result} showGross={showGross} />
              <div className="sc-history-divider" />
              <h2 style={{ margin: '0 0 6px' }}>Історія</h2>
              {history.length === 0 ? (
                <div className="sc-history-empty">Поки що порожньо — збережи перший розрахунок</div>
              ) : (
                <div className="sc-history-list">
                  {history.map((h) => (
                    <div key={h.id} className="sc-history-item" onClick={() => restore(h)}>
                      <span className="t">
                        {h.ts}{h.profileName ? ` · ${h.profileName}` : ''}
                      </span>
                      <span className="v">{fmtMoney(h.totalNet)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExtrasFields({ profile, form, patch }) {
  const extras = profile.extras ?? []
  if (extras.length === 0) return null

  function setExtra(id, value) {
    patch({ extras: { ...(form.extras ?? {}), [id]: value } })
  }

  // грошові поля парами, лічильники — окремим рядком
  const counts = extras.filter((e) => e.kind === 'count')
  const moneys = extras.filter((e) => e.kind !== 'count')

  return (
    <>
      {counts.map((e) => (
        <div className="sc-field" style={{ marginTop: 6 }} key={e.id}>
          <label>
            {e.label}
            {e.max ? ` (до ${e.max})` : ''}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={form.extras?.[e.id] ?? ''}
            placeholder="0"
            onChange={(ev) => {
              let v = normalizeDigits(ev.target.value, 2)
              if (e.max && v !== '' && parseInt(v, 10) > e.max) v = String(e.max) // clamp лишили тільки тут
              setExtra(e.id, v)
            }}
          />
        </div>
      ))}
      {moneys.length > 0 && (
        <div className="sc-fields-2" style={{ marginTop: 6 }}>
          {moneys.map((e) => (
            <div className="sc-field" key={e.id}>
              <label>{e.label}, ₴</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.extras?.[e.id] ?? ''}
                placeholder="0"
                onChange={(ev) => setExtra(e.id, normalizeMoney(ev.target.value))}
                onBlur={(ev) => { if (ev.target.value === '0') setExtra(e.id, '') }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Breakdown({ result, showGross }) {
  if (!result) return <div className="sc-history-empty">Введи параметри — все порахується само</div>

  // Кожен рядок показується у валюті активного режиму: в «На руки» оподатковувані
  // рядки множаться на (1 − податок), тож колонка сходиться з підсумком в обох
  // режимах. Підсумки завжди серверні — клієнт нічого не досумовує.
  const k = showGross ? 1 : 1 - result.taxRate

  return (
    <div className="sc-breakdown">
      {result.rows.map((r) => (
        <div className="sc-row" key={r.id}>
          <span className="k">{r.label}</span>
          <span className={`v ${r.amount < 0 ? 'neg' : ''}`}>{fmtMoney(r.amount * k)}</span>
        </div>
      ))}
      {result.netExtras.map((r) => (
        <div className="sc-row" key={r.id}>
          <span className="k">{r.label} (чистими)</span>
          {/* у режимі «до податків» чистих сум не існує в брутто-світі — прочерк, не вигадане брутто */}
          <span className={`v ${showGross ? 'dim' : r.amount < 0 ? 'neg' : ''}`}>
            {showGross ? '—' : `${r.amount > 0 ? '+' : '−'}${fmtMoney(Math.abs(r.amount))}`}
          </span>
        </div>
      ))}
      <div className="sc-row total">
        <span className="k">{showGross ? 'Разом до податків' : 'Разом на руки'}</span>
        <span className="v">{fmtMoney(showGross ? result.gross : result.totalNet)}</span>
      </div>
      {showGross && (
        <>
          {/* довідково під підсумком: скільки з цього брутто піде податком і що лишиться */}
          <div className="sc-row ref">
            <span className="k">Податок {Math.round(result.taxRate * 100)}%</span>
            <span className="v dim">−{fmtMoney(result.tax)}</span>
          </div>
          <div className="sc-row ref">
            <span className="k">На руки</span>
            <span className="v dim">{fmtMoney(result.totalNet)}</span>
          </div>
        </>
      )}
    </div>
  )
}
