import { db } from './database';
import type { Project, ProjectSummary } from '@/types/project.types';
import type { AgentId, AgentRun } from '@/types/agent.types';
import { TOTAL_AGENTS } from '@/agents/constants';

function newId(): string {
  return crypto.randomUUID();
}

export async function createProject(
  data: Omit<Project, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns' | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'>
): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    ...data,
    id: newId(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    teamMembers: [],
    agentAssignments: [],
  };
  await db.projects.add(project);
  return project;
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await db.projects.orderBy('updatedAt').reverse().toArray();
  return projects.map((p) => ({
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
  }));
}

export async function updateProject(
  id: string,
  updater: (p: Project) => Project | void
): Promise<Project> {
  return db.transaction('rw', db.projects, async () => {
    const existing = await db.projects.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);

    const updated = updater(existing) ?? existing;
    updated.version += 1;
    updated.updatedAt = Date.now();

    await db.projects.put(updated);
    return updated;
  });
}

export async function updateAgentRun(
  projectId: string,
  agentId: AgentId,
  run: Partial<AgentRun>
): Promise<void> {
  await updateProject(projectId, (p) => {
    p.agentRuns[agentId] = { ...(p.agentRuns[agentId] ?? { agentId, status: 'idle' }), ...run };
  });
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

export async function restoreProject(id: string): Promise<void> {
  await updateProject(id, (p) => {
    p.archived = false;
    p.archivedReason = undefined;
    p.archivedAt = undefined;
    p.archivedBy = undefined;
  });
}

export async function exportAllProjects(): Promise<string> {
  const projects = await db.projects.toArray();
  return JSON.stringify({ version: 1, exportedAt: Date.now(), projects }, null, 2);
}

export async function importProjects(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (!data.projects || !Array.isArray(data.projects)) throw new Error('Invalid backup format');
  await db.projects.bulkPut(data.projects);
  return data.projects.length;
}
