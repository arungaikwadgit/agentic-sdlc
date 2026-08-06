/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/**
 * AgentContextUploader
 *
 * Allows uploading PDF, images, Word (.docx), Excel (.xlsx/.xls), CSV, and
 * plain-text files as additional context for an agent prompt.  Extracted text
 * is passed to the parent via `onContextChange`.
 *
 * Parsing strategy:
 *   .txt / .md  → FileReader
 *   .csv        → PapaParse
 *   .docx       → mammoth (already in package.json)
 *   .xlsx/.xls  → SheetJS/xlsx (already in package.json)
 *   .pdf        → pdfjs-dist loaded dynamically from CDN (no extra install)
 *   images      → base64-encoded; included as [IMAGE: filename] marker so the
 *                 LLM prompt indicates the attachment without transmitting binary
 */

import { useState, useCallback, useRef } from 'react';
import styles from './AgentContextUploader.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedFile {
  id: string;
  name: string;
  sizeKb: number;
  kind: 'text' | 'image' | 'spreadsheet' | 'document' | 'pdf' | 'unknown';
  content: string;
  error?: string;
}

interface Props {
  /** Called whenever the combined extracted-context string changes. */
  onContextChange: (context: string) => void;
  /** Called with the full file list whenever files are added or removed — for persistence. */
  onFilesChange?: (files: ExtractedFile[]) => void;
  /** Pre-populate the uploader with files restored from storage. */
  initialFiles?: ExtractedFile[];
  /** Max characters of extracted text to include in the prompt (default 8000). */
  maxChars?: number;
  /** Cap on number of files (default 3). */
  maxFiles?: number;
}

// ── Accepted MIME types / extensions ─────────────────────────────────────────

const ACCEPT =
  '.txt,.md,.csv,.docx,.xlsx,.xls,.pdf,' +
  'image/png,image/jpeg,image/gif,image/webp,image/bmp';

// ── PDF extraction via CDN pdfjs-dist ─────────────────────────────────────────

let pdfjsModule: { getDocument: Function; GlobalWorkerOptions: { workerSrc: string } } | null = null;

async function loadPdfJs() {
  if (pdfjsModule) return pdfjsModule;
  // @ts-ignore — CDN dynamic import; no TypeScript type declarations available
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  const mod = await import(/* @vite-ignore */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  pdfjsModule = mod;
  return mod;
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items.map((item: { str: string }) => item.str).join(' ');
    textParts.push(pageText);
  }
  return textParts.join('\n\n');
}

// ── Per-file extraction logic ─────────────────────────────────────────────────

async function extractFile(file: File): Promise<ExtractedFile> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sizeKb = Math.round(file.size / 1024);
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  // ── Plain text ────────────────────────────────────────────────────────────
  if (['txt', 'md', 'markdown'].includes(ext) || file.type.startsWith('text/')) {
    const text = await file.text();
    return { id, name, sizeKb, kind: 'text', content: text };
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  if (ext === 'csv') {
    const text = await file.text();
    const { data } = (await import('papaparse')).parse(text, { header: true, skipEmptyLines: true });
    const rows = (data as Record<string, string>[]).slice(0, 100);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const formatted =
      [headers.join(' | '), headers.map(() => '---').join(' | ')]
        .concat(rows.map((r) => headers.map((h) => r[h] ?? '').join(' | ')))
        .join('\n');
    return { id, name, sizeKb, kind: 'text', content: `CSV file: ${name}\n\n${formatted}` };
  }

  // ── Word / DOCX ───────────────────────────────────────────────────────────
  if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { id, name, sizeKb, kind: 'document', content: result.value };
  }

  // ── Excel / XLSX / XLS ────────────────────────────────────────────────────
  if (['xlsx', 'xls'].includes(ext)) {
    const arrayBuffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheets: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws);
      if (csv.trim()) {
        sheets.push(`=== Sheet: ${sheetName} ===\n${csv}`);
      }
    }
    return {
      id, name, sizeKb, kind: 'spreadsheet',
      content: `Excel file: ${name}\n\n${sheets.join('\n\n')}`,
    };
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  if (ext === 'pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const text = await extractPdf(arrayBuffer);
      return { id, name, sizeKb, kind: 'pdf', content: `PDF file: ${name}\n\n${text}` };
    } catch (e) {
      return {
        id, name, sizeKb, kind: 'pdf',
        content: `[PDF: ${name} — text extraction failed; paste relevant sections manually]`,
        error: String(e),
      };
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────
  if (file.type.startsWith('image/')) {
    return {
      id, name, sizeKb, kind: 'image',
      content: `[IMAGE ATTACHED: ${name} (${sizeKb} KB) — describe any relevant information from this image in the Additional Instructions field above]`,
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return {
    id, name, sizeKb, kind: 'unknown',
    content: `[File: ${name} — unsupported format; paste relevant content manually]`,
  };
}

// ── Kind labels & icons ───────────────────────────────────────────────────────

const KIND_META: Record<ExtractedFile['kind'], { icon: string; label: string; color: string }> = {
  text:        { icon: '📄', label: 'Text',        color: '#6366f1' },
  image:       { icon: '🖼️', label: 'Image',       color: '#8b5cf6' },
  spreadsheet: { icon: '📊', label: 'Spreadsheet', color: '#10b981' },
  document:    { icon: '📝', label: 'Document',    color: '#3b82f6' },
  pdf:         { icon: '📕', label: 'PDF',         color: '#ef4444' },
  unknown:     { icon: '📎', label: 'File',        color: '#94a3b8' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentContextUploader({
  onContextChange,
  onFilesChange,
  initialFiles,
  maxChars = 8_000,
  maxFiles = 3,
}: Props) {
  const [files, setFiles] = useState<ExtractedFile[]>(initialFiles ?? []);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Emit initial context so parent is in sync on first render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useState(() => { if (initialFiles?.length) rebuildContext(initialFiles); });

  // Re-build combined context whenever files change
  function rebuildContext(updated: ExtractedFile[]) {
    if (updated.length === 0) {
      onContextChange('');
      onFilesChange?.([]);
      return;
    }
    const parts = updated.map((f) => `### Attached file: ${f.name}\n${f.content}`);
    const combined = parts.join('\n\n---\n\n');
    const truncated = combined.length > maxChars
      ? combined.slice(0, maxChars) + `\n\n[...content truncated to ${maxChars.toLocaleString()} chars to stay within token limit]`
      : combined;
    onContextChange(truncated);
    onFilesChange?.(updated);
  }

  async function addFiles(raw: FileList | null) {
    if (!raw || raw.length === 0) return;
    const toAdd = Array.from(raw).slice(0, maxFiles - files.length);
    if (toAdd.length === 0) return;

    setProcessing(true);
    try {
      const results = await Promise.all(toAdd.map(extractFile));
      const updated = [...files, ...results];
      setFiles(updated);
      rebuildContext(updated);
    } finally {
      setProcessing(false);
    }
  }

  function removeFile(id: string) {
    const updated = files.filter((f) => f.id !== id);
    setFiles(updated);
    rebuildContext(updated);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [files, maxFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const canAdd = files.length < maxFiles && !processing;

  return (
    <div className={styles.root}>
      {/* Drop zone */}
      {canAdd && (
        <div
          className={`${styles.dropZone} ${dragOver ? styles.dropZoneOver : ''}`}
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          {processing ? (
            <><span className={styles.spinner} /> Extracting…</>
          ) : (
            <>
              <span className={styles.uploadIcon}>⬆</span>
              <span className={styles.uploadLabel}>
                {dragOver ? 'Drop file here' : 'Attach context file'}
              </span>
              <span className={styles.uploadHint}>
                PDF · Word · Excel · CSV · TXT · Image
              </span>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple={maxFiles > 1}
            className={styles.hiddenInput}
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>
      )}

      {/* File chips */}
      {files.length > 0 && (
        <div className={styles.fileList}>
          {files.map((f) => {
            const meta = KIND_META[f.kind];
            return (
              <div key={f.id} className={styles.fileChip}>
                <span className={styles.fileIcon}>{meta.icon}</span>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName} title={f.name}>{f.name}</span>
                  <span className={styles.fileMeta} style={{ color: meta.color }}>
                    {meta.label} · {f.sizeKb} KB
                    {f.error && <span className={styles.fileError}> · extraction failed</span>}
                  </span>
                </div>
                <button
                  className={styles.removeBtn}
                  onClick={() => removeFile(f.id)}
                  title={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
