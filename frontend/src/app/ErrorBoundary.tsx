import { Component, type ReactNode } from 'react'
import { Sprout } from 'lucide-react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <main className="app-error" role="alert">
          <Sprout size={35} />
          <h1>No pudimos abrir este espacio.</h1>
          <p>Revisa tu conexión y vuelve a intentarlo.</p>
          <button className="button button-primary" onClick={() => window.location.reload()}>
            Volver a intentar
          </button>
        </main>
      )
    return this.props.children
  }
}
