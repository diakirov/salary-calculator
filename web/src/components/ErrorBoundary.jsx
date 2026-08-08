import React from 'react'

/**
 * Остання межа клієнта. Без неї будь-яке виключення при рендері знімало
 * все дерево, і людина бачила порожню білу сторінку — «калькулятор
 * зламався», без жодного слова.
 *
 * Текст помилки на екран НЕ виводимо: у ньому бувають шляхи, імена полів
 * і внутрішня механіка, які нікому за межами розробки не потрібні. Деталі —
 * у консоль, людині — що робити далі.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Помилка інтерфейсу:', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="sc-login">
        <div className="sc-login-card">
          <h1>Щось зламалось</h1>
          <p>Розрахунок не постраждав — усе введене зберігається в цьому браузері. Перезавантаж сторінку.</p>
          <button className="sc-btn" type="button" onClick={() => window.location.reload()}>
            Перезавантажити
          </button>
        </div>
      </div>
    )
  }
}
