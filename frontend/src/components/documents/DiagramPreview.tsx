/**
 * Renders mermaid fenced code blocks from a markdown document as live diagrams.
 *
 * Uses the mermaid npm package directly — no iframes, no CDN, no postMessage.
 * Each diagram is rendered into a div using mermaid.render() and the resulting
 * SVG is injected into the DOM.
 *
 * © 2025 Arun Gaikwad. All rights reserved.
 */
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import styles from './DiagramPreview.module.css';

// mermaid.initialize is idempotent — safe to call before every render.
// Calling it each time avoids a module-level singleton flag that would
// survive vi.clearAllMocks() in tests and prevent init assertions.
function ensureMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
    fontSize: 13,
    flowchart: { curve: 'basis', padding: 16, useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
    er: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  });
}

// ── Extraction ────────────────────────────────────────────────────────────────

interface DiagramBlock {
  id: string;
  label: string;
  code: string;
}

function extractMermaidBlocks(markdown: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = [];
  const lines = markdown.split('\n');
  let lastHeading = '';
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      lastHeading = headingMatch[1].trim();
      i++;
      continue;
    }
    if (/^```mermaid\s*$/.test(line.trim())) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      blockIndex++;
      blocks.push({
        id: `mermaid-diagram-${blockIndex}`,
        // Strip leading "1." / "1)" / "1 " numbering from heading labels
        label: (lastHeading.replace(/^\d+[.)\s]\s*/, '').trim()) || `Diagram ${blockIndex}`,
        code: codeLines.join('\n').trim(),
      });
    }
    i++;
  }
  return blocks;
}

// ── Sanitiser ─────────────────────────────────────────────────────────────────

const C4_SPLIT_RE = /(\))\s{2,}(?=[A-Z][A-Za-z]*\s*[\(\{])/g;

function sanitize(raw: string): string {
  const lines = raw.split('\n');
  const first = (lines[0] || '').trim().toLowerCase().replace(/\s+/g, '');
  const isSeq  = first.startsWith('sequencediagram');
  const isFlow = first.startsWith('graph') || first.startsWith('flowchart');
  const isEr   = first.startsWith('erdiagram');
  const isC4   = first.startsWith('c4context') || first.startsWith('c4container') ||
                 first.startsWith('c4component') || first.startsWith('c4dynamic');
  const out: string[] = [];

  if (isC4) {
    // Collect Boundary IDs first — Boundaries are containers, not relatable nodes.
    // Mermaid's C4 layout engine crashes with "Cannot read properties of undefined
    // (reading 'x')" when a Rel() target is a Boundary ID instead of a Person/System.
    const boundaryIds = new Set<string>();
    const C4_BOUNDARY_RE = /^\s*Boundary\s*\(\s*(\w+)\s*,/i;
    for (const line of lines) {
      const bm = line.match(C4_BOUNDARY_RE);
      if (bm) boundaryIds.add(bm[1]);
    }

    // Arrow relationships (entity --> target  or  entity --> target : label)
    // are not valid in Mermaid 11 C4 — convert to Rel() automatically.
    // Skip arrows where either endpoint is a Boundary (they are containers, not nodes).
    const C4_ARROW_RE = /^(\s*)(\w+)\s*-->\s*(\w+)(?:\s*:\s*"?([^"\n]*)"?)?\s*$/;
    for (const line of lines) {
      const arrowMatch = line.match(C4_ARROW_RE);
      if (arrowMatch) {
        const [, indent, from, to, label] = arrowMatch;
        // Skip if either endpoint is a Boundary — Mermaid can't layout relationships to containers
        if (boundaryIds.has(from) || boundaryIds.has(to)) continue;
        const lbl = label ? label.trim() : '';
        out.push(`${indent}Rel(${from}, ${to}, "${lbl}")`);
        continue;
      }
      // Strip trailing period from description strings — causes lexer errors in some builds.
      const split = line
        .replace(/(\.\s*")/g, '"')          // "text." → "text"
        .replace(C4_SPLIT_RE, ')\n');
      for (const sub of split.split('\n')) out.push(sub);
    }
    return out.join('\n');
  }

  const TYPE_MAP: Record<string, string> = {
    'timestampwithtimezone': 'TIMESTAMP', 'timestamp with time zone': 'TIMESTAMP',
    'timestampwithouttimezone': 'TIMESTAMP', 'timestamp without time zone': 'TIMESTAMP',
    'timestamptz': 'TIMESTAMP', 'character varying': 'VARCHAR', 'charactervarying': 'VARCHAR',
    'double precision': 'DOUBLE', 'doubleprecision': 'DOUBLE',
  };

  if (isEr) {
    const CONCAT_RE = new RegExp('(")([A-Z][A-Za-z0-9_]*[|}{o][|}{o]?)', 'g');
    const splitLines: string[] = [];
    for (const line of lines) {
      const parts = line.split(CONCAT_RE);
      if (parts.length > 1) {
        let current = '';
        for (let pi = 0; pi < parts.length; pi++) {
          if (pi % 3 === 0) { current += parts[pi]; }
          else if (pi % 3 === 1) { current += parts[pi]; splitLines.push(current.trimEnd()); current = '    '; }
          else { current += parts[pi]; }
        }
        if (current.trim()) splitLines.push(current);
      } else {
        splitLines.push(line);
      }
    }
    for (const line of splitLines) {
      const isRelLine = /[|}{o][|}{o]/.test(line) || /:\s*"/.test(line);
      if (!isRelLine && /^\s+\S/.test(line)) {
        const attrMatch = line.match(/^(\s+)(\S.*?)(\s+)(\w+)(\s*.*)$/);
        if (attrMatch) {
          const [, indent, rawType, , fieldName, rest] = attrMatch;
          const lower = rawType.toLowerCase();
          let cleanType = TYPE_MAP[lower] || TYPE_MAP[lower.replace(/\s+/g, '')] || rawType;
          cleanType = cleanType.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z0-9_]/g, '');
          if (cleanType) { out.push(indent + cleanType + ' ' + fieldName + rest); continue; }
        }
      }
      out.push(line);
    }
    return out.join('\n');
  }

  for (let line of lines) {
    if (isFlow) {
      line = line.replace(/([)\]"}])(\s*[A-Za-z_])/g, (m, close, next) => close + '\n' + next.trimStart());
      line = line.replace(/\b(\w+)\(([^")][^)]*)\)/g, (_m, id, label) => {
        if (/[.,;:\-\[\]{}|"'\\/<>@#()]/.test(label)) return id + '("' + label.replace(/"/g, "'").trim() + '")';
        return id + '(' + label + ')';
      });
      line = line.replace(/\b(\w+)\[([^\]"'][^\]]*)\]/g, (_m, id, label) => {
        if (/[.,;:\-{}|"'\\/<>@#]/.test(label)) return id + '["' + label.replace(/"/g, "'").trim() + '"]';
        return id + '[' + label + ']';
      });
    }
    if (isSeq) {
      line = line.replace(/^(\s*(?:participant|actor)\s+\S+\s+as\s+)(.+)$/, (_m, prefix, alias) => {
        const t = alias.trim();
        if (/[.,;:()\[\]{}|<>@#"'\\\/]/.test(t) && !t.startsWith('"')) return prefix + '"' + t.replace(/"/g, "'") + '"';
        return prefix + alias;
      });
    }
    for (const sub of line.split('\n')) out.push(sub);
  }
  return out.join('\n');
}

// ── Single diagram card ───────────────────────────────────────────────────────

function DiagramFrame({ block }: { block: DiagramBlock }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [svgSrc, setSvgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    setSvgSrc(null);

    async function render() {
      ensureMermaid();
      const cleanCode = sanitize(block.code);
      const renderId = block.id + '-' + Date.now();
      try {
        const { svg } = await mermaid.render(renderId, cleanCode);
        if (cancelled) return;
        setSvgSrc(svg);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            const vb = svgEl.getAttribute('viewBox');
            const attrW = svgEl.getAttribute('width');
            const attrH = svgEl.getAttribute('height');
            if (!vb && attrW && attrH) {
              const w = parseFloat(attrW);
              const h = parseFloat(attrH);
              if (w > 0 && h > 0) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            // Let CSS drive sizing (max-width/max-height 100% to fit container).
            // Do NOT set width:100% here — that forces the diagram to fill the
            // container width and makes ER diagrams very tall on screen.
            svgEl.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;display:block;';
          }
        }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setStatus('error');
      }
    }

    render();
    return () => { cancelled = true; };
  }, [block.id, block.code]);

  const downloadSvg = useCallback(() => {
    if (!svgSrc) return;
    const blob = new Blob([svgSrc], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = block.label.replace(/[^a-z0-9_-]/gi, '_') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [svgSrc, block.label]);

  return (
    <div className={styles.block}>
      <div className={styles.blockHeader}>
        <span className={styles.blockLabel}>{block.label}</span>
        <span className={styles.statusPill} data-status={status}>
          {status === 'loading' ? '⧗ rendering…' : status === 'error' ? '⚠ error' : '✓ rendered'}
        </span>
        <button className={styles.downloadBtn} onClick={downloadSvg} disabled={!svgSrc}>
          ↓ SVG
        </button>
      </div>

      {status === 'error' ? (
        <div className={styles.errorBox}>
          <strong>Render error</strong>
          <pre>{errorMsg}</pre>
          <details style={{ marginTop: 8, fontSize: 10 }}>
            <summary>Mermaid source</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{block.code}</pre>
          </details>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={styles.diagramContainer}
          data-status={status}
        />
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export default function DiagramPreview({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => extractMermaidBlocks(markdown), [markdown]);

  if (blocks.length === 0) {
    return (
      <div className={styles.empty}>
        No Mermaid diagrams found in this document. Switch to the Spec tab to view the full markdown.
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      <div className={styles.grid}>
        {blocks.map((block) => (
          <DiagramFrame key={block.id} block={block} />
        ))}
      </div>
    </div>
  );
}
