/**
 * Рушій розрахунку зарплати.
 *
 * Формула однакова для всіх посад — різняться тільки числа. Тому профіль
 * приходить із конфігу, а тут немає жодної константи предметної області.
 *
 * Порядок операцій навмисно повторює розрахунковий лист бухгалтерії:
 * кожен рядок нарахування округлюється до копійок ОКРЕМО, і лише потім
 * рядки сумуються. Якщо сумувати точні значення й округлити наприкінці —
 * підсумок розходиться на копійку. Це не косметика, це звірка з листом.
 */

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * @param {object} args
 * @param {object} args.rates    — версія ставок (див. resolveVersion)
 * @param {number} args.normHours
 * @param {object} args.input
 * @returns {object} розклад нарахувань
 */
export function calculate({ rates, normHours, input }) {
  const profile = rates.profiles[input.profileId]
  if (!profile) throw new CalcError('UNKNOWN_PROFILE', `Немає профілю ${input.profileId}`)
  if (!normHours || normHours <= 0) throw new CalcError('NO_NORM', 'Норма годин не задана для цього періоду')

  const stage = pickStage(profile, input.stageId)
  const zone = stage.zones.find((z) => z.id === input.zoneId)
  if (!zone) throw new CalcError('UNKNOWN_ZONE', `Немає зони ${input.zoneId}`)

  const workedHours = num(input.workedHours)
  const knowledgeHours = input.knowledge ? 1 : 0
  const effectiveHours = workedHours + knowledgeHours
  const share = effectiveHours / normHours

  const qualBonus = resolveQualBonus(profile.qualLevels, input.qualId, zone.id)
  const tenureBonus = resolveTenureBase(profile, rates, input.tenureYears)

  // Назви рядків — теж дані: беремо з конфігу, у коді лишаються тільки
  // нейтральні запасні варіанти на випадок неповного конфігу.
  const L = rates.labels ?? {}

  // ── Оподатковувані нарахування ────────────────────────────────────────
  const rows = [
    row('salary', L.salary ?? 'Ставка', profile.baseSalary * share),
    row('zone', L.zone ?? 'Надбавка за рівень', zone.premium * share),
  ]

  if (qualBonus > 0) rows.push(row('qual', L.qual ?? 'Надбавка за кваліфікацію', qualBonus * share))
  if (tenureBonus > 0) rows.push(row('tenure', L.tenure ?? 'Надбавка за вислугу', tenureBonus * share))

  const nightHours = num(input.nightHours)
  if (nightHours > 0) {
    rows.push(row('night', L.night ?? 'Нічні години', (profile.baseSalary / normHours) * nightHours * rates.nightMultiplier))
  }

  const x2Hours = num(input.x2Hours)
  if (x2Hours > 0) {
    // Ці години вже пораховані у відпрацьованих, тож тут нараховується лише
    // друга половина подвоєння — і рахується вона по ставці разом із надбавкою
    // за рівень, а не по самій ставці.
    rows.push(row('x2', L.x2 ?? 'Подвоєні години', ((profile.baseSalary + zone.premium) / normHours) * x2Hours))
  }

  // ── Довільні рядки з конфігу: разові доплати й утримання ──────────────
  const taxableExtras = []
  const netExtras = []

  for (const extra of profile.extras ?? []) {
    const amount = extraAmount(extra, input.extras?.[extra.id])
    if (amount === 0) continue
    const signed = amount * (extra.sign ?? 1)
    const entry = row(extra.id, extra.label, signed)
    if (extra.taxable) taxableExtras.push(entry)
    else netExtras.push(entry)
  }

  for (const entry of taxableExtras) rows.push(entry)

  // ── Підсумки ──────────────────────────────────────────────────────────
  const gross = round2(rows.reduce((sum, r) => sum + r.amount, 0))
  const tax = round2(gross * rates.taxRate)
  const net = round2(gross - tax)
  const extrasNet = round2(netExtras.reduce((sum, r) => sum + r.amount, 0))

  return {
    normHours,
    effectiveHours,
    knowledgeHours,
    hourlyRate: round2(profile.baseSalary / normHours),
    zone: { id: zone.id, label: zone.label, color: zone.color },
    stage: { id: stage.id, label: stage.label },
    qualNote: qualNote(profile.qualLevels, input.qualId, zone),
    rows,               // оподатковувані — показуються в обох режимах
    netExtras,          // чисті — у режимі «до податків» їх немає
    gross,
    tax,
    taxRate: rates.taxRate,
    net,
    totalNet: round2(net + extrasNet),
  }
}

// ── Внутрішнє ───────────────────────────────────────────────────────────

export class CalcError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function row(id, label, amount) {
  return { id, label, amount: round2(amount) }
}

function num(value) {
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function pickStage(profile, stageId) {
  const stages = profile.stages ?? []
  if (stages.length === 0) throw new CalcError('NO_STAGES', `У профілі ${profile.name} немає жодного стажу`)
  return stages.find((s) => s.id === stageId) ?? stages.find((s) => s.default) ?? stages[0]
}

/**
 * Рівні впорядковані від найвищого (id 1) до найнижчого, тому умова
 * «не нижче N» — це zoneId <= N. Профіль може задати `degradeAtZone`:
 * на вказаному рівні надбавка виплачується за ставкою іншої кваліфікації
 * (`degradeTo`), а не обнуляється.
 */
function resolveQualBonus(qualLevels, qualId, zoneId) {
  const level = qualLevels.find((q) => q.id === qualId)
  if (!level || !level.bonus) return 0

  if (level.degradeAtZone != null && zoneId === level.degradeAtZone) {
    const fallback = qualLevels.find((q) => q.id === level.degradeTo)
    return fallback?.bonus ?? 0
  }
  if (level.minZone != null && zoneId > level.minZone) return 0
  return level.bonus
}

function qualNote(qualLevels, qualId, zone) {
  const level = qualLevels.find((q) => q.id === qualId)
  if (!level || !level.bonus) return null
  if (level.degradeAtZone != null && zone.id === level.degradeAtZone) {
    const fallback = qualLevels.find((q) => q.id === level.degradeTo)
    return `«${zone.label}»: «${level.label}» оплачується як «${fallback?.label ?? ''}»`
  }
  if (level.minZone != null && zone.id > level.minZone) {
    return `«${zone.label}»: надбавка за «${level.label}» не виплачується`
  }
  return null
}

/**
 * База надбавки за вислугу — окреме число профілю (`tenureBaseIncome`),
 * а не ставка й не «ставка + надбавка за рівень». Виглядає як зайва
 * сутність, але саме тому і задається явно: підстановка ставки замість неї
 * дає близький, проте неправильний результат.
 */
function resolveTenureBase(profile, rates, tenureYears) {
  const years = Math.max(0, Math.min(Math.floor(num(tenureYears)), rates.maxTenureYears))
  if (years === 0 || !profile.tenureBaseIncome) return 0
  return profile.tenureBaseIncome * rates.tenurePercentPerYear * years
}

function extraAmount(extra, raw) {
  if (extra.kind === 'count') {
    const count = Math.max(0, Math.min(Math.floor(num(raw)), extra.max ?? Infinity))
    return count * extra.amount
  }
  return num(raw)
}
