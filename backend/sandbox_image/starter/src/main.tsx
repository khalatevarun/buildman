import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-8">
          <div className="max-w-lg w-full space-y-3 text-center">
            <p className="text-base font-medium text-destructive">Something went wrong</p>
            <pre className="text-xs text-left text-muted-foreground bg-muted p-4 rounded-lg overflow-auto whitespace-pre-wrap break-words">
              {(this.state.error as Error).message}
            </pre>
            <p className="text-xs text-muted-foreground">Copy this error and paste it in the chat to fix it.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
