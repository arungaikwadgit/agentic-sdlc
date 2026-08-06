/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { UploadedFile } from '@/types/extraction.types';
import styles from './ExtractionStep.module.css';

interface TraceEvent {
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'iteration';
  label: string;
  detail?: string;
}

interface Props {
  files: UploadedFile[];
  traceEvents: TraceEvent[];
  currentIteration: number;
  maxIterations: number;
  fieldsExtracted: number;
  totalFields: number;
  error?: string;
  onRetry?: () => void;
}

function relativeTime(ts: number): string {
  const s = Math.round((ts - Date.now() + 30000) / 1000);
  return `${s < 0 ? 0 : s}s`;
}

function formatElapsed(events: TraceEvent[]): string {
  if (events.length < 2) return '…';
  const ms = events[events.length - 1].timestamp - events[0].timestamp;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const TYPE_ICON: Record<TraceEvent['type'], string> = {
  tool_call:   '🔧',
  tool_result: '✓',
  thinking:    '💭',
  iteration:   '↻',
};

export default function ExtractionStep({
  files,
  traceEvents,
  currentIteration,
  maxIterations,
  fieldsExtracted,
  totalFields,
  error,
  onRetry,
}: Props) {
  const progress = totalFields > 0 ? fieldsExtracted / totalFields : 0;
  const elapsed = formatElapsed(traceEvents);
  const isRunning = !error && fieldsExtracted < totalFields;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>Extracting Project Context</h2>
        <p className={styles.sub}>
          The L3 agent is reading your documents and filling in project context fields.
          This usually takes 15–45 seconds.
        </p>
      </div>

      {/* Doc chips */}
      <div className={styles.docChips}>
        {files.filter((f) => f.status === 'ready').map((f) => (
          <span key={f.id} className={styles.docChip}>📄 {f.name}</span>
        ))}
      </div>

      {/* Progress */}
      <div className={styles.progressCard}>
        <div className={styles.progressHeader}>
          <span className={styles.progressLabel}>
            {error
              ? 'Extraction failed'
              : fieldsExtracted >= totalFields && totalFields > 0
                ? 'Extraction complete'
                : `Extracting… iteration ${currentIteration} / ${maxIterations}`}
          </span>
          <span className={styles.progressStats}>
            {fieldsExtracted}/{totalFields} fields · {elapsed}
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={`${styles.progressFill} ${error ? styles.progressError : ''} ${isRunning ? styles.progressRunning : ''}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <span>⚠</span>
          <div>
            <strong>Extraction failed</strong>
            <p>{error}</p>
          </div>
          {onRetry && (
            <button className={styles.retryBtn} onClick={onRetry}>Retry</button>
          )}
        </div>
      )}

      {/* Trace log */}
      <div className={styles.tracePanel}>
        <div className={styles.traceHeader}>Agent Trace</div>
        <div className={styles.traceList}>
          {traceEvents.length === 0 ? (
            <div className={styles.traceEmpty}>Waiting for agent to start…</div>
          ) : (
            [...traceEvents].reverse().map((ev, i) => (
              <div key={i} className={`${styles.traceRow} ${styles[ev.type]}`}>
                <span className={styles.traceIcon}>{TYPE_ICON[ev.type]}</span>
                <div className={styles.traceBody}>
                  <span className={styles.traceLabel}>{ev.label}</span>
                  {ev.detail && <span className={styles.traceDetail}>{ev.detail}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export type { TraceEvent };
