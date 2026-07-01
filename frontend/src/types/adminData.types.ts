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
  source: 'ai-suggested' | 'admin-added' | 'assessment';
  createdAt: number;
  updatedAt: number;
  notes?: string;
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
