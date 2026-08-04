async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
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
  adminSaveNormHours: (body) => request('/api/admin/norm-hours', { method: 'POST', body }),
}
