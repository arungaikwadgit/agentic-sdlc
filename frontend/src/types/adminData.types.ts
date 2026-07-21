/**
 * Admin-only data models persisted through the backend app-state API.
 */

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  category: 'security' | 'performance' | 'ux' | 'devops' | 'feature' | 'testing' | 'tech-debt';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in-progress' | 'done' | 'archived';
  // 'governance' (added AI Governance MVP-0, 2026-07-21): auto-created by
  // backend/src/routes/governance.js from a Medium+ severity aiGovernance
  // finding (see govern-ai-gap-assessment-and-implementation-plan.md,
  // decision 7) -- distinct from 'ai-suggested' (which is manually curated
  // in BacklogTab.tsx's SEED_ITEMS) and 'assessment' (one-off human audit
  // findings). De-duped via a deterministic id (`gov-${projectId}-${controlId}`),
  // not this field, but the field lets the UI tag/filter these separately.
  source: 'ai-suggested' | 'admin-added' | 'assessment' | 'governance';
  createdAt: number;
  updatedAt: number;
  notes?: string;
  // Optional (added AI Governance MVP-0, 2026-07-21 -- see migration
  // 014_governance_backlog_project_scope.sql): only present on
  // governance-sourced items. admin_backlog_items was, and remains for
  // every pre-existing/manually-added row, a single global admin list --
  // this field does not retroactively scope those rows to a project.
  projectId?: string;
}

export interface TestRunResult {
  id: string;
  suite: 'unit' | 'e2e' | 'performance' | 'security';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  output?: string;
  triggeredBy: string;
}
