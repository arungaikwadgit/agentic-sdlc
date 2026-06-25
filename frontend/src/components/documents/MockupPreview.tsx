/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * UX Mockup Preview — renders the full UX Mockups document as a rich article.
 *
 * Layout:
 *   - Sticky top toolbar: viewport switcher + color palette presets
 *   - Scrollable document body where:
 *       • Markdown sections render as styled prose (headings, bullets, tables)
 *       • ```html fenced blocks render as live sandboxed iframes inline
 *   - HTML blocks use the full document width and auto-resize to content height
 *
 * The style-editor controls (palette, viewport) are in the toolbar so they
 * are always visible while the user scrolls through the document.
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import styles from './MockupPreview.module.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface HtmlBlock {
  id: string;
  label: string;
  code: string;
}

interface StyleState {
  primaryColor: string;
  secondaryColor: string;
  surfaceColor: string;
  textColor: string;
  fontFamily: string;
  radius: string;
  spacingUnit: string;
}

type Viewport = 'desktop' | 'tablet' | 'mobile';

// Parsed document segment — either a run of markdown text, or an HTML block
type Segment =
  | { type: 'markdown'; text: string }
  | { type: 'html'; block: HtmlBlock };

// ── Constants ─────────────────────────────────────────────────────────────

const VIEWPORT_OPTIONS: { id: Viewport; label: string; icon: string; width: string }[] = [
  { id: 'desktop', label: 'Desktop', icon: '🖥', width: '100%' },
  { id: 'tablet',  label: 'Tablet',  icon: '⬜', width: '768px' },
  { id: 'mobile',  label: 'Mobile',  icon: '📱', width: '375px' },
];

const FONT_OPTIONS = [
  { label: 'Inter (Default)', value: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { label: 'Roboto',          value: "'Roboto', 'Helvetica Neue', Arial, sans-serif" },
  { label: 'Georgia (Serif)', value: "'Georgia', 'Times New Roman', serif" },
  { label: 'Mono',            value: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" },
  { label: 'System UI',       value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
];

const PALETTE_PRESETS = [
  { label: 'Original', primary: '', secondary: '', surface: '', text: '' },
  { label: 'Ocean',   primary: '#0077b6', secondary: '#00b4d8', surface: '#f8fafc', text: '#1a2533' },
  { label: 'Forest',  primary: '#2d6a4f', secondary: '#40916c', surface: '#f4f9f4', text: '#1b2d22' },
  { label: 'Sunset',  primary: '#e85d04', secondary: '#f48c06', surface: '#fff8f0', text: '#1a0a00' },
  { label: 'Violet',  primary: '#6d28d9', secondary: '#a78bfa', surface: '#f5f3ff', text: '#1e1b4b' },
  { label: 'Rose',    primary: '#be123c', secondary: '#fb7185', surface: '#fff1f2', text: '#1c0a14' },
  { label: 'Dark',    primary: '#818cf8', secondary: '#a5b4fc', surface: '#0f172a', text: '#e2e8f0' },
];

const DEFAULT_STYLE: StyleState = {
  primaryColor: '', secondaryColor: '', surfaceColor: '',
  textColor: '', fontFamily: '', radius: '8', spacingUnit: '8',
};

// ── Markdown segment parser ───────────────────────────────────────────────

function parseSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let blockIndex = 0;
  let lastIndex = 0;

  const htmlBlockRe = /^```html\s*\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = htmlBlockRe.exec(markdown)) !== null) {
    // Text before this block
    const before = markdown.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: 'markdown', text: before });

    blockIndex++;
    // Find nearest heading before this block for the label
    const textBefore = markdown.slice(0, match.index);
    const headingMatch = textBefore.match(/^#{1,6}\s+(.+)$/gm);
    const label = headingMatch?.length
      ? headingMatch[headingMatch.length - 1].replace(/^#+\s+/, '').trim()
      : `Mockup ${blockIndex}`;

    segments.push({
      type: 'html',
      block: { id: `mockup-${blockIndex}`, label, code: match[1].trim() },
    });

    lastIndex = match.index + match[0].length;
  }

  const tail = markdown.slice(lastIndex);
  if (tail.trim()) segments.push({ type: 'markdown', text: tail });

  return segments;
}

// ── Minimal markdown → HTML renderer ─────────────────────────────────────

function renderMarkdownToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, m => `<table>${m}</table>`)
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n(?!<)/g, '</p><p>')
    .replace(/\n/g, '<br />');
}

// ── Style injection (unchanged from original) ─────────────────────────────

function buildStyleBlock(s: StyleState): string {
  const vars: string[] = [];
  if (s.primaryColor)   vars.push(`  --color-primary: ${s.primaryColor};`);
  if (s.secondaryColor) vars.push(`  --color-secondary: ${s.secondaryColor};`);
  if (s.surfaceColor)   vars.push(`  --color-surface: ${s.surfaceColor};`);
  if (s.textColor)      vars.push(`  --color-text: ${s.textColor};`);
  if (s.fontFamily)     vars.push(`  --font-family: ${s.fontFamily};`);
  if (s.radius)         vars.push(`  --radius: ${s.radius}px;`);
  if (s.spacingUnit)    vars.push(`  --spacing-unit: ${s.spacingUnit}px;`);

  const overrides: string[] = [];
  if (s.surfaceColor)   overrides.push(`html,body{background-color:${s.surfaceColor}!important;}`);
  if (s.textColor)      overrides.push(`body,p,span,li,td,th,label,input,select,textarea,h1,h2,h3,h4,h5,h6{color:${s.textColor}!important;}`);
  if (s.primaryColor) {
    overrides.push(`nav,header,.navbar,.nav,.sidebar,.topbar,.header{background-color:${s.primaryColor}!important;color:#fff!important;}`);
    overrides.push(`nav *,header *,.navbar *,.nav *,.sidebar *,.topbar *{color:#fff!important;}`);
    overrides.push(`a{color:${s.primaryColor}!important;}`);
    overrides.push(`button[class*="primary"],.btn-primary{background-color:${s.primaryColor}!important;border-color:${s.primaryColor}!important;color:#fff!important;}`);
  }
  if (s.secondaryColor) overrides.push(`.badge,.tag,.chip,.pill{background-color:${s.secondaryColor}!important;color:#fff!important;}`);
  if (s.fontFamily)     overrides.push(`*{font-family:${s.fontFamily}!important;}`);
  if (s.radius)         overrides.push(`button,.btn,input,select,textarea,.card,.panel,.modal{border-radius:${s.radius}px!important;}`);

  const root = vars.length ? `:root{\n${vars.join('\n')}\n}\n` : '';
  return `<style id="__style_editor__">
  *,*::before,*::after{box-sizing:border-box!important;}
  html{overflow-x:hidden!important;}
  body{overflow-x:hidden!important;width:100%!important;min-width:0!important;margin:0!important;}
  .container,.wrapper,.layout,.main,.content,.page,main,section,article,aside,.row,.grid,.col,.column,
  [class*="container"],[class*="wrapper"],[class*="layout"]{max-width:100%!important;width:100%!important;min-width:0!important;}
  .row,[class*="row"],[class*="flex-row"]{flex-wrap:wrap!important;}
  img,video,canvas,svg{max-width:100%!important;height:auto!important;}
  html{font-size:clamp(12px,1.4vw,16px)!important;}
  @media(max-width:600px){
    .sidebar,[class*="sidebar"],aside{display:none!important;}
    [style*="display:flex"],[style*="display: flex"],.flex,.d-flex{flex-direction:column!important;}
    table{font-size:11px!important;}th,td{padding:4px 6px!important;}
  }
  ${root}
  ${overrides.join('\n')}
</style>`;
}

const ROUTER_SCRIPT = `<script id="__spa_router__">
(function(){
  var _cur='Home',_ok=false;
  function install(){
    if(_ok)return;_ok=true;
    document.addEventListener('click',function(e){
      var t=e.target;
      while(t&&t!==document.body){
        var tag=(t.tagName||'').toLowerCase();
        var isNav=(tag==='a'||tag==='li'||
          (t.classList&&(t.classList.contains('nav-item')||t.classList.contains('nav-link')||
           t.classList.contains('sidebar-link')||t.classList.contains('menu-item'))));
        if(isNav){var lbl=(t.textContent||'').trim();if(lbl&&lbl.length>1&&lbl.length<40){e.preventDefault();e.stopPropagation();go(lbl);return;}}
        t=t.parentElement;
      }
    },true);
  }
  document.readyState!=='loading'?install():document.addEventListener('DOMContentLoaded',install);
  function go(p){
    if(p===_cur)return;_cur=p;
    var c=document.querySelector('main,.main-content,[class*="content-area"],.content,#content,article');
    if(!c)return;
    var primary=getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()||'#4f46e5';
    c.innerHTML='<div style="padding:8px 0"><h2 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 20px">'+p+'</h2>'
      +'<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px">'
      +'<p style="margin:0;font-size:13px;color:#6b7280">This section lets you manage '+p.toLowerCase()+' across the platform.</p></div></div>';
    document.querySelectorAll('a,li,[class*="nav-item"],[class*="menu-item"]').forEach(function(el){
      var txt=(el.textContent||'').trim();
      el.style.fontWeight=txt===p?'bold':'';el.style.opacity=txt===p?'1':'';
    });
  }
})();
</script>`;

function applyStyleAndRouter(htmlCode: string, s: StyleState): string {
  const result = /<\/body>/i.test(htmlCode)
    ? htmlCode.replace(/<\/body>/i, `${ROUTER_SCRIPT}\n</body>`)
    : htmlCode + '\n' + ROUTER_SCRIPT;
  const styleBlock = buildStyleBlock(s);
  if (/<\/body>/i.test(result)) return result.replace(/<\/body>/i, `${styleBlock}\n</body>`);
  if (/<head[^>]*>/i.test(result)) return result.replace(/(<head[^>]*>)/i, `$1\n${styleBlock}`);
  return styleBlock + '\n' + result;
}


async function copyAsPng(htmlContent: string, label: string): Promise<void> {
  // Render the HTML string into a hidden same-origin div, snapshot with html2canvas,
  // copy to clipboard as PNG. Falls back to PNG download if clipboard API unavailable.
  const { default: html2canvas } = await import('html2canvas');

  // Create a sandboxed container off-screen
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: '1280px',
    overflow: 'hidden',
    background: '#fff',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  // Write the HTML into a shadow-like iframe-in-div by using a blob URL
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.src = blobUrl;
  iframe.style.width = '1280px';
  iframe.style.height = '900px';
  iframe.style.border = 'none';
  container.appendChild(iframe);
  document.body.appendChild(container);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    setTimeout(resolve, 2000); // fallback timeout
  });

  try {
    // html2canvas the iframe element itself (captures visible area)
    const canvas = await html2canvas(container, {
      useCORS: true,
      allowTaint: true,
      scale: 1.5,
      width: 1280,
      height: 900,
      backgroundColor: '#ffffff',
    });

    const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!pngBlob) throw new Error('Canvas toBlob failed');

    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      alert(`✓ "${label}" copied as PNG — paste directly into Figma (Ctrl+V / Cmd+V).`);
    } else {
      // Fallback: download PNG
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = label.replace(/[^a-z0-9_-]/gi, '_') + '.png';
      a.click();
      URL.revokeObjectURL(url);
    }
  } finally {
    URL.revokeObjectURL(blobUrl);
    document.body.removeChild(container);
  }
}

function downloadHtml(filename: string, htmlContent: string) {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-z0-9_-]/gi, '_') + '.html';
  a.click();
  URL.revokeObjectURL(url);
}

// ── HtmlFrame — single auto-resizing iframe ───────────────────────────────

function HtmlFrame({
  block, style: styleState, viewportWidth,
}: { block: HtmlBlock; style: StyleState; viewportWidth: string }) {
  const [height, setHeight] = useState(680);
  const [copyingPng, setCopyingPng] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const styledHtml = useMemo(
    () => applyStyleAndRouter(block.code, styleState),
    [block.code, styleState],
  );

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type === 'mermaid-height') {
        setHeight(Math.max(480, e.data.height as number));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Auto-resize iframe to content height after load
  const handleLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const h = Math.max(480, doc.documentElement.scrollHeight, doc.body.scrollHeight);
        setHeight(h);
      }
    } catch {
      // cross-origin guard — postMessage height will fill in
    }
  }, []);

  return (
    <div className={styles.htmlFrame}>
      <div className={styles.htmlFrameHeader}>
        <span className={styles.htmlFrameLabel}>{block.label}</span>
        <button
          className={styles.downloadBtn}
          onClick={() => downloadHtml(block.label, styledHtml)}
          title="Download this mockup as an HTML file"
        >
          ⬇ Download HTML
        </button>
        <button
          className={styles.downloadBtn}
          disabled={copyingPng}
          onClick={async () => {
            setCopyingPng(true);
            try { await copyAsPng(styledHtml, block.label); }
            catch (e) { alert(`PNG export failed: ${String(e)}`); }
            finally { setCopyingPng(false); }
          }}
          title="Copy this mockup as a PNG — paste directly into Figma with Ctrl+V / Cmd+V"
        >
          {copyingPng ? '⟳ Rendering…' : '📋 Copy PNG → Figma'}
        </button>
      </div>
      <div
        className={styles.htmlFrameViewport}
        style={{ maxWidth: viewportWidth === '100%' ? '100%' : viewportWidth }}
      >
        <iframe
          ref={iframeRef}
          key={`${block.id}-${viewportWidth}-${JSON.stringify(styleState)}`}
          className={styles.htmlFrameIframe}
          style={{ height }}
          srcDoc={styledHtml}
          sandbox="allow-scripts"
          title={block.label}
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function MockupPreview({ markdown }: { markdown: string }) {
  const segments = useMemo(() => parseSegments(markdown), [markdown]);
  const [style, setStyle] = useState<StyleState>(DEFAULT_STYLE);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [showFontMenu, setShowFontMenu] = useState(false);

  const applyPreset = useCallback((preset: typeof PALETTE_PRESETS[0]) => {
    setStyle(prev => ({
      ...prev,
      primaryColor: preset.primary,
      secondaryColor: preset.secondary,
      surfaceColor: preset.surface,
      textColor: preset.text,
    }));
  }, []);

  const htmlBlocks = useMemo(
    () => segments.filter((s): s is { type: 'html'; block: HtmlBlock } => s.type === 'html').map(s => s.block),
    [segments],
  );

  if (htmlBlocks.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>No HTML mockups in this output.</strong>
        <br /><br />
        This agent was run with a saved custom prompt that produced markdown instead of HTML.
        <br /><br />
        To fix: click <strong>Re-run</strong>, then <strong>Reset to built-in default</strong>, then confirm re-run.
      </div>
    );
  }

  const activeViewport = VIEWPORT_OPTIONS.find(v => v.id === viewport)!;

  return (
    <div className={styles.docRoot}>
      {/* ── Sticky toolbar ─────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        {/* Viewport */}
        <div className={styles.toolbarGroup}>
          {VIEWPORT_OPTIONS.map(v => (
            <button
              key={v.id}
              className={`${styles.vpBtn} ${viewport === v.id ? styles.vpBtnActive : ''}`}
              onClick={() => setViewport(v.id)}
              title={`${v.label} – ${v.width}`}
            >
              <span>{v.icon}</span>
              <span className={styles.vpLabel}>{v.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.toolbarDivider} />

        {/* Palette presets */}
        <div className={styles.toolbarGroup}>
          {PALETTE_PRESETS.map(p => (
            <button
              key={p.label}
              className={`${styles.paletteBtn} ${!p.primary ? styles.paletteBtnReset : ''}`}
              title={p.label}
              onClick={() => applyPreset(p)}
              style={p.primary ? { background: p.primary, borderColor: p.primary } : undefined}
            >
              {!p.primary && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↺</span>}
            </button>
          ))}
          <span className={styles.toolbarHint}>Palette</span>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Primary color */}
        <div className={styles.toolbarGroup}>
          <label className={styles.toolbarHint}>Primary</label>
          <input
            type="color"
            className={styles.colorPicker}
            value={style.primaryColor || '#4f46e5'}
            onChange={e => setStyle(s => ({ ...s, primaryColor: e.target.value }))}
            title="Primary color"
          />
          <input
            type="color"
            className={styles.colorPicker}
            value={style.surfaceColor || '#ffffff'}
            onChange={e => setStyle(s => ({ ...s, surfaceColor: e.target.value }))}
            title="Surface / background color"
          />
          <label className={styles.toolbarHint}>Surface</label>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Radius */}
        <div className={styles.toolbarGroup}>
          <label className={styles.toolbarHint}>Radius</label>
          <input
            type="range"
            min={0} max={24} step={2}
            value={style.radius}
            onChange={e => setStyle(s => ({ ...s, radius: e.target.value }))}
            className={styles.toolbarRange}
            title={`Border radius: ${style.radius}px`}
          />
          <span className={styles.toolbarHint}>{style.radius}px</span>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Font */}
        <div className={styles.toolbarGroup} style={{ position: 'relative' }}>
          <button
            className={styles.fontBtn}
            onClick={() => setShowFontMenu(m => !m)}
            title="Font family"
          >
            Aa {style.fontFamily ? '●' : ''}
          </button>
          {showFontMenu && (
            <div className={styles.fontMenu}>
              <button className={styles.fontOption} onClick={() => { setStyle(s => ({ ...s, fontFamily: '' })); setShowFontMenu(false); }}>Use original</button>
              {FONT_OPTIONS.map(f => (
                <button key={f.label} className={styles.fontOption} style={{ fontFamily: f.value }}
                  onClick={() => { setStyle(s => ({ ...s, fontFamily: f.value })); setShowFontMenu(false); }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.toolbarSpacer} />

        <button
          className={styles.resetBtn}
          onClick={() => setStyle(DEFAULT_STYLE)}
          title="Reset all style overrides"
        >
          Reset
        </button>
      </div>

      {/* ── Document body ──────────────────────────────────────────────── */}
      <div className={styles.docBody}>
        {htmlBlocks.length === 2 ? (
          /* ── Side-by-side 2-up layout when exactly 2 mockups ── */
          <div className={styles.sideBySide}>
            {htmlBlocks.map((block, idx) => (
              <div key={block.id} className={styles.sidePane}>
                <div className={styles.sidePaneLabel}>
                  {block.label || `Mockup ${idx + 1}`}
                </div>
                <HtmlFrame
                  block={block}
                  style={style}
                  viewportWidth={activeViewport.width}
                />
              </div>
            ))}
          </div>
        ) : (
          /* ── Default single-column layout ── */
          <article className={styles.article}>
            {segments.map((seg, i) =>
              seg.type === 'markdown' ? (
                <div
                  key={i}
                  className={styles.mdSection}
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(seg.text) }}
                />
              ) : (
                <HtmlFrame
                  key={seg.block.id}
                  block={seg.block}
                  style={style}
                  viewportWidth={activeViewport.width}
                />
              )
            )}
          </article>
        )}
      </div>
    </div>
  );
}
