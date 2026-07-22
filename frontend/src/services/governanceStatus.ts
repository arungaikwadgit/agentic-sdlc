/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * AI Governance MVP-0 (2026-07-21) -- see
 * docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md.
 * Shared client for backend/src/routes/governance.js's read endpoint.
 * Used by both ReviewGateModal.tsx (gate0's decision badge + override, per
 * decisions 1/5) and ProjectWorkspace.tsx's persistent workspace-header
 * badge (decision 4) -- factored out here rather than duplicated across
 * both, since both need the exact same shape and fetch behavior.
 */
import { getAuthHeader } from './api';

export interface GovernanceFinding {
  id: string;
  control_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  gap: string | null;
  recommendation: string | null;
  owner_role: string | null;
}

export interface GovernanceDecisionRecord {
  id: string;
  decision: 'approved' | 'approved_with_conditions' | 'human_review_required' | 'blocked' | 'not_applicable';
  risk_tier: 'critical' | 'high' | 'moderate' | 'low';
  confidence: number | null;
  decision_reason: string | null;
}

export interface GovernanceOverrideRecord {
  id: string;
  actor_email: string;
  actor_role: string;
  reason: string;
}

export interface GovernanceStatus {
  decision: GovernanceDecisionRecord | null;
  findings: GovernanceFinding[];
  openFindingsCount: number;
  override: GovernanceOverrideRecord | null;
}

function getApiBase(raw?: string): string {
  const base = (raw ?? '/api').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

export function governanceApiBase(): string {
  return getApiBase(import.meta.env.VITE_API_URL);
}

export async function fetchGovernanceStatus(projectId: string): Promise<GovernanceStatus | null> {
  try {
    const resp = await fetch(`${governanceApiBase()}/governance/${projectId}`, {
      headers: await getAuthHeader(),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as GovernanceStatus;
  } catch (err) {
    console.error('[governanceStatus] Failed to load governance status:', err instanceof Error ? err.message : err);
    return null;
  }
}

export const DECISION_LABELS: Record<GovernanceDecisionRecord['decision'], string> = {
  approved: 'Approved',
  approved_with_conditions: 'Approved with Conditions',
  human_review_required: 'Human Review Required',
  blocked: 'Blocked',
  not_applicable: 'Not Applicable',
};

export const DECISION_COLORS: Record<GovernanceDecisionRecord['decision'], string> = {
  approved: 'var(--success, #10b981)',
  approved_with_conditions: '#f59e0b',
  human_review_required: '#f59e0b',
  blocked: 'var(--error, #ef4444)',
  not_applicable: 'var(--text-muted, #94a3b8)',
};
