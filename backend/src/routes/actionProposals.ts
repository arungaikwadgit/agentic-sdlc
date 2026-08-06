import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ActionProposalRepository } from '../repositories/ActionProposalRepository';
import type {
  ActionType,
  RiskLevel,
  ActionProposalStatus,
} from '@agentic-sdlc/shared-types';

interface CreateProposalBody {
  project_id: string;
  agent_run_id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  payload?: unknown;
  status?: ActionProposalStatus;
}

interface UpdateStatusBody {
  status: ActionProposalStatus;
  decided_by?: string;
}

interface IdParam { id: string }

// ADR-005: routes for the action-type taxonomy / human-approval-gate model.
// No automated policy engine is wired in yet (see ADR-006) — every proposal
// is created as 'pending' unless the caller explicitly overrides it, and
// moving out of 'pending' currently requires an explicit PATCH from a human
// decision-maker via the /status endpoint. There is no auto-approval path yet.
export function actionProposalsRouter(db: Pool): Router {
  const router = Router();
  const repo = new ActionProposalRepository(db);

  /**
   * POST /api/v1/action-proposals
   * Records a proposed agent action awaiting (or auto-granted) approval.
   */
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as CreateProposalBody;
    if (!body.project_id || !body.agent_run_id || !body.action_type || !body.risk_level) {
      res.status(400).json({
        error: 'project_id, agent_run_id, action_type, and risk_level are required',
      });
      return;
    }
    try {
      const proposal = await repo.create({
        project_id: body.project_id,
        agent_run_id: body.agent_run_id,
        action_type: body.action_type,
        risk_level: body.risk_level,
        payload: body.payload,
        status: body.status ?? 'pending',
      });
      res.status(201).json(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[action-proposals] create error:', message);
      res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/action-proposals/:id
   */
  router.get('/:id', async (req: Request<IdParam>, res: Response) => {
    try {
      const proposal = await repo.findById(req.params.id);
      if (!proposal) { res.status(404).json({ error: 'Action proposal not found' }); return; }
      res.json(proposal);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * PATCH /api/v1/action-proposals/:id/status
   * The human approval-gate action: approve or reject a pending proposal.
   */
  router.patch('/:id/status', async (req: Request<IdParam>, res: Response) => {
    const body = req.body as UpdateStatusBody;
    if (!body.status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    try {
      const proposal = await repo.updateStatus(req.params.id, body.status, body.decided_by);
      res.json(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  /**
   * GET /api/v1/action-proposals?agent_run_id=...
   * GET /api/v1/action-proposals?project_id=...&status=...
   * Exactly one of agent_run_id or project_id is required.
   */
  router.get('/', async (req: Request, res: Response) => {
    const agent_run_id = req.query.agent_run_id as string | undefined;
    const project_id = req.query.project_id as string | undefined;
    const status = req.query.status as ActionProposalStatus | undefined;

    if (!agent_run_id && !project_id) {
      res.status(400).json({ error: 'agent_run_id or project_id query param required' });
      return;
    }
    try {
      const proposals = agent_run_id
        ? await repo.findByAgentRun(agent_run_id)
        : await repo.findPendingByProject(project_id as string, status);
      res.json(proposals);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return router;
}
