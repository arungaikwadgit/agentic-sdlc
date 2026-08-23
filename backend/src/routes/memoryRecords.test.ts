export {};
// Tests for GET /api/v1/memory-records/similar (item #5 Phase 3, pgvector
// RAG grounding pilot). Boots a real express() app around
// memoryRecordsRouter with a mocked pg Pool and a mocked generateEmbedding,
// same real-HTTP convention as agentFeedback.test.ts. Only the new /similar
// route is covered here -- the rest of this router (POST /, /retrieve,
// /pending-approval, /:id, /:id/approve) predates this change and had no
// test file before it either; not backfilled here, out of scope for this
// phase's change.

const express = require('express');
const { memoryRecordsRouter } = require('./memoryRecords');

jest.mock('../embeddings', () => ({
  generateEmbedding: jest.fn(),
  toPgvectorLiteral: jest.requireActual('../embeddings').toPgvectorLiteral,
}));
const { generateEmbedding } = jest.requireMock('../embeddings') as { generateEmbedding: jest.Mock };

function makeEmbedding(length = 1536): number[] {
  return Array.from({ length }, (_, i) => i / length);
}

async function startServer(query: jest.Mock) {
  const db = { query } as any;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/memory-records', memoryRecordsRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/memory-records`;
  return { server, baseUrl };
}

async function withServer(query: jest.Mock, fn: (baseUrl: string) => Promise<void>) {
  const { server, baseUrl } = await startServer(query);
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('GET /api/v1/memory-records/similar', () => {
  beforeEach(() => {
    generateEmbedding.mockReset();
  });

  it('returns 400 when project_id is missing', async () => {
    const query = jest.fn();
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?query=cost+optimization`);
      expect(res.status).toBe(400);
    });
  });

  it('returns 400 when query is missing', async () => {
    const query = jest.fn();
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?project_id=proj-1`);
      expect(res.status).toBe(400);
    });
  });

  it('returns found:false with no items when embedding generation fails (never a 500)', async () => {
    generateEmbedding.mockResolvedValue(null);
    const query = jest.fn();
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?project_id=proj-1&query=cost+optimization`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toMatchObject({ found: false, items: [], confidence: 0, sufficient: false });
      expect(query).not.toHaveBeenCalled();
    });
  });

  it('returns evidence items built from similarity results, with a computed confidence', async () => {
    generateEmbedding.mockResolvedValue(makeEmbedding());
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'rec-1', project_id: 'proj-1', title: 'Token budget decision',
          content: 'Use progressive context loading for architecture agent.',
          updated_at: '2026-08-01T00:00:00Z', similarity: 0.92,
        },
        {
          id: 'rec-2', project_id: 'proj-1', title: 'Model routing note',
          content: 'Route standard-tier agents to the smallest sufficient model.',
          updated_at: '2026-08-02T00:00:00Z', similarity: 0.81,
        },
      ],
    });
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?project_id=proj-1&query=token+cost+optimization`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.found).toBe(true);
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toMatchObject({
        sourceType: 'memory',
        sourceId: 'rec-1',
        title: 'Token budget decision',
        authority: 92,
        authorized: true,
      });
      expect(typeof body.confidence).toBe('number');
      expect(body.confidence).toBeGreaterThan(0);
    });
  });

  it('passes project_id, domain_id, and the generated embedding through to the repository query', async () => {
    const embedding = makeEmbedding();
    generateEmbedding.mockResolvedValue(embedding);
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await withServer(query, async (baseUrl) => {
      await fetch(`${baseUrl}/similar?project_id=proj-1&domain_id=saas&query=hello&limit=3`);
      expect(generateEmbedding).toHaveBeenCalledWith('hello');
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('embedding <=> $2::vector');
      expect(params[0]).toBe('proj-1');
      expect(sql).toContain("scope = 'domain_shared'");
    });
  });

  it('returns an empty found:false result (not a 500) when no similar records exist', async () => {
    generateEmbedding.mockResolvedValue(makeEmbedding());
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?project_id=proj-1&query=nothing+matches`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.found).toBe(false);
      expect(body.items).toEqual([]);
    });
  });

  it('returns 500 with an error message when the repository query itself throws', async () => {
    generateEmbedding.mockResolvedValue(makeEmbedding());
    const query = jest.fn().mockRejectedValue(new Error('connection reset'));
    await withServer(query, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/similar?project_id=proj-1&query=hello`);
      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.error).toBe('connection reset');
    });
  });
});
