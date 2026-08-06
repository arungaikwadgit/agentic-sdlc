// tests/unit/projectRepository.test.ts
//
// projectRepository.ts is fully backend-owned (REST via fetch against
// server/src/routes/projects.ts) — it no longer touches Dexie/IndexedDB at
// all. These tests mock `fetch` with a small in-memory fake of the
// /api/projects REST surface (including the admin-gated soft-delete routes:
// DELETE /:id and POST /:id/restore) rather than mocking a local database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from '../../frontend/src/types/project.types';

// ── Auth/session mocks ──────────────────────────────────────────────────────
// projectRepository.ts only needs getAuthHeader() from services/api — mock
// just that so a fake bearer token is always present (apiFetch throws
// 'Not authenticated' otherwise).
vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

vi.mock('../../frontend/src/services/inviteSession', () => ({
  getInviteSession: vi.fn(() => null),
}));

const signOutMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock('../../frontend/src/lib/supabase', () => ({
  supabase: { auth: { signOut: signOutMock } },
}));

// ── Fake /api/projects REST backend ─────────────────────────────────────────
interface FakeRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  domain: string;
  status: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  creator_name?: string;
  creator_email?: string;
  creator_role?: string;
}

const rows = new Map<string, FakeRow>();
let nextId = 1;
let isAppAdminFlag = true; // most tests act as an app admin unless overridden

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  // GET /api/projects/permissions/me
  if (path === '/api/projects/permissions/me' && method === 'GET') {
    return jsonResponse({ isAppAdmin: isAppAdminFlag });
  }

  // POST /api/projects/:id/restore
  const restoreMatch = path.match(/^\/api\/projects\/([^/]+)\/restore$/);
  if (restoreMatch && method === 'POST') {
    if (!isAppAdminFlag) return jsonResponse({ error: 'This action requires app administrator access.' }, 403);
    const row = rows.get(restoreMatch[1]);
    if (!row) return jsonResponse({ error: 'Project not found' }, 404);
    delete row.data.archived;
    delete row.data.archivedReason;
    delete row.data.archivedAt;
    delete row.data.archivedBy;
    row.updated_at = nowIso();
    return jsonResponse(row);
  }

  // /api/projects/:id  (GET, PATCH, DELETE)
  const idMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    if (method === 'GET') {
      const row = rows.get(id);
      if (!row) return jsonResponse({ error: 'Project not found' }, 404);
      return jsonResponse({ ...row, members: [] });
    }
    if (method === 'PATCH') {
      const row = rows.get(id);
      if (!row) return jsonResponse({ error: 'Project not found' }, 404);
      // Mirror the real server: archive fields in `data` are always forced
      // back to the current DB values on a generic PATCH, no matter what the
      // client sends — only DELETE and /restore may change them.
      const { archived, archivedReason, archivedAt, archivedBy } = row.data;
      Object.assign(row, {
        name: body.name ?? row.name,
        description: body.description ?? row.description,
        domain: body.domain ?? row.domain,
        status: body.status ?? row.status,
      });
      row.data = { ...(body.data ?? {}), archived, archivedReason, archivedAt, archivedBy };
      row.updated_at = nowIso();
      return jsonResponse(row);
    }
    if (method === 'DELETE') {
      if (!isAppAdminFlag) return jsonResponse({ error: 'This action requires app administrator access.' }, 403);
      const remarks = typeof body?.remarks === 'string' ? body.remarks.trim() : '';
      if (!remarks) return jsonResponse({ error: 'Remarks are required to delete a project' }, 400);
      const row = rows.get(id);
      if (!row) return jsonResponse({ error: 'Project not found' }, 404);
      row.data = {
        ...row.data,
        archived: true,
        archivedReason: remarks,
        archivedAt: Date.now(),
        archivedBy: 'admin@example.com',
      };
      row.updated_at = nowIso();
      return jsonResponse(row);
    }
  }

  // /api/projects  (GET list, POST create)
  if (path === '/api/projects') {
    if (method === 'GET') {
      return jsonResponse(Array.from(rows.values()));
    }
    if (method === 'POST') {
      const id = `proj-${nextId++}`;
      const timestamp = nowIso();
      const row: FakeRow = {
        id,
        owner_id: 'owner-1',
        name: body.name,
        description: body.description ?? '',
        domain: body.domain ?? '',
        status: 'draft',
        data: body.data ?? {},
        created_at: timestamp,
        updated_at: timestamp,
      };
      rows.set(id, row);
      return jsonResponse(row, 201);
    }
  }

  throw new Error(`Unhandled fake fetch: ${method} ${path}`);
});

vi.stubGlobal('fetch', fetchMock);

// Import after mocks so projectRepository picks up the mocked modules.
import {
  buildApiUrl,
  createProject,
  getProject,
  listProjects,
  updateProject,
  updateAgentRun,
  deleteProject,
  restoreProject,
  checkIsAppAdmin,
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
    rows.clear();
    nextId = 1;
    isAppAdminFlag = true;
    fetchMock.mockClear();
    signOutMock.mockClear();
  });

  it('builds a single /api prefix when VITE_API_URL is set to /api', () => {
    vi.stubEnv('VITE_API_URL', '/api');

    expect(buildApiUrl('/api/projects')).toBe('/api/projects');
    expect(buildApiUrl('/projects')).toBe('/api/projects');
  });

  // Regression test for a real production bug: VITE_API_URL is a full origin
  // ending in "/api" in production (e.g. Railway), not the literal string "/api"
  // like local dev. The old buildApiUrl() only special-cased base === '/api'
  // exactly and blindly concatenated otherwise, which doubled up into
  // ".../api/api/projects" for every caller here since they all already pass an
  // "/api"-prefixed path. The local-dev-only test above never caught this because
  // it never exercised a full-URL base.
  it('builds a single /api prefix when VITE_API_URL is a full production URL ending in /api', () => {
    vi.stubEnv('VITE_API_URL', 'https://agentic-sdlc-production.up.railway.app/api');

    expect(buildApiUrl('/api/projects')).toBe('https://agentic-sdlc-production.up.railway.app/api/projects');
    expect(buildApiUrl('/projects')).toBe('https://agentic-sdlc-production.up.railway.app/api/projects');
    expect(buildApiUrl('/api/projects/permissions/me')).toBe('https://agentic-sdlc-production.up.railway.app/api/projects/permissions/me');
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

      const olderRow = rows.get(older.id)!;
      olderRow.updated_at = new Date(newer.updatedAt - 1000).toISOString();

      const summaries = await listProjects();

      expect(summaries.map((s) => s.id).sort()).toEqual([newer.id, older.id].sort());
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

      const summaries = await listProjects();
      const summary = summaries.find((s) => s.id === project.id)!;

      expect(summary.completedAgents).toBe(2);
      expect(summary.totalAgents).toBeGreaterThan(0);
    });

    it('maps creator metadata from the backend into project summaries', async () => {
      const project = await createProject(baseProjectData());
      Object.assign(rows.get(project.id)!, {
        creator_name: 'Priya Owner',
        creator_email: 'priya@example.com',
        creator_role: 'Project Owner',
      });

      const [summary] = await listProjects();

      expect(summary).toEqual(expect.objectContaining({
        creatorName: 'Priya Owner',
        creatorEmail: 'priya@example.com',
        creatorRole: 'Project Owner',
      }));
    });

    it('includes archive fields when present (TS-7)', async () => {
      const project = await createProject(baseProjectData());
      await deleteProject(project.id, 'No longer needed');

      const summaries = await listProjects();
      const summary = summaries.find((s) => s.id === project.id)!;

      expect(summary.archived).toBe(true);
      expect(summary.archivedReason).toBe('No longer needed');
      expect(summary.archivedAt).toBeTypeOf('number');
      expect(summary.archivedBy).toBe('admin@example.com');
    });
  });

  describe('updateProject', () => {
    it('increments version and updates updatedAt (TS-8)', async () => {
      const project = await createProject(baseProjectData());
      const originalUpdatedAt = project.updatedAt;

      await new Promise((r) => setTimeout(r, 5));

      const updated = await updateProject(project.id, (p) => {
        p.status = 'running';
      });

      expect(updated.version).toBe(2);
      expect(updated.status).toBe('running');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('throws when the project does not exist (TS-9)', async () => {
      await expect(updateProject('missing-id', (p) => p)).rejects.toThrow('Project not found: missing-id');
    });

    it('cannot smuggle archive fields through a routine edit (TS-9b)', async () => {
      // Regression guard for the bug this session fixed: a non-admin PATCH
      // must never be able to set `archived` — only DELETE/:id/restore can.
      const project = await createProject(baseProjectData());
      const updated = await updateProject(project.id, (p) => {
        p.archived = true;
        p.archivedReason = 'sneaky';
      });
      expect(updated.archived).toBeUndefined();
      expect(updated.archivedReason).toBeUndefined();
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

  describe('deleteProject (admin-only soft delete)', () => {
    it('soft-deletes: the row survives and archive fields are set (TS-12)', async () => {
      const project = await createProject(baseProjectData());
      await deleteProject(project.id, 'Duplicate of another project');

      const still = await getProject(project.id);
      expect(still).toBeDefined();
      expect(still?.archived).toBe(true);
      expect(still?.archivedReason).toBe('Duplicate of another project');
      expect(still?.archivedBy).toBe('admin@example.com');
    });

    it('rejects deletion without remarks (TS-12b)', async () => {
      const project = await createProject(baseProjectData());
      await expect(deleteProject(project.id, '')).rejects.toThrow();
      await expect(deleteProject(project.id, '   ')).rejects.toThrow();

      const stillActive = await getProject(project.id);
      expect(stillActive?.archived).toBeUndefined();
    });

    it('is rejected server-side for non-admin users (TS-12c)', async () => {
      isAppAdminFlag = false;
      const project = await createProject(baseProjectData());
      await expect(deleteProject(project.id, 'trying anyway')).rejects.toThrow();
    });
  });

  describe('restoreProject (admin-only)', () => {
    it('clears all archive fields (TS-13)', async () => {
      const project = await createProject(baseProjectData());
      await deleteProject(project.id, 'Temporary');

      await restoreProject(project.id);

      const restored = await getProject(project.id);
      expect(restored?.archived).toBeUndefined();
      expect(restored?.archivedReason).toBeUndefined();
      expect(restored?.archivedAt).toBeUndefined();
      expect(restored?.archivedBy).toBeUndefined();
    });

    it('is rejected server-side for non-admin users (TS-13b)', async () => {
      const project = await createProject(baseProjectData());
      await deleteProject(project.id, 'Temporary');

      isAppAdminFlag = false;
      await expect(restoreProject(project.id)).rejects.toThrow();
    });
  });

  describe('checkIsAppAdmin', () => {
    it('returns true when the server reports app-admin access (TS-17)', async () => {
      isAppAdminFlag = true;
      await expect(checkIsAppAdmin()).resolves.toBe(true);
    });

    it('returns false when the server reports no app-admin access (TS-18)', async () => {
      isAppAdminFlag = false;
      await expect(checkIsAppAdmin()).resolves.toBe(false);
    });

    it('defaults to false on any request failure rather than throwing (TS-19)', async () => {
      fetchMock.mockImplementationOnce(async () => {
        throw new Error('network down');
      });
      await expect(checkIsAppAdmin()).resolves.toBe(false);
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

    it('imports a valid backup via POST /api/projects and returns the count (TS-15)', async () => {
      const project = await createProject(baseProjectData());
      const backupJson = await exportAllProjects();

      rows.clear();
      expect(await getProject(project.id)).toBeUndefined();

      const count = await importProjects(backupJson);

      expect(count).toBe(1);
      const [imported] = await listProjects();
      expect(imported.name).toBe(project.name);
    });

    it('throws "Invalid backup format" when projects is not an array (TS-16)', async () => {
      await expect(importProjects(JSON.stringify({ foo: 'bar' }))).rejects.toThrow('Invalid backup format');
    });
  });
});
