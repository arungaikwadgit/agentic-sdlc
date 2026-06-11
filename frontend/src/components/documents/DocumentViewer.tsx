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
      // @ts-ignore
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

function renderMarkdown(md: string): { html: string; mermaidBlocks: MermaidBlock[] } {
  const mermaidBlocks: MermaidBlock[] = [];

  // Extract mermaid blocks before general processing
  let processed = md.replace(/```mermaid\n?([\s\S]*?)```/g, (_match, code) => {
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    mermaidBlocks.push({ id, code: code.trim() });
    return `<div class="mermaid-placeholder" data-id="${id}"></div>`;
  });

  let html = processed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Restore mermaid placeholders (escaped above)
    .replace(/&lt;div class="mermaid-placeholder" data-id="([^"]+)"&gt;&lt;\/div&gt;/g,
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
    // Bold/italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) return '';
      return '<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n(?!<)/g, '</p><p>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/(<tr>.*<\/tr>\n?)+/g, (m) => `<table>${m}</table>`);

  return { html: `<p>${html}</p>`, mermaidBlocks };
}

export default function DocumentViewer({ markdown }: { markdown: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { html, mermaidBlocks } = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    if (mermaidBlocks.length === 0 || !containerRef.current) return;
    loadMermaid().then(async () => {
      // @ts-ignore
      const mermaid = window.mermaid;
      if (!mermaid) return;

      for (const { id, code } of mermaidBlocks) {
        const placeholder = containerRef.current?.querySelector(`[data-id="${id}"]`);
        if (!placeholder) continue;

        try {
          // Render each diagram individually so one bad diagram can't break
          // the rest, and so we can show a clean fallback instead of
          // mermaid's "Syntax error in text" error graphic.
          const renderId = `mermaid-svg-${Math.random().toString(36).slice(2, 9)}`;
          const { svg } = await mermaid.render(renderId, code);

          // mermaid v10 often *resolves* (doesn't throw) for invalid syntax,
          // but returns an SVG containing its own "Syntax error in text" /
          // bomb-icon error graphic. Detect that case and treat it the same
          // as a thrown error so we show the raw-source fallback instead.
          if (/aria-roledescription="error"/.test(svg) || /Syntax error in text/.test(svg)) {
            throw new Error('Mermaid returned an error diagram');
          }

          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid';
          wrapper.innerHTML = svg;
          placeholder.replaceWith(wrapper);
        } catch {
          // Invalid diagram syntax — fall back to showing the raw source
          // as a code block instead of mermaid's error SVG.
          const fallback = document.createElement('pre');
          fallback.className = 'mermaid-fallback';
          const codeEl = document.createElement('code');
          codeEl.textContent = code;
          fallback.appendChild(codeEl);
          placeholder.replaceWith(fallback);

          // mermaid.render() can leave a stray error SVG (and its wrapping
          // container) appended to <body> even when it throws — clean it up
          // so it doesn't show elsewhere on the page.
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
