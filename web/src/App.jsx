import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import Login from './components/Login.jsx'
import Calculator from './components/Calculator.jsx'
import Admin from './components/Admin.jsx'

export default function App() {
  const [auth, setAuth] = useState({ loading: true, role: null, isAdmin: false })
  const [screen, setScreen] = useState('calc') // 'calc' | 'admin'

  useEffect(() => {
    api
      .me()
      .then((me) => setAuth({ loading: false, ...me }))
      .catch(() => setAuth({ loading: false, role: null, isAdmin: false }))
  }, [])

  if (auth.loading) return null

  if (!auth.role) {
    return <Login onLogin={(me) => setAuth({ loading: false, ...me })} />
  }

  async function logout() {
    await api.logout().catch(() => {})
    setAuth({ loading: false, role: null, isAdmin: false })
    setScreen('calc')
  }

  if (screen === 'admin' && auth.isAdmin) {
    return <Admin onBack={() => setScreen('calc')} />
  }

  return <Calculator auth={auth} onLogout={logout} onAdmin={auth.isAdmin ? () => setScreen('admin') : null} />
}
