/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ConfirmDialog — modal replacement for browser confirm().
 * Optionally collects a required text remark (e.g. "reason for deleting")
 * before allowing confirmation — used by admin-gated destructive actions.
 */
import { useState } from 'react';
import styles from './ConfirmDialog.module.css';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When true, shows a required textarea and disables Confirm until it's non-empty. */
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  /** Receives the trimmed input value when requireInput is true, otherwise undefined. */
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireInput = false,
  inputLabel = 'Reason',
  inputPlaceholder = '',
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canConfirm = !requireInput || trimmed.length > 0;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title" className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {requireInput && (
          <>
            <label className={styles.inputLabel} htmlFor="confirm-dialog-input">{inputLabel}</label>
            <textarea
              id="confirm-dialog-input"
              className={styles.input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={inputPlaceholder}
              autoFocus
              maxLength={500}
            />
          </>
        )}
        <div className={styles.actions}>
          <button className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={danger ? styles.dangerBtn : 'btn-primary'}
            onClick={() => canConfirm && onConfirm(requireInput ? trimmed : undefined)}
            disabled={!canConfirm}
            autoFocus={!requireInput}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
