/**
 * Повідомлення для людини, а не для консолі. Сервер віддає людський текст
 * сам; сюди підставляємо запасні варіанти для випадків, коли тексту немає:
 * обрив мережі (fetch кидає своє англійське «Failed to fetch») і відповіді
 * без тіла. `status` лишається як є — на нього спираються 401 і 429.
 */
async function request(url, options = {}) {
  let res
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    const err = new Error('Немає звʼязку з сервером. Перевір інтернет і спробуй ще раз')
    err.status = 0
    throw err
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || (res.status >= 500 ? 'Сервер не відповів як слід' : 'Запит не пройшов'))
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  login: (password) => request('/api/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  profiles: () => request('/api/profiles'),
  calc: (input) => request('/api/calc', { method: 'POST', body: input }),
  adminConfig: () => request('/api/admin/config'),
  adminSaveVersion: (body) => request('/api/admin/versions', { method: 'POST', body }),
  adminEditVersion: (id, body) => request(`/api/admin/versions/${id}`, { method: 'PUT', body }),
  adminSaveNormHours: (body) => request('/api/admin/norm-hours', { method: 'POST', body }),
  adminBackups: () => request('/api/admin/backups'),
  adminRollback: (body) => request('/api/admin/rollback', { method: 'POST', body }),
  adminAudit: () => request('/api/admin/audit'),
  adminLogs: () => request('/api/admin/logs'),
  adminLogSnapshot: (hours) => request('/api/admin/logs/snapshot', { method: 'POST', body: { hours } }),
  adminLogDelete: (name) => request(`/api/admin/logs/${name}`, { method: 'DELETE' }),
}
