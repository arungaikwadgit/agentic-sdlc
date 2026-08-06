/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { AgentId } from '@/types/agent.types';
import { getAuthHeader } from '@/services/api';

function getApiBase(raw: string | undefined): string {
  const base = (raw ?? '/api').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

const API_URL = getApiBase(import.meta.env.VITE_API_URL);

export type PromptGovernanceScope = 'global' | 'project';
export type PromptGovernanceStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'activated'
  | 'superseded'
  | 'rolled_back';

export interface PromptGovernanceRecord {
  id: string;
  scope: PromptGovernanceScope;
  agent_id: string;
  agent_name: string;
  project_id?: string | null;
  parent_global_prompt_id?: string | null;
  version: number;
  content: string;
  resolved_effective_prompt?: string | null;
  content_checksum: string;
  status: PromptGovernanceStatus;
  active: boolean;
  approval_status: PromptGovernanceStatus;
  approval_comments?: string | null;
  change_summary?: string | null;
  change_reason?: string | null;
  risk_assessment?: string | null;
  impact_assessment?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptGovernanceSeed {
  agentId: AgentId;
  agentName: string;
  content: string;
}

export interface PromptVersionMutationOptions {
  changeSummary?: string;
  changeReason?: string;
  businessReason?: string;
  technicalReason?: string;
  riskAssessment?: string;
  impactAssessment?: string;
  metadata?: Record<string, unknown>;
}

export interface EffectivePromptResponse {
  prompt: string | null;
  source: 'project' | 'global' | 'legacy-app-state' | 'fallback';
  version: number | null;
  record: PromptGovernanceRecord | null;
}

async function governanceFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  return data as T;
}

export async function getGovernedEffectivePrompt(agentId: AgentId, projectId?: string): Promise<EffectivePromptResponse> {
  const params = new URLSearchParams({ agentId });
  if (projectId) params.set('projectId', projectId);
  return governanceFetch<EffectivePromptResponse>(`/prompt-governance/effective?${params.toString()}`);
}

export async function listPromptGovernanceVersions(agentId: AgentId, projectId?: string): Promise<PromptGovernanceRecord[]> {
  const params = new URLSearchParams({ agentId });
  if (projectId) params.set('projectId', projectId);
  const data = await governanceFetch<{ items: PromptGovernanceRecord[] }>(`/prompt-governance/versions?${params.toString()}`);
  return data.items ?? [];
}

export async function saveGlobalPromptVersion(agentId: AgentId, agentName: string, content: string): Promise<void> {
  await governanceFetch(`/prompt-governance/global/${encodeURIComponent(agentId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      content,
      changeSummary: 'Updated app-level prompt default.',
      changeReason: 'Admin edited the global agent prompt default.',
      metadata: { source: 'app-settings' },
    }),
  });
}

export async function activateProjectPromptOverride(
  projectId: string,
  agentId: AgentId,
  agentName: string,
  content: string,
): Promise<void> {
  await governanceFetch(`/prompt-governance/project/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      content,
      approvalComments: 'Activated by Project Owner through the project prompt editor.',
      changeSummary: 'Updated project-specific prompt override.',
      changeReason: 'Project-specific instructions need to override the global default.',
      metadata: { source: 'project-prompt-editor' },
    }),
  });
}


export async function createProjectPromptDraft(
  projectId: string,
  agentId: AgentId,
  agentName: string,
  content: string,
  options: PromptVersionMutationOptions = {},
): Promise<{ id: string; version: number }> {
  return governanceFetch(`/prompt-governance/project/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, content, ...options }),
  });
}

async function transitionProjectPromptVersion(
  projectId: string,
  agentId: AgentId,
  versionId: string,
  action: 'submit' | 'approve' | 'reject' | 'changes-requested',
  comments?: string,
): Promise<PromptGovernanceRecord> {
  const data = await governanceFetch<{ item: PromptGovernanceRecord }>(
    `/prompt-governance/project/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}/${encodeURIComponent(versionId)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalComments: comments ?? null }),
    },
  );
  return data.item;
}

export function submitProjectPromptVersion(projectId: string, agentId: AgentId, versionId: string, comments?: string) {
  return transitionProjectPromptVersion(projectId, agentId, versionId, 'submit', comments);
}

export function approveProjectPromptVersion(projectId: string, agentId: AgentId, versionId: string, comments?: string) {
  return transitionProjectPromptVersion(projectId, agentId, versionId, 'approve', comments);
}

export function rejectProjectPromptVersion(projectId: string, agentId: AgentId, versionId: string, comments?: string) {
  return transitionProjectPromptVersion(projectId, agentId, versionId, 'reject', comments);
}

export function requestProjectPromptChanges(projectId: string, agentId: AgentId, versionId: string, comments?: string) {
  return transitionProjectPromptVersion(projectId, agentId, versionId, 'changes-requested', comments);
}

export async function rollbackProjectPromptVersion(projectId: string, agentId: AgentId, versionId: string, reason: string): Promise<PromptGovernanceRecord> {
  const data = await governanceFetch<{ item: PromptGovernanceRecord }>(
    `/prompt-governance/project/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}/${encodeURIComponent(versionId)}/rollback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  return data.item;
}

export async function seedGlobalPromptVersions(prompts: PromptGovernanceSeed[]): Promise<{ created: number; skipped: number }> {
  const data = await governanceFetch<{ created: number; skipped: number }>('/prompt-governance/seed/global', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts }),
  });
  return { created: data.created, skipped: data.skipped };
}
