import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { RollbackLogRepository } from '../repositories/RollbackLogRepository';

interface CreateRollbackBody {
  agent_run_id: string;
  project_id: string;
  action_type: string;
  snapshot: unknown;
  rolled_back_by?: string;
}

interface IdParam { id: string }

// NOTE: RollbackLogRepository.create() takes action_type and rolled_back_by,
// but the shared-types `RollbackLog` interface only declares
// {id, proposal_id, snapshot, created_at} - it's missing action_type,
// project_id, and rolled_back_by even though the SQL and the repository
// both use them. That's a pre-existing inconsistency between the type
// declaration and the actual table/repository, not something introduced
// here - flagging it rather than silently "fixing" the shared type, since
// changing a shared interface is a bigger decision than wiring up a route.
export function rollbackLogsRouter(db: Pool): Router {
  const router = Router();
  const repo = new RollbackLogRepository(db);

  /**
   * POST /api/v1/rollback-logs
   * Records a rollback action taken against a previously-executed agent run.
   */
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as CreateRollbackBody;
    if (!body.agent_run_id || !body.project_id || !body.action_type || body.snapshot === undefined) {
      res.status(400).json({
        error: 'agent_run_id, project_id, action_type, and snapshot are required',
      });
      return;
    }
    try {
      const log = await repo.create({
        agent_run_id: body.agent_run_id,
        project_id: body.project_id,
        action_type: body.action_type,
        snapshot: body.snapshot,
        rolled_back_by: body.rolled_back_by,
      });
      res.status(201).json(log);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[rollback-logs] create error:', message);
      res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/rollback-logs/:id
   */
  router.get('/:id', async (req: Request<IdParam>, res: Response) => {
    try {
      const log = await repo.findById(req.params.id);
      if (!log) { res.status(404).json({ error: 'Rollback log not found' }); return; }
      res.json(log);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/rollback-logs?agent_run_id=...
   * GET /api/v1/rollback-logs?project_id=...&limit=...
   * Exactly one of agent_run_id or project_id is required.
   */
  router.get('/', async (req: Request, res: Response) => {
    const agent_run_id = req.query.agent_run_id as string | undefined;
    const project_id = req.query.project_id as string | undefined;

    if (!agent_run_id && !project_id) {
      res.status(400).json({ error: 'agent_run_id or project_id query param required' });
      return;
    }
    try {
      const logs = agent_run_id
        ? await repo.findByAgentRun(agent_run_id)
        : await repo.findByProject(project_id as string, req.query.limit ? Number(req.query.limit) : undefined);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return router;
}
