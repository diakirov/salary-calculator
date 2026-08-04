/**
 * Тема: без вибору користувача — за системною (prefers-color-scheme),
 * після ручного перемикання — збережений вибір. Тема ставиться атрибутом
 * data-theme на <html>, звідти її читає CSS; theme-color для смуг Safari
 * оновлюється тим самим рухом.
 */
const KEY = 'sc-theme'
const COLORS = { dark: '#121211', light: '#f4f4f2' }

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', COLORS[theme])
}

export function currentTheme() {
  return document.documentElement.dataset.theme || 'dark'
}

export function initTheme() {
  apply(localStorage.getItem(KEY) ?? systemTheme())
  // системна зміна підхоплюється, лише поки немає ручного вибору
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!localStorage.getItem(KEY)) apply(systemTheme())
  })
}

export function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light'
  localStorage.setItem(KEY, next)
  apply(next)
  return next
}
