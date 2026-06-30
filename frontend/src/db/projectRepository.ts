/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Project repository — talks to the Express backend API when Supabase is
 * configured, or falls back to local Dexie storage in admin mode.
 *
 * The calling interface is identical so no other files need to change.
 */
import type { Project, ProjectSummary } from '@/types/project.types';
import type { AgentId, AgentRun } from '@/types/agent.types';
import type { ProjectDocument } from '@/types/extraction.types';
import { TOTAL_AGENTS } from '@/agents/constants';
import { supabase } from '@/lib/supabase';
import { isAdminMode, ADMIN_USER_ID } from '@/lib/adminMode';
import { db } from './database';

// ── API layer ─────────────────────────────────────────────────────────────────

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // On 401, clear local state so UI redirects to login
    if (res.status === 401) {
      await supabase.auth.signOut().catch(() => {});
    }
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Server row shape ──────────────────────────────────────────────────────────

interface ApiProjectRow {
  id:          string;
  owner_id:    string;
  name:        string;
  description: string;
  domain:      string;
  status:      string;
  data:        Record<string, unknown>;
  created_at:  string;
  updated_at:  string;
  members?:    unknown[];
}

interface ApiCreatePayload {
  name:         string;
  description?: string;
  domain?:      string;
  status?:      string;
  data?:        Record<string, unknown>;
}

function rowToProject(row: ApiProjectRow): Project {
  const blob = (row.data ?? {}) as Partial<Project>;
  return {
    id:               row.id,
    name:             row.name,
    description:      row.description ?? '',
    domain:           (row.domain ?? '') as Project['domain'],
    status:           (row.status as Project['status']) ?? 'draft',
    createdAt:        new Date(row.created_at).getTime(),
    updatedAt:        new Date(row.updated_at).getTime(),
    ownerId:          row.owner_id,
    version:          (blob.version as number) ?? 1,
    agentRuns:        (blob.agentRuns as Project['agentRuns']) ?? {},
    reviewGates:      (blob.reviewGates as Project['reviewGates']) ?? {},
    promptOverrides:  (blob.promptOverrides as Project['promptOverrides']) ?? [],
    teamMembers:      (blob.teamMembers as Project['teamMembers']) ?? [],
    agentAssignments: (blob.agentAssignments as Project['agentAssignments']) ?? [],
    techStack:        blob.techStack,
    domainKnowledge:  blob.domainKnowledge,
    brandingGuidelines: blob.brandingGuidelines,
    sourceDocumentIds:  blob.sourceDocumentIds ?? [],
    archived:         blob.archived,
    archivedReason:   blob.archivedReason,
    archivedAt:       blob.archivedAt,
    archivedBy:       blob.archivedBy,
    activeAdminId:      blob.activeAdminId,
    mode:               (blob.mode as Project['mode']) ?? 'simple',
    mockupVersionCount: typeof blob.mockupVersionCount === 'number' ? blob.mockupVersionCount : undefined,
    exportAccess:       blob.exportAccess as Project['exportAccess'],
  };
}

function projectToPayload(p: Project): ApiCreatePayload {
  return {
    name:        p.name,
    description: p.description,
    domain:      p.domain,
    status:      p.status,
    data: {
      version:            p.version,
      agentRuns:          p.agentRuns,
      reviewGates:        p.reviewGates,
      promptOverrides:    p.promptOverrides,
      teamMembers:        p.teamMembers,
      agentAssignments:   p.agentAssignments,
      techStack:          p.techStack,
      domainKnowledge:    p.domainKnowledge,
      brandingGuidelines: p.brandingGuidelines,
      sourceDocumentIds:  p.sourceDocumentIds,
      archived:           p.archived,
      archivedReason:     p.archivedReason,
      archivedAt:         p.archivedAt,
      archivedBy:         p.archivedBy,
      activeAdminId:      p.activeAdminId,
      mode:               p.mode,
      mockupVersionCount: p.mockupVersionCount,
      exportAccess:       p.exportAccess,
    },
  };
}

// ── Dexie fallback (admin / local mode) ───────────────────────────────────────

function toSummary(p: Project): ProjectSummary {
  return {
    id:              p.id,
    name:            p.name,
    domain:          p.domain,
    status:          p.status,
    createdAt:       p.createdAt,
    updatedAt:       p.updatedAt,
    completedAgents: Object.values(p.agentRuns).filter((r) => r?.status === 'complete').length,
    totalAgents:     TOTAL_AGENTS,
    archived:        p.archived,
    archivedReason:  p.archivedReason,
    archivedAt:      p.archivedAt,
    archivedBy:      p.archivedBy,
  };
}

async function dexieCreate(
  data: Omit<Project, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns' | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'>
): Promise<Project> {
  const project: Project = {
    ...data,
    id:               crypto.randomUUID(),
    ownerId:          ADMIN_USER_ID,
    version:          1,
    createdAt:        Date.now(),
    updatedAt:        Date.now(),
    agentRuns:        {},
    reviewGates:      {},
    promptOverrides:  [],
    teamMembers:      [],
    agentAssignments: [],
    sourceDocumentIds: data.sourceDocumentIds ?? [],
  };
  await db.projects.add(project);
  return project;
}

async function dexieUpdate(
  id: string,
  updater: (p: Project) => Project | void
): Promise<Project> {
  const current = await db.projects.get(id);
  if (!current) throw new Error('Project not found: ' + id);
  const updated = updater(current) ?? current;
  updated.version  = (updated.version ?? 1) + 1;
  updated.updatedAt = Date.now();
  await db.projects.put(updated);
  return updated;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createProject(
  data: Omit<Project, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns' | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'>
): Promise<Project> {
  if (isAdminMode()) return dexieCreate(data);

  const partial: Project = {
    ...data,
    id:               '',
    version:          1,
    createdAt:        Date.now(),
    updatedAt:        Date.now(),
    agentRuns:        {},
    reviewGates:      {},
    promptOverrides:  [],
    teamMembers:      [],
    agentAssignments: [],
  };
  const row = await apiFetch<ApiProjectRow>('/api/projects', {
    method: 'POST',
    body:   JSON.stringify(projectToPayload(partial)),
  });
  return rowToProject(row);
}

export async function getProject(id: string): Promise<Project | undefined> {
  if (isAdminMode()) return db.projects.get(id);

  try {
    const row = await apiFetch<ApiProjectRow>(`/api/projects/${id}`);
    return rowToProject(row);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return undefined;
    throw err;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (isAdminMode()) {
    const projects = await db.projects.toArray();
    return projects.map(toSummary);
  }
  const rows = await apiFetch<ApiProjectRow[]>('/api/projects');
  return rows.map((row) => toSummary(rowToProject(row)));
}

export async function listVisibleProjects(): Promise<ProjectSummary[]> {
  return listProjects();
}

export async function updateProject(
  id: string,
  updater: (p: Project) => Project | void
): Promise<Project> {
  if (isAdminMode()) return dexieUpdate(id, updater);

  const current = await getProject(id);
  if (!current) throw new Error('Project not found: ' + id);
  const updated = updater(current) ?? current;
  updated.version  += 1;
  updated.updatedAt = Date.now();
  const row = await apiFetch<ApiProjectRow>(`/api/projects/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(projectToPayload(updated)),
  });
  return rowToProject(row);
}

export async function updateAgentRun(
  projectId: string,
  agentId: AgentId,
  run: Partial<AgentRun>
): Promise<void> {
  await updateProject(projectId, (p) => {
    // M-08 fix: cap stored output at 50K chars to prevent Dexie quota exhaustion
    // on large 30-agent projects. Truncated marker helps diagnose display issues.
    const MAX_OUTPUT_CHARS = 50_000;
    const runToStore = { ...run };
    if (typeof runToStore.output === 'string' && runToStore.output.length > MAX_OUTPUT_CHARS) {
      runToStore.output = runToStore.output.slice(0, MAX_OUTPUT_CHARS) +
        '\n\n[...output truncated — exceeded 50K character storage limit]';
    }
    p.agentRuns[agentId] = { ...(p.agentRuns[agentId] ?? { agentId, status: 'idle' }), ...runToStore };
  });
}

export async function deleteProject(id: string): Promise<void> {
  if (isAdminMode()) {
    await db.projects.delete(id);
    return;
  }
  await apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function restoreProject(id: string): Promise<void> {
  await updateProject(id, (p) => {
    p.archived       = false;
    p.archivedReason = undefined;
    p.archivedAt     = undefined;
    p.archivedBy     = undefined;
  });
}

export async function exportAllProjects(): Promise<string> {
  let projects: Project[];
  if (isAdminMode()) {
    projects = await db.projects.toArray();
  } else {
    const rows = await apiFetch<ApiProjectRow[]>('/api/projects');
    projects = rows.map(rowToProject);
  }
  return JSON.stringify({ version: 1, exportedAt: Date.now(), projects }, null, 2);
}

/**
 * Validates that an imported object has the minimum fields required for a
 * Project to be safely inserted.  Rejects nulls, non-objects, and anything
 * missing the three fields every downstream consumer depends on.
 */
function isValidProjectShape(p: unknown): p is Project {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id          === 'string' && obj.id.trim() !== '' &&
    typeof obj.name        === 'string' && obj.name.trim() !== '' &&
    typeof obj.description === 'string' &&
    typeof obj.domain      === 'string' &&
    (obj.agentRuns === undefined || (typeof obj.agentRuns === 'object' && obj.agentRuns !== null))
  );
}

export async function importProjects(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (!data.projects || !Array.isArray(data.projects)) throw new Error('Invalid backup format');

  let count = 0;
  for (const p of data.projects as unknown[]) {
    if (!isValidProjectShape(p)) {
      console.warn('[importProjects] Skipping invalid project entry:', p);
      continue;
    }
    if (isAdminMode()) {
      await db.projects.put({ ...p, ownerId: p.ownerId || ADMIN_USER_ID });
    } else {
      await apiFetch<ApiProjectRow>('/api/projects', {
        method: 'POST',
        body:   JSON.stringify(projectToPayload(p)),
      });
    }
    count++;
  }
  return count;
}

// ── Project documents (always local Dexie — binary blobs) ─────────────────────

export async function addProjectDocument(doc: ProjectDocument): Promise<void> {
  await db.projectDocuments.add(doc);
}

export async function getProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  return db.projectDocuments.where('projectId').equals(projectId).sortBy('uploadedAt');
}

export async function deleteProjectDocument(docId: string): Promise<void> {
  await db.projectDocuments.delete(docId);
}

export async function deleteProjectDocuments(projectId: string): Promise<void> {
  await db.projectDocuments.where('projectId').equals(projectId).delete();
}
