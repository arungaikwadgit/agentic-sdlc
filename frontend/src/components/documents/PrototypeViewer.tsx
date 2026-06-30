/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * PrototypeViewer — renders the Working Prototype agent output.
 *
 * The agent produces a multi-file codebase in this format:
 *   ## Tech Stack … (prose)
 *   ## File Structure … (tree)
 *   ```file:path/to/file
 *   … file contents …
 *   ```
 *
 * This component:
 *  1. Parses all file blocks from the markdown output
 *  2. Shows a tabbed UI: Preview (preview.html iframe) | Files (file tree + viewer) | Spec (raw markdown)
 *  3. Provides a "Download ZIP" button (JSZip) that packages all files + README
 *  4. Provides a "Download HTML" button for the preview.html standalone file
 *  5. The Preview iframe has a live external Theme Studio toolbar (in case preview.html
 *     doesn't include its own — it should, but this is a fallback)
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import styles from './PrototypeViewer.module.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedFile {
  path: string;
  content: string;
  language: string; // derived from extension
}

interface ParsedPrototype {
  files: ParsedFile[];
  previewHtml: string | null;
  techStackDescription: string;
  fileTree: string;
  rawMarkdown: string;
}

type ViewTab = 'preview' | 'files' | 'spec';

// ── Parser ──────────────────────────────────────────────────────────────────

function parsePrototypeOutput(markdown: string): ParsedPrototype {
  const files: ParsedFile[] = [];

  // Match ```file:path\n…content…\n``` blocks
  const fileBlockRe = /^```file:([^\n]+)\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = fileBlockRe.exec(markdown)) !== null) {
    const path = match[1].trim();
    const content = match[2];
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
      json: 'json', html: 'html', css: 'css', scss: 'scss',
      sql: 'sql', md: 'markdown', py: 'python', java: 'java',
      yaml: 'yaml', yml: 'yaml', env: 'bash', sh: 'bash',
    };
    files.push({ path, content, language: langMap[ext] ?? 'text' });
  }

  // Extract tech stack description (## Tech Stack section)
  const stackMatch = markdown.match(/^##\s+Tech Stack[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  const techStackDescription = stackMatch ? stackMatch[1].trim() : '';

  // Extract file tree (## File Structure section)
  const treeMatch = markdown.match(/^##\s+File Structure[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  const fileTree = treeMatch ? treeMatch[1].trim() : '';

  // Find preview.html
  const previewFile = files.find(f => f.path === 'preview.html' || f.path.endsWith('/preview.html'));
  const previewHtml = previewFile ? previewFile.content : null;

  return { files, previewHtml, techStackDescription, fileTree, rawMarkdown: markdown };
}

// ── Language → display label ───────────────────────────────────────────────

function langLabel(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'TS', tsx: 'TSX', javascript: 'JS', jsx: 'JSX',
    json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL',
    markdown: 'MD', python: 'PY', yaml: 'YAML', bash: 'SH',
  };
  return map[lang] ?? lang.toUpperCase().slice(0, 4);
}

function langColor(lang: string): string {
  const map: Record<string, string> = {
    typescript: '#3178c6', tsx: '#3178c6', javascript: '#f7df1e',
    jsx: '#61dafb', json: '#5b9bd5', html: '#e34c26', css: '#563d7c',
    sql: '#336791', markdown: '#083fa1', python: '#3572a5', bash: '#89e051',
  };
  return map[lang] ?? '#888';
}

// ── ZIP download ──────────────────────────────────────────────────────────

async function downloadZip(proto: ParsedPrototype, projectName: string): Promise<void> {
  const zip = new JSZip();
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const folder = zip.folder(slug)!;

  for (const file of proto.files) {
    folder.file(file.path, file.content);
  }

  // If no README in files, generate one
  const hasReadme = proto.files.some(f => f.path.toLowerCase() === 'readme.md');
  if (!hasReadme) {
    folder.file('README.md', [
      `# ${projectName}`,
      '',
      '## Tech Stack',
      proto.techStackDescription || 'See architecture document for tech stack details.',
      '',
      '## Setup',
      '',
      '```bash',
      '# Install dependencies',
      'npm install',
      '',
      '# Set up environment',
      'cp .env.example .env',
      '# Edit .env with your values',
      '',
      '# Set up database',
      'psql -U postgres -f db/schema.sql',
      'psql -U postgres -f db/seed.sql',
      '',
      '# Start development server',
      'npm run dev',
      '```',
      '',
      '## Preview (no build required)',
      '',
      'Open `preview.html` in your browser for an instant interactive prototype.',
      'No server or build step needed — everything is self-contained.',
      '',
      '## Project Structure',
      '',
      '```',
      proto.fileTree || proto.files.map(f => f.path).join('\n'),
      '```',
    ].join('\n'));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug + '-prototype.zip';
  a.click();
  URL.revokeObjectURL(url);
}

// ── External Theme Studio — types, constants ──────────────────────────────

interface ThemeState {
  preset: string;
  dark: boolean;
  font: string;
  primary: string;
  radius: number;
  spacing: number;
}

const DEFAULT_THEME: ThemeState = {
  preset: 'Default',
  dark: false,
  font: 'Inter, system-ui, sans-serif',
  primary: '#6366f1',
  radius: 8,
  spacing: 8,
};

const PRESETS: Record<string, Record<string, string>> = {
  Default:  { '--color-primary': '#6366f1', '--color-secondary': '#a5b4fc' },
  Ocean:    { '--color-primary': '#0ea5e9', '--color-secondary': '#7dd3fc' },
  Forest:   { '--color-primary': '#22c55e', '--color-secondary': '#86efac' },
  Sunset:   { '--color-primary': '#f97316', '--color-secondary': '#fdba74' },
  Violet:   { '--color-primary': '#a855f7', '--color-secondary': '#d8b4fe' },
  Midnight: { '--color-primary': '#818cf8', '--color-secondary': '#a5b4fc' },
};

const DARK_VARS: Record<string, string> = {
  '--color-bg':         '#0f172a',
  '--color-surface':    '#1e293b',
  '--color-text':       '#e2e8f0',
  '--color-text-muted': '#94a3b8',
  '--color-border':     '#334155',
};

const LIGHT_VARS: Record<string, string> = {
  '--color-bg':         '#f8fafc',
  '--color-surface':    '#ffffff',
  '--color-text':       '#1e293b',
  '--color-text-muted': '#64748b',
  '--color-border':     '#e2e8f0',
};

const FONTS = [
  { label: 'Inter',   value: 'Inter, system-ui, sans-serif' },
  { label: 'Roboto',  value: 'Roboto, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Mono',    value: "'JetBrains Mono', 'Fira Code', monospace" },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
];

// ── Preview iframe ────────────────────────────────────────────────────────

function PreviewFrame({ html }: { html: string }) {
  const [height, setHeight] = useState(720);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeState>(DEFAULT_THEME);
  // Mutable ref so handleLoad can read the latest theme without stale closures
  const themeRef = useRef<ThemeState>(DEFAULT_THEME);

  const blobUrl = useMemo(() => {
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [html]);

  useEffect(() => {
    return () => { URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  // Stable: injects a <style> tag with !important overrides so changes apply
  // immediately regardless of whether the prototype uses CSS variables or
  // hardcoded values.
  const applyTheme = useCallback((t: ThemeState) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    const preset   = PRESETS[t.preset] ?? PRESETS.Default;
    const primary  = t.primary || preset['--color-primary'];
    const mode     = t.dark ? DARK_VARS : LIGHT_VARS;
    const bg       = mode['--color-bg'];
    const surface  = mode['--color-surface'];
    const text     = mode['--color-text'];
    const muted    = mode['--color-text-muted'];
    const border   = mode['--color-border'];

    // Remove previous injection before re-adding
    doc.getElementById('__theme_studio__')?.remove();

    const style = doc.createElement('style');
    style.id = '__theme_studio__';
    style.textContent = `
      :root {
        --color-primary:    ${primary} !important;
        --color-secondary:  ${preset['--color-secondary'] ?? primary} !important;
        --color-bg:         ${bg} !important;
        --color-surface:    ${surface} !important;
        --color-text:       ${text} !important;
        --color-text-muted: ${muted} !important;
        --color-border:     ${border} !important;
        --font-family:      ${t.font} !important;
        --radius:           ${t.radius}px !important;
        --spacing-base:     ${t.spacing}px !important;
      }
      html, body {
        background-color: ${bg} !important;
        color: ${text} !important;
        font-family: ${t.font} !important;
      }
      * { font-family: ${t.font} !important; }
      nav, header, .navbar, .nav, .header, .topbar,
      [class*="navbar"], [class*="topbar"], [class*="header"]:not(h1):not(h2):not(h3):not(h4) {
        background-color: ${primary} !important;
        color: #fff !important;
      }
      nav *, header *, .navbar *, [class*="navbar"] *, [class*="topbar"] * { color: #fff !important; }
      a { color: ${primary} !important; }
      button[class*="primary"], .btn-primary, [class*="btn-primary"],
      button[class*="cta"], [class*="cta-btn"], .primary-action {
        background-color: ${primary} !important;
        border-color: ${primary} !important;
        color: #fff !important;
      }
      button, .btn, input, select, textarea,
      .card, [class*="card"], .panel, [class*="panel"],
      .modal, [class*="modal"], .dialog, [class*="dialog"] {
        border-radius: ${t.radius}px !important;
      }
      .card, [class*="card"], .panel, [class*="panel"], section, article,
      .surface, [class*="surface"], .container > div {
        background-color: ${surface} !important;
        border-color: ${border} !important;
        color: ${text} !important;
      }
      p, span, li, td, th, label, h1, h2, h3, h4, h5, h6 { color: ${text} !important; }
      .text-muted, [class*="muted"], [class*="subtitle"], small { color: ${muted} !important; }
      hr, [class*="divider"], [class*="separator"] { border-color: ${border} !important; }
    `;
    (doc.head ?? doc.documentElement).appendChild(style);
  }, []);

  const handleLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const h = Math.max(720, doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
        setHeight(h);
        // Re-apply current theme into the freshly-loaded iframe
        applyTheme(themeRef.current);
      }
    } catch { /* cross-origin — shouldn't happen with blob URL + allow-same-origin */ }
  }, [applyTheme]);

  const updateTheme = useCallback((patch: Partial<ThemeState>) => {
    setTheme(prev => {
      const next = { ...prev, ...patch };
      themeRef.current = next;
      applyTheme(next);
      return next;
    });
  }, [applyTheme]);

  return (
    <div className={styles.previewWrapper}>
      <iframe
        ref={iframeRef}
        src={blobUrl}
        className={styles.previewIframe}
        style={{ height }}
        sandbox="allow-scripts allow-same-origin"
        title="Working Prototype Preview"
        onLoad={handleLoad}
      />

      {/* ── External Theme Studio ─────────────────────────────────────── */}
      <button
        className={styles.themeFab}
        onClick={() => setStudioOpen(v => !v)}
        title="Theme Studio"
        aria-label="Open Theme Studio"
      >
        🎨
      </button>

      {studioOpen && (
        <div className={styles.themePanel}>
          <div className={styles.themePanelHeader}>
            <span>🎨 Theme Studio</span>
            <button
              className={styles.themePanelClose}
              onClick={() => setStudioOpen(false)}
              aria-label="Close Theme Studio"
            >✕</button>
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeSectionLabel}>Presets</div>
            <div className={styles.presetSwatches}>
              {(Object.keys(PRESETS) as string[]).map(name => (
                <button
                  key={name}
                  className={`${styles.swatchBtn} ${theme.preset === name ? styles.swatchActive : ''}`}
                  style={{ background: PRESETS[name]['--color-primary'] }}
                  onClick={() => updateTheme({ preset: name, primary: PRESETS[name]['--color-primary'] })}
                  title={name}
                />
              ))}
            </div>
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeToggleRow}>
              <span className={styles.themeSectionLabel}>Dark Mode</span>
              <div
                className={`${styles.toggleSwitch} ${theme.dark ? styles.toggleOn : ''}`}
                onClick={() => updateTheme({ dark: !theme.dark })}
                role="switch"
                aria-checked={theme.dark}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && updateTheme({ dark: !theme.dark })}
              >
                <div className={styles.toggleKnob} />
              </div>
            </div>
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeSectionLabel}>Primary Color</div>
            <input
              type="color"
              value={theme.primary}
              onChange={e => updateTheme({ preset: 'Custom', primary: e.target.value })}
              className={styles.colorInput}
            />
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeSectionLabel}>Font Family</div>
            <select
              value={theme.font}
              onChange={e => updateTheme({ font: e.target.value })}
              className={styles.themeSelect}
            >
              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeSectionLabel}>Border Radius — {theme.radius}px</div>
            <input
              type="range" min={0} max={24}
              value={theme.radius}
              onChange={e => updateTheme({ radius: Number(e.target.value) })}
              className={styles.themeSlider}
            />
          </div>

          <div className={styles.themeSection}>
            <div className={styles.themeSectionLabel}>Spacing — {theme.spacing}px</div>
            <input
              type="range" min={4} max={16} step={2}
              value={theme.spacing}
              onChange={e => updateTheme({ spacing: Number(e.target.value) })}
              className={styles.themeSlider}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── File viewer (syntax-highlighted via <pre>) ────────────────────────────

function FileViewer({
  file,
  canDownload,
  downloadDisabledReason,
}: {
  file: ParsedFile;
  canDownload: boolean;
  downloadDisabledReason?: string | null;
}) {
  const copyFile = useCallback(() => {
    navigator.clipboard.writeText(file.content).catch(() => {});
  }, [file.content]);

  const downloadFile = useCallback(() => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = file.path.split('/').pop() ?? 'file';
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, [file.content, file.path]);

  return (
    <div className={styles.fileViewer}>
      <div className={styles.fileViewerHeader}>
        <span className={styles.fileViewerPath}>{file.path}</span>
        <span className={styles.fileViewerLang} style={{ background: langColor(file.language) }}>
          {langLabel(file.language)}
        </span>
        <button className={styles.fileViewerBtn} onClick={copyFile} title="Copy to clipboard">⎘ Copy</button>
        <button
          className={styles.fileViewerBtn}
          onClick={downloadFile}
          disabled={!canDownload}
          title={!canDownload ? (downloadDisabledReason ?? 'File download is disabled for your current access level.') : 'Download file'}
        >
          ⬇ Download
        </button>
      </div>
      <pre className={styles.fileViewerPre}><code>{file.content}</code></pre>
    </div>
  );
}

// ── File tree sidebar ─────────────────────────────────────────

function FileTree({
  files, selected, onSelect,
}: { files: ParsedFile[]; selected: string | null; onSelect: (path: string) => void }) {
  // Group by directory
  const groups = useMemo(() => {
    const map = new Map<string, ParsedFile[]>();
    for (const f of files) {
      const parts = f.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(f);
    }
    return map;
  }, [files]);

  const dirs = useMemo(() => {
    const all = Array.from(groups.keys()).sort();
    return all;
  }, [groups]);

  return (
    <div className={styles.fileTree}>
      {dirs.map(dir => (
        <div key={dir} className={styles.fileTreeDir}>
          {dir && <div className={styles.fileTreeDirLabel}>📁 {dir}</div>}
          {groups.get(dir)!.map(f => (
            <button
              key={f.path}
              className={`${styles.fileTreeItem} ${selected === f.path ? styles.fileTreeItemActive : ''}`}
              onClick={() => onSelect(f.path)}
              title={f.path}
            >
              <span className={styles.fileTreeLang} style={{ background: langColor(f.language) }}>
                {langLabel(f.language)}
              </span>
              <span className={styles.fileTreeName}>{f.path.split('/').pop()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Raw markdown viewer (for Spec tab) ───────────────────────

function SpecView({ markdown }: { markdown: string }) {
  return (
    <pre className={styles.specPre}>{markdown}</pre>
  );
}

// ── Main component ────────────────────────────────────────────

export default function PrototypeViewer({
  markdown,
  projectName,
  canDownload = true,
  downloadDisabledReason,
}: {
  markdown: string;
  projectName: string;
  canDownload?: boolean;
  downloadDisabledReason?: string | null;
}) {
  const proto = useMemo(() => parsePrototypeOutput(markdown), [markdown]);
  const [tab, setTab] = useState<ViewTab>('files');
  const [selectedFile, setSelectedFile] = useState<string | null>(
    proto.files[0]?.path ?? null,
  );
  const [downloading, setDownloading] = useState(false);

  const selectedFileObj = useMemo(
    () => proto.files.find(f => f.path === selectedFile) ?? null,
    [proto.files, selectedFile],
  );

  const handleDownloadZip = useCallback(async () => {
    setDownloading(true);
    try { await downloadZip(proto, projectName); }
    catch (e) { alert(`ZIP download failed: ${String(e)}`); }
    finally { setDownloading(false); }
  }, [proto, projectName]);

  const handleDownloadHtml = useCallback(() => {
    if (!proto.previewHtml) return;
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const blob = new Blob([proto.previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug + '-preview.html';
    a.click();
    URL.revokeObjectURL(url);
  }, [proto.previewHtml, projectName]);

  if (proto.files.length === 0 && !proto.previewHtml) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyNote}>
          <strong>No file blocks detected in prototype output.</strong>
          <br /><br />
          The agent may have produced a single HTML prototype instead of a multi-file codebase.
          Try re-running with the built-in default prompt, or switch to the Spec tab to view raw output.
        </div>
        <SpecView markdown={markdown} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {proto.previewHtml && (
            <button
              className={`${styles.tab} ${tab === 'preview' ? styles.tabActive : ''}`}
              onClick={() => setTab('preview')}
            >
              ▶ Preview
            </button>
          )}
          <button
            className={`${styles.tab} ${tab === 'files' ? styles.tabActive : ''}`}
            onClick={() => setTab('files')}
          >
            📁 Files ({proto.files.length})
          </button>
          <button
            className={`${styles.tab} ${tab === 'spec' ? styles.tabActive : ''}`}
            onClick={() => setTab('spec')}
          >
            📄 Spec
          </button>
        </div>

        <div className={styles.toolbarActions}>
          {proto.techStackDescription && (
            <span className={styles.stackBadge} title={proto.techStackDescription}>
              ⚙ {proto.techStackDescription.split('\n')[0].slice(0, 60)}
            </span>
          )}
          {proto.previewHtml && (
            <button
              className={styles.actionBtn}
              onClick={handleDownloadHtml}
              disabled={!canDownload}
              title={!canDownload ? (downloadDisabledReason ?? 'HTML download is disabled for your current access level.') : undefined}
            >
              ⬇ Preview HTML
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={handleDownloadZip}
            disabled={downloading || proto.files.length === 0 || !canDownload}
            title={!canDownload ? (downloadDisabledReason ?? 'ZIP download is disabled for your current access level.') : undefined}
          >
            {downloading ? '⟳ Packaging…' : '⬇ Download ZIP'}
          </button>
        </div>
      </div>

      {/* ── Content area ──────────────────────────────────────────────── */}
      {tab === 'preview' && proto.previewHtml && (
        <div className={styles.previewArea}>
          <div className={styles.previewNote}>
            💡 Click the <strong>🎨</strong> button (bottom-right of screen) to customize colors, fonts, dark mode, and more in real time.
          </div>
          <PreviewFrame html={proto.previewHtml} />
        </div>
      )}

      {tab === 'files' && (
        <div className={styles.filesArea}>
          <FileTree
            files={proto.files}
            selected={selectedFile}
            onSelect={setSelectedFile}
          />
          <div className={styles.fileContent}>
            {selectedFileObj ? (
              <FileViewer
                file={selectedFileObj}
                canDownload={canDownload}
                downloadDisabledReason={downloadDisabledReason}
              />
            ) : (
              <div className={styles.noFileSelected}>Select a file to view its contents</div>
            )}
          </div>
        </div>
      )}

      {tab === 'spec' && (
        <div className={styles.specArea}>
          <SpecView markdown={markdown} />
        </div>
      )}
    </div>
  );
}
