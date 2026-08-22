/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Item #18 (Step 6 prioritization matrix) — user feedback capture on agent
 * output. Thin client for /api/agent-feedback (backend/src/routes/
 * agentFeedback.js). submitAgentFeedback is usable by any authenticated
 * user; listAgentFeedback/getAgentFeedbackSummary are admin-only (the
 * backend enforces this — a non-admin call just gets a 403).
 */
import { getAuthHeader } from '@/services/api';

function getApiBase(raw: string | undefined): string {
  const base = (raw ?? '/api').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

const API_URL = getApiBase(import.meta.env.VITE_API_URL);

export type FeedbackRating = 'up' | 'down';

export interface AgentFeedbackEntry {
  id: string;
  projectId: string;
  agentId: string;
  rating: FeedbackRating;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AgentFeedbackSummaryEntry {
  agentId: string;
  upCount: number;
  downCount: number;
  lastFeedbackAt: string | null;
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = {
    ...(await getAuthHeader()),
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data
      ? (data.error ?? data.message ?? JSON.stringify(data))
      : String(data ?? response.statusText);
    throw new Error(message);
  }
  return data;
}

export async function submitAgentFeedback(
  projectId: string,
  agentId: string,
  rating: FeedbackRating,
  comment?: string
): Promise<{ id: string }> {
  return apiFetch('/agent-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, agentId, rating, comment: comment || undefined }),
  });
}

export async function listAgentFeedback(options?: { projectId?: string; limit?: number }): Promise<AgentFeedbackEntry[]> {
  const params = new URLSearchParams();
  if (options?.projectId) params.set('projectId', options.projectId);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  const data = await apiFetch(`/agent-feedback${qs ? `?${qs}` : ''}`);
  return (data?.items ?? []) as AgentFeedbackEntry[];
}

export async function getAgentFeedbackSummary(): Promise<AgentFeedbackSummaryEntry[]> {
  const data = await apiFetch('/agent-feedback/summary');
  return (data?.items ?? []) as AgentFeedbackSummaryEntry[];
}
