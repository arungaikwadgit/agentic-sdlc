/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useCallback, useRef } from 'react';
import type { UploadedFile } from '@/types/extraction.types';
import styles from './UploadStep.module.css';

interface Props {
  files: UploadedFile[];
  onFilesAdded: (raw: File[]) => void;
  onFileRemove: (id: string) => void;
}

const ACCEPTED = '.pdf,.docx,.txt,.xlsx,.xls,.csv';
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusIcon(status: UploadedFile['status']): string {
  if (status === 'ready')      return '\u2713';
  if (status === 'error')      return '\u2715';
  if (status === 'extracting') return '\u2026';
  return '\u25cc';
}

function isAcceptedFile(f: File): boolean {
  if (ACCEPTED_MIME.includes(f.type)) return true;
  const n = f.name.toLowerCase();
  return (
    n.endsWith('.docx') || n.endsWith('.pdf') || n.endsWith('.txt') ||
    n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv')
  );
}

export default function UploadStep({ files, onFilesAdded, onFileRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const raw = Array.from(e.dataTransfer.files).filter(isAcceptedFile);
    if (raw.length) onFilesAdded(raw);
  }, [onFilesAdded]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Array.from(e.target.files ?? []);
    if (raw.length) onFilesAdded(raw);
    e.target.value = '';
  }, [onFilesAdded]);

  const isExtracting = files.some((f) => f.status === 'extracting');
  const allReady = files.length > 0 && files.every((f) => f.status === 'ready' || f.status === 'error');

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>Upload Project Documents</h2>
        <p className={styles.sub}>
          Upload your SOW, RFP, BRD, brief, or discovery notes. The AI will extract
          25 project context fields automatically, so you spend less time filling forms.
        </p>
      </div>

      <div
        className={styles.dropZone}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Upload documents"
      >
        <div className={styles.dropIcon}>\ud83d\udcc4</div>
        <p className={styles.dropTitle}>Drop files here or click to browse</p>
        <p className={styles.dropHint}>PDF, DOCX, TXT, XLSX, XLS, CSV &mdash; up to 5 files</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          style={{ display: 'none' }}
          onChange={handleChange}
        />
      </div>

      {files.length > 0 && (
        <div className={styles.fileList}>
          {files.map((f) => (
            <div key={f.id} className={`${styles.fileRow} ${f.status === 'error' ? styles.fileRowError : ''}`}>
              <span className={`${styles.fileStatus} ${styles[f.status]}`}>
                {statusIcon(f.status)}
              </span>
              <div className={styles.fileMeta}>
                <span className={styles.fileName}>{f.name}</span>
                <span className={styles.fileSize}>
                  {formatSize(f.size)}
                  {f.status === 'ready' && ` \u00b7 ${f.charCount.toLocaleString()} chars`}
                  {f.status === 'error' && ` \u00b7 ${f.error}`}
                </span>
              </div>
              <button
                className={styles.removeBtn}
                onClick={(e) => { e.stopPropagation(); onFileRemove(f.id); }}
                aria-label={`Remove ${f.name}`}
                disabled={isExtracting}
              >
                \u2715
              </button>
            </div>
          ))}
        </div>
      )}

      {allReady && (
        <div className={styles.readyBanner}>
          <span>\u2713</span>
          <span>
            {files.filter((f) => f.status === 'ready').length} document(s) ready for extraction.
            {files.some((f) => f.status === 'error') && ' Some files had errors and will be skipped.'}
          </span>
        </div>
      )}

      <div className={styles.tipBox}>
        <strong>Tips</strong>
        <ul>
          <li>Include your SOW or Requirements doc for the best extraction results.</li>
          <li>Multiple documents are fine &mdash; the agent cross-references them.</li>
          <li>Excel files: each sheet is extracted as a labelled text table.</li>
          <li>You can skip this step and fill fields manually instead.</li>
        </ul>
      </div>
    </div>
  );
}
