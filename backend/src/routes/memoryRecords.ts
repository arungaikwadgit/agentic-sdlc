import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { MemoryRecordRepository } from '../repositories/MemoryRecordRepository';
import { generateEmbedding } from '../embeddings';
import type { CreateMemoryRecordRequest, MemoryRecord } from '@agentic-sdlc/shared-types';

// rag/evidenceSchema.js and rag/evidenceAssessment.js are plain CommonJS
// (backend/tsconfig.json has no `allowJs`, so a static `import` from this
// .ts file wouldn't resolve at compile time) -- require() instead, same
// pattern already used by backend/src/chat/*.js and this repo's own
// rag/*.test.ts files to pull in the same modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evidenceItem } = require('../rag/evidenceSchema') as {
  evidenceItem: (args: {
    sourceType: string; sourceId: string; title: string; excerpt: unknown;
    version?: string | null; updatedAt?: string | null; authority?: number;
  }) => { sourceType: string; sourceId: string; title: string; version: string | null; updatedAt: string | null; excerpt: string; authority: number; authorized: boolean };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { assessEvidence } = require('../rag/evidenceAssessment') as {
  assessEvidence: (items: unknown[], requirements: string[]) => { confidence: number; sufficient: boolean; missing: string[]; contradictions: string[] };
};

interface CreateRecordBody extends CreateMemoryRecordRequest {
  project_id: string;
  created_by?: string;
}

interface ApproveBody { approved_by: string }

interface IdParam { id: string }

// ADR-004: memory record routes. Retrieval enforces the project-isolation /
// domain-reuse rule from the architecture doc at the repository layer (see
// MemoryRecordRepository.retrieve) — this route layer just passes query
// params through, it does not loosen that rule.
export function memoryRecordsRouter(db: Pool): Router {
  const router = Router();
  const repo = new MemoryRecordRepository(db);

  /**
   * POST /api/v1/memory-records
   */
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as CreateRecordBody;
    if (!body.project_id || !body.scope || !body.title || !body.content) {
      res.status(400).json({ error: 'project_id, scope, title, and content are required' });
      return;
    }
    try {
      const record = await repo.create(body.project_id, body.created_by, {
        scope: body.scope,
        domain_id: body.domain_id,
        title: body.title,
        content: body.content,
        tags: body.tags,
      });
      res.status(201).json(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[memory-records] create error:', message);
      res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/memory-records/similar?project_id=...&domain_id=...&query=...&limit=...
   *
   * Item #5 Phase 3 (pgvector RAG grounding pilot) -- semantic-search
   * counterpart to /retrieve above. Called by server/src's agent-context
   * assembly (server/src/routes/projects.ts) ONLY for the tokenOptimizer
   * pilot agent today; every other agent's memory context still comes from
   * server/src's own keyword/recency ranking, unchanged. Returns evidence
   * items in the shared rag/evidenceSchema.js shape (so this response can
   * feed AgentThinkingPanel's citations UI directly) plus a computed
   * confidence/sufficiency assessment (rag/evidenceAssessment.js) against a
   * single synthetic requirement, 'project_memory' -- there's no
   * requirement taxonomy for a single ad hoc query the way the chatbot has
   * for a whole conversation, so this just asks "did we find anything
   * relevant at all."
   *
   * Auth: requireApiToken (mounted below in index.ts), which as of this
   * phase also accepts RUNTIME_API_TOKEN_INTERNAL -- see that middleware's
   * header comment for why this is a second, independent secret rather
   * than reusing RUNTIME_API_TOKEN.
   *
   * Must come before /:id below so Express doesn't treat "similar" as an
   * :id value.
   */
  router.get('/similar', async (req: Request, res: Response) => {
    const project_id = req.query.project_id as string | undefined;
    const query = req.query.query as string | undefined;
    if (!project_id) {
      res.status(400).json({ error: 'project_id query param required' });
      return;
    }
    if (!query || !query.trim()) {
      res.status(400).json({ error: 'query param required' });
      return;
    }
    try {
      const embedding = await generateEmbedding(query);
      if (!embedding) {
        // Best-effort by design (embeddings.ts's generateEmbedding never
        // throws) -- no OPENAI_API_KEY, a timeout, or a malformed response
        // all land here. Report "found nothing" rather than a 500 so the
        // caller's own fallback-to-keyword-search path (server/src) is the
        // one to decide what happens next, not this route.
        res.json({ found: false, items: [], confidence: 0, sufficient: false, missing: ['project_memory'], contradictions: [] });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const records = await repo.retrieveBySimilarity({
        project_id,
        domain_id: req.query.domain_id as string | undefined,
        queryEmbedding: embedding,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      const items = records.map((record: MemoryRecord & { similarity: number }) => evidenceItem({
        sourceType: 'memory',
        sourceId: record.id,
        title: record.title,
        excerpt: record.content,
        updatedAt: record.updated_at,
        // similarity is 0..1 (1 - cosine distance); scale onto the same
        // 0-100 authority range assessEvidence expects, matching how the
        // chatbot's evidenceItem() callers already score authority.
        authority: Math.round(Math.max(0, Math.min(1, record.similarity)) * 100),
      }));
      const assessment = assessEvidence(items, ['project_memory']);
      res.json({ found: items.length > 0, items, ...assessment });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/memory-records/retrieve?project_id=...&domain_id=...&tags=a,b&keyword=...&limit=...
   * Used by agents to pull context before a run. Must come before /:id below
   * so Express doesn't treat "retrieve" as an :id value.
   */
  router.get('/retrieve', async (req: Request, res: Response) => {
    const project_id = req.query.project_id as string | undefined;
    if (!project_id) {
      res.status(400).json({ error: 'project_id query param required' });
      return;
    }
    const tagsRaw = req.query.tags as string | undefined;
    try {
      const records = await repo.retrieve({
        project_id,
        domain_id: req.query.domain_id as string | undefined,
        tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        keyword: req.query.keyword as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/memory-records/pending-approval?limit=...
   * Domain-shared records awaiting human approval before reuse across
   * projects. Must also come before /:id.
   */
  router.get('/pending-approval', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const records = await repo.findPendingApproval(limit);
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * PATCH /api/v1/memory-records/:id/approve
   */
  router.patch('/:id/approve', async (req: Request<IdParam>, res: Response) => {
    const body = req.body as ApproveBody;
    if (!body.approved_by) {
      res.status(400).json({ error: 'approved_by is required' });
      return;
    }
    try {
      await repo.approve(req.params.id, body.approved_by);
      const record = await repo.findById(req.params.id);
      if (!record) { res.status(404).json({ error: 'Memory record not found' }); return; }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/memory-records/:id
   */
  router.get('/:id', async (req: Request<IdParam>, res: Response) => {
    try {
      const record = await repo.findById(req.params.id);
      if (!record) { res.status(404).json({ error: 'Memory record not found' }); return; }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/memory-records?project_id=...
   * Plain listing for a project's own settings/memory-management UI
   * (distinct from /retrieve, which is the agent-context-injection path).
   */
  router.get('/', async (req: Request, res: Response) => {
    const project_id = req.query.project_id as string | undefined;
    if (!project_id) {
      res.status(400).json({ error: 'project_id query param required' });
      return;
    }
    try {
      const records = await repo.findByProject(project_id);
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return router;
}
