/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AlertContext — modal replacement for the browser's native alert().
 *
 * Distinct from ToastContext: a toast is a non-blocking, auto-dismissing
 * corner notification (good for "✓ Saved"); this is a blocking, centered
 * modal dialog the user must explicitly acknowledge (good for errors and
 * warnings that need a clear "OK" click before continuing) — visually
 * consistent with ConfirmDialog rather than the browser's unstyled popup.
 *
 * Usage:
 *   const { showAlert } = useAlert();
 *   showAlert('Invite failed: ' + err.message, { kind: 'error' });
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import styles from '../components/common/ConfirmDialog.module.css';

type AlertKind = 'error' | 'warning' | 'info';

interface AlertOptions {
  title?: string;
  kind?: AlertKind;
}

interface AlertState {
  message: string;
  title: string;
  kind: AlertKind;
}

interface AlertContextValue {
  showAlert: (message: string, options?: AlertOptions) => void;
}

const DEFAULT_TITLES: Record<AlertKind, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Notice',
};

const AlertContext = createContext<AlertContextValue | null>(null);

export function useAlert(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert must be used inside <AlertProvider>');
  return ctx;
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState | null>(null);

  const showAlert = useCallback((message: string, options?: AlertOptions) => {
    const kind = options?.kind ?? 'error';
    setAlertState({
      message,
      title: options?.title ?? DEFAULT_TITLES[kind],
      kind,
    });
  }, []);

  const dismiss = useCallback(() => setAlertState(null), []);

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      {alertState && (
        <div className={styles.overlay} onClick={dismiss}>
          <div
            className={styles.dialog}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-message"
          >
            <h3 id="alert-dialog-title" className={styles.title}>
              {alertState.kind === 'error' ? '⚠ ' : alertState.kind === 'warning' ? '⚠ ' : 'ℹ '}
              {alertState.title}
            </h3>
            <p id="alert-dialog-message" className={styles.message}>{alertState.message}</p>
            <div className={styles.actions}>
              <button className="btn-primary" onClick={dismiss} autoFocus>OK</button>
            </div>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
}
