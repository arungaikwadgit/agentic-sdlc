/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * OrchestratorView
 *
 * Renders the SDLC Orchestration Plan with a unified Risk Register.
 *
 * Single source of truth: the orchestrator agent's markdown output.
 * - Risks tab seeds from the "Risk Register" section in that markdown.
 * - Any add / edit / delete writes back into the orchestrator output so
 *   the Full Plan always reflects the current risk list — no separate section.
 * - AI suggestions call the API with project context and let the user
 *   one-click-add to the unified register.
 */
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import DocumentViewer from '../documents/DocumentViewer';
import { getProject, updateProject } from '@/db/projectRepository';
import { api } from '@/services/api';
import styles from './OrchestratorView.module.css';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
  Header, Footer, PageNumber,
} from 'docx';
import { saveAs } from 'file-saver';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhaseBlock {
  phase: string;
  label: string;
  agents: string[];
  guidance: string;
  complexity: 'Low' | 'Medium' | 'High' | '';
  goCriteria: string;
  phaseInput: string;
  agenticBehavior: string;
}

interface RiskRow {
  risk: string;
  likelihood: string;
  impact: string;
  mitigation: string;
}

interface OrchestratorPlan {
  summary: string;
  phases: PhaseBlock[];
  criticalPath: string[];
  risks: RiskRow[];
  replanTriggers: string[];
  rawMarkdown: string;
  riskSectionHeading: string; // the exact heading line found in the markdown
}

// ── Markdown helpers ──────────────────────────────────────────────────────────

function stripMd(s: string): string {
  return s
    .replace(/^#{1,6}\s*/g, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

// ── Risk table helpers ────────────────────────────────────────────────────────

function riskTableToMarkdown(risks: RiskRow[]): string {
  if (!risks.length) return '';
  const header = '| Risk | Likelihood | Impact | Mitigation |\n|------|-----------|--------|-----------|';
  const rows = risks.map(r => `| ${r.risk} | ${r.likelihood} | ${r.impact} | ${r.mitigation} |`);
  return [header, ...rows].join('\n');
}

function parseRiskTable(text: string): RiskRow[] {
  const rows: RiskRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (/^[-:]+$/.test(cells[0])) continue;
    if (/risk/i.test(cells[0]) && /likelihood/i.test(cells[1])) continue;
    rows.push({ risk: cells[0] ?? '', likelihood: cells[1] ?? '', impact: cells[2] ?? '', mitigation: cells[3] ?? '' });
  }
  return rows;
}

/**
 * Replace (or append) the Risk Register section in the orchestrator markdown.
 * Returns the updated full markdown string.
 */
function spliceRiskRegister(markdown: string, heading: string, risks: RiskRow[]): string {
  const table = riskTableToMarkdown(risks);
  const h = heading || '## Risk Register';

  const idx = markdown.indexOf(h);
  if (idx < 0) {
    // No existing section — append
    return markdown.trimEnd() + `\n\n${h}\n\n${table}\n`;
  }

  const afterHeading = markdown.slice(idx + h.length);
  // Find next same-or-higher-level heading
  const headLevel = (h.match(/^#+/) ?? ['##'])[0].length;
  const nextHeadingRe = new RegExp(`^#{1,${headLevel}}\\s`, 'm');
  const nextMatch = afterHeading.search(nextHeadingRe);

  if (nextMatch >= 0) {
    return markdown.slice(0, idx) + h + '\n\n' + table + '\n\n' + afterHeading.slice(nextMatch);
  }
  return markdown.slice(0, idx) + h + '\n\n' + table + '\n';
}

// ── Plan parser ───────────────────────────────────────────────────────────────

function parsePlan(markdown: string): OrchestratorPlan {
  const lines = markdown.split('\n');

  let summary = '';
  const summaryIdx = lines.findIndex(l => /executive summary|project intelligence/i.test(l));
  if (summaryIdx !== -1) {
    const sl: string[] = [];
    for (let i = summaryIdx + 1; i < Math.min(summaryIdx + 20, lines.length); i++) {
      if (/^#{1,3}\s/.test(lines[i])) break;
      if (lines[i].trim()) sl.push(stripMd(lines[i].trim()));
    }
    summary = sl.slice(0, 5).join(' ');
  }

  const phases: PhaseBlock[] = [];
  const phaseRe = /^#{2,4}\s*(Phase\s*\d+[A-Z]?[\s—:-]+.+)$/i;
  const agentRe = /(?:agents?|run|execute)[:\s]+([^\n]+)/i;
  const complexityRe = /complexity[:\s]+(low|medium|high)/i;
  const goRe = /go[/-]?no[/-]?go|success criteria|done when/i;
  const phaseInputRe = /\*\*phase input\*\*[:\s]+(.+)/i;
  const agenticBehaviorRe = /\*\*agentic behavior[^*]*\*\*[:\s]+(.+)/i;

  let i = 0;
  while (i < lines.length) {
    const pm = lines[i].match(phaseRe);
    if (pm) {
      const label = stripMd(pm[1].replace(/^Phase\s*/i, 'Phase ').trim());
      const phaseNum = label.match(/\d+[A-Z]?/)?.[0] ?? '';
      const block: PhaseBlock = { phase: phaseNum, label, agents: [], guidance: '', complexity: '', goCriteria: '', phaseInput: '', agenticBehavior: '' };
      const gl: string[] = [];
      i++;
      while (i < lines.length && !/^#{2,4}\s/.test(lines[i])) {
        const line = lines[i];
        const am = line.match(agentRe);
        if (am) block.agents.push(...am[1].split(/[,;|]+/).map(s => stripMd(s.trim())).filter(Boolean));
        const cm = line.match(complexityRe);
        if (cm) block.complexity = (cm[1].charAt(0).toUpperCase() + cm[1].slice(1).toLowerCase()) as 'Low' | 'Medium' | 'High';
        const pim = line.match(phaseInputRe);
        if (pim && !block.phaseInput) {
          const parts = [pim[1]];
          for (let j = i + 1; j < lines.length; j++) {
            if (/^#{1,4}\s/.test(lines[j]) || /^[-*•]\s*\*\*/.test(lines[j]) || !lines[j].trim()) break;
            parts.push(lines[j]);
          }
          block.phaseInput = stripMd(parts.join(' ').trim());
        }
        const abm = line.match(agenticBehaviorRe);
        if (abm && !block.agenticBehavior) {
          const parts = [abm[1]];
          for (let j = i + 1; j < lines.length; j++) {
            if (/^#{1,4}\s/.test(lines[j]) || /^[-*•]\s*\*\*/.test(lines[j]) || !lines[j].trim()) break;
            parts.push(lines[j]);
          }
          block.agenticBehavior = stripMd(parts.join(' ').trim());
        }
        if (goRe.test(line)) {
          const gl2: string[] = [];
          for (let j = i + 1; j < Math.min(i + 6, lines.length) && !/^#{2,4}\s/.test(lines[j]); j++) {
            if (lines[j].trim()) gl2.push(stripMd(lines[j].replace(/^[-*•]\s*/, '').trim()));
          }
          block.goCriteria = gl2.slice(0, 3).join(' · ');
        }
        if (line.trim() && !/^#{1,4}/.test(line) && !pim && !abm) gl.push(stripMd(line.replace(/^[-*•]\s*/, '')));
        i++;
      }
      block.guidance = gl.slice(0, 3).join(' ').slice(0, 200);
      const dupIdx = phases.findIndex(p => p.phase === block.phase);
      if (dupIdx >= 0) { if (block.agents.length > phases[dupIdx].agents.length) phases[dupIdx] = block; }
      else phases.push(block);
    } else { i++; }
  }

  const critIdx = lines.findIndex(l => /critical path/i.test(l));
  const criticalPath: string[] = [];
  if (critIdx !== -1) {
    for (let j = critIdx + 1; j < Math.min(critIdx + 15, lines.length); j++) {
      if (/^#{1,3}\s/.test(lines[j])) break;
      const m = lines[j].match(/^[-*•\d.]\s*(.+)/);
      if (m) criticalPath.push(stripMd(m[1].trim()));
    }
  }

  // Find risk register section and capture its heading
  const riskHeadingRe = /^(#{1,3}\s*(?:\d+\.\s+)?(?:Risk Register|Risks?))\s*$/im;
  const riskHeadingMatch = markdown.match(riskHeadingRe);
  const riskSectionHeading = riskHeadingMatch ? riskHeadingMatch[1].trimEnd() : '';

  const risks: RiskRow[] = [];
  const riskIdx = lines.findIndex(l => riskHeadingRe.test(l));
  if (riskIdx !== -1) {
    for (let j = riskIdx + 1; j < Math.min(riskIdx + 50, lines.length); j++) {
      if (/^#{1,3}\s/.test(lines[j])) break;
      const cells = lines[j].split('|').map(s => s.trim()).filter(Boolean);
      if (cells.length >= 3 && !/^[-:]+$/.test(cells[0]) && !/Risk/i.test(cells[0])) {
        risks.push({ risk: stripMd(cells[0]), likelihood: stripMd(cells[1] ?? ''), impact: stripMd(cells[2] ?? ''), mitigation: stripMd(cells[3] ?? '') });
      }
    }
  }

  const replanTriggers: string[] = [];
  const replanIdx = lines.findIndex(l => /replan trigger|replanning trigger/i.test(l));
  if (replanIdx !== -1) {
    for (let j = replanIdx + 1; j < Math.min(replanIdx + 15, lines.length); j++) {
      if (/^#{1,3}\s/.test(lines[j])) break;
      const m = lines[j].match(/^[-*•\d.]\s*(.+)/);
      if (m) replanTriggers.push(stripMd(m[1].trim()));
    }
  }

  return { summary, phases, criticalPath, risks, replanTriggers, rawMarkdown: markdown, riskSectionHeading };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPLEXITY_COLOR: Record<string, string> = {
  High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e', '': '#94a3b8',
};
const LIKELIHOOD_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];
const IMPACT_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];
const BADGE_COLOR: Record<string, string> = {
  low: '#22c55e', medium: '#f59e0b', high: '#ef4444', critical: '#7c3aed', '': '#94a3b8',
};

function RiskBadge({ value }: { value: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
      fontWeight: 600, color: '#fff',
      background: BADGE_COLOR[value.toLowerCase()] ?? BADGE_COLOR[''],
    }}>{value || '—'}</span>
  );
}

// ── Inline Risk Editor Row ────────────────────────────────────────────────────

const EMPTY_RISK: RiskRow = { risk: '', likelihood: 'Medium', impact: 'Medium', mitigation: '' };

function RiskEditorRow({ initial, onSave, onCancel }: { initial: RiskRow; onSave: (r: RiskRow) => void; onCancel: () => void }) {
  const [form, setForm] = useState<RiskRow>(initial);
  const set = (k: keyof RiskRow) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <tr style={{ background: 'var(--surface2)' }}>
      <td style={{ padding: '6px 8px' }}>
        <input className="input" value={form.risk} onChange={set('risk')} placeholder="Describe the risk…"
          style={{ width: '100%', fontSize: 12, padding: '4px 6px' }} />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <select className="input" value={form.likelihood} onChange={set('likelihood')} style={{ fontSize: 12, padding: '4px 6px', width: '100%' }}>
          {LIKELIHOOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
      </td>
      <td style={{ padding: '6px 8px' }}>
        <select className="input" value={form.impact} onChange={set('impact')} style={{ fontSize: 12, padding: '4px 6px', width: '100%' }}>
          {IMPACT_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input className="input" value={form.mitigation} onChange={set('mitigation')} placeholder="Mitigation strategy…"
          style={{ width: '100%', fontSize: 12, padding: '4px 6px' }} />
      </td>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px', marginRight: 4 }}
          onClick={() => { if (form.risk.trim()) onSave(form); }} disabled={!form.risk.trim()}>Save</button>
        <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

// ── Word export ───────────────────────────────────────────────────────────────

const BADGE_COLORS: Record<string, string> = {
  low: 'C6EFCE',
  medium: 'FFEB9C',
  high: 'FFC7CE',
  critical: 'D9B3F0',
};

function cellBg(value: string): string {
  return BADGE_COLORS[value.toLowerCase()] ?? 'F2F2F2';
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function headerCell(text: string, widthDxa: number): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '1F3864' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '1F3864' },
      left: border, right: border,
    },
    shading: { fill: '1F3864', type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Arial' })],
    })],
  });
}

function dataCell(text: string, widthDxa: number, bg?: string, center?: boolean): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    borders: cellBorders,
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text, size: 19, font: 'Arial' })],
    })],
  });
}

async function exportRiskRegisterToWord(risks: RiskRow[], projectName?: string): Promise<void> {
  const title = projectName ? `${projectName} — Risk Register` : 'Risk Register';
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  // Column widths (DXA) — total = 9360 (US Letter, 1" margins)
  const colWidths = [3000, 1200, 1200, 3960];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Risk', colWidths[0]),
      headerCell('Likelihood', colWidths[1]),
      headerCell('Impact', colWidths[2]),
      headerCell('Mitigation Strategy', colWidths[3]),
    ],
  });

  const dataRows = risks.map((r, i) =>
    new TableRow({
      children: [
        dataCell(r.risk, colWidths[0], i % 2 === 0 ? 'F7F9FC' : 'FFFFFF'),
        dataCell(r.likelihood, colWidths[1], cellBg(r.likelihood), true),
        dataCell(r.impact, colWidths[2], cellBg(r.impact), true),
        dataCell(r.mitigation, colWidths[3], i % 2 === 0 ? 'F7F9FC' : 'FFFFFF'),
      ],
    })
  );

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1F3864' } },
            children: [
              new TextRun({ text: title, bold: true, size: 22, font: 'Arial', color: '1F3864' }),
              new TextRun({ text: `\t${now}`, size: 20, font: 'Arial', color: '888888' }),
            ],
            tabStops: [{ type: 'right' as const, position: 8640 }],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 18, color: '888888', font: 'Arial' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888', font: 'Arial' }),
              new TextRun({ text: ' of ', size: 18, color: '888888', font: 'Arial' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '888888', font: 'Arial' }),
            ],
          })],
        }),
      },
      children: [
        // Title
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 0, after: 240 },
          children: [new TextRun({ text: 'Risk Register', bold: true, size: 36, font: 'Arial', color: '1F3864' })],
        }),
        // Subtitle
        new Paragraph({
          spacing: { before: 0, after: 400 },
          children: [new TextRun({
            text: `${risks.length} risk${risks.length !== 1 ? 's' : ''} identified and assessed  ·  Generated ${now}`,
            size: 20, color: '666666', italics: true, font: 'Arial',
          })],
        }),
        // Table
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: colWidths,
          rows: [headerRow, ...dataRows],
        }),
        // Legend
        new Paragraph({ spacing: { before: 320, after: 100 }, children: [new TextRun({ text: 'Severity Legend', bold: true, size: 20, font: 'Arial', color: '444444' })] }),
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new TextRun({ text: '  Low  ', size: 18, font: 'Arial', shading: { fill: 'C6EFCE', type: ShadingType.CLEAR } }),
            new TextRun({ text: '   Medium  ', size: 18, font: 'Arial', shading: { fill: 'FFEB9C', type: ShadingType.CLEAR } }),
            new TextRun({ text: '   High  ', size: 18, font: 'Arial', shading: { fill: 'FFC7CE', type: ShadingType.CLEAR } }),
            new TextRun({ text: '   Critical  ', size: 18, font: 'Arial', shading: { fill: 'D9B3F0', type: ShadingType.CLEAR } }),
          ],
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${(projectName ?? 'Risk-Register').replace(/[^a-zA-Z0-9-_ ]/g, '')}-Risk-Register.docx`;
  saveAs(blob, filename);
}

// ── Main component ────────────────────────────────────────────────────────────

interface OrchestratorViewProps {
  markdown: string;
  projectId?: string;
  onRunAll?: () => void;
  onRunPhase?: (phaseLabel: string) => void;
  isRunning?: boolean;
  canExport?: boolean;
  exportDisabledReason?: string | null;
}

export default function OrchestratorView({
  markdown,
  projectId,
  onRunAll,
  onRunPhase,
  isRunning,
  canExport = true,
  exportDisabledReason,
}: OrchestratorViewProps) {
  const plan = useMemo(() => parsePlan(markdown), [markdown]);
  const [tab, setTab] = useState<'pipeline' | 'risks' | 'spec'>('pipeline');

  // ── Unified risk register (seeded from plan.risks) ────────────────────────
  const [allRisks, setAllRisks] = useState<RiskRow[]>([]);
  const initializedRef = useRef(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── AI suggestion state ───────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<RiskRow[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionsShown, setSuggestionsShown] = useState(false);
  const [projectCtx, setProjectCtx] = useState<{ domain: string; techStack: string; customDomain: string; name: string }>({ domain: '', techStack: '', customDomain: '', name: '' });

  // Seed allRisks from plan once (when orchestrator output first arrives)
  useEffect(() => {
    if (!initializedRef.current && plan.risks.length > 0) {
      setAllRisks(plan.risks);
      initializedRef.current = true;
    }
  }, [plan.risks]);

  // Load project context for suggestions
  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(p => {
      if (!p) return;
      setProjectCtx({
        domain: p.domain ?? '',
        techStack: p.techStack ?? '',
        customDomain: (() => {
          const dk = p.domainKnowledge ?? '';
          const h = '## Domain\n';
          const idx = dk.indexOf(h);
          if (idx < 0) return '';
          const after = dk.slice(idx + h.length);
          const next = after.search(/\n##\s/);
          return (next >= 0 ? after.slice(0, next) : after).trim();
        })(),
        name: p.name ?? '',
      });
    });
  }, [projectId]);

  // Persist updated risks → splice back into orchestrator markdown output
  const persist = useCallback(async (risks: RiskRow[]) => {
    if (!projectId) return;
    setSaving(true);
    try {
      const heading = plan.riskSectionHeading || '## Risk Register';
      await updateProject(projectId, (p) => {
        const run = (p.agentRuns as Record<string, { output?: string }>)['sdlcOrchestrator'];
        if (run?.output) {
          run.output = spliceRiskRegister(run.output, heading, risks);
        }
      });
    } finally {
      setSaving(false);
    }
  }, [projectId, plan.riskSectionHeading]);

  function handleSaveNew(r: RiskRow) {
    const updated = [...allRisks, r];
    setAllRisks(updated);
    setAddingNew(false);
    persist(updated);
  }

  function handleSaveEdit(idx: number, r: RiskRow) {
    const updated = allRisks.map((x, i) => i === idx ? r : x);
    setAllRisks(updated);
    setEditingIdx(null);
    persist(updated);
  }

  function handleDelete(idx: number) {
    if (!confirm('Remove this risk?')) return;
    const updated = allRisks.filter((_, i) => i !== idx);
    setAllRisks(updated);
    persist(updated);
  }

  // ── AI Risk Suggestions ───────────────────────────────────────────────────
  async function generateSuggestions() {
    setLoadingSuggestions(true);
    setSuggestionError(null);
    setSuggestions([]);
    setSuggestionsShown(true);

    const domainLabel = projectCtx.customDomain || projectCtx.domain || 'software';
    const techLabel = projectCtx.techStack || 'modern web stack';
    const existingRisks = allRisks.map(r => r.risk).join(', ');

    const systemPrompt = `You are a senior software delivery risk consultant.
Given project context, return a JSON array of 8-10 distinct, actionable risk suggestions.
Cover: domain-specific risks, technical risks (security, scalability, performance, data),
integration risks, team/process risks, and 2024-2025 trending risks for this tech stack.
Each risk must be specific — not generic filler.
Return ONLY a valid JSON array, no markdown:
[{"risk":"...","likelihood":"Low|Medium|High|Critical","impact":"Low|Medium|High|Critical","mitigation":"..."}]`;

    const userPrompt = `Project domain: ${domainLabel}
Tech stack: ${techLabel}
Already in risk register (do NOT repeat): ${existingRisks || 'none'}

Suggest 8-10 NEW risks covering domain, technical, integration, process, and trending angles.`;

    try {
      const resp = await api.callAgent({ systemPrompt, userPrompt, agentId: 'riskAdvisor' });
      const raw = resp.choices[0]?.message?.content ?? '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in response');
      const parsed: RiskRow[] = JSON.parse(match[0]);
      const existing = new Set(allRisks.map(r => r.risk.toLowerCase()));
      setSuggestions(parsed.filter(r => !existing.has(r.risk.toLowerCase())));
    } catch (e) {
      setSuggestionError(`Could not generate suggestions: ${String(e)}`);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function addSuggestion(r: RiskRow) {
    const updated = [...allRisks, r];
    setAllRisks(updated);
    setSuggestions(prev => prev.filter(s => s.risk !== r.risk));
    persist(updated);
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.badge}>🤖 Orchestration Plan</span>
          {plan.summary && <p className={styles.summary}>{plan.summary.slice(0, 300)}{plan.summary.length > 300 ? '…' : ''}</p>}
        </div>
        <div className={styles.headerActions}>
          {onRunAll && (
            <button className={styles.runAllBtn} onClick={onRunAll} disabled={isRunning}>
              {isRunning ? '⟳ Running…' : '▶ Run Full Pipeline'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'pipeline' ? styles.tabActive : ''}`} onClick={() => setTab('pipeline')}>
          🗺 Pipeline Plan
        </button>
        <button className={`${styles.tab} ${tab === 'risks' ? styles.tabActive : ''}`} onClick={() => setTab('risks')}>
          ⚠ Risks {allRisks.length > 0 && <span className={styles.tabBadge}>{allRisks.length}</span>}
        </button>
        <button className={`${styles.tab} ${tab === 'spec' ? styles.tabActive : ''}`} onClick={() => setTab('spec')}>
          📄 Full Plan
        </button>
      </div>

      {/* Pipeline tab */}
      {tab === 'pipeline' && (
        <div className={styles.pipelineTab}>
          {plan.criticalPath.length > 0 && (
            <div className={styles.criticalPathBar}>
              <span className={styles.criticalLabel}>🎯 Critical Path:</span>
              {plan.criticalPath.slice(0, 4).map((item, i) => (
                <span key={i} className={styles.criticalChip}>{item.slice(0, 60)}</span>
              ))}
            </div>
          )}
          <div className={styles.phaseGrid}>
            {plan.phases.length > 0 ? plan.phases.map((phase, i) => (
              <div key={i} className={styles.phaseCard}>
                <div className={styles.phaseCardHeader}>
                  <div className={styles.phaseCardTitle}>
                    <span className={styles.phaseNum}>Phase {phase.phase}</span>
                    <span className={styles.phaseName}>{phase.label.replace(/^Phase\s*\d+[A-Z]?\s*[—:-]?\s*/i, '')}</span>
                  </div>
                  <div className={styles.phaseCardMeta}>
                    {phase.complexity && (
                      <span className={styles.complexityBadge} style={{ color: COMPLEXITY_COLOR[phase.complexity] }}>
                        {phase.complexity}
                      </span>
                    )}
                    {onRunPhase && (
                      <button className={styles.runPhaseBtn} onClick={() => onRunPhase(phase.phase)}>▶</button>
                    )}
                  </div>
                </div>
                {phase.agents.length > 0 && (
                  <div className={styles.agentChips}>
                    {phase.agents.slice(0, 6).map((a, j) => <span key={j} className={styles.agentChip}>{a}</span>)}
                  </div>
                )}
                {phase.phaseInput && (
                  <div className={styles.goBox}>
                    <span className={styles.goLabel}>📥 Input:</span> {phase.phaseInput.slice(0, 220)}
                  </div>
                )}
                {phase.agenticBehavior && (
                  <div className={styles.goBox}>
                    <span className={styles.goLabel}>🧠 Agentic behavior:</span> {phase.agenticBehavior.slice(0, 220)}
                  </div>
                )}
                {phase.guidance && <p className={styles.phaseGuidance}>{phase.guidance.slice(0, 150)}</p>}
                {phase.goCriteria && (
                  <div className={styles.goBox}>
                    <span className={styles.goLabel}>✅ Go:</span> {phase.goCriteria.slice(0, 100)}
                  </div>
                )}
              </div>
            )) : (
              <div className={styles.emptyPhases}>
                <p>No phase plan extracted — view the Full Plan tab for the complete orchestration document.</p>
              </div>
            )}
          </div>
          {plan.replanTriggers.length > 0 && (
            <div className={styles.triggersBox}>
              <h4 className={styles.triggersTitle}>🔄 Replan Triggers</h4>
              <ul className={styles.triggersList}>
                {plan.replanTriggers.slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Risks tab — unified register */}
      {tab === 'risks' && (
        <div className={styles.risksTab}>

          {/* Register header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Risk Register {saving && <span style={{ fontWeight: 400, color: 'var(--accent)', fontSize: 11 }}>— saving…</span>}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {allRisks.length > 0 && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={() => exportRiskRegisterToWord(allRisks, projectCtx.name)}
                  disabled={!canExport}
                  title={!canExport ? (exportDisabledReason ?? 'Export is disabled for your current access level.') : undefined}
                >
                  ⬇ Export .docx
                </button>
              )}
              {projectId && !addingNew && editingIdx === null && (
                <button className="btn-primary" style={{ fontSize: 12, padding: '5px 14px' }}
                  onClick={() => setAddingNew(true)}>+ Add Risk</button>
              )}
            </div>
          </div>

          {allRisks.length === 0 && !addingNew ? (
            <div className={styles.emptyPhases} style={{ padding: '24px 16px' }}>
              <p style={{ margin: 0 }}>
                No risks found in the orchestration plan.{projectId ? ' Click "+ Add Risk" to log one.' : ''}
              </p>
            </div>
          ) : (
            <table className={styles.riskTable} style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Risk</th>
                  <th style={{ width: '12%' }}>Likelihood</th>
                  <th style={{ width: '10%' }}>Impact</th>
                  <th style={{ width: '34%' }}>Mitigation</th>
                  {projectId && <th style={{ width: '16%' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {allRisks.map((r, idx) =>
                  editingIdx === idx ? (
                    <RiskEditorRow key={idx} initial={r}
                      onSave={updated => handleSaveEdit(idx, updated)}
                      onCancel={() => setEditingIdx(null)} />
                  ) : (
                    <tr key={idx}>
                      <td>{r.risk}</td>
                      <td><RiskBadge value={r.likelihood} /></td>
                      <td><RiskBadge value={r.impact} /></td>
                      <td>{r.mitigation}</td>
                      {projectId && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', marginRight: 4 }}
                            onClick={() => { setEditingIdx(idx); setAddingNew(false); }}>✏ Edit</button>
                          <button className="btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--error)' }}
                            onClick={() => handleDelete(idx)} aria-label="Delete row">✕</button>
                        </td>
                      )}
                    </tr>
                  )
                )}
                {addingNew && (
                  <RiskEditorRow initial={EMPTY_RISK} onSave={handleSaveNew} onCancel={() => setAddingNew(false)} />
                )}
              </tbody>
            </table>
          )}

          {/* AI Risk Suggestions */}
          {projectId && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                  ✨ AI Risk Suggestions
                </h3>
                <button className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 14px' }}
                  onClick={generateSuggestions}
                  disabled={loadingSuggestions}>
                  {loadingSuggestions ? '⟳ Analysing…' : suggestionsShown ? '↺ Regenerate' : '✨ Suggest Risks'}
                </button>
              </div>

              {suggestionError && (
                <p style={{ color: 'var(--error)', fontSize: 12, margin: '0 0 8px' }}>{suggestionError}</p>
              )}

              {loadingSuggestions && (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Analysing domain, tech stack, and trending risks…
                </div>
              )}

              {!loadingSuggestions && suggestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suggestions.map((s, idx) => (
                    <div key={idx} style={{
                      display: 'grid', gridTemplateColumns: '1fr auto auto auto',
                      alignItems: 'start', gap: 12, padding: '10px 14px',
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, fontSize: 13,
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 3 }}>{s.risk}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{s.mitigation}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
                        <RiskBadge value={s.likelihood} />
                        <RiskBadge value={s.impact} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingTop: 4 }}>
                        {s.likelihood} likelihood<br />{s.impact} impact
                      </span>
                      <button className="btn-primary"
                        style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap', alignSelf: 'center' }}
                        onClick={() => addSuggestion(s)}>+ Add</button>
                    </div>
                  ))}
                </div>
              )}

              {!loadingSuggestions && suggestionsShown && suggestions.length === 0 && !suggestionError && (
                <div className={styles.emptyPhases} style={{ padding: '16px' }}>
                  <p style={{ margin: 0 }}>All suggestions have been added to your register.</p>
                </div>
              )}

              {!suggestionsShown && !loadingSuggestions && (
                <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center',
                  border: '1px dashed var(--border)', borderRadius: 6 }}>
                  Click "✨ Suggest Risks" to get AI-powered suggestions based on your domain, tech stack, and industry trends.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Full Plan — the orchestrator markdown is the source of truth */}
      {tab === 'spec' && (
        <div className={styles.specTab}>
          <DocumentViewer markdown={plan.rawMarkdown} />
        </div>
      )}
    </div>
  );
}
