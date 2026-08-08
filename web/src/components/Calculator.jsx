import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { loadState, saveState, loadHistory, pushHistory, removeHistoryEntry, clearFormState, clearHistory } from '../store.js'
import { normalizeHours, hoursTimeHint, normalizeMoney, normalizeDigits, parseNum, fmtMoney, setCentsDisplay, MONTH_NAMES } from '../lib/inputs.js'
import VersionBar from './VersionBar.jsx'
import { currentTheme, toggleTheme } from '../theme.js'

// Іконки — інлайн SVG, не юнікод-символи: гліфи ☾/☀ на Windows беруться
// з системного фолбек-шрифту й пливуть за формою та базовою лінією
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" />
  </svg>
)

/** Перемикач теми: місяць у світлій пропонує темну, сонце навпаки. */
export function ThemeButton() {
  const [theme, setTheme] = useState(currentTheme)
  return (
    <button
      className="sc-link-btn sc-icon-btn"
      title={theme === 'light' ? 'Темна тема' : 'Світла тема'}
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}

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
    knowledge: true, // за замовчуванням увімкнено — переважна більшість підтверджує знання
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
  const [showCents, setShowCents] = useState(() => localStorage.getItem('sc-cents') === '1')
  const [confirmWipe, setConfirmWipe] = useState(false) // корзина історії: перший клік — питання
  const [confirmedHours, setConfirmedHours] = useState(null) // «Ого, точно?» — підтверджене значення
  const [timeHint, setTimeHint] = useState(null) // { field, text, value } — «10,30 це 10.5?»
  const [copied, setCopied] = useState(false)
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
      knowledge: f.knowledge ?? true,
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

  // ── Годинні поля: ввід + підказка про «10,30» ──
  // Підказка живе рівно доти, доки людина на ній: виправила сама, пішла в
  // інше поле, проскролила чи просто забила — зникає. Нічого не перекриває,
  // бо це звичайний рядок у потоці під полем.
  function onHoursChange(field) {
    return (e) => {
      const raw = e.target.value
      const hint = hoursTimeHint(raw, form[field])
      setTimeHint(hint ? { field, ...hint } : null)
      patch({ [field]: normalizeHours(raw, form[field]) })
    }
  }

  function applyTimeHint() {
    patch({ [timeHint.field]: timeHint.value })
    setTimeHint(null)
  }

  useEffect(() => {
    if (!timeHint) return
    const drop = () => setTimeHint(null)
    const timer = setTimeout(drop, 12000) // встигнути прочитати й вирішити, але не висіти
    window.addEventListener('scroll', drop, { passive: true, capture: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', drop, { capture: true })
    }
  }, [timeHint])

  // ── Норма годин для плейсхолдера ──
  const normHours = meta?.normHours?.[form.year]?.[form.schedule]?.[form.month] ?? null

  // ── Валідація ──
  const worked = parseNum(form.workedHours)
  const night = parseNum(form.nightHours)
  const x2 = parseNum(form.x2Hours)
  const effWorked = worked ?? normHours ?? 0
  const errors = {}
  // Мінус зараз недосяжний (normalizeHours його ріже), але якщо нормалізація
  // колись зміниться — жарт уже чекає, а не NaN.
  if (worked != null && worked < 0) errors.workedHours = 'Йойь, як таке можливо?🥹'
  else if (worked != null && worked > 501) errors.workedHours = 'Ну стільки точно не зможеш😁'
  // 302–501 — можливо, але підозріло: рахуємо лише після явного «так, точно»
  const needsConfirm =
    worked != null && worked > 301 && !errors.workedHours && confirmedHours !== worked
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
    if (Object.keys(errors).length > 0 || needsConfirm) return // тримаємо попередній результат, показуємо помилку/питання

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
        .catch((e) => { if (seq !== calcSeq.current) return; setCalcError(e.message); if (e.status === 401) onLogout({ expired: true }) })
    }, 180)
    return () => clearTimeout(debounce.current)
  }, [profileId, JSON.stringify(form), versionId, normHours, needsConfirm])

  // Питання корзини живе, поки клікаєш у ньому; клік будь-де інде — скасування
  useEffect(() => {
    if (!confirmWipe) return
    const cancel = (e) => {
      if (!e.target.closest?.('.sc-history-head, .sc-history-wipe')) setConfirmWipe(false)
    }
    document.addEventListener('click', cancel)
    return () => document.removeEventListener('click', cancel)
  }, [confirmWipe])

  if (!meta || !profile) return null

  const zones = profile.zones[form.stageId] ?? []
  const total = result ? (showGross ? result.gross : result.totalNet) : null

  setCentsDisplay(showCents) // до рендеру дітей, щоб fmtMoney скрізь був у одному режимі

  function toggleCents() {
    const next = !showCents
    localStorage.setItem('sc-cents', next ? '1' : '')
    setShowCents(next)
  }

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

  function copyResult() {
    if (!result) return
    const k = showGross ? 1 : 1 - result.taxRate
    const lines = [
      `${profile.name} · ${MONTH_NAMES[form.month]} ${form.year} · ${showGross ? 'до податків' : 'на руки'}`,
    ]
    for (const r of result.rows) lines.push(`${r.label}: ${fmtMoney(r.amount * k)}`)
    const extraLine = (r) => `${r.label} (чистими): ${r.amount > 0 ? '+' : '−'}${fmtMoney(Math.abs(r.amount))}`
    if (!showGross) for (const r of result.netExtras) lines.push(extraLine(r))
    lines.push(`Разом ${showGross ? 'до податків' : 'на руки'}: ${fmtMoney(showGross ? result.gross : result.totalNet)}`)
    if (showGross) {
      lines.push(`Податок ${Math.round(result.taxRate * 100)}%: −${fmtMoney(result.tax)}`)
      for (const r of result.netExtras) lines.push(extraLine(r))
      lines.push(`На руки: ${fmtMoney(result.totalNet)}`)
    }
    if (result.version?.label) lines.push(`Ставки: ${result.version.label}`)
    const text = lines.join('\n')

    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
    } else {
      fallbackCopy(text, done)
    }
  }

  function restore(entry) {
    if (entry.profileId !== profileId && meta.profiles[entry.profileId]) setProfileId(entry.profileId)
    setForms((prev) => ({ ...prev, [entry.profileId]: { ...entry.form } }))
  }

  // Скидає тільки калькулятор: історію не чіпає (у неї своя корзина)
  function resetAll() {
    clearFormState()
    setForms({})
    setVersionId(null)
  }

  function removeEntry(id) {
    setHistory(removeHistoryEntry(id))
  }

  function wipeHistory() {
    clearHistory()
    setHistory([])
    setConfirmWipe(false)
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
            <ThemeButton />
            <button
              className={`sc-link-btn sc-cents-btn ${showCents ? 'on' : ''}`}
              title={showCents ? 'Ховати копійки' : 'Показувати копійки'}
              onClick={toggleCents}
            >
              ,00
            </button>
            {onAdmin && <button className="sc-link-btn" onClick={onAdmin}>Адмінка</button>}
            <button className="sc-link-btn" onClick={() => onLogout()}>Вийти</button>
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
                  onChange={onHoursChange('workedHours')}
                  onBlur={() => setTimeHint(null)}
                />
                <TimeHint hint={timeHint} field="workedHours" onApply={applyTimeHint} />
                {errors.workedHours && <div className="sc-hint warn">{errors.workedHours}</div>}
                {needsConfirm && (
                  <div className="sc-hint warn">
                    Ого, точно стільки відпрацюєш?👀{' '}
                    <button type="button" className="sc-link-btn" onClick={() => setConfirmedHours(worked)}>
                      Так, точно
                    </button>
                  </div>
                )}
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
                    onChange={onHoursChange('nightHours')}
                    onBlur={() => setTimeHint(null)}
                  />
                  <TimeHint hint={timeHint} field="nightHours" onApply={applyTimeHint} />
                  {errors.nightHours && <div className="sc-hint warn">{errors.nightHours}</div>}
                </div>
                <div className="sc-field">
                  <label>Години х2</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.x2Hours}
                    placeholder="0"
                    onChange={onHoursChange('x2Hours')}
                    onBlur={() => setTimeHint(null)}
                  />
                  <TimeHint hint={timeHint} field="x2Hours" onApply={applyTimeHint} />
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
                  {/* тумблер підписаний тим, що вмикає, а не станом: «До податків»
                      біля вимкненого перемикача читалось як брехня про режим */}
                  <span>Податки</span>
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
                <button className="sc-btn ghost" onClick={copyResult} disabled={!result}>
                  {copied ? 'Скопійовано ✓' : 'Скопіювати'}
                </button>
                <button className="sc-btn ghost" onClick={resetAll}>Скинути</button>
              </div>
            </div>

            <div className="sc-panel">
              <h2>Деталізація</h2>
              <Breakdown result={result} showGross={showGross} />
              <HowCalculated result={result} form={form} profile={profile} showGross={showGross} />
              <div className="sc-history-divider" />
              <div className="sc-history-head">
                <h2 style={{ margin: 0 }}>Історія</h2>
                {history.length > 0 && (
                  <button
                    type="button"
                    className="sc-link-btn"
                    title="Стерти всю історію"
                    onClick={() => setConfirmWipe(!confirmWipe)}
                  >
                    🗑
                  </button>
                )}
              </div>
              {confirmWipe && history.length > 0 && (
                <div className="sc-hint warn sc-history-wipe" style={{ margin: '0 0 4px' }}>
                  Стерти всю історію ({history.length === 1 ? '1 запис' : `${history.length} зап.`})? Відновити не вийде.{' '}
                  <button type="button" className="sc-link-btn" onClick={wipeHistory}>Так, стерти</button>
                </div>
              )}
              {history.length === 0 ? (
                <div className="sc-history-empty">Поки що порожньо — збережи перший розрахунок</div>
              ) : (
                <>
                  <div className="sc-hint" style={{ margin: '0 0 4px' }}>
                    Натисни на запис — він відновиться у форму (поточні значення заміняться)
                  </div>
                  <div className="sc-history-list">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        className="sc-history-item"
                        title="Відновити цей розрахунок у форму"
                        onClick={() => restore(h)}
                      >
                        <span className="t">
                          {h.ts}{h.profileName ? ` · ${h.profileName}` : ''}
                        </span>
                        <span className="v">{fmtMoney(h.totalNet)} <span className="sc-restore">↺</span></span>
                        <button
                          type="button"
                          className="sc-history-del"
                          title="Видалити цей запис"
                          onClick={(e) => { e.stopPropagation(); removeEntry(h.id) }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <Signature configUpdatedAt={auth.configUpdatedAt} />
      </div>
    </div>
  )
}

/**
 * Підпис унизу сторінки. Дата створення — з першого коміту першої версії
 * (07.05.2026); публічна історія репозиторію новіша, тому спирається на
 * приватну. `updated` — коли востаннє чіпали конфіг зі ставками; якщо сервер
 * його не віддав, шматок просто не рендериться, «undefined» тут бути не може.
 */
function Signature({ configUpdatedAt }) {
  const updated = formatConfigDate(configUpdatedAt)
  return (
    <div className="sc-signature">
      by diakirov · created 07.05.2026
      {updated ? ` · updated ${updated}` : ''} · v{__APP_VERSION__}
    </div>
  )
}

function formatConfigDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Підказка «10,30 — це 10 год 30 хв?». Клік по ній самій підставляє значення,
 * окремої кнопки немає. `onMouseDown` гасить фокус: інакше `blur` поля встиг
 * би сховати підказку раніше, ніж спрацює клік по ній.
 */
function TimeHint({ hint, field, onApply }) {
  if (!hint || hint.field !== field) return null
  return (
    <button type="button" className="sc-hint sc-hint-fix" onMouseDown={(e) => e.preventDefault()} onClick={onApply}>
      {hint.text}
    </button>
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
          {e.hint && <div className="sc-hint">{e.hint}</div>}
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
              {e.hint && <div className="sc-hint">{e.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Фолбек копіювання для WebKit без clipboard API (http, старі iOS). */
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); done() } catch { /* мовчки: гірше не стало */ }
  document.body.removeChild(ta)
}

/**
 * «Як пораховано» — та сама форма запису, що в презентації для новачків:
 * `сума / норма × відпрацьовані = результат`, без часток і відсотків
 * (єдиний відсоток — податок). Числа реальні, з цього-от розрахунку;
 * складові виводяться назад із сум відповіді — сервер зайвого не шле.
 */
function HowCalculated({ result, form, profile, showGross }) {
  if (!result) return null
  const norm = result.normHours
  const hours = result.effectiveHours
  const share = hours / norm
  const f = fmtMoney
  const nightH = parseNum(form.nightHours) ?? 0
  const x2H = parseNum(form.x2Hours) ?? 0
  const tenureY = Math.floor(parseNum(form.tenureYears) ?? 0)

  // `база / норма × години = сума` — рівно як у презентації.
  // Назви рядків — ті самі, що в деталізації (приходять із конфігу).
  const prop = (amount) => `${f((amount * norm) / hours)} / ${norm} × ${hours} = ${f(amount)}`

  const lines = []
  for (const r of result.rows) {
    if (share > 0 && (r.id === 'salary' || r.id === 'zone' || r.id === 'qual')) {
      lines.push([r.label, prop(r.amount)])
    } else if (share > 0 && r.id === 'tenure') {
      lines.push([r.label, `${prop(r.amount)} (за ${tenureY} р. стажу)`])
    } else if (r.id === 'night' && nightH > 0) {
      const mult = Math.round((r.amount / (result.hourlyRate * nightH)) * 100) / 100
      lines.push([r.label, `${f(result.hourlyRate)} за год × ${nightH} год × ${mult} = ${f(r.amount)}`])
    } else if (r.id === 'x2' && x2H > 0) {
      lines.push([r.label, `${f(r.amount / x2H)} за год × ${x2H} год = ${f(r.amount)}`])
    }
  }

  // Доплати й утримання живуть усередині брутто, і на око це не очевидно:
  // введене утримання коштує менше за номінал, а обіцяне чистими стоїть
  // у нарахуваннях більшим числом. Обидва випадки треба сказати словами.
  const net = (amount) => f(amount * (1 - result.taxRate))
  const extraLines = []
  for (const e of profile?.extras ?? []) {
    const r = result.rows.find((x) => x.id === e.id)
    if (!r) continue
    extraLines.push([
      r.label,
      e.grossUpNet
        ? `${f(r.amount)} у нарахуваннях — це обіцяна сума, збільшена на податок, щоб на руки лягло рівно стільки, скільки обіцяли`
        : `${f(r.amount)} — до податку, тобто на руки це ${net(r.amount)}`,
    ])
  }

  return (
    <details className="sc-how">
      <summary>Як пораховано</summary>
      <div className="sc-how-body">
        <p>
          Норма — {norm} год, відпрацьовано — {hours} год
          {form.knowledge ? ` (${result.effectiveHours - 1} + 1 за знання)` : ''}.
        </p>
        {lines.map(([label, text]) => (
          <p key={label}>
            <b>{label}:</b> {text}
          </p>
        ))}
        {extraLines.map(([label, text]) => (
          <p key={label}>
            <b>{label}:</b> {text}
          </p>
        ))}
        <p>
          <b>Податок:</b> {f(result.gross)} × {Math.round(result.taxRate * 100)}% = −{f(result.tax)}
        </p>
        {result.netExtras.map((r) => (
          <p key={r.id}>
            <b>{r.label}:</b> {r.amount > 0 ? '+' : '−'}{f(Math.abs(r.amount))} — чистими, податок їх не чіпає.
          </p>
        ))}
        {!showGross && (
          <p>У режимі «На руки» кожен рядок показано вже після податку.</p>
        )}
      </div>
    </details>
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
      {!showGross &&
        result.netExtras.map((r) => (
          <div className="sc-row" key={r.id}>
            <span className="k">{r.label} (чистими)</span>
            <span className={`v ${r.amount < 0 ? 'neg' : ''}`}>
              {r.amount > 0 ? '+' : '−'}{fmtMoney(Math.abs(r.amount))}
            </span>
          </div>
        ))}
      <div className="sc-row total">
        <span className="k">{showGross ? 'Разом до податків' : 'Разом на руки'}</span>
        <span className="v">{fmtMoney(showGross ? result.gross : result.totalNet)}</span>
      </div>
      {showGross && (
        <>
          {/* довідково під підсумком: податок, чисті доплати (вигаданого брутто
              для них не існує, але й зникати вони не повинні) і фінальне «на руки» */}
          <div className="sc-row ref">
            <span className="k">Податок {Math.round(result.taxRate * 100)}%</span>
            <span className="v dim">−{fmtMoney(result.tax)}</span>
          </div>
          {result.netExtras.map((r) => (
            <div className="sc-row ref" key={r.id}>
              <span className="k">{r.label} (чистими)</span>
              <span className="v dim">{r.amount > 0 ? '+' : '−'}{fmtMoney(Math.abs(r.amount))}</span>
            </div>
          ))}
          <div className="sc-row ref">
            <span className="k">На руки</span>
            <span className="v dim">{fmtMoney(result.totalNet)}</span>
          </div>
        </>
      )}
    </div>
  )
}
