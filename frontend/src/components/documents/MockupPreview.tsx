/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * UX Mockup Preview v2 — tabbed version comparison with live style editing.
 *
 * Features:
 *   - Version tabs (A / B / C / D) — one mockup at a time, easy switching
 *   - Placeholder tabs for versions not yet generated (greyed out)
 *   - Details tab (≡) — always visible; renders markdown design notes
 *   - Viewport switcher (Desktop / Tablet / Mobile)
 *   - Live style panel: palette presets, color pickers, font, radius, density, dark mode
 *   - Per-version style state — palette / colors apply to the selected tab only
 *   - ↻ Update button — triggers direct re-run without opening the panel
 *   - CSS token injection — overrides CSS custom properties in the iframe in real time
 *   - Download HTML / Copy PNG → Figma actions per version
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useAlert } from '@/contexts/AlertContext';
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
  density: 'compact' | 'comfortable' | 'spacious';
  darkMode: boolean;
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
  { label: 'Slate',   primary: '#475569', secondary: '#94a3b8', surface: '#f8fafc', text: '#0f172a' },
];

const DENSITY_OPTIONS = [
  { id: 'compact'     as const, label: 'S', title: 'Compact — tighter spacing' },
  { id: 'comfortable' as const, label: 'M', title: 'Comfortable — default spacing' },
  { id: 'spacious'    as const, label: 'L', title: 'Spacious — generous spacing' },
];

const DEFAULT_STYLE: StyleState = {
  primaryColor: '', secondaryColor: '', surfaceColor: '',
  textColor: '', fontFamily: '', radius: '8',
  density: 'comfortable', darkMode: false,
};

// ── Markdown segment parser ───────────────────────────────────────────────

function parseSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let blockIndex = 0;
  let lastIndex = 0;

  const htmlBlockRe = /^```html\s*\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = htmlBlockRe.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: 'markdown', text: before });

    blockIndex++;
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

// ── Style injection ───────────────────────────────────────────────────────

function buildStyleBlock(s: StyleState): string {
  const allOverrides: string[] = [];

  // 1. Dark mode — base layer, explicit user colors override later
  if (s.darkMode) {
    allOverrides.push(
      `html,body{background:#0f172a!important;color:#e2e8f0!important;}` +
      `[class*="card"],[class*="panel"],.card,.panel{background:#1e293b!important;border-color:#334155!important;color:#e2e8f0!important;}` +
      `nav,header,.navbar,[class*="nav"],[class*="sidebar"],footer{background:#0f172a!important;border-color:#334155!important;}` +
      `nav *,header *,.navbar *{color:#cbd5e1!important;}` +
      `input,select,textarea{background:#1e293b!important;color:#e2e8f0!important;border-color:#475569!important;}` +
      `table{background:#1e293b!important;}` +
      `thead,th{background:#0f172a!important;color:#94a3b8!important;border-color:#334155!important;}` +
      `td{border-color:#334155!important;}` +
      `.bg-white,.bg-light,[class*="bg-white"],[class*="bg-gray-50"],[class*="bg-slate"]{background:#1e293b!important;}` +
      `.text-muted,.text-secondary,[class*="text-gray"],[class*="text-slate"]{color:#94a3b8!important;}` +
      `img{filter:brightness(0.85);}` +
      `a:not([class*="btn"]):not(.btn){color:#818cf8!important;}` +
      `hr,[class*="divider"]{border-color:#334155!important;}` +
      `.hero,.banner,[class*="hero"]{background:linear-gradient(135deg,#1e1b4b 0%,#0f172a 100%)!important;}`
    );
  }

  // 2. Density overrides
  if (s.density === 'compact') {
    allOverrides.push(
      `button,.btn{padding:3px 8px!important;font-size:12px!important;}` +
      `.card,[class*="card"]{padding:8px!important;}` +
      `td,th{padding:3px 8px!important;}` +
      `section,.section,main{padding:8px 12px!important;}` +
      `h1,h2{margin:8px 0 4px!important;}h3,h4{margin:6px 0 3px!important;}` +
      `p,ul,li{margin-bottom:3px!important;}` +
      `[class*="gap"]{gap:4px!important;}`
    );
  } else if (s.density === 'spacious') {
    allOverrides.push(
      `button,.btn{padding:14px 28px!important;font-size:15px!important;}` +
      `.card,[class*="card"]{padding:28px!important;}` +
      `td,th{padding:14px 20px!important;}` +
      `section,.section,main{padding:48px!important;}` +
      `h1{margin:32px 0 16px!important;font-size:clamp(28px,4vw,48px)!important;}` +
      `h2{margin:24px 0 12px!important;font-size:clamp(22px,3vw,36px)!important;}` +
      `p,ul,li{margin-bottom:14px!important;line-height:1.8!important;}` +
      `[class*="gap"]{gap:20px!important;}`
    );
  }

  // 3. CSS custom properties (root vars)
  const densityPx = s.density === 'compact' ? '4' : s.density === 'spacious' ? '16' : '8';
  const vars: string[] = [`  --spacing-unit: ${densityPx}px;`];
  if (s.primaryColor)                    vars.push(`  --color-primary: ${s.primaryColor};`);
  if (s.secondaryColor)                  vars.push(`  --color-secondary: ${s.secondaryColor};`);
  if (s.surfaceColor)                    vars.push(`  --color-surface: ${s.surfaceColor};`);
  if (s.textColor)                       vars.push(`  --color-text: ${s.textColor};`);
  if (s.fontFamily)                      vars.push(`  --font-family: ${s.fontFamily};`);
  if (s.radius)                          vars.push(`  --radius: ${s.radius}px;`);
  if (s.darkMode && !s.surfaceColor)     vars.push(`  --color-surface: #1e293b;`);
  if (s.darkMode && !s.textColor)        vars.push(`  --color-text: #e2e8f0;`);

  // 4. Explicit user color overrides — highest priority, override dark mode
  if (s.surfaceColor) {
    allOverrides.push(`html,body{background-color:${s.surfaceColor}!important;}`);
  }
  if (s.textColor) {
    allOverrides.push(`body,p,span,li,td,th,label,input,select,textarea,h1,h2,h3,h4,h5,h6{color:${s.textColor}!important;}`);
  }
  if (s.primaryColor) {
    allOverrides.push(
      `nav,header,.navbar,.nav,.sidebar,.topbar,.header{background-color:${s.primaryColor}!important;color:#fff!important;}` +
      `nav *,header *,.navbar *,.nav *,.sidebar *,.topbar *{color:#fff!important;}` +
      `a{color:${s.primaryColor}!important;}` +
      `button[class*="primary"],.btn-primary{background-color:${s.primaryColor}!important;border-color:${s.primaryColor}!important;color:#fff!important;}`
    );
  }
  if (s.secondaryColor) {
    allOverrides.push(`.badge,.tag,.chip,.pill{background-color:${s.secondaryColor}!important;color:#fff!important;}`);
  }
  if (s.fontFamily)  allOverrides.push(`*{font-family:${s.fontFamily}!important;}`);
  if (s.radius)      allOverrides.push(`button,.btn,input,select,textarea,.card,.panel,.modal{border-radius:${s.radius}px!important;}`);

  const root = `:root{color-scheme:${s.darkMode ? 'dark' : 'light'};\n${vars.join('\n')}\n}\n`;

  return `<style id="__style_editor__">
  *,*::before,*::after{box-sizing:border-box!important;}
  html{overflow-x:hidden!important;}
  body{overflow-x:hidden!important;width:100%!important;min-width:0!important;margin:0!important;}
  .container,.wrapper,.layout,.main,.content,.page,main,section,article,aside,.row,.grid,.col,.column,
  [class*="container"],[class*="wrapper"],[class*="layout"]{max-width:100%!important;width:100%!important;min-width:0!important;}
  .row,[class*="row"],[class*="flex-row"]{flex-wrap:wrap!important;}
  img,video,canvas,svg{max-width:100%!important;}
  html{font-size:clamp(12px,1.4vw,16px)!important;}
  @media(max-width:600px){
    .sidebar,[class*="sidebar"],aside{display:none!important;}
    [style*="display:flex"],[style*="display: flex"],.flex,.d-flex{flex-direction:column!important;}
    table{font-size:11px!important;}th,td{padding:4px 6px!important;}
  }
  ${root}
  ${allOverrides.join('\n')}
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

async function copyAsPng(htmlContent: string, label: string): Promise<'copied' | 'downloaded'> {
  const { default: html2canvas } = await import('html2canvas');
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '1280px', overflow: 'hidden', background: '#fff',
    zIndex: '-1', pointerEvents: 'none',
  });
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.src = blobUrl;
  iframe.style.cssText = 'width:1280px;height:900px;border:none;';
  container.appendChild(iframe);
  document.body.appendChild(container);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    setTimeout(resolve, 2000);
  });

  try {
    const canvas = await html2canvas(container, {
      useCORS: true, allowTaint: true, scale: 1.5,
      width: 1280, height: 900, backgroundColor: '#ffffff',
    });
    const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!pngBlob) throw new Error('Canvas toBlob failed');

    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return 'copied';
    } else {
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = label.replace(/[^a-z0-9_-]/gi, '_') + '.png';
      a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
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
  const { toast } = useToast();
  const { showAlert } = useAlert();
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

  const handleLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const h = Math.max(480, doc.documentElement.scrollHeight, doc.body.scrollHeight);
        setHeight(h);
      }
    } catch { /* cross-origin guard */ }
  }, []);

  return (
    <div className={styles.htmlFrame}>
      <div className={styles.htmlFrameHeader}>
        <span className={styles.htmlFrameLabel}>{block.label}</span>
        <div className={styles.htmlFrameActions}>
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
              try {
                const result = await copyAsPng(styledHtml, block.label);
                if (result === 'copied') {
                  toast(`✓ "${block.label}" copied as PNG — paste directly into Figma (Ctrl+V / Cmd+V).`, 'success');
                }
              }
              catch (e) { showAlert(`PNG export failed: ${String(e)}`, { kind: 'error' }); }
              finally { setCopyingPng(false); }
            }}
            title="Copy this mockup as a PNG — paste directly into Figma with Ctrl+V / Cmd+V"
          >
            {copyingPng ? '⟳ Rendering…' : '📋 Copy PNG → Figma'}
          </button>
        </div>
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

interface MockupPreviewProps {
  markdown: string;
  /** Project ID — used to persist style state in localStorage across navigation. */
  projectId?: string;
  /** How many versions the user wants — controls display AND next re-run count. 1–4. */
  versionCount?: number;
  /** Called when the user picks a new count in the toolbar */
  onVersionCountChange?: (n: number) => void;
  /** Called when the user clicks ↻ Update — triggers immediate re-run */
  onRerun?: () => void;
  /** True while a re-run is in progress — disables Update button and shows spinner */
  isRerunning?: boolean;
}

const STYLE_STORAGE_KEY = (id: string) => `sdlc_mockup_styles_${id}`;
const PROTO_STYLE_KEY   = (id: string) => `sdlc_proto_style_${id}`;

export default function MockupPreview({
  markdown,
  projectId,
  versionCount,
  onVersionCountChange,
  onRerun,
  isRerunning,
}: MockupPreviewProps) {
  const segments = useMemo(() => parseSegments(markdown), [markdown]);

  // Per-version style state: each tab gets its own colour/font/density settings.
  // Persisted to localStorage keyed by projectId so styles survive navigation.
  const [versionStyles, setVersionStyles] = useState<Record<number, StyleState>>(() => {
    if (!projectId) return {};
    try {
      const saved = localStorage.getItem(STYLE_STORAGE_KEY(projectId));
      return saved ? (JSON.parse(saved) as Record<number, StyleState>) : {};
    } catch {
      return {};
    }
  });
  // Persist style state whenever it changes
  useEffect(() => {
    if (!projectId || Object.keys(versionStyles).length === 0) return;
    try {
      localStorage.setItem(STYLE_STORAGE_KEY(projectId), JSON.stringify(versionStyles));
    } catch { /* quota exceeded — silently ignore */ }
  }, [projectId, versionStyles]);

  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [activeVersionIndex, setActiveVersionIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [protoSaved, setProtoSaved] = useState(false);

  // ── Derived counts ──────────────────────────────────────────────────────
  const allHtmlBlocks = useMemo(
    () => segments.filter((s): s is { type: 'html'; block: HtmlBlock } => s.type === 'html').map(s => s.block),
    [segments],
  );

  const desiredCount = Math.min(Math.max(versionCount ?? allHtmlBlocks.length, 1), 4);
  const visibleCount = Math.min(desiredCount, allHtmlBlocks.length);
  const needsRerun   = desiredCount > allHtmlBlocks.length;
  const htmlBlocks   = allHtmlBlocks.slice(0, visibleCount);

  const hasMarkdown = useMemo(
    () => segments.some(s => s.type === 'markdown' && s.text.trim()),
    [segments],
  );

  // Keep active index valid when visible count shrinks
  const safeActiveIndex = Math.min(activeVersionIndex, Math.max(0, htmlBlocks.length - 1));

  // The style for the currently displayed version
  const activeStyle: StyleState = versionStyles[safeActiveIndex] ?? DEFAULT_STYLE;

  // Ref so callbacks can read the latest safeActiveIndex without being recreated
  const safeActiveIndexRef = useRef(safeActiveIndex);
  safeActiveIndexRef.current = safeActiveIndex;

  // ── Style helpers ───────────────────────────────────────────────────────

  /** Update only the active version's style */
  const updateActiveStyle = useCallback((fn: (prev: StyleState) => StyleState) => {
    const idx = safeActiveIndexRef.current;
    setVersionStyles(vs => ({
      ...vs,
      [idx]: fn(vs[idx] ?? DEFAULT_STYLE),
    }));
  }, []);

  const applyPreset = useCallback((preset: typeof PALETTE_PRESETS[0]) => {
    updateActiveStyle(prev => ({
      ...prev,
      primaryColor: preset.primary,
      secondaryColor: preset.secondary,
      surfaceColor: preset.surface,
      textColor: preset.text,
      darkMode: false,
    }));
  }, [updateActiveStyle]);

  // ── Save style for Working Prototype ────────────────────────────────────

  const saveForPrototype = useCallback(() => {
    if (!projectId) return;
    const style = versionStyles[safeActiveIndex] ?? DEFAULT_STYLE;
    const versionChar = String.fromCharCode(65 + safeActiveIndex); // 'A', 'B', 'C', 'D'
    try {
      localStorage.setItem(PROTO_STYLE_KEY(projectId), JSON.stringify({
        version: versionChar,
        style,
      }));
      setProtoSaved(true);
      setTimeout(() => setProtoSaved(false), 3000);
    } catch { /* quota exceeded */ }
  }, [projectId, versionStyles, safeActiveIndex]);

  // ── Guards ──────────────────────────────────────────────────────────────

  if (allHtmlBlocks.length === 0) {
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
  const versionLetter  = (i: number) => String.fromCharCode(65 + i);

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

        {/* Palette presets — apply to active version only */}
        <div className={styles.toolbarGroup}>
          {PALETTE_PRESETS.map(p => (
            <button
              key={p.label}
              className={`${styles.paletteBtn} ${!p.primary ? styles.paletteBtnReset : ''}`}
              title={`${p.label} (Version ${versionLetter(safeActiveIndex)})`}
              onClick={() => applyPreset(p)}
              style={p.primary ? { background: p.primary, borderColor: p.primary } : undefined}
            >
              {!p.primary && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↺</span>}
            </button>
          ))}
          <span className={styles.toolbarHint} title="Palette applies to the selected version only">
            Palette <span style={{ opacity: 0.6 }}>(Ver {versionLetter(safeActiveIndex)})</span>
          </span>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Color pickers — active version only */}
        <div className={styles.toolbarGroup}>
          <label className={styles.toolbarHint}>Primary</label>
          <input
            type="color"
            className={styles.colorPicker}
            value={activeStyle.primaryColor || '#4f46e5'}
            onChange={e => updateActiveStyle(s => ({ ...s, primaryColor: e.target.value }))}
            title="Primary color (active version)"
          />
          <input
            type="color"
            className={styles.colorPicker}
            value={activeStyle.surfaceColor || '#ffffff'}
            onChange={e => updateActiveStyle(s => ({ ...s, surfaceColor: e.target.value }))}
            title="Surface / background color (active version)"
          />
          <label className={styles.toolbarHint}>Bg</label>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Radius */}
        <div className={styles.toolbarGroup}>
          <label className={styles.toolbarHint}>Radius</label>
          <input
            type="range" min={0} max={24} step={2}
            value={activeStyle.radius}
            onChange={e => updateActiveStyle(s => ({ ...s, radius: e.target.value }))}
            className={styles.toolbarRange}
            title={`Border radius: ${activeStyle.radius}px`}
          />
          <span className={styles.toolbarHint}>{activeStyle.radius}px</span>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Density */}
        <div className={styles.toolbarGroup}>
          <label className={styles.toolbarHint}>Density</label>
          {DENSITY_OPTIONS.map(d => (
            <button
              key={d.id}
              className={`${styles.densityBtn} ${activeStyle.density === d.id ? styles.densityBtnActive : ''}`}
              title={d.title}
              onClick={() => updateActiveStyle(s => ({ ...s, density: d.id }))}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className={styles.toolbarDivider} />

        {/* Dark mode toggle */}
        <button
          className={`${styles.darkModeBtn} ${activeStyle.darkMode ? styles.darkModeBtnActive : ''}`}
          title={activeStyle.darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'}
          onClick={() => updateActiveStyle(s => ({ ...s, darkMode: !s.darkMode }))}
        >
          {activeStyle.darkMode ? '☀' : '🌙'}
        </button>

        <div className={styles.toolbarDivider} />

        {/* Font */}
        <div className={styles.toolbarGroup} style={{ position: 'relative' }}>
          <button
            className={styles.fontBtn}
            onClick={() => setShowFontMenu(m => !m)}
            title="Font family (active version)"
          >
            Aa {activeStyle.fontFamily ? '●' : ''}
          </button>
          {showFontMenu && (
            <div className={styles.fontMenu}>
              <button className={styles.fontOption} onClick={() => { updateActiveStyle(s => ({ ...s, fontFamily: '' })); setShowFontMenu(false); }}>
                Use original
              </button>
              {FONT_OPTIONS.map(f => (
                <button key={f.label} className={styles.fontOption} style={{ fontFamily: f.value }}
                  onClick={() => { updateActiveStyle(s => ({ ...s, fontFamily: f.value })); setShowFontMenu(false); }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.toolbarSpacer} />

        {/* Version count + Update button */}
        {onVersionCountChange && (
          <>
            <div className={styles.toolbarDivider} />
            <div className={styles.toolbarGroup}>
              <label className={styles.toolbarHint}>Versions</label>
              {([1, 2, 3, 4] as const).map(n => (
                <button
                  key={n}
                  className={`${styles.densityBtn} ${desiredCount === n ? styles.densityBtnActive : ''}`}
                  title={`Generate ${n} design version${n > 1 ? 's' : ''}`}
                  onClick={() => {
                    if (safeActiveIndex >= n) setActiveVersionIndex(n - 1);
                    onVersionCountChange(n);
                  }}
                >
                  {n}
                </button>
              ))}
              {onRerun && (
                <button
                  className={`${styles.updateBtn}${needsRerun ? ` ${styles.updateBtnHighlight}` : ''}`}
                  title={isRerunning ? 'Generating…' : `Re-generate ${desiredCount} version${desiredCount !== 1 ? 's' : ''} now`}
                  disabled={isRerunning}
                  onClick={onRerun}
                >
                  {isRerunning ? '⟳ Updating…' : '↻ Update'}
                </button>
              )}
            </div>
          </>
        )}

        <div className={styles.toolbarDivider} />

        {/* Send to Prototype — saves active version's style for workingPrototype */}
        {projectId && (
          <button
            className={styles.resetBtn}
            onClick={saveForPrototype}
            title={`Use Version ${versionLetter(safeActiveIndex)} colors in Working Prototype`}
            style={protoSaved ? { background: 'var(--success, #22c55e)', color: '#fff', borderColor: 'var(--success, #22c55e)' } : undefined}
          >
            {protoSaved ? '✓ Style Saved' : '→ Prototype'}
          </button>
        )}

        {/* Reset — resets only the active version's style */}
        <button
          className={styles.resetBtn}
          onClick={() => {
            setVersionStyles(vs => {
              const next = { ...vs };
              delete next[safeActiveIndex];
              // Persist the updated (reduced) map so the reset survives reload
              if (projectId) {
                try {
                  const remaining = { ...next };
                  if (Object.keys(remaining).length === 0) {
                    localStorage.removeItem(STYLE_STORAGE_KEY(projectId));
                  } else {
                    localStorage.setItem(STYLE_STORAGE_KEY(projectId), JSON.stringify(remaining));
                  }
                } catch { /* ignore */ }
              }
              return next;
            });
            setShowDetails(false);
          }}
          title={`Reset style for Version ${versionLetter(safeActiveIndex)}`}
        >
          Reset
        </button>
      </div>

      {/* ── Re-run banner — shown when desired > generated ─────────────── */}
      {needsRerun && (
        <div className={styles.rerunBanner}>
          <span>
            {allHtmlBlocks.length} version{allHtmlBlocks.length !== 1 ? 's' : ''} generated — you selected {desiredCount}.
          </span>
          <strong>Click ↻ Update to generate {desiredCount} versions with distinct color themes.</strong>
        </div>
      )}

      {/* ── Version tab bar ────────────────────────────────────────────── */}
      <div className={styles.versionTabBar}>

        {/* Generated version tabs */}
        {htmlBlocks.map((block, i) => (
          <button
            key={block.id}
            className={`${styles.versionTab} ${!showDetails && safeActiveIndex === i ? styles.versionTabActive : ''}`}
            onClick={() => { setActiveVersionIndex(i); setShowDetails(false); }}
            title={block.label}
          >
            <span className={styles.versionTabBadge}>{versionLetter(i)}</span>
            <span className={styles.versionTabLabel}>{block.label}</span>
          </button>
        ))}

        {/* Placeholder tabs for versions not yet generated */}
        {Array.from({ length: desiredCount - visibleCount }, (_, i) => {
          const tabIdx = visibleCount + i;
          return (
            <button
              key={`pending-${tabIdx}`}
              className={`${styles.versionTab} ${styles.versionTabPending}`}
              disabled
              title={`Version ${versionLetter(tabIdx)} — click ↻ Update to generate`}
            >
              <span className={styles.versionTabBadge}>{versionLetter(tabIdx)}</span>
              <span className={styles.versionTabLabel}>Pending</span>
            </button>
          );
        })}

        {/* Details tab — always visible */}
        <button
          className={`${styles.versionTab} ${showDetails ? styles.versionTabActive : ''}`}
          onClick={() => setShowDetails(true)}
          title="Design system docs, comparison notes, and recommendations"
        >
          <span className={styles.versionTabBadge}>≡</span>
          <span className={styles.versionTabLabel}>Details</span>
        </button>

        <div className={styles.versionTabSpacer} />
        <span className={styles.versionTabCount}>
          {htmlBlocks.length}/{desiredCount} version{desiredCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className={styles.docBody}>
        {showDetails ? (
          /* Details tab — full markdown (or placeholder if none) */
          <article className={styles.article}>
            {hasMarkdown ? (
              segments.map((seg, i) =>
                seg.type === 'markdown' ? (
                  <div
                    key={i}
                    className={styles.mdSection}
                    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(seg.text) }}
                  />
                ) : null
              )
            ) : (
              /* Instructional fallback when the LLM didn't produce markdown notes */
              <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>
                  About This Preview
                </h3>
                <p style={{ margin: '0 0 16px' }}>
                  The <strong>Details</strong> tab shows the design rationale the AI wrote alongside the mockups —
                  things like design system notes, feature coverage, and a comparison of each version.
                  When those notes are present, they appear here automatically.
                </p>

                <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
                  Version color themes
                </h4>
                <p style={{ margin: '0 0 6px' }}>Each version uses a completely distinct palette. No colors overlap between tabs:</p>
                <ul style={{ margin: '0 0 16px', paddingLeft: 20 }}>
                  <li><strong>Version A</strong> &mdash; Indigo / Blue-Violet (uses your style guide if one is attached)</li>
                  <li><strong>Version B</strong> &mdash; Teal / Emerald</li>
                  <li><strong>Version C</strong> &mdash; Amber / Orange</li>
                  <li><strong>Version D</strong> &mdash; Rose / Pink</li>
                </ul>

                <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
                  Style toolbar
                </h4>
                <p style={{ margin: '0 0 6px' }}>Each tab has its own independent style state. Use the toolbar to:</p>
                <ul style={{ margin: '0 0 16px', paddingLeft: 20 }}>
                  <li>Switch palette presets (Ocean, Forest, Sunset, Violet, Rose, Slate)</li>
                  <li>Pick custom primary / secondary / surface / text colors</li>
                  <li>Change font family and border radius</li>
                  <li>Toggle Compact / Comfortable / Spacious density</li>
                  <li>Enable dark mode &mdash; all overrides apply live inside the iframe</li>
                </ul>

                <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
                  Getting design notes
                </h4>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Click <strong>Update</strong> (the rotate arrow in the toolbar) to re-run the UX Mockups agent.
                  The agent will generate fresh mockups and include a Design System section, version rationale,
                  and a Comparison {'&'} Recommendation table visible here in the Details tab.
                  {desiredCount > allHtmlBlocks.length
                    ? ` (${desiredCount - allHtmlBlocks.length} pending version${desiredCount - allHtmlBlocks.length !== 1 ? 's' : ''} will also be generated.)`
                    : ''}
                </p>
              </div>
            )}
          </article>
        ) : (
          /* Active HTML version -- uses that version's own style state */
          htmlBlocks[safeActiveIndex] && (
            <HtmlFrame
              block={htmlBlocks[safeActiveIndex]}
              style={activeStyle}
              viewportWidth={activeViewport.width}
            />
          )
        )}
      </div>
    </div>
  );
}
