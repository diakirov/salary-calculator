import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import Login from './components/Login.jsx'
import Calculator from './components/Calculator.jsx'
import Admin from './components/Admin.jsx'

export default function App() {
  const [auth, setAuth] = useState({ loading: true, role: null, isAdmin: false })
  const [screen, setScreen] = useState('calc') // 'calc' | 'admin'
  // Сесія протухає сама (16 год). Без цього людину викидало на логін мовчки,
  // і виглядало це як поламаний калькулятор, а не як завершена сесія.
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    api
      .me()
      .then((me) => setAuth({ loading: false, ...me }))
      .catch(() => setAuth({ loading: false, role: null, isAdmin: false }))
  }, [])

  if (auth.loading) return null

  if (!auth.role) {
    return <Login expired={expired} onLogin={(me) => { setExpired(false); setAuth({ loading: false, ...me }) }} />
  }

  async function logout({ expired: wasExpired = false } = {}) {
    await api.logout().catch(() => {})
    setExpired(wasExpired)
    setAuth({ loading: false, role: null, isAdmin: false })
    setScreen('calc')
  }

  if (screen === 'admin' && auth.isAdmin) {
    return <Admin onBack={() => setScreen('calc')} />
  }

  return <Calculator auth={auth} onLogout={logout} onAdmin={auth.isAdmin ? () => setScreen('admin') : null} />
}
