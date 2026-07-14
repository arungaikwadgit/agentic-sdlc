/**
 * Project repository.
 *
 * Core project data is backend-owned and persisted in Postgres through the
 * Express API. The frontend may still have browser-only UI preferences in
 * other modules, but project records and project-attached document context do
 * do not use browser-local persistence here.
 */
import type { Project, ProjectSummary } from '@/types/project.types';
import type { AgentId, AgentRun } from '@/types/agent.types';
import type { ProjectDocument } from '@/types/extraction.types';
import { TOTAL_AGENTS } from '@/agents/constants';
import { supabase } from '@/lib/supabase';
import { getInviteSession } from '@/services/inviteSession';
import { getAuthHeader, getProxyToken } from '@/services/api';

function getApiBase(raw: string | undefined): string {
  const base = (raw ?? 'http://localhost:3001').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBase(import.meta.env.VITE_API_URL as string | undefined);

  // getApiBase() always returns something ending in "/api" -- either the literal
  // string "/api" (local dev, VITE_API_URL unset or already "/api") or a full
  // origin + "/api" (production, e.g. VITE_API_URL=https://.../api). Every caller
  // in this file already passes an "/api"-prefixed path (e.g. '/api/projects'), so
  // strip that redundant prefix before concatenating. The previous version only
  // special-cased base === '/api' literally and otherwise concatenated blindly,
  // which was fine in local dev but doubled up into ".../api/api/projects" in
  // production where base is the full Railway URL ending in "/api" -- the local
  // case accidentally masked the bug because "/api" + "/api/projects" still
  // "looked" like it worked by coincidence of string matching, not by design.
  const suffix = normalizedPath.startsWith('/api') ? normalizedPath.slice(4) : normalizedPath;
  return `${base}${suffix}`;
}

const PROJECT_REPOSITORY_EVENT = 'sdlc:project-repository-change';

function emitProjectRepositoryChange(projectId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROJECT_REPOSITORY_EVENT, { detail: { projectId } }));
}

export function subscribeProjectRepositoryChange(listener: (projectId?: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ projectId?: string }>;
    listener(custom.detail?.projectId);
  };
  window.addEventListener(PROJECT_REPOSITORY_EVENT, handler as EventListener);
  return () => window.removeEventListener(PROJECT_REPOSITORY_EVENT, handler as EventListener);
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers = await getAuthHeader();
  if (!headers.Authorization && !headers['X-API-Token']) {
    const proxyToken = getProxyToken();
    if (proxyToken) {
      return { 'Content-Type': 'application/json', 'X-API-Token': proxyToken };
    }
    throw new Error('Not authenticated');
  }
  return { 'Content-Type': 'application/json', ...headers };
}

function hasInviteSession(): boolean {
  return !!getInviteSession()?.token;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const shouldSignOut =
      res.status === 401 &&
      /invalid|expired|please sign in again/i.test(body);
    if (shouldSignOut) {
      await supabase.auth.signOut().catch(() => {});
    }
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface ApiProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  domain: string;
  status: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  members?: unknown[];
}

interface ApiCreatePayload {
  name: string;
  description?: string;
  domain?: string;
  status?: string;
  data?: Record<string, unknown>;
}

function rowToProject(row: ApiProjectRow): Project {
  const blob = (row.data ?? {}) as Partial<Project>;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    domain: (row.domain ?? '') as Project['domain'],
    status: (row.status as Project['status']) ?? 'draft',
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    ownerId: row.owner_id,
    version: (blob.version as number) ?? 1,
    agentRuns: (blob.agentRuns as Project['agentRuns']) ?? {},
    reviewGates: (blob.reviewGates as Project['reviewGates']) ?? {},
    promptOverrides: (blob.promptOverrides as Project['promptOverrides']) ?? [],
    teamMembers: (blob.teamMembers as Project['teamMembers']) ?? [],
    agentAssignments: (blob.agentAssignments as Project['agentAssignments']) ?? [],
    techStack: blob.techStack,
    domainKnowledge: blob.domainKnowledge,
    brandingGuidelines: blob.brandingGuidelines,
    sourceDocumentIds: blob.sourceDocumentIds ?? [],
    archived: blob.archived,
    archivedReason: blob.archivedReason,
    archivedAt: blob.archivedAt,
    archivedBy: blob.archivedBy,
    activeAdminId: blob.activeAdminId,
    mode: (blob.mode as Project['mode']) ?? 'simple',
    mockupVersionCount: typeof blob.mockupVersionCount === 'number' ? blob.mockupVersionCount : undefined,
    exportAccess: blob.exportAccess as Project['exportAccess'],
    owner: blob.owner,
    team: blob.team,
    projectType: blob.projectType,
    priority: blob.priority,
    startDate: blob.startDate,
    targetEndDate: blob.targetEndDate,
    targetUsers: blob.targetUsers,
    initialRisks: blob.initialRisks,
    skippedAgentIds: blob.skippedAgentIds,
    teamAssignmentWarningAcknowledged: blob.teamAssignmentWarningAcknowledged,
    clarifyingAnswers: blob.clarifyingAnswers,
    contextDocuments: blob.contextDocuments,
    extractionPackage: blob.extractionPackage,
    creationApproval: blob.creationApproval,
    replanFlags: blob.replanFlags,
    disabledRoleIds: blob.disabledRoleIds,
    githubIntegrationId: blob.githubIntegrationId,
    currentPhase: blob.currentPhase,
    // NOTE: was added to the Project type earlier but never wired into this
    // blob mapping, so it silently never persisted — fixing that gap here
    // rather than leaving a second broken field alongside the new one.
    projectExecutionStyle: blob.projectExecutionStyle,
  };
}

function projectToPayload(p: Project): ApiCreatePayload {
  return {
    name: p.name,
    description: p.description,
    domain: p.domain,
    status: p.status,
    data: {
      version: p.version,
      agentRuns: p.agentRuns,
      reviewGates: p.reviewGates,
      promptOverrides: p.promptOverrides,
      teamMembers: p.teamMembers,
      agentAssignments: p.agentAssignments,
      techStack: p.techStack,
      domainKnowledge: p.domainKnowledge,
      brandingGuidelines: p.brandingGuidelines,
      sourceDocumentIds: p.sourceDocumentIds,
      archived: p.archived,
      archivedReason: p.archivedReason,
      archivedAt: p.archivedAt,
      archivedBy: p.archivedBy,
      activeAdminId: p.activeAdminId,
      mode: p.mode,
      mockupVersionCount: p.mockupVersionCount,
      exportAccess: p.exportAccess,
      owner: p.owner,
      team: p.team,
      projectType: p.projectType,
      priority: p.priority,
      startDate: p.startDate,
      targetEndDate: p.targetEndDate,
      targetUsers: p.targetUsers,
      initialRisks: p.initialRisks,
      skippedAgentIds: p.skippedAgentIds,
      teamAssignmentWarningAcknowledged: p.teamAssignmentWarningAcknowledged,
      clarifyingAnswers: p.clarifyingAnswers,
      contextDocuments: p.contextDocuments,
      extractionPackage: p.extractionPackage,
      creationApproval: p.creationApproval,
      replanFlags: p.replanFlags,
      disabledRoleIds: p.disabledRoleIds,
      githubIntegrationId: p.githubIntegrationId,
      currentPhase: p.currentPhase,
      projectExecutionStyle: p.projectExecutionStyle,
    },
  };
}

function toSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    domain: p.domain,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    completedAgents: Object.values(p.agentRuns).filter((r) => r?.status === 'complete').length,
    totalAgents: TOTAL_AGENTS,
    archived: p.archived,
    archivedReason: p.archivedReason,
    archivedAt: p.archivedAt,
    archivedBy: p.archivedBy,
  };
}

export async function createProject(
  data: Omit<Project, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns' | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'>
): Promise<Project> {
  const partial: Project = {
    ...data,
    id: '',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    teamMembers: [],
    agentAssignments: [],
  };
  const row = await apiFetch<ApiProjectRow>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(projectToPayload(partial)),
  });
  const project = rowToProject(row);
  emitProjectRepositoryChange(project.id);
  return project;
}

export async function getProject(id: string): Promise<Project | undefined> {
  try {
    const path = hasInviteSession()
      ? `/api/invite/projects/${id}`
      : `/api/projects/${id}`;
    const row = await apiFetch<ApiProjectRow>(path);
    return rowToProject(row);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return undefined;
    throw err;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await listProjectRecords();
  return projects.map(toSummary);
}

export async function listProjectRecords(): Promise<Project[]> {
  const path = hasInviteSession()
    ? '/api/invite/projects'
    : '/api/projects';
  const rows = await apiFetch<ApiProjectRow[]>(path);
  return rows.map(rowToProject);
}

export async function listVisibleProjects(): Promise<ProjectSummary[]> {
  return listProjects();
}

export async function updateProject(
  id: string,
  updater: (p: Project) => Project | void
): Promise<Project> {
  const current = await getProject(id);
  if (!current) throw new Error('Project not found: ' + id);
  const updated = updater(current) ?? current;
  updated.version += 1;
  updated.updatedAt = Date.now();
  const path = hasInviteSession()
    ? `/api/invite/projects/${id}`
    : `/api/projects/${id}`;
  const row = await apiFetch<ApiProjectRow>(path, {
    method: 'PATCH',
    body: JSON.stringify(projectToPayload(updated)),
  });
  const project = rowToProject(row);
  emitProjectRepositoryChange(project.id);
  return project;
}

export async function updateAgentRun(
  projectId: string,
  agentId: AgentId,
  run: Partial<AgentRun>
): Promise<void> {
  await updateProject(projectId, (p) => {
    const MAX_OUTPUT_CHARS = 50_000;
    const runToStore = { ...run };
    if (typeof runToStore.output === 'string' && runToStore.output.length > MAX_OUTPUT_CHARS) {
      runToStore.output = runToStore.output.slice(0, MAX_OUTPUT_CHARS) +
        '\n\n[...output truncated - exceeded 50K character storage limit]';
    }
    p.agentRuns[agentId] = { ...(p.agentRuns[agentId] ?? { agentId, status: 'idle' }), ...runToStore };
  });
}

/**
 * Soft-deletes a project. Requires non-empty remarks and app-admin access -
 * enforced server-side in server/src/routes/projects.ts (DELETE /:id). This
 * never permanently removes the row; it flips `archived` + records the
 * remarks/timestamp/admin so the project can be restored via restoreProject().
 */
export async function deleteProject(id: string, remarks: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ remarks }),
  });
  emitProjectRepositoryChange(id);
}

/**
 * Restores a soft-deleted project. App-admin only - enforced server-side
 * (POST /:id/restore), not via the generic PATCH path, so a non-admin can't
 * un-delete a project through a routine project edit.
 */
export async function restoreProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}/restore`, { method: 'POST' });
  emitProjectRepositoryChange(id);
}

/**
 * Returns whether the current authenticated user is an app-wide admin
 * (ADMIN_EMAIL_ALLOWLIST on the server), used to show/hide delete & restore
 * controls in the UI. Defaults to false on any error (e.g. invite-session
 * users, who have no Supabase session to check).
 */
export async function checkIsAppAdmin(): Promise<boolean> {
  try {
    const result = await apiFetch<{ isAppAdmin: boolean }>('/api/projects/permissions/me');
    return !!result?.isAppAdmin;
  } catch {
    return false;
  }
}

export async function exportAllProjects(): Promise<string> {
  const rows = await apiFetch<ApiProjectRow[]>('/api/projects');
  const projects = rows.map(rowToProject);
  return JSON.stringify({ version: 1, exportedAt: Date.now(), projects }, null, 2);
}

function isValidProjectShape(p: unknown): p is Project {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id === 'string' && obj.id.trim() !== '' &&
    typeof obj.name === 'string' && obj.name.trim() !== '' &&
    typeof obj.description === 'string' &&
    typeof obj.domain === 'string' &&
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
    await apiFetch<ApiProjectRow>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(projectToPayload(p)),
    });
    count++;
  }
  emitProjectRepositoryChange();
  return count;
}

function mapContextDocumentToProjectDocument(projectId: string, doc: NonNullable<Project['contextDocuments']>[number]): ProjectDocument {
  return {
    id: doc.id,
    projectId,
    fileName: doc.name,
    fileType: doc.kind === 'spreadsheet' ? 'xlsx'
      : doc.kind === 'pdf' ? 'pdf'
      : doc.kind === 'document' ? 'docx'
      : 'txt',
    fileSize: Math.max(0, Math.round(doc.sizeKb * 1024)),
    mimeType: 'text/plain',
    extractedText: doc.content,
    charCount: doc.content.length,
    uploadedAt: 0,
  };
}

function mapProjectDocumentToContextDocument(doc: ProjectDocument): NonNullable<Project['contextDocuments']>[number] {
  const kind = doc.fileType === 'pdf' ? 'pdf'
    : doc.fileType === 'xlsx' || doc.fileType === 'csv' ? 'spreadsheet'
    : doc.fileType === 'docx' ? 'document'
    : 'text';
  return {
    id: doc.id,
    name: doc.fileName,
    sizeKb: Math.max(1, Math.round(doc.fileSize / 1024)),
    kind,
    content: doc.extractedText,
  };
}

export async function addProjectDocument(doc: ProjectDocument): Promise<void> {
  await updateProject(doc.projectId, (project) => {
    const existing = project.contextDocuments ?? [];
    project.contextDocuments = [
      ...existing.filter((item) => item.id !== doc.id),
      mapProjectDocumentToContextDocument(doc),
    ];
  });
}

export async function getProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  const project = await getProject(projectId);
  return (project?.contextDocuments ?? []).map((doc) => mapContextDocumentToProjectDocument(projectId, doc));
}

export async function deleteProjectDocument(docId: string): Promise<void> {
  const summaries = await listProjects();
  for (const summary of summaries) {
    const project = await getProject(summary.id);
    if (!project?.contextDocuments?.some((doc) => doc.id === docId)) continue;
    await updateProject(summary.id, (current) => {
      current.contextDocuments = (current.contextDocuments ?? []).filter((doc) => doc.id !== docId);
    });
    return;
  }
}

export async function deleteProjectDocuments(projectId: string): Promise<void> {
  await updateProject(projectId, (project) => {
    project.contextDocuments = [];
  });
}
