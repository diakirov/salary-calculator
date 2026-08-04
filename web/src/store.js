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
  return read(KEY_STATE, { lastProfile: null, forms: {} })
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

export function clearAll() {
  localStorage.removeItem(KEY_STATE)
  localStorage.removeItem(KEY_HISTORY)
}
