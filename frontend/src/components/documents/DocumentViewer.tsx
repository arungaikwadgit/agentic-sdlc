/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Renders Markdown as styled HTML.
 * Mermaid code blocks (```mermaid) are rendered as live diagrams via mermaid.js CDN.
 */
import { useMemo, useEffect, useRef } from 'react';
import styles from './DocumentViewer.module.css';

// Load mermaid from CDN once
let mermaidLoaded = false;
function loadMermaid(): Promise<void> {
  if (mermaidLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      // @ts-expect-error - mermaid is loaded dynamically via CDN script, no type declarations
      window.mermaid?.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      mermaidLoaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });
}

const MERMAID_PLACEHOLDER = '__MERMAID_BLOCK__';

interface MermaidBlock {
  id: string;
  code: string;
}

/** Convert a block of pipe-delimited lines into a proper HTML table with
 *  <thead>/<tbody>/<th> elements and column alignment from the separator row. */
function buildTable(lines: string[]): string {
  const parseCells = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  if (lines.length < 2) return lines.join('\n');

  const headerCells = parseCells(lines[0]);
  const sepCells = parseCells(lines[1]);

  // Only treat as a table if line[1] is a separator row
  if (!sepCells.every((c) => /^[-: ]+$/.test(c))) return lines.join('\n');

  const aligns = sepCells.map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    return '';
  });

  const thCells = headerCells
    .map((c, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${c}</th>`)
    .join('');
  const thead = `<thead><tr>${thCells}</tr></thead>`;

  const bodyRows = lines
    .slice(2)
    .filter((l) => l.trim().startsWith('|'))
    .map((line) => {
      const cells = parseCells(line);
      const tdCells = cells
        .map((c, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${c}</td>`)
        .join('');
      return `<tr>${tdCells}</tr>`;
    })
    .join('');

  return `<table>${thead}<tbody>${bodyRows}</tbody></table>`;
}

/** Pre-process markdown: replace table blocks with full HTML tables before
 *  line-by-line processing. This preserves header/data distinction and alignment. */
function preProcessTables(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const isTableRow = /^\|.+\|$/.test(line.trim());
    if (isTableRow) {
      inTable = true;
      tableLines.push(line);
    } else {
      if (inTable) {
        out.push(buildTable(tableLines));
        tableLines = [];
        inTable = false;
      }
      out.push(line);
    }
  }
  if (inTable && tableLines.length) out.push(buildTable(tableLines));
  return out.join('\n');
}

function renderMarkdown(md: string): { html: string; mermaidBlocks: MermaidBlock[] } {
  const mermaidBlocks: MermaidBlock[] = [];

  // Step 1: extract mermaid blocks before any other processing
  const withoutMermaid = md.replace(/```mermaid\n?([\s\S]*?)```/g, (_match, code) => {
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    mermaidBlocks.push({ id, code: code.trim() });
    return `\x00MERMAID:${id}\x00`;
  });

  // Step 2: build proper HTML tables before HTML-escaping cell content
  const withTables = preProcessTables(withoutMermaid);

  // Step 3: HTML-escape everything, then restore known-safe HTML
  const escaped = withTables
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Restore table HTML (table/thead/tbody/tr/th/td tags + style attrs)
    .replace(/&lt;(\/?)(table|thead|tbody|tr|th|td)(\s[^&]*?)?&gt;/g,
      (_m, slash, tag, attrs) => `<${slash}${tag}${attrs ? attrs.replace(/&amp;/g, '&') : ''}>`);

  const html = escaped
    // Restore mermaid placeholders
    .replace(/\x00MERMAID:([^\x00]+)\x00/g,
      (_m, id) => `<div class="mermaid-placeholder" data-id="${id}"></div>`)
    // Code blocks (non-mermaid)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule (only bare `---` lines, not inside tables)
    .replace(/^---$/gm, '<hr />')
    // Lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Paragraphs
    .replace(/\n\n(?!<)/g, '</p><p>')
    // Wrap consecutive list items
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  return { html: `<p>${html}</p>`, mermaidBlocks };
}

export default function DocumentViewer({ markdown }: { markdown: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { html, mermaidBlocks } = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    if (mermaidBlocks.length === 0 || !containerRef.current) return;
    loadMermaid().then(async () => {
      // @ts-expect-error - mermaid is loaded dynamically via CDN script, no type declarations
      const mermaid = window.mermaid;
      if (!mermaid) return;

      for (const { id, code } of mermaidBlocks) {
        const placeholder = containerRef.current?.querySelector(`[data-id="${id}"]`);
        if (!placeholder) continue;

        try {
          const renderId = `mermaid-svg-${Math.random().toString(36).slice(2, 9)}`;
          const { svg } = await mermaid.render(renderId, code);

          if (/aria-roledescription="error"/.test(svg) || /Syntax error in text/.test(svg)) {
            throw new Error('Mermaid returned an error diagram');
          }

          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid';
          wrapper.innerHTML = svg;
          placeholder.replaceWith(wrapper);
        } catch {
          const fallback = document.createElement('pre');
          fallback.className = 'mermaid-fallback';
          const codeEl = document.createElement('code');
          codeEl.textContent = code;
          fallback.appendChild(codeEl);
          placeholder.replaceWith(fallback);

          document.querySelectorAll('svg[aria-roledescription="error"], svg[id^="mermaid-svg-"]')
            .forEach((el) => {
              const node = (el.closest('body > *') ?? el) as Element;
              node.remove();
            });
        }
      }
    });
  }, [html, mermaidBlocks]);

  return (
    <div
      ref={containerRef}
      className={styles.viewer}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
