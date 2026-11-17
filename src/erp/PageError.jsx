import { Component } from 'react'
import { C, btn, btnPrimary } from '../styles.js'

// A page that fails to draw shows this instead of taking the whole ERP down with it (React drops everything
// on an error nobody catches): the menu still works, and the page can be tried again. `whole`: the last
// resort around the entire app, where only reloading helps.
export default class PageError extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('This page could not be shown:', error, info?.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    const whole = !!this.props.whole
    return (
      <div className={whole ? undefined : 'ssk-page'} role="alert"
        style={{ maxWidth: 520, margin: whole ? '72px auto' : '24px auto', padding: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius, fontFamily: C.font }}>
        <h1 style={{ fontSize: 19, margin: '0 0 8px' }}>{whole ? 'The ERP stopped' : 'This page could not be shown'}</h1>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.5, margin: '0 0 16px' }}>
          {whole ? 'Something went wrong. Reload to carry on; nothing you saved is lost.'
            : 'Something on it went wrong. The rest of the ERP still works: try this page again, or pick another one. Nothing you saved is lost.'}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {whole
            ? <button style={btnPrimary} onClick={() => window.location.reload()}>Reload</button>
            : <>
              <button style={btnPrimary} onClick={() => this.setState({ error: null })}>Try again</button>
              <a href="#/dashboard" style={{ ...btn, textDecoration: 'none' }}>Go to the dashboard</a>
            </>}
        </div>
      </div>
    )
  }
}
