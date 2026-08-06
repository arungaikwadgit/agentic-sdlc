/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { ExtractionMethod } from '@/types/extraction.types';
import styles from './FieldBadge.module.css';

interface Props {
  method: ExtractionMethod;
  confidence?: number;
}

const LABELS: Record<ExtractionMethod, string> = {
  extracted:      'EXTRACTED',
  inferred:       'INFERRED',
  missing:        'MISSING',
  conflict:       'CONFLICT',
  'user-edited':  'EDITED',
  'user-rejected':'CLEARED',
};

export default function FieldBadge({ method, confidence }: Props) {
  const label = LABELS[method];
  const pct = confidence !== undefined ? Math.round(confidence * 100) : undefined;
  return (
    <span className={`${styles.badge} ${styles[method.replace('-', '_') as keyof typeof styles]}`}>
      {label}{pct !== undefined && method !== 'missing' && method !== 'user-rejected' ? ` ${pct}%` : ''}
    </span>
  );
}
