/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Client-side document text extraction.
 *
 * Supports PDF (via pdf.js CDN), DOCX (mammoth.js), TXT (FileReader),
 * XLSX / XLS (SheetJS — already a project dep), and CSV (SheetJS).
 *
 * Returns plain text. Large documents are soft-truncated at MAX_CHARS.
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export const MAX_CHARS_PER_DOC = 8000;
export const MAX_TOTAL_CHARS   = 24000;

export type DocType = 'pdf' | 'docx' | 'txt' | 'xlsx' | 'csv';

export function inferDocType(file: File): DocType | null {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) return 'docx';
  if (name.endsWith('.txt') || mime === 'text/plain' || mime === '') return 'txt';
  if (
    name.endsWith('.xlsx') || name.endsWith('.xls') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) return 'xlsx';
  if (name.endsWith('.csv') || mime === 'text/csv' || mime === 'application/csv') return 'csv';
  return null;
}

// --- TXT ------------------------------------------------------------------

function extractTxt(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) ?? '');
    reader.onerror = () => reject(new Error('Failed to read text file'));
    reader.readAsText(file, 'utf-8');
  });
}

// --- DOCX -----------------------------------------------------------------

async function extractDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// --- PDF (pdf.js via CDN module) ------------------------------------------

declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (opts: { data: ArrayBuffer }) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
          }>;
        }>;
      };
    };
  }
}

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function loadPdfJs(): Promise<NonNullable<typeof window.pdfjsLib>> {
  if (window.pdfjsLib) return window.pdfjsLib;

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(s);
  });

  const lib = window.pdfjsLib!;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    pageTexts.push(`[Page ${i}]\n${pageText}`);
  }

  return pageTexts.join('\n\n');
}

// --- XLSX / XLS -----------------------------------------------------------

function sheetToText(sheet: XLSX.WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  return rows
    .filter(row => (row as unknown[]).some(cell => String(cell || '').trim() !== ''))
    .map(row => (row as unknown[]).map(cell => String(cell || '').trim()).join('\t'))
    .join('\n');
}

async function extractXlsx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const text = sheetToText(sheet);
    if (text.trim()) parts.push(`[Sheet: ${sheetName}]\n${text}`);
  }

  return parts.join('\n\n');
}

// --- CSV ------------------------------------------------------------------

async function extractCsv(file: File): Promise<string> {
  const text = await extractTxt(file);
  const workbook = XLSX.read(text, { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheetToText(sheet);
}

// --- Main entry point -----------------------------------------------------

export async function extractText(file: File, type: DocType): Promise<string> {
  let raw = '';
  switch (type) {
    case 'txt':  raw = await extractTxt(file);  break;
    case 'docx': raw = await extractDocx(file); break;
    case 'pdf':  raw = await extractPdf(file);  break;
    case 'xlsx': raw = await extractXlsx(file); break;
    case 'csv':  raw = await extractCsv(file);  break;
  }

  const cleaned = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= MAX_CHARS_PER_DOC) return cleaned;

  return (
    cleaned.slice(0, MAX_CHARS_PER_DOC) +
    `\n\n[Document truncated at ${MAX_CHARS_PER_DOC} characters -- ${cleaned.length - MAX_CHARS_PER_DOC} additional characters not shown]`
  );
}

/**
 * Build the combined extraction user prompt from multiple uploaded files.
 * Each document is wrapped in a header block so the LLM can reference it by name.
 */
export function buildExtractionPrompt(
  files: Array<{ name: string; type: DocType; charCount: number; extractedText: string }>
): string {
  const docs = files.map((f, i) => {
    const docText =
      f.extractedText.length > MAX_CHARS_PER_DOC
        ? f.extractedText.slice(0, MAX_CHARS_PER_DOC) +
          `\n[...truncated at ${MAX_CHARS_PER_DOC} chars]`
        : f.extractedText;

    return (
      `DOCUMENT ${i + 1} -- ${f.name} (${f.type.toUpperCase()}, ${f.charCount.toLocaleString()} characters)\n` +
      `${'='.repeat(72)}\n` +
      docText
    );
  });

  return (
    `You are analysing the following project documents to extract a complete project context package.\n\n` +
    docs.join('\n\n') +
    `\n\n` +
    `---\n` +
    `Extract the full project context package as described in your instructions.\n` +
    `Return ONLY valid JSON inside FINAL_OUTPUT. Do not include any text before or after the JSON.`
  );
}
