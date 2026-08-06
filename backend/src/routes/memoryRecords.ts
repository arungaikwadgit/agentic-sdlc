import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { MemoryRecordRepository } from '../repositories/MemoryRecordRepository';
import type { CreateMemoryRecordRequest } from '@agentic-sdlc/shared-types';

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
