import React, { useState } from 'react'
import { api } from '../api.js'

export default function Login({ onLogin, expired = false }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      onLogin(await api.login(password))
    } catch (err) {
      setError(err.status === 429 ? 'Забагато спроб — зачекай 15 хвилин' : 'Невірний пароль')
      setBusy(false)
    }
  }

  return (
    <div className="sc-login">
      <form className="sc-login-card" onSubmit={submit}>
        <h1>Калькулятор ЗП</h1>
        <p>
          {expired
            ? 'Сесія завершилась — увійди знову. Введене нікуди не зникло.'
            : 'Внутрішній інструмент. Введи пароль своєї ролі — і все порахується.'}
        </p>
        <div className="sc-field">
          <label>Пароль</label>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => { setPassword(e.target.value); setError('') }}
          />
          {error && <div className="sc-hint warn">{error}</div>}
        </div>
        <button className="sc-btn" type="submit" disabled={busy || !password}>
          {busy ? 'Хвилинку…' : 'Увійти'}
        </button>
      </form>
    </div>
  )
}
