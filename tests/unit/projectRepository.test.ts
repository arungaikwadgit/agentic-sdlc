// tests/unit/projectRepository.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from '../../frontend/src/types/project.types';

// ── In-memory mock of the Dexie `db.projects` table ────────────────────────
// Real IndexedDB isn't available in this project's test setup (no
// fake-indexeddb dependency), so we mock `db` with a Map-backed table that
// implements just the Dexie methods projectRepository.ts relies on:
// add, get, put, delete, orderBy().reverse().toArray(), bulkPut, and a
// transaction() that simply invokes its callback.
const projectsStore = new Map<string, Project>();

vi.mock('../../frontend/src/db/database', () => {
  const projects = {
    add: vi.fn(async (p: Project) => {
      projectsStore.set(p.id, p);
      return p.id;
    }),
    get: vi.fn(async (id: string) => projectsStore.get(id)),
    put: vi.fn(async (p: Project) => {
      projectsStore.set(p.id, p);
      return p.id;
    }),
    delete: vi.fn(async (id: string) => {
      projectsStore.delete(id);
    }),
    bulkPut: vi.fn(async (items: Project[]) => {
      for (const item of items) projectsStore.set(item.id, item);
    }),
    toArray: vi.fn(async () => Array.from(projectsStore.values())),
    orderBy: vi.fn((_field: string) => ({
      reverse: () => ({
        toArray: async () =>
          Array.from(projectsStore.values()).sort((a, b) => b.updatedAt - a.updatedAt),
      }),
    })),
  };

  const db = {
    projects,
    transaction: vi.fn(async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn()),
  };

  return { db };
});

import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  updateAgentRun,
  deleteProject,
  restoreProject,
  exportAllProjects,
  importProjects,
} from '../../frontend/src/db/projectRepository';

function baseProjectData(): Omit<
  Project,
  'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns' | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'
> {
  return {
    name: 'Test Project',
    description: 'A project for testing',
    domain: 'fintech',
    status: 'draft',
    mode: 'simple',
  };
}

describe('projectRepository', () => {
  beforeEach(() => {
    projectsStore.clear();
    vi.clearAllMocks();
  });

  describe('createProject', () => {
    it('creates a project with generated id and default fields (TS-1, TS-2)', async () => {
      const project = await createProject(baseProjectData());

      expect(project.id).toBeTruthy();
      expect(project.version).toBe(1);
      expect(project.createdAt).toBeTypeOf('number');
      expect(project.updatedAt).toBe(project.createdAt);
      expect(project.agentRuns).toEqual({});
      expect(project.reviewGates).toEqual({});
      expect(project.promptOverrides).toEqual([]);
      expect(project.teamMembers).toEqual([]);
      expect(project.agentAssignments).toEqual([]);
      expect(project.name).toBe('Test Project');

      expect(await getProject(project.id)).toEqual(project);
    });
  });

  describe('getProject', () => {
    it('returns the project for an existing id (TS-3)', async () => {
      const created = await createProject(baseProjectData());
      const found = await getProject(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns undefined for a non-existent id (TS-4)', async () => {
      const found = await getProject('does-not-exist');
      expect(found).toBeUndefined();
    });
  });

  describe('listProjects', () => {
    it('returns summaries ordered by updatedAt descending (TS-5)', async () => {
      const older = await createProject(baseProjectData());
      const newer = await createProject({ ...baseProjectData(), name: 'Newer Project' });

      // Force a clear, deterministic ordering regardless of clock resolution:
      // make `older` strictly older than `newer` by directly editing the
      // mock store (bypassing updateProject, which always stamps Date.now()).
      const olderRecord = projectsStore.get(older.id)!;
      olderRecord.updatedAt = newer.updatedAt - 1000;
      projectsStore.set(older.id, olderRecord);

      const summaries = await listProjects();

      expect(summaries.map((s) => s.id)).toEqual([newer.id, older.id]);
    });

    it('computes completedAgents from agentRuns with status "complete" (TS-6)', async () => {
      const project = await createProject(baseProjectData());
      await updateProject(project.id, (p) => {
        p.agentRuns = {
          manager: { agentId: 'manager', status: 'complete' },
          projectCharter: { agentId: 'projectCharter', status: 'running' },
          brd: { agentId: 'brd', status: 'complete' },
        } as Project['agentRuns'];
      });

      const [summary] = await listProjects();

      expect(summary.completedAgents).toBe(2);
      expect(summary.totalAgents).toBeGreaterThan(0);
    });

    it('includes archive fields when present (TS-7)', async () => {
      const project = await createProject(baseProjectData());
      await updateProject(project.id, (p) => {
        p.archived = true;
        p.archivedReason = 'No longer needed';
        p.archivedAt = 12345;
        p.archivedBy = 'Alice';
      });

      const [summary] = await listProjects();

      expect(summary.archived).toBe(true);
      expect(summary.archivedReason).toBe('No longer needed');
      expect(summary.archivedAt).toBe(12345);
      expect(summary.archivedBy).toBe('Alice');
    });
  });

  describe('updateProject', () => {
    it('increments version and updates updatedAt (TS-8)', async () => {
      const project = await createProject(baseProjectData());
      const originalUpdatedAt = project.updatedAt;

      // Force a measurable time difference
      await new Promise((r) => setTimeout(r, 5));

      const updated = await updateProject(project.id, (p) => {
        p.status = 'running';
      });

      expect(updated.version).toBe(2);
      expect(updated.status).toBe('running');
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('throws when the project does not exist (TS-9)', async () => {
      await expect(updateProject('missing-id', (p) => p)).rejects.toThrow('Project not found: missing-id');
    });
  });

  describe('updateAgentRun', () => {
    it('merges into an existing run, preserving other fields (TS-10)', async () => {
      const project = await createProject(baseProjectData());
      await updateAgentRun(project.id, 'manager', { agentId: 'manager', status: 'running', startedAt: 100 });

      await updateAgentRun(project.id, 'manager', { status: 'complete', output: 'done', completedAt: 200 });

      const updated = await getProject(project.id);
      expect(updated?.agentRuns.manager).toEqual({
        agentId: 'manager',
        status: 'complete',
        startedAt: 100,
        output: 'done',
        completedAt: 200,
      });
    });

    it('defaults to { agentId, status: "idle" } when no prior run exists (TS-11)', async () => {
      const project = await createProject(baseProjectData());
      await updateAgentRun(project.id, 'manager', { status: 'running' });

      const updated = await getProject(project.id);
      expect(updated?.agentRuns.manager).toEqual({
        agentId: 'manager',
        status: 'running',
      });
    });
  });

  describe('deleteProject', () => {
    it('permanently removes the project (TS-12)', async () => {
      const project = await createProject(baseProjectData());
      await deleteProject(project.id);

      expect(await getProject(project.id)).toBeUndefined();
    });
  });

  describe('restoreProject', () => {
    it('clears all archive fields (TS-13)', async () => {
      const project = await createProject(baseProjectData());
      await updateProject(project.id, (p) => {
        p.archived = true;
        p.archivedReason = 'Temporary';
        p.archivedAt = 999;
        p.archivedBy = 'Bob';
      });

      await restoreProject(project.id);

      const restored = await getProject(project.id);
      expect(restored?.archived).toBe(false);
      expect(restored?.archivedReason).toBeUndefined();
      expect(restored?.archivedAt).toBeUndefined();
      expect(restored?.archivedBy).toBeUndefined();
    });
  });

  describe('exportAllProjects / importProjects', () => {
    it('exports valid JSON with version, exportedAt, and projects (TS-14)', async () => {
      await createProject(baseProjectData());
      await createProject({ ...baseProjectData(), name: 'Second Project' });

      const json = await exportAllProjects();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(1);
      expect(parsed.exportedAt).toBeTypeOf('number');
      expect(Array.isArray(parsed.projects)).toBe(true);
      expect(parsed.projects).toHaveLength(2);
    });

    it('imports a valid backup via bulkPut and returns the count (TS-15)', async () => {
      const project = await createProject(baseProjectData());
      const backupJson = await exportAllProjects();

      // Simulate a fresh database
      projectsStore.clear();
      expect(await getProject(project.id)).toBeUndefined();

      const count = await importProjects(backupJson);

      expect(count).toBe(1);
      expect(await getProject(project.id)).toBeTruthy();
    });

    it('throws "Invalid backup format" when projects is not an array (TS-16)', async () => {
      await expect(importProjects(JSON.stringify({ foo: 'bar' }))).rejects.toThrow('Invalid backup format');
    });
  });
});
