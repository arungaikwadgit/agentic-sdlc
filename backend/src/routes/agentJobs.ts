import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { AgentJobRepository } from '../repositories/AgentJobRepository';
import type { AgentJobStatus } from '@agentic-sdlc/shared-types';

interface CreateJobBody {
  project_id: string;
  agent_key: string;
  input_payload?: unknown;
}

interface IdParam { id: string }

export function agentJobsRouter(db: Pool): Router {
  const router = Router();
  const repo = new AgentJobRepository(db);

  /**
   * POST /api/v1/agent-jobs
   * Enqueue a durable agent job. Worker picks it up asynchronously.
   */
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as CreateJobBody;
    if (!body.project_id || !body.agent_key) {
      res.status(400).json({ error: 'project_id and agent_key are required' });
      return;
    }
    try {
      const job = await repo.create({
        project_id: body.project_id,
        agent_key: body.agent_key,
        input_payload: body.input_payload,
      });
      res.status(201).json(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[agent-jobs] create error:', message);
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/agent-jobs/:id
   * Poll a job's current status. Used by frontend to track async execution.
   */
  router.get('/:id', async (req: Request<IdParam>, res: Response) => {
    try {
      const job = await repo.findById(req.params.id);
      if (!job) { res.status(404).json({ error: 'Agent job not found' }); return; }
      res.json(job);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/agent-jobs?project_id=...&status=...
   * List jobs for a project, optionally filtered by status.
   */
  router.get('/', async (req: Request, res: Response) => {
    const project_id = req.query.project_id as string | undefined;
    if (!project_id) {
      res.status(400).json({ error: 'project_id query param required' });
      return;
    }
    const status = req.query.status as AgentJobStatus | undefined;
    try {
      const jobs = await repo.findByProject(project_id, status);
      res.json(jobs);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return router;
}
