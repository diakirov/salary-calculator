import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { ThemeButton } from './Calculator.jsx'

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

const todayKey = () => new Date().toISOString().slice(0, 10)

/** Періоди дії: кінець версії — день перед наступною; остання — «досі». */
function withSpans(versions) {
  const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
  return sorted.map((v, i) => {
    const next = sorted[i + 1]
    let to = null
    if (next) {
      const d = new Date(`${next.effectiveFrom}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 1)
      to = d.toISOString().slice(0, 10)
    }
    return { ...v, span: { from: v.effectiveFrom, to } }
  })
}

/**
 * Адмінка для людини, що правитиме ставки руками.
 *
 * Принципи: видно, ЩО редагуєш (версія + період її дії) і ЩО вже змінив
 * (позначки «змінено»); будь-яка небезпечна дія — ретро-вставка, правка
 * чинної/минулої версії, відкат — спершу показує діф «було → стало»
 * і чекає явного підтвердження. Випадково зіпсувати минуле неможливо.
 */
export default function Admin({ onBack }) {
  const [config, setConfig] = useState(null)
  const [tab, setTab] = useState('rates') // rates | general | norm | versions | history | logs
  const [status, setStatus] = useState(null) // {kind:'ok'|'error', text}

  // Що редагуємо: або наявна версія (target=id), або нова з дати (target=null)
  const [targetId, setTargetId] = useState(null)
  const [draft, setDraft] = useState(null) // редагована копія версії (без id/label/effectiveFrom)
  const [baseline, setBaseline] = useState(null) // з чого почали — для позначок «змінено»
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonthFirst())
  const [label, setLabel] = useState('')
  const [profileId, setProfileId] = useState(null)

  // Підтвердження: {changes, warning, run: () => Promise}
  const [pending, setPending] = useState(null)

  const versions = useMemo(() => (config ? withSpans(config.rateVersions) : []), [config])

  async function reload({ keepDraft = false } = {}) {
    const c = await api.adminConfig()
    setConfig(c)
    if (!keepDraft) {
      const latest = withSpans(c.rateVersions).at(-1)
      startEditing(latest, c)
    }
    return c
  }

  function startEditing(version, cfg = config) {
    const { id, label: l, effectiveFrom: ef, span, ...editable } = structuredClone(version)
    setTargetId(version.id)
    setDraft(editable)
    setBaseline(structuredClone(editable))
    setLabel(l ?? '')
    setEffectiveFrom(ef)
    const pids = Object.keys(editable.profiles ?? {})
    setProfileId((prev) => (prev && pids.includes(prev) ? prev : pids[0]))
  }

  function startNewVersion() {
    // нова версія успадковує вміст найновішої
    const latest = versions.at(-1)
    const { id, label: _l, effectiveFrom: _e, span, ...editable } = structuredClone(latest)
    setTargetId(null)
    setDraft(editable)
    setBaseline(structuredClone(editable))
    setLabel('')
    setEffectiveFrom(nextMonthFirst())
  }

  useEffect(() => { reload() }, [])

  if (!config || !draft) return null

  const target = targetId ? versions.find((v) => v.id === targetId) : null
  const targetActive = target && target.effectiveFrom <= todayKey()
  const profileIds = Object.keys(draft.profiles ?? {})
  const dirtyProfiles = profileIds.filter(
    (pid) => JSON.stringify(draft.profiles[pid]) !== JSON.stringify(baseline.profiles?.[pid])
  )
  const generalKeys = ['taxRate', 'nightMultiplier', 'tenurePercentPerYear', 'maxTenureYears']
  const dirtyGeneral = generalKeys.some((k) => draft[k] !== baseline[k])
  const isDirty = dirtyProfiles.length > 0 || dirtyGeneral

  function ok(text) { setStatus({ kind: 'ok', text }); setPending(null) }
  function err(text) { setStatus({ kind: 'error', text }) }

  /** Спільний протокол збереження: dryRun → (діф + підтвердження, якщо треба) → запис. */
  async function saveVersion() {
    setStatus(null)
    const versionLabel = label || `Ставки з ${fmtDate(effectiveFrom)}`
    try {
      if (targetId) {
        const probe = await api.adminEditVersion(targetId, { version: draft, label: versionLabel, dryRun: true })
        if (probe.changes.length === 0) return ok('Змін немає')
        const run = async () => {
          await api.adminEditVersion(targetId, { version: draft, label: versionLabel, confirm: true })
          await reload()
          ok('Зміни збережено')
        }
        if (probe.requiresConfirm) setPending({ ...probe, run, pathRoot: draft })
        else await run()
      } else {
        const body = { effectiveFrom, label: versionLabel, version: draft }
        const probe = await api.adminSaveVersion({ ...body, dryRun: true })
        const run = async () => {
          await api.adminSaveVersion({ ...body, confirm: true })
          await reload()
          ok(`Збережено — діє з ${fmtDate(effectiveFrom)}`)
        }
        if (probe.requiresConfirm) setPending({ ...probe, run, pathRoot: draft })
        else await run()
      }
    } catch (e) {
      err(e.message)
    }
  }

  const tabs = [
    ['rates', `Ставки${dirtyProfiles.length ? ' •' : ''}`],
    ['general', `Загальні${dirtyGeneral ? ' •' : ''}`],
    ['norm', 'Норми годин'],
    ['versions', 'Версії'],
    ['history', 'Історія'],
    ['logs', 'Логи'],
  ]

  return (
    <div className="sc-page">
      <div className="sc-shell">
        <div className="sc-header">
          <div>
            <h1>Адмінка</h1>
            <p>Небезпечні зміни завжди показують «було → стало» і чекають підтвердження</p>
          </div>
          <div className="sc-header-right">
            <ThemeButton />
            <button className="sc-link-btn" onClick={onBack}>← До калькулятора</button>
          </div>
        </div>

        <div className="sc-tabs">
          {tabs.map(([id, title]) => (
            <button key={id} className={`sc-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {title}
            </button>
          ))}
        </div>

        {status && <div className={status.kind === 'ok' ? 'sc-ok' : 'sc-error'}>{status.text}</div>}

        {pending && (
          <ConfirmBox
            pending={pending}
            onCancel={() => setPending(null)}
            onConfirm={() => pending.run().catch((e) => err(e.message))}
          />
        )}

        {(tab === 'rates' || tab === 'general') && (
          <div className="sc-panel">
            <VersionContext
              versions={versions}
              targetId={targetId}
              targetActive={targetActive}
              effectiveFrom={effectiveFrom}
              setEffectiveFrom={setEffectiveFrom}
              label={label}
              setLabel={setLabel}
              onPick={(v) => startEditing(v)}
              onNew={startNewVersion}
            />

            {tab === 'rates' ? (
              <>
                <div className="sc-tabs" style={{ margin: '10px 0 8px' }}>
                  {profileIds.map((pid) => (
                    <button
                      key={pid}
                      className={`sc-tab ${profileId === pid ? 'active' : ''}`}
                      onClick={() => setProfileId(pid)}
                    >
                      {draft.profiles[pid].name ?? pid}
                      {dirtyProfiles.includes(pid) ? ' •' : ''}
                    </button>
                  ))}
                </div>
                <div className="sc-admin-tree-wrap">
                  <NumberTree
                    node={draft.profiles[profileId]}
                    base={baseline.profiles?.[profileId]}
                    onChange={(next) => setDraft({ ...draft, profiles: { ...draft.profiles, [profileId]: next } })}
                  />
                </div>
              </>
            ) : (
              <div className="sc-admin-tree-wrap" style={{ marginTop: 8 }}>
                <NumberTree
                  node={Object.fromEntries(generalKeys.map((k) => [k, draft[k]]))}
                  base={Object.fromEntries(generalKeys.map((k) => [k, baseline[k]]))}
                  onChange={(next) => setDraft({ ...draft, ...next })}
                />
              </div>
            )}

            <div className="sc-hero-actions">
              <button className="sc-btn" onClick={saveVersion} disabled={!isDirty && targetId != null}>
                {targetId ? (targetActive ? 'Зберегти зміни (з підтвердженням)' : 'Зберегти зміни') : 'Створити версію'}
              </button>
              {isDirty && (
                <button className="sc-btn ghost" onClick={() => setDraft(structuredClone(baseline))}>
                  Відкинути зміни
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'norm' && <NormHours config={config} onSaved={(y) => { reload({ keepDraft: true }); ok(`Норму годин на ${y} збережено`) }} onError={err} />}

        {tab === 'versions' && (
          <div className="sc-panel">
            <h2>Версії ставок</h2>
            <div className="sc-versions-list">
              {[...versions].reverse().map((v) => (
                <div className="sc-version-item" key={v.id}>
                  <span>
                    {v.label}
                    {v.effectiveFrom <= todayKey() && (!v.span.to || v.span.to >= todayKey()) ? ' — чинна' : ''}
                  </span>
                  <span style={{ color: 'var(--sc-muted)' }}>
                    {fmtDate(v.span.from)} — {v.span.to ? fmtDate(v.span.to) : 'досі'}
                  </span>
                  <button className="sc-link-btn" onClick={() => { startEditing(v); setTab('rates') }}>
                    Редагувати
                  </button>
                </div>
              ))}
            </div>
            <div className="sc-hint" style={{ marginTop: 6 }}>
              Дата кінця вираховується сама: день перед наступною версією. Дві версії
              одночасно діяти не можуть. Для внесення історії — «Нова версія» з минулою датою.
            </div>
          </div>
        )}

        {tab === 'history' && (
          <History
            config={config}
            onError={err}
            onRolledBack={() => { reload(); ok('Відкат виконано') }}
            setPending={setPending}
          />
        )}

        {tab === 'logs' && <LogsPanel onError={err} />}
      </div>
    </div>
  )
}

/** Що саме редагуємо: наявна версія (з періодом) чи нова з дати. */
function VersionContext({ versions, targetId, targetActive, effectiveFrom, setEffectiveFrom, label, setLabel, onPick, onNew }) {
  return (
    <div>
      <div className="sc-fields-2">
        <div className="sc-field">
          <label>Що редагуємо</label>
          <select
            value={targetId ?? '__new__'}
            onChange={(e) => {
              if (e.target.value === '__new__') onNew()
              else onPick(versions.find((v) => v.id === e.target.value))
            }}
          >
            {[...versions].reverse().map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {fmtDate(v.span.from)} — {v.span.to ? fmtDate(v.span.to) : 'досі'}
              </option>
            ))}
            <option value="__new__">+ Нова версія з дати…</option>
          </select>
        </div>
        {targetId == null ? (
          <div className="sc-field">
            <label>Діє з (1-ше число)</label>
            <input
              type="text"
              value={effectiveFrom}
              placeholder="2026-09-01"
              onChange={(e) => setEffectiveFrom(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
            />
          </div>
        ) : (
          <div className="sc-field">
            <label>Назва версії</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        )}
      </div>
      {targetId == null && (
        <div className="sc-field">
          <label>Назва (наприклад «Підвищення з вересня»)</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      )}
      {targetActive && (
        <div className="sc-hint warn">
          Ця версія вже діяла — збереження перерахує її період заднім числом. Перед записом покажеться діф.
        </div>
      )}
    </div>
  )
}

/** Діф «було → стало» + кнопки підтвердження. */
function ConfirmBox({ pending, onCancel, onConfirm }) {
  const shown = pending.changes.slice(0, 25)
  return (
    <div className="sc-panel sc-confirm">
      <h2>Підтвердь зміни</h2>
      {pending.warning && <div className="sc-hint warn" style={{ marginBottom: 6 }}>{pending.warning}</div>}
      <div className="sc-difflist">
        {shown.map((c, i) => (
          <div className="sc-row" key={i}>
            <span className="k">{humanPath(c.path, pending.pathRoot)}</span>
            <span className="v">
              <span className="dim">{JSON.stringify(c.from)}</span> → <b>{JSON.stringify(c.to)}</b>
            </span>
          </div>
        ))}
        {pending.changes.length > shown.length && (
          <div className="sc-hint">…і ще {pending.changes.length - shown.length} змін</div>
        )}
        {pending.changes.length === 0 && <div className="sc-hint">Змін у полях немає</div>}
      </div>
      <div className="sc-hero-actions">
        <button className="sc-btn" onClick={onConfirm}>Так, застосувати</button>
        <button className="sc-btn ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </div>
  )
}

/** Норми годин: список років, редагування наявного, додавання будь-якого. */
function NormHours({ config, onSaved, onError }) {
  const [year, setYear] = useState('')
  const [draft, setDraft] = useState(null)

  function startYear(y) {
    if (y && config.normHours[y]) {
      setYear(y)
      setDraft(structuredClone(config.normHours[y]))
      return
    }
    const next = String(Number(Object.keys(config.normHours).sort().at(-1)) + 1)
    setYear(y ?? next)
    const schedules = {}
    for (const s of Object.keys(Object.values(config.normHours)[0])) schedules[s] = Array(12).fill(null)
    setDraft(schedules)
  }

  async function save() {
    try {
      await api.adminSaveNormHours({ year, schedules: draft })
      setYear('')
      setDraft(null)
      onSaved(year)
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <div className="sc-panel">
      <h2>Норми годин за роками</h2>
      {Object.entries(config.normHours).map(([y, schedules]) => (
        <div key={y} style={{ marginBottom: 6 }}>
          <div className="sc-admin-section-title">
            {y}{' '}
            <button className="sc-link-btn" onClick={() => startYear(y)}>Редагувати</button>
          </div>
          {Object.entries(schedules).map(([s, months]) => (
            <div key={s} className="sc-hint">{s}: {months.map((m) => m ?? '—').join(' · ')}</div>
          ))}
        </div>
      ))}

      {!draft ? (
        <div className="sc-hero-actions">
          <button className="sc-btn ghost" onClick={() => startYear()}>Додати рік</button>
        </div>
      ) : (
        <>
          <div className="sc-field" style={{ marginTop: 8 }}>
            <label>Рік (можна і минулий — для внесення історії)</label>
            <input type="text" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          {Object.entries(draft).map(([s, months]) => (
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
                      setDraft((prev) => {
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
            <button className="sc-btn" onClick={save}>Зберегти рік</button>
            <button className="sc-btn ghost" onClick={() => { setDraft(null); setYear('') }}>Скасувати</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Історія змін (audit.jsonl) + бекапи з відкатом. */
function History({ config, onError, onRolledBack, setPending }) {
  // Шляхи діфів версійних дій — відносно версії; відкат — відносно конфігу
  const latestVersion = [...config.rateVersions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)).at(-1)
  const rootFor = (action) => (action === 'config.rollback' ? config : latestVersion)
  const [audit, setAudit] = useState(null)
  const [backups, setBackups] = useState(null)
  const [unavailable, setUnavailable] = useState(null)

  useEffect(() => {
    api.adminAudit().then((r) => setAudit(r.entries)).catch((e) => {
      if (e.status === 503) setUnavailable(e.message)
      else onError(e.message)
    })
    api.adminBackups().then((r) => setBackups(r.backups)).catch((e) => onError(e.message))
  }, [])

  async function rollback(name) {
    try {
      const probe = await api.adminRollback({ name, dryRun: true })
      setPending({
        ...probe,
        pathRoot: config,
        warning: `Відкат до бекапа ${name}. Поточний стан теж збережеться бекапом.`,
        run: async () => {
          await api.adminRollback({ name, confirm: true })
          onRolledBack()
        },
      })
    } catch (e) {
      onError(e.message)
    }
  }

  const ACTION_LABELS = {
    'version.create': 'нова версія',
    'version.retro-create': 'ретро-вставка версії',
    'version.replace': 'заміна майбутньої версії',
    'version.edit': 'редагування версії',
    'norm-hours.set': 'норми годин',
    'config.rollback': 'відкат конфігу',
    'logs.snapshot': 'зріз логів',
  }

  return (
    <>
      <div className="sc-panel">
        <h2>Історія змін</h2>
        {unavailable && <div className="sc-hint warn">{unavailable}</div>}
        {audit && audit.length === 0 && <div className="sc-history-empty">Поки що порожньо</div>}
        {audit && audit.length > 0 && (
          <div className="sc-versions-list">
            {audit.map((e, i) => (
              <details key={i} className="sc-audit-item">
                <summary>
                  <span>{ACTION_LABELS[e.action] ?? e.action}{e.versionId ? ` · ${e.versionId}` : ''}{e.year ? ` · ${e.year}` : ''}</span>
                  <span style={{ color: 'var(--sc-muted)' }}>{e.role} · {new Date(e.ts).toLocaleString('uk-UA')}</span>
                </summary>
                <div className="sc-difflist">
                  {(e.changes ?? []).slice(0, 25).map((c, j) => (
                    <div className="sc-row" key={j}>
                      <span className="k">{humanPath(c.path, rootFor(e.action))}</span>
                      <span className="v"><span className="dim">{JSON.stringify(c.from)}</span> → <b>{JSON.stringify(c.to)}</b></span>
                    </div>
                  ))}
                  {(e.changes ?? []).length > 25 && <div className="sc-hint">…і ще {e.changes.length - 25}</div>}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="sc-panel">
        <h2>Бекапи (для відкату)</h2>
        {backups && backups.length === 0 && <div className="sc-history-empty">Бекапів ще немає — вони зʼявляються при кожному збереженні</div>}
        {backups && backups.length > 0 && (
          <div className="sc-versions-list">
            {backups.map((b) => (
              <div className="sc-version-item" key={b.name}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{new Date(b.createdAt).toLocaleString('uk-UA')}</span>
                <span style={{ color: 'var(--sc-muted)' }}>{(b.size / 1024).toFixed(1)} КБ</span>
                <button className="sc-link-btn" onClick={() => rollback(b.name)}>Відкотитись</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/** Кнопка «зберегти зріз логів» + список збережених. */
function LogsPanel({ onError }) {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState(null)
  const [unavailable, setUnavailable] = useState(null)
  const [offer, setOffer] = useState(null) // пропозиція видалити найстаріший
  const [confirmDel, setConfirmDel] = useState(null)

  function refresh() {
    api.adminLogs().then(setData).catch((e) => {
      if (e.status === 503) setUnavailable(e.message)
      else onError(e.message)
    })
  }
  useEffect(refresh, [])

  async function snapshot() {
    try {
      const r = await api.adminLogSnapshot(hours)
      refresh()
      // збереження вже відбулось; при перевищенні лімітів — пропонуємо (не робимо)
      if (r.overLimit && r.oldest) setOffer(r.oldest)
    } catch (e) {
      onError(e.message)
    }
  }

  async function remove(name) {
    try {
      await api.adminLogDelete(name)
      setConfirmDel(null)
      setOffer(null)
      refresh()
    } catch (e) {
      onError(e.message)
    }
  }

  if (unavailable) {
    return (
      <div className="sc-panel">
        <h2>Логи</h2>
        <div className="sc-hint warn">{unavailable}</div>
      </div>
    )
  }

  return (
    <div className="sc-panel">
      <h2>Зрізи логів</h2>
      <div className="sc-fields-2">
        <div className="sc-field">
          <label>Період</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={6}>останні 6 годин</option>
            <option value={12}>останні 12 годин</option>
            <option value={24}>остання доба</option>
            <option value={72}>останні 3 дні</option>
            <option value={168}>останній тиждень</option>
          </select>
        </div>
        <div className="sc-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="sc-btn" onClick={snapshot}>Зберегти зріз</button>
        </div>
      </div>

      {offer && (
        <div className="sc-hint warn" style={{ margin: '6px 0' }}>
          Ліміт зрізів перевищено. Зріз збережено, але варто звільнити місце — видалити
          найстаріший ({offer.name}, {(offer.size / 1024).toFixed(0)} КБ)?{' '}
          <button className="sc-link-btn" onClick={() => remove(offer.name)}>Видалити</button>
          <button className="sc-link-btn" onClick={() => setOffer(null)}>Лишити</button>
        </div>
      )}

      {data && data.files.length === 0 && <div className="sc-history-empty">Збережених зрізів немає</div>}
      {data && data.files.length > 0 && (
        <div className="sc-versions-list" style={{ marginTop: 8 }}>
          {[...data.files].reverse().map((f) => (
            <div className="sc-version-item" key={f.name}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{new Date(f.createdAt).toLocaleString('uk-UA')}</span>
              <span style={{ color: 'var(--sc-muted)' }}>{(f.size / 1024).toFixed(0)} КБ</span>
              <span>
                <a className="sc-link-btn" href={`/api/admin/logs/${f.name}`} download>Завантажити</a>
                {confirmDel === f.name ? (
                  <>
                    <button className="sc-link-btn" style={{ color: 'var(--sc-neg)' }} onClick={() => remove(f.name)}>Точно видалити</button>
                    <button className="sc-link-btn" onClick={() => setConfirmDel(null)}>Ні</button>
                  </>
                ) : (
                  <button className="sc-link-btn" onClick={() => setConfirmDel(f.name)}>Видалити</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {data && (
        <div className="sc-hint" style={{ marginTop: 6 }}>
          {data.files.length} з {data.limits.maxCount} файлів ·{' '}
          {(data.totalBytes / 1024 / 1024).toFixed(1)} з {(data.limits.maxTotalBytes / 1024 / 1024).toFixed(0)} МБ.
          Зрізи не видаляються автоматично — лише вручну звідси.
        </div>
      )}
    </div>
  )
}

/**
 * «profiles.role-a.baseSalary» → «Профіль A · Оклад»: шлях діфа мовою
 * людини, а не рядком із бази. Обʼєкти, що мають name/label, називають себе
 * самі; службові рівні (profiles, zones…) та індекси масивів не показуються.
 */
const SERVICE_KEYS = new Set(['profiles', 'stages', 'zones', 'qualLevels', 'extras', 'rateVersions'])
function humanPath(path, root) {
  const out = []
  let node = root
  for (const part of String(path).split('.')) {
    const child = node && typeof node === 'object' ? node[part] : undefined
    let label
    if (child && typeof child === 'object' && (child.name || child.label)) {
      label = child.name ?? child.label
    } else if (SERVICE_KEYS.has(part) || (Array.isArray(node) && /^\d+$/.test(part))) {
      label = null
    } else {
      label = LABELS[part] ?? part
    }
    if (label) out.push(label)
    node = child
  }
  return out.join(' · ')
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
  labels: 'Підписи рядків',
}

/**
 * Рекурсивний редактор чисел. Рядки/булеві — лише читання, структура незмінна.
 * `base` — той самий вузол зі стану «як завантажили»: біля кожного зміненого
 * поля зʼявляється мітка, щоб після перерви було видно, що вже внесено.
 * Масив з одного елемента не створює зайвого рівня вкладеності.
 */
function NumberTree({ node, base, onChange }) {
  if (Array.isArray(node)) {
    if (node.length === 1) {
      return <NumberTree node={node[0]} base={base?.[0]} onChange={(next) => onChange([next])} />
    }
    return node.map((item, i) => {
      const title = item?.label ?? item?.name ?? item?.id ?? i
      return (
        <div key={i}>
          <div className="sc-admin-section-title">{String(title)}</div>
          <div className="sc-admin-branch">
            <NumberTree node={item} base={base?.[i]} onChange={(next) => onChange(node.map((x, j) => (j === i ? next : x)))} />
          </div>
        </div>
      )
    })
  }

  if (node && typeof node === 'object') {
    return Object.entries(node).map(([key, value]) => {
      if (key.startsWith('$') || key === 'color' || key === 'id' || key === 'minZone' || key === 'degradeAtZone' || key === 'degradeTo' || key === 'sign') return null
      if (typeof value === 'number') {
        const dirty = base != null && base[key] !== value
        return (
          <div className={`sc-admin-leaf${dirty ? ' dirty' : ''}`} key={key}>
            <label>{dirty ? '● ' : ''}{LABELS[key] ?? key}</label>
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
        return (
          <div key={key}>
            <div className="sc-admin-section-title">{LABELS[key] ?? value?.name ?? key}</div>
            <div className="sc-admin-branch">
              <NumberTree node={value} base={base?.[key]} onChange={(next) => onChange({ ...node, [key]: next })} />
            </div>
          </div>
        )
      }
      return null
    })
  }

  return null
}
