export {};
// Tests for backend/src/routes/agentFeedback.js (item #18, user feedback
// capture). Boots a real express() app around createAgentFeedbackRouter
// with fully-mocked DI dependencies, then exercises it over real HTTP via
// global fetch -- same convention as appState.test.ts.

const express = require('express');
const { createAgentFeedbackRouter } = require('./agentFeedback');

const VALID_PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function buildDeps(overrides: any = {}) {
  const db = overrides.db !== undefined ? overrides.db : { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const getDb = overrides.getDb || (() => db);
  const checkToken = overrides.checkToken || ((req: any, _res: any, next: any) => {
    req.authUser = { email: 'user@example.com' };
    next();
  });
  const requireAdmin = overrides.requireAdmin || ((_req: any, _res: any, next: any) => next());

  return { getDb, checkToken, requireAdmin, db };
}

async function startServer(overrides: any = {}) {
  const deps = buildDeps(overrides);
  const app = express();
  app.use(express.json());
  app.use('/api/agent-feedback', createAgentFeedbackRouter(deps));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/agent-feedback`;
  return { server, baseUrl, deps };
}

async function withServer(overrides: any, fn: (ctx: any) => Promise<void>) {
  const ctx = await startServer(overrides);
  try {
    await fn(ctx);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('agentFeedback routes', () => {
  describe('POST /', () => {
    const validBody = { projectId: VALID_PROJECT_ID, agentId: 'sprintPlanner', rating: 'up' };

    it('inserts the feedback event and returns ok+id', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validBody, comment: 'Great output!' }),
        });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.ok).toBe(true);
        expect(UUID_RE.test(body.id)).toBe(true);
        expect(deps.db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO agent_feedback'),
          [body.id, VALID_PROJECT_ID, 'sprintPlanner', 'up', 'Great output!', 'user@example.com'],
        );
      });
    });

    it('stores a null comment when none is provided', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        const [, params] = deps.db.query.mock.calls[0];
        expect(params[4]).toBeNull();
      });
    });

    it('falls back to an empty payload (400) when the request has no body', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, { method: 'POST' });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'projectId must be a valid project UUID.' });
      });
    });

    it('returns 400 when projectId is not a string', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validBody, projectId: 12345 }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'projectId must be a valid project UUID.' });
      });
    });

    it('records created_by as admin-bypass for an admin-bypass session with no email', async () => {
      const checkToken = (req: any, _res: any, next: any) => {
        req.authUser = { adminBypass: true };
        next();
      };
      await withServer({ checkToken }, async ({ baseUrl, deps }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        const [, params] = deps.db.query.mock.calls[0];
        expect(params[5]).toBe('admin-bypass');
      });
    });

    it('returns 400 when projectId is not a valid UUID', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validBody, projectId: 'not-a-uuid' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'projectId must be a valid project UUID.' });
      });
    });

    it('returns 400 when agentId is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: VALID_PROJECT_ID, rating: 'up' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'agentId is required.' });
      });
    });

    it('returns 400 when rating is not up/down', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validBody, rating: 'sideways' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "rating must be 'up' or 'down'." });
      });
    });

    it('returns 400 when the comment exceeds the length limit', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validBody, comment: 'x'.repeat(2001) }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'comment cannot exceed 2000 characters.' });
      });
    });

    it('returns 404 when the project does not exist (FK violation)', async () => {
      const db = { query: jest.fn().mockRejectedValue({ code: '23503', message: 'fk violation' }) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Project not found.' });
      });
    });

    it('returns 500 (not a hung request) on a non-FK database error', async () => {
      // Express 4 does not await async handlers, so a route that re-throws
      // here would leave the request hanging with no response instead of
      // reaching any error middleware -- this test caught exactly that
      // before agentFeedback.js's catch block was fixed to respond
      // explicitly. See that file's comment on this catch for detail.
      const db = { query: jest.fn().mockRejectedValue(new Error('boom')) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Failed to record feedback.' });
      });
    });

    it('returns 503 when the database is unavailable', async () => {
      await withServer({ getDb: () => null }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(503);
      });
    });

    it('does not require admin -- any authenticated user can submit feedback', async () => {
      const requireAdmin = jest.fn((_req: any, res: any) => res.status(403).json({ error: 'forbidden' }));
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        expect(requireAdmin).not.toHaveBeenCalled();
      });
    });
  });

  describe('GET /', () => {
    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (_req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl);
        expect(res.status).toBe(403);
      });
    });

    it('lists recent feedback, newest first, mapped to camelCase', async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            id: 'f1',
            project_id: VALID_PROJECT_ID,
            agent_id: 'sprintPlanner',
            rating: 'up',
            comment: 'nice',
            created_by: 'user@example.com',
            created_at: '2026-08-22T00:00:00.000Z',
          }],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl);
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.items).toEqual([{
          id: 'f1',
          projectId: VALID_PROJECT_ID,
          agentId: 'sprintPlanner',
          rating: 'up',
          comment: 'nice',
          createdBy: 'user@example.com',
          createdAt: '2026-08-22T00:00:00.000Z',
        }]);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), [100]);
      });
    });

    it('filters by projectId when a valid UUID is supplied', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}?projectId=${VALID_PROJECT_ID}`);
        expect(res.status).toBe(200);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE project_id'), [VALID_PROJECT_ID, 100]);
      });
    });

    it('ignores an invalid projectId filter and falls back to the unfiltered query', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}?projectId=not-a-uuid`);
        expect(res.status).toBe(200);
        expect(db.query).toHaveBeenCalledWith(expect.not.stringContaining('WHERE project_id'), [100]);
      });
    });

    it('clamps limit to the 1-500 range', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        await fetch(`${baseUrl}?limit=99999`);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [500]);
      });
    });

    it('falls back to the default limit for a non-numeric limit', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        await fetch(`${baseUrl}?limit=notanumber`);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [100]);
      });
    });

    it('returns 503 when the database is unavailable', async () => {
      await withServer({ getDb: () => null }, async ({ baseUrl }) => {
        const res = await fetch(baseUrl);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /summary', () => {
    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (_req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/summary`);
        expect(res.status).toBe(403);
      });
    });

    it('returns per-agent aggregate counts, mapped to camelCase with numeric coercion', async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [{ agent_id: 'sprintPlanner', up_count: '3', down_count: '1', last_feedback_at: '2026-08-22T00:00:00.000Z' }],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/summary`);
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.items).toEqual([{
          agentId: 'sprintPlanner',
          upCount: 3,
          downCount: 1,
          lastFeedbackAt: '2026-08-22T00:00:00.000Z',
        }]);
      });
    });

    it('returns 503 when the database is unavailable', async () => {
      await withServer({ getDb: () => null }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/summary`);
        expect(res.status).toBe(503);
      });
    });
  });
});
