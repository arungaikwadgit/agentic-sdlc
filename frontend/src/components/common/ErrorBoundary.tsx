/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ErrorBoundary — catches uncaught React render errors and shows a recovery UI
 * instead of a blank screen.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production this would ship to an observability sink (Sentry, Datadog, etc.)
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: 32,
        background: 'var(--color-bg, #0f1117)',
        color: 'var(--text, #e2e8f0)',
        textAlign: 'center',
        gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Something went wrong</h2>
        <p style={{ margin: 0, color: 'var(--text-muted, #94a3b8)', maxWidth: 480, lineHeight: 1.6 }}>
          An unexpected error occurred. You can try refreshing the page or resetting the view.
        </p>
        {this.state.error && (
          <pre style={{
            fontSize: 11,
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '12px 16px',
            maxWidth: 600,
            overflow: 'auto',
            color: '#f87171',
            textAlign: 'left',
          }}>
            {this.state.error.message}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={this.handleReset}
          >
            Try again
          </button>
          <button
            className="btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', margin: 0 }}>
          © 2026 Arun Gaikwad. All rights reserved.
        </p>
      </div>
    );
  }
}
