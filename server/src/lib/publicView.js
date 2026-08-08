/**
 * Що з конфігу можна віддати браузеру.
 *
 * Принцип: браузер отримує СТРУКТУРУ (які поля, які зони, які місяці),
 * але не ЧИСЛА (оклади, премії, надбавки). Рахує сервер.
 */
import { versionStatus, sortVersions, dayBefore } from '../engine/resolveVersion.js'

export function profilesView(config, session) {
  const sorted = sortVersions(config.rateVersions)
  const latest = sorted.at(-1)

  const profiles = {}
  for (const id of session.profiles) {
    const p = latest.profiles[id]
    if (!p) continue
    profiles[id] = {
      id,
      name: p.name,
      description: p.description,
      stages: p.stages.map((s) => ({ id: s.id, label: s.label, default: !!s.default })),
      zones: Object.fromEntries(
        p.stages.map((s) => [s.id, s.zones.map((z) => ({ id: z.id, label: z.label, color: z.color }))])
      ),
      qualLevels: p.qualLevels.map((q) => ({ id: q.id, label: q.label })),
      // `hint` і `grossUpNet` — структура, не числа: підпис під полем і те,
      // як пояснювати рядок у «Як пораховано» (обіцянка чистими чи номінал).
      extras: (p.extras ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        hint: e.hint ?? null,
        kind: e.kind,
        max: e.max ?? null,
        sign: e.sign ?? 1,
        grossUpNet: !!e.grossUpNet,
      })),
      hasTenure: !!p.tenureBaseIncome,
    }
  }

  return {
    profiles,
    schedules: Object.keys(Object.values(config.normHours)[0] ?? {}),
    normHours: config.normHours, // норми годин — не секрет, вони в кожній презентації
    years: Object.keys(config.normHours),
    maxTenureYears: latest.maxTenureYears,
    // Періоди дії за один прохід по вже відсортованому списку:
    // кінець версії — день перед наступною, остання відкрита (to: null).
    versions: sorted.map((v, i) => ({
      id: v.id,
      label: v.label,
      effectiveFrom: v.effectiveFrom,
      span: { from: v.effectiveFrom, to: sorted[i + 1] ? dayBefore(sorted[i + 1].effectiveFrom) : null },
    })),
    role: session.role,
    isAdmin: session.admin,
  }
}

export function versionStatusFor(config, monthKey, todayKey) {
  return versionStatus({ versions: config.rateVersions, monthKey, todayKey })
}
