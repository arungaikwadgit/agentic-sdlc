/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Excel export for pipeline metrics and review checklists (Appendix v4.2).
 * Uses SheetJS (xlsx) to generate .xlsx files.
 */

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Project } from '@/types/project.types';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';

function autoWidth(ws: XLSX.WorkSheet, data: object[]) {
  const cols = Object.keys(data[0] ?? {}).map((key) => ({
    wch: Math.max(key.length, ...data.map((r) => String((r as Record<string, unknown>)[key] ?? '').length)),
  }));
  ws['!cols'] = cols;
}

export function exportPipelineMetricsXlsx(project: Project) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Agent Summary ──────────────────────────────────────
  const summaryRows = PHASE_ORDER.flatMap((phase) =>
    PHASE_AGENTS[phase].map((agentId) => {
      const run = project.agentRuns[agentId];
      const def = AGENT_DEFINITIONS[agentId];
      const duration =
        run?.startedAt && run?.completedAt
          ? ((run.completedAt - run.startedAt) / 1000).toFixed(1) + 's'
          : '—';
      return {
        Phase: PHASE_LABELS[phase],
        Agent: def?.name ?? agentId,
        'Output Document': def?.outputLabel ?? '—',
        Status: run?.status ?? 'idle',
        'Duration (s)': duration,
        'Tokens Used': run?.tokensUsed ?? 0,
        'Output Length': run?.output?.length ?? 0,
        'Error': run?.error ?? '',
      };
    })
  );
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  autoWidth(ws1, summaryRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Agent Summary');

  // ── Sheet 2: Review Gate Log ────────────────────────────────────
  const gateRows = Object.entries(project.reviewGates).map(([gateId, gate]) => ({
    'Gate ID': gateId,
    'Approved': gate?.approved ? 'Yes' : 'No',
    'Approved At': gate?.approvedAt ? new Date(gate.approvedAt).toLocaleString() : '—',
    'Notes': gate?.notes ?? '',
  }));
  if (gateRows.length === 0) gateRows.push({ 'Gate ID': 'No gates triggered yet', 'Approved': '', 'Approved At': '', 'Notes': '' });
  const ws2 = XLSX.utils.json_to_sheet(gateRows);
  autoWidth(ws2, gateRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Review Gates');

  // ── Sheet 3: Review Checklist (DoD) ────────────────────────────
  const dodItems = [
    'Code written and committed with meaningful message',
    'Unit tests pass (≥80% line coverage)',
    'Integration tests pass',
    'E2E tests pass (if UI changes)',
    'Linting and formatting pass with no warnings',
    'TypeScript compilation has no errors',
    'Accessibility: axe-playwright passes with zero violations',
    'Documentation updated',
    'Reviewed by at least one team member (PR approval)',
    'No known critical bugs (P0/P1)',
    'Performance test shows no regression >10%',
    'Security scan (npm audit) passes',
    'Deployed to staging and verified by QA',
  ];
  const dodRows = dodItems.map((item) => ({
    'Definition of Done Item': item,
    'Complete (Yes/No)': '',
    'Notes': '',
  }));
  const ws3 = XLSX.utils.json_to_sheet(dodRows);
  autoWidth(ws3, dodRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'DoD Checklist');

  // ── Write and download ──────────────────────────────────────────
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  saveAs(blob, `${project.name.replace(/[^a-z0-9]/gi, '_')}_metrics.xlsx`);
}
