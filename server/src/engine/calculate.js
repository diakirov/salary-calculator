/**
 * Рушій розрахунку зарплати.
 *
 * Формула однакова для всіх посад — різняться тільки числа. Тому профіль
 * приходить із конфігу, а тут немає жодної константи предметної області.
 *
 * Порядок операцій навмисно повторює розрахунковий лист бухгалтерії:
 * рядки рахуються з повною точністю, брутто — це округлена сума ТОЧНИХ
 * значень, і лише для показу кожен рядок округлюється окремо. Саме так
 * рахує лист: у ньому видно округлені рядки, але «Всього нараховано»
 * зведене з точних (звірено на липні 2026 — сума округлених дає на
 * копійку більше, ніж стоїть у листі).
 *
 * Доплати й утримання діляться на три види, і різниця не косметична:
 *   • не оподатковувані (`taxable: false`) — додаються після податку;
 *   • номінальні в брутто (`taxable: true`) — утримання: людина вписує
 *     число з табеля, воно знімається до податку;
 *   • обіцяні чистими (`taxable: true, grossUpNet: true`) — бухгалтерія
 *     грос-апить їх так, щоб на руки лягла рівно обіцяна сума, тому в
 *     брутто йде amount / (1 − податок).
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

  // Крос-перевірки погодинних полів — тут, а не лише в UI: схема руту
  // перевіряє кожне поле окремо і цю залежність не бачить.
  if (num(input.nightHours) > effectiveHours) {
    throw new CalcError('NIGHT_GT_WORKED', 'Нічних годин не може бути більше, ніж відпрацьованих')
  }
  if (num(input.x2Hours) > workedHours * 2) {
    throw new CalcError('X2_GT_WORKED', 'Подвоєних годин не може бути більше, ніж відпрацьованих')
  }

  const qual = resolveQual(profile.qualLevels, input.qualId, zone)
  const tenureBonus = resolveTenureBase(profile, rates, input.tenureYears)

  // Назви рядків — теж дані: беремо з конфігу, у коді лишаються тільки
  // нейтральні запасні варіанти на випадок неповного конфігу.
  const L = rates.labels ?? {}

  // ── Оподатковувані нарахування ────────────────────────────────────────
  const rows = [
    row('salary', L.salary ?? 'Ставка', profile.baseSalary * share),
    row('zone', L.zone ?? 'Надбавка за рівень', zone.premium * share),
  ]

  if (qual.bonus > 0) rows.push(row('qual', L.qual ?? 'Надбавка за кваліфікацію', qual.bonus * share))
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
  const netExtras = []

  for (const extra of profile.extras ?? []) {
    const amount = extraAmount(extra, input.extras?.[extra.id])
    if (amount === 0) continue
    const signed = amount * (extra.sign ?? 1)
    if (!extra.taxable) {
      netExtras.push(row(extra.id, extra.label, signed))
      continue
    }
    // Грос-ап рахується до копійок одразу: саме округлену суму бухгалтерія
    // і ставить у лист рядком, з неї ж далі рахується податок.
    rows.push(row(extra.id, extra.label, extra.grossUpNet ? round2(signed / (1 - rates.taxRate)) : signed))
  }

  // ── Підсумки ──────────────────────────────────────────────────────────
  // Сумуються ТОЧНІ значення рядків, округлення — один раз на підсумку.
  const gross = round2(rows.reduce((sum, r) => sum + r.amount, 0))
  const tax = round2(gross * rates.taxRate)
  const net = round2(gross - tax)
  const extrasNet = round2(netExtras.reduce((sum, r) => sum + r.amount, 0))

  // Рядки округлюються лише тут, для показу: до цього моменту вони точні.
  for (const r of [...rows, ...netExtras]) r.amount = round2(r.amount)

  return {
    normHours,
    effectiveHours,
    knowledgeHours,
    hourlyRate: round2(profile.baseSalary / normHours),
    zone: { id: zone.id, label: zone.label, color: zone.color },
    stage: { id: stage.id, label: stage.label },
    qualNote: qual.note,
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

/** Сума лишається точною — округлює її вже `calculate`, після підсумків. */
function row(id, label, amount) {
  return { id, label, amount }
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
 *
 * Сума і пояснення рахуються разом — раніше це були дві функції з однаковими
 * гілками, і вони встигли розійтись (нота показувала «оплачується як “”»
 * там, де сума вже була нулем).
 */
function resolveQual(qualLevels, qualId, zone) {
  const level = qualLevels.find((q) => q.id === qualId)
  if (!level || !level.bonus) return { bonus: 0, note: null }

  if (level.degradeAtZone != null && zone.id === level.degradeAtZone) {
    const fallback = qualLevels.find((q) => q.id === level.degradeTo)
    if (!fallback?.bonus) {
      return { bonus: 0, note: `«${zone.label}»: надбавка за «${level.label}» не виплачується` }
    }
    return { bonus: fallback.bonus, note: `«${zone.label}»: «${level.label}» оплачується як «${fallback.label}»` }
  }
  if (level.minZone != null && zone.id > level.minZone) {
    return { bonus: 0, note: `«${zone.label}»: надбавка за «${level.label}» не виплачується` }
  }
  return { bonus: level.bonus, note: null }
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
