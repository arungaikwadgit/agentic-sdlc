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

function tableCell(text: string, opts: { header?: boolean } = {}): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: inlineRuns(text, { size: 21, color: opts.header ? 'ffffff' : '1e293b' }),
      }),
    ],
    shading: opts.header
      ? { type: ShadingType.SOLID, color: ACCENT, fill: ACCENT }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function buildMarkdownTable(headerLine: string, bodyLines: string[]): Table {
  const headerCells = splitTableRow(headerLine);
  const rows: TableRow[] = [
    new TableRow({
      children: headerCells.map((c) => tableCell(c, { header: true })),
      tableHeader: true,
    }),
  ];
  for (const line of bodyLines) {
    const cells = splitTableRow(line);
    // Pad/truncate to header column count for consistency
    while (cells.length < headerCells.length) cells.push('');
    rows.push(new TableRow({ children: cells.slice(0, headerCells.length).map((c) => tableCell(c)) }));
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
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
  // @ts-ignore
  if (window.mermaid) return Promise.resolve();
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      // @ts-ignore
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
    // @ts-ignore
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
        type: 'png',
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
 */
export async function exportAllArtifactsZip(
  artifacts: Array<{ title: string; markdown: string; phaseNumber: number; agentLabel: string }>,
  projectName: string,
) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const usedNames = new Set<string>();
  for (const { title, markdown, phaseNumber, agentLabel } of artifacts) {
    const blob = await buildDocxBlob(markdown, title, projectName);
    let filename = buildArtifactFilename(projectName, phaseNumber, agentLabel);
    let i = 2;
    while (usedNames.has(filename)) {
      filename = buildArtifactFilename(projectName, phaseNumber, `${agentLabel}_${i}`);
      i++;
    }
    usedNames.add(filename);
    zip.file(filename, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, `${projectShortName(projectName)}_artifacts.zip`);
}
