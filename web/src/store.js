/**
 * Стан у localStorage: форма по кожному профілю, історія, останній профіль.
 * На сервер нічого з цього не їде.
 */
const KEY_STATE = 'sc-state-v1'
const KEY_HISTORY = 'sc-history-v1'

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

export function loadState() {
  const st = read(KEY_STATE, { lastProfile: null, forms: {} })
  // Одноразова міграція (05.08.2026): «Знання» стало увімкненим за
  // замовчуванням. У старих збережених формах false — старий дефолт,
  // а не вибір людини, тож піднімаємо його один раз; далі поважаємо вибір.
  if (!localStorage.getItem('sc-knowledge-default-v2')) {
    for (const f of Object.values(st.forms ?? {})) {
      if (f && typeof f === 'object') f.knowledge = true
    }
    localStorage.setItem('sc-knowledge-default-v2', '1')
  }
  return st
}

export function saveState(state) {
  localStorage.setItem(KEY_STATE, JSON.stringify(state))
}

export function loadHistory() {
  return read(KEY_HISTORY, [])
}

export function pushHistory(entry) {
  const next = [entry, ...loadHistory()].slice(0, 20)
  localStorage.setItem(KEY_HISTORY, JSON.stringify(next))
  return next
}

export function removeHistoryEntry(id) {
  const next = loadHistory().filter((h) => h.id !== id)
  localStorage.setItem(KEY_HISTORY, JSON.stringify(next))
  return next
}

export function clearFormState() {
  localStorage.removeItem(KEY_STATE)
}

export function clearHistory() {
  localStorage.removeItem(KEY_HISTORY)
}
