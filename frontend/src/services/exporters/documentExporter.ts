/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { saveAs } from 'file-saver';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Header, Footer, PageNumber,
  PageBreak, Table, TableRow, TableCell, WidthType, ShadingType,
  TabStopType, TabStopPosition, VerticalAlign, ImageRun,
} from 'docx';

const ACCENT = '1d4ed8';
const MUTED = '64748b';
const FAINT = '94a3b8';
const RULE = 'cbd5e1';
const CODE_BG = 'f1f5f9';
const CODE_BORDER = 'cbd5e1';

export function exportMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, filename);
}

// Strip everything except letters/digits — used to build filename segments
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '');
}

/**
 * Derive the project's "short form" name for filenames — the part of the
 * project name before a separating dash (em-dash, en-dash, or hyphen), e.g.
 * "LearnPath — Adaptive LMS" -> "LearnPath". Falls back to the full name
 * (sanitized) if no separator is present.
 */
function projectShortName(projectName: string): string {
  const head = projectName.split(/\s*[—–-]\s*/)[0] ?? projectName;
  const sanitized = sanitizeSegment(head);
  return sanitized || sanitizeSegment(projectName) || 'Project';
}

/**
 * Build the standard artifact filename: `<ProjectShortName>_<PhaseNumber>_<AgentLabel>.docx`
 * e.g. "LearnPath_1_ProductRequirementsDocument.docx"
 *
 * - phaseNumber: 1-based position of the phase in PHASE_ORDER
 * - agentLabel: the agent's outputLabel, sanitized to alphanumerics
 */
export function buildArtifactFilename(projectName: string, phaseNumber: number, agentLabel: string): string {
  const project = projectShortName(projectName);
  const label = sanitizeSegment(agentLabel) || 'Document';
  return `${project}_${phaseNumber}_${label}.docx`;
}

// Split a markdown table row into trimmed cells
function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((c) => c.trim());
}

// True if a line looks like a markdown table separator row, e.g. |---|:--:|---|
function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || /^-+$/.test(c));
}

// Build inline runs from a line of text, handling bold/italic/code spans
function inlineRuns(text: string, opts: { size?: number; color?: string } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('***') && part.endsWith('***') && part.length > 6) {
      runs.push(new TextRun({ text: part.slice(3, -3), bold: true, italics: true, ...opts }));
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, ...opts }));
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, ...opts }));
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Consolas', size: (opts.size ?? 22) - 2, ...opts }));
    } else {
      runs.push(new TextRun({ text: part, ...opts }));
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text: '', ...opts }));
  return runs;
}

// Content width for US Letter with 1" margins (DXA: 1440 = 1 inch)
const CONTENT_WIDTH_DXA = 9360;

// Standard table border used everywhere
const TBL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const TBL_BORDER_INNER = { style: BorderStyle.SINGLE, size: 2, color: RULE };
const TBL_BORDERS = {
  top: TBL_BORDER, bottom: TBL_BORDER,
  left: TBL_BORDER, right: TBL_BORDER,
  insideHorizontal: TBL_BORDER_INNER,
  insideVertical: TBL_BORDER_INNER,
};

// Colour palette for table rows
const ROW_EVEN_BG  = 'F7F9FC'; // subtle blue-grey stripe
const ROW_ODD_BG   = 'FFFFFF';
const HEADER_BG    = '1F3864'; // dark navy header

function tableCell(
  text: string,
  opts: { header?: boolean; evenRow?: boolean; widthDxa?: number; center?: boolean } = {},
): TableCell {
  const fill = opts.header ? HEADER_BG : opts.evenRow ? ROW_EVEN_BG : ROW_ODD_BG;
  return new TableCell({
    ...(opts.widthDxa ? { width: { size: opts.widthDxa, type: WidthType.DXA } } : {}),
    borders: {
      top: TBL_BORDER, bottom: TBL_BORDER,
      left: TBL_BORDER, right: TBL_BORDER,
    },
    shading: { fill, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: inlineRuns(text, {
          size: 20,
          color: opts.header ? 'FFFFFF' : '1e293b',
        }),
      }),
    ],
  });
}

function buildMarkdownTable(headerLine: string, bodyLines: string[]): Table {
  const headerCells = splitTableRow(headerLine);
  const colCount = headerCells.length || 1;

  // Distribute content width equally across columns (DXA)
  const colW = Math.floor(CONTENT_WIDTH_DXA / colCount);
  // Last column absorbs rounding remainder
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    i === colCount - 1 ? CONTENT_WIDTH_DXA - colW * (colCount - 1) : colW
  );

  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: headerCells.map((c, i) =>
        tableCell(c, { header: true, widthDxa: colWidths[i] })
      ),
    }),
  ];

  bodyLines.forEach((line, rowIdx) => {
    const cells = splitTableRow(line);
    while (cells.length < colCount) cells.push('');
    const even = rowIdx % 2 === 0;
    rows.push(new TableRow({
      children: cells.slice(0, colCount).map((c, i) =>
        tableCell(c, { evenRow: even, widthDxa: colWidths[i] })
      ),
    }));
  });

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    borders: TBL_BORDERS,
    rows,
  });
}

const HEADING_SPACING = {
  [HeadingLevel.HEADING_1]: { before: 0, after: 200 },
  [HeadingLevel.HEADING_2]: { before: 320, after: 160 },
  [HeadingLevel.HEADING_3]: { before: 240, after: 120 },
  [HeadingLevel.HEADING_4]: { before: 200, after: 100 },
} as const;

// Load mermaid from CDN once (shared with DocumentViewer's lazy-load approach)
let mermaidLoadPromise: Promise<void> | null = null;
function loadMermaidLib(): Promise<void> {
  // @ts-expect-error - mermaid is loaded dynamically via CDN script, no type declarations
  if (window.mermaid) return Promise.resolve();
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      // @ts-expect-error - mermaid is loaded dynamically via CDN script, no type declarations
      window.mermaid?.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load mermaid.js'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}

/**
 * Render a mermaid diagram definition to a PNG image (as a Uint8Array),
 * along with its pixel dimensions, for embedding in a docx via ImageRun.
 * Returns null if rendering fails (e.g. invalid diagram syntax) so the
 * caller can fall back to showing the raw diagram source as code.
 */
async function renderMermaidToPng(code: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    await loadMermaidLib();
    // @ts-expect-error - mermaid is loaded dynamically via CDN script, no type declarations
    const mermaid = window.mermaid;
    if (!mermaid) return null;

    const id = `mermaid-export-${Math.random().toString(36).slice(2, 9)}`;
    const { svg } = await mermaid.render(id, code);

    // Parse the SVG to get its intrinsic size
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = svgDoc.documentElement;
    let width = parseFloat(svgEl.getAttribute('width') ?? '');
    let height = parseFloat(svgEl.getAttribute('height') ?? '');
    if (!width || !height) {
      const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
      if (viewBox && viewBox.length === 4) {
        width = viewBox[2];
        height = viewBox[3];
      }
    }
    if (!width || !height) { width = 800; height = 600; }

    // Rasterize the SVG to PNG via an offscreen canvas
    const scale = 2; // render at 2x for sharper output in the doc
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // White background so transparent diagram areas don't turn black in Word
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) return null;
      const buf = new Uint8Array(await pngBlob.arrayBuffer());
      return { data: buf, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * Build a docx Paragraph rendering a fenced code block as a monospaced,
 * shaded "code snippet" block. Each source line becomes its own run/break
 * within a single paragraph so whitespace and line breaks are preserved
 * exactly (no inline markdown formatting is applied inside code).
 */
function buildCodeBlockParagraph(codeLines: string[]): Paragraph {
  const children: TextRun[] = [];
  codeLines.forEach((line, idx) => {
    if (idx > 0) children.push(new TextRun({ text: '', break: 1 }));
    children.push(new TextRun({ text: line.length ? line : ' ', font: 'Consolas', size: 19, color: '1e293b' }));
  });
  return new Paragraph({
    children,
    shading: { type: ShadingType.SOLID, color: CODE_BG, fill: CODE_BG },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
    },
    spacing: { before: 80, after: 120 },
    indent: { left: 80, right: 80 },
  });
}

/**
 * Build a docx Paragraph embedding a rendered diagram image, centered,
 * scaled down to fit within the page content width if necessary.
 */
function buildDiagramParagraph(image: { data: Uint8Array; width: number; height: number }): Paragraph {
  const MAX_WIDTH_PX = 600; // ~6.25in at 96dpi, fits within page margins
  let { width, height } = image;
  if (width > MAX_WIDTH_PX) {
    const ratio = MAX_WIDTH_PX / width;
    width = MAX_WIDTH_PX;
    height = Math.round(height * ratio);
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 160 },
    children: [
      new ImageRun({
        data: image.data,
        transformation: { width, height },
      }),
    ],
  });
}

/**
 * Parse markdown into docx body content (paragraphs, tables, page breaks).
 * - H1/H2 headings start on a new page (page break before).
 * - Markdown tables (header + |---| separator + rows) render as real tables.
 * - Fenced code blocks (```lang ... ```) render as monospaced, shaded
 *   "code snippet" boxes; ```mermaid blocks are rendered to PNG images
 *   and embedded as diagrams (falling back to a code box if rendering fails).
 * - Bullet/numbered lists, blockquotes, horizontal rules, and inline
 *   bold/italic/code formatting are supported.
 */
async function markdownToDocxContent(md: string): Promise<(Paragraph | Table)[]> {
  const lines = md.split('\n');
  const content: (Paragraph | Table)[] = [];
  let firstHeading = true;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Fenced code block (```lang ... ``` or ```mermaid ... ```)
    if (line.startsWith('```')) {
      const fenceLang = line.slice(3).trim().toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      // i now points at the closing ``` (or past the end if unterminated)

      if (fenceLang === 'mermaid') {
        const diagramSource = codeLines.join('\n');
        const image = await renderMermaidToPng(diagramSource);
        if (image) {
          content.push(buildDiagramParagraph(image));
        } else {
          // Rendering failed — fall back to showing the diagram source as code
          content.push(buildCodeBlockParagraph(codeLines));
        }
      } else {
        content.push(buildCodeBlockParagraph(codeLines));
      }
      content.push(new Paragraph({ text: '', spacing: { after: 80 } }));
      continue;
    }

    // Markdown table: header row, separator row, then 0+ body rows
    if (line.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1].trim())) {
      const headerLine = line;
      const bodyLines: string[] = [];
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyLines.push(lines[i].trim());
        i++;
      }
      i--; // compensate for outer loop increment
      content.push(buildMarkdownTable(headerLine, bodyLines));
      content.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    if (line.startsWith('# ')) {
      content.push(new Paragraph({
        children: inlineRuns(line.slice(2), { size: 32, color: '0f172a' }),
        heading: HeadingLevel.HEADING_1,
        spacing: HEADING_SPACING[HeadingLevel.HEADING_1],
        pageBreakBefore: !firstHeading,
        border: { bottom: { color: ACCENT, space: 4, style: BorderStyle.SINGLE, size: 6 } },
      }));
      firstHeading = false;
    } else if (line.startsWith('## ')) {
      content.push(new Paragraph({
        children: inlineRuns(line.slice(3), { size: 27, color: '1e293b' }),
        heading: HeadingLevel.HEADING_2,
        spacing: HEADING_SPACING[HeadingLevel.HEADING_2],
        pageBreakBefore: !firstHeading,
      }));
      firstHeading = false;
    } else if (line.startsWith('### ')) {
      content.push(new Paragraph({
        children: inlineRuns(line.slice(4), { size: 24, color: '334155' }),
        heading: HeadingLevel.HEADING_3,
        spacing: HEADING_SPACING[HeadingLevel.HEADING_3],
      }));
    } else if (line.startsWith('#### ')) {
      content.push(new Paragraph({
        children: inlineRuns(line.slice(5), { size: 22, color: '475569' }),
        heading: HeadingLevel.HEADING_4,
        spacing: HEADING_SPACING[HeadingLevel.HEADING_4],
      }));
    } else if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      content.push(new Paragraph({
        spacing: { before: 120, after: 120 },
        border: { bottom: { color: RULE, space: 1, style: BorderStyle.SINGLE, size: 6 } },
      }));
    } else if (line.startsWith('> ')) {
      content.push(new Paragraph({
        children: inlineRuns(line.slice(2), { size: 22, color: MUTED }),
        indent: { left: 360 },
        border: { left: { color: ACCENT, space: 8, style: BorderStyle.SINGLE, size: 16 } },
        spacing: { before: 60, after: 60 },
      }));
    } else if (/^(\s*)([-*])\s+/.test(raw)) {
      const m = raw.match(/^(\s*)([-*])\s+(.*)$/)!;
      const level = Math.min(Math.floor(m[1].length / 2), 4);
      content.push(new Paragraph({
        children: inlineRuns(m[3], { size: 22 }),
        bullet: { level },
        spacing: { after: 40 },
      }));
    } else if (/^(\s*)\d+\.\s+/.test(raw)) {
      const m = raw.match(/^(\s*)(\d+)\.\s+(.*)$/)!;
      const level = Math.min(Math.floor(m[1].length / 2), 4);
      content.push(new Paragraph({
        children: inlineRuns(m[3], { size: 22 }),
        numbering: { reference: 'default-numbering', level },
        spacing: { after: 40 },
      }));
    } else if (line === '') {
      content.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      content.push(new Paragraph({
        children: inlineRuns(line, { size: 22 }),
        spacing: { after: 80 },
        alignment: AlignmentType.JUSTIFIED,
      }));
    }
  }

  return content;
}

/**
 * Build a polished Word document (cover page, page breaks before major
 * sections, header/footer with page numbers) and return it as a Blob,
 * without triggering a download. Used by both exportDocx and the
 * project-level "download all artifacts" ZIP export.
 */
export async function buildDocxBlob(markdown: string, title: string, projectName: string): Promise<Blob> {
  const contentParagraphs = await markdownToDocxContent(markdown);

  const header = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        border: { bottom: { color: RULE, space: 4, style: BorderStyle.SINGLE, size: 4 } },
        children: [
          new TextRun({ text: projectName, size: 18, color: MUTED, bold: true }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: title, size: 18, color: FAINT }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { color: RULE, space: 4, style: BorderStyle.SINGLE, size: 4 } },
        children: [
          new TextRun({ text: 'Page ', size: 18, color: FAINT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: FAINT }),
          new TextRun({ text: ' of ', size: 18, color: FAINT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: FAINT }),
        ],
      }),
    ],
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [
          { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } },
          { level: 1, format: 'lowerLetter', text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 260 } } } },
          { level: 2, format: 'lowerRoman', text: '%3.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 260 } } } },
        ],
      }],
    },
    sections: [
      // Cover page (no header/footer)
      {
        properties: {},
        children: [
          new Paragraph({ text: '', spacing: { before: 2400 } }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: title, bold: true, size: 56, color: ACCENT })],
            spacing: { after: 240 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: projectName, size: 30, color: '1e293b' })],
            spacing: { after: 120 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: `Generated ${new Date().toLocaleString()}`,
              size: 20, color: FAINT, italics: true,
            })],
          }),
          new Paragraph({
            children: [new PageBreak()],
          }),
        ],
      },
      // Content section (with header/footer + page numbers)
      {
        properties: {
          page: { pageNumbers: { start: 1 } },
        },
        headers: { default: header },
        footers: { default: footer },
        children: contentParagraphs,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/**
 * Export a single agent's markdown output as a polished Word document with a
 * cover/title page, page breaks before each major section, and a project
 * header/footer with page numbers.
 *
 * `phaseNumber` and `agentLabel` (typically the agent's outputLabel) drive the
 * filename: `<ProjectShortName>_<PhaseNumber>_<AgentLabel>.docx`. If omitted,
 * falls back to the legacy `<title>.docx` naming for backward compatibility.
 */
export async function exportDocx(
  markdown: string,
  title: string,
  projectName: string,
  phaseNumber?: number,
  agentLabel?: string,
) {
  const blob = await buildDocxBlob(markdown, title, projectName);
  const filename = phaseNumber != null
    ? buildArtifactFilename(projectName, phaseNumber, agentLabel ?? title)
    : `${title.replace(/[^a-z0-9]/gi, '_')}.docx`;
  saveAs(blob, filename);
}

/**
 * Export multiple agent outputs as a single combined Word document — a cover
 * page, then each section starting on its own page (H1 = section title),
 * with consistent headers/footers and page numbers throughout.
 *
 * `phaseNumber` and `agentLabel` follow the same naming convention as
 * `exportDocx` (e.g. agentLabel could be "ReviewPackage" for a gate export).
 */
export async function exportCombinedDocx(
  sections: Array<{ title: string; markdown: string }>,
  title: string,
  projectName: string,
  phaseNumber?: number,
  agentLabel?: string,
) {
  const combinedMarkdown = sections
    .map((s) => `# ${s.title}\n\n${s.markdown}`)
    .join('\n\n');

  await exportDocx(combinedMarkdown, title, projectName, phaseNumber, agentLabel);
}

/**
 * Download all completed agent artifacts for a project as a single ZIP file,
 * containing one polished Word document (.docx) per agent. Each file follows
 * the `<ProjectShortName>_<PhaseNumber>_<AgentLabel>.docx` naming convention.
 *
 * `generatedDocuments` (optional) adds the Document Agent's project-specific
 * AppDocs pack (docs/Document-Agent-Feature-Plan.md Section 4.2) into the same
 * ZIP under a `Documentation/<category>/` folder structure that mirrors the
 * AppDocs/ folder taxonomy — real subfolders via JSZip's folder-path support,
 * sitting alongside the raw agent-output artifacts already zipped above.
 */
export async function exportAllArtifactsZip(
  artifacts: Array<{ title: string; markdown: string; phaseNumber: number; agentLabel: string }>,
  projectName: string,
  generatedDocuments?: Array<{ category: string; title: string; format: 'docx' | 'md'; contentBase64: string }>,
) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const usedNames = new Set<string>();
  for (const { title, markdown, phaseNumber, agentLabel } of artifacts) {
    const blob = await buildDocxBlob(markdown, title, projectName);
    const baseFilename = buildArtifactFilename(projectName, phaseNumber, agentLabel);
    let filename = baseFilename;
    let i = 2;
    while (usedNames.has(filename)) {
      // Append the disambiguating suffix to the already-built filename rather
      // than to agentLabel before sanitization — sanitizeSegment() strips
      // underscores, so `${agentLabel}_${i}` would collapse to "Architecture2"
      // instead of producing "..._Architecture_2.docx".
      filename = baseFilename.replace(/\.docx$/, `_${i}.docx`);
      i++;
    }
    usedNames.add(filename);
    zip.file(filename, blob);
  }

  if (generatedDocuments && generatedDocuments.length > 0) {
    const usedDocNames = new Set<string>();
    for (const doc of generatedDocuments) {
      const ext = doc.format === 'docx' ? 'docx' : 'md';
      const baseName = doc.title.replace(/[^a-z0-9]/gi, '_');
      let filename = `${baseName}.${ext}`;
      let i = 2;
      while (usedDocNames.has(`${doc.category}/${filename}`)) {
        filename = `${baseName}_${i}.${ext}`;
        i++;
      }
      usedDocNames.add(`${doc.category}/${filename}`);
      // JSZip resolves slash-containing paths into real folders automatically.
      zip.file(`Documentation/${doc.category}/${filename}`, doc.contentBase64, { base64: true });
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, `${projectShortName(projectName)}_artifacts.zip`);
}

/**
 * Export a single agent output as a PDF using a styled print window.
 * Opens a hidden iframe, injects the rendered HTML, and triggers print-to-PDF.
 * No extra dependencies needed.
 */
export function exportPdf(markdown: string, title: string, projectName: string): void {
  const lines = markdown.split('\n');
  // Minimal markdown-to-HTML conversion for print
  const html = lines.map((line) => {
    if (/^# /.test(line))   return `<h1>${line.slice(2)}</h1>`;
    if (/^## /.test(line))  return `<h2>${line.slice(3)}</h2>`;
    if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
    if (/^#### /.test(line))return `<h4>${line.slice(5)}</h4>`;
    if (/^[-*] /.test(line))return `<li>${line.slice(2)}</li>`;
    if (/^\d+\. /.test(line)) return `<li>${line.replace(/^\d+\. /, '')}</li>`;
    if (/^\|/.test(line) && !/^\|[-:]+/.test(line)) {
      // peek ahead: if next non-empty line is a separator this is the header row
      const nextLine = lines[lines.indexOf(line) + 1] ?? '';
      const isHeader = /^\|[-:]+/.test(nextLine);
      const tag = isHeader ? 'th' : 'td';
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => `<${tag}>${c.trim()}</${tag}>`).join('');
      return `<tr>${cells}</tr>`;
    }
    if (/^\|[-:]+/.test(line)) return '';
    if (line.trim() === '') return '<br/>';
    return `<p>${line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`;
  }).join('\n')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/(<tr>.*<\/tr>\n?)+/g, (m) => `<table>${m}</table>`);

  const printDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>${title} — ${projectName}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12pt; color: #111; margin: 2cm; }
  h1 { font-size: 20pt; color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 6px; margin-bottom: 16px; }
  h2 { font-size: 15pt; color: #1e40af; margin-top: 24px; }
  h3 { font-size: 13pt; color: #1e3a8a; margin-top: 18px; }
  h4 { font-size: 11pt; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0 0 8px; line-height: 1.6; }
  ul { margin: 4px 0 10px 20px; }
  li { margin-bottom: 4px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11pt; }
  td, th { border: 1px solid #cbd5e1; padding: 7px 10px; vertical-align: top; word-break: break-word; }
  th { background: #1F3864; color: #ffffff; font-weight: 700; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.04em; }
  tbody tr:nth-child(even) td { background: #F7F9FC; }
  tbody tr:hover td { background: #e8f0fe; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 10pt; }
  .header { border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 24px; color: #64748b; font-size: 10pt; }
  @media print { body { margin: 1.5cm; } }
</style>
</head>
<body>
<div class="header">${projectName} &nbsp;›&nbsp; ${title}</div>
${html}
</body>
</html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(printDoc);
  w.document.close();
  w.focus();
  // Give the new document a moment to lay out (images/fonts) before printing.
  w.setTimeout(() => {
    w.print();
  }, 250);
}
