import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { AgentRunRepository } from '../repositories/AgentRunRepository';
import type { AgentRunStatus } from '@agentic-sdlc/shared-types';

// H-04 fix: Zod schemas replace hand-rolled TypeScript interfaces for runtime validation
const CreateRunSchema = z.object({
  project_id: z.string().uuid('project_id must be a UUID'),
  agent_key:  z.string().min(1).max(128),
  goal:         z.string().max(2000).optional(),
  plan_steps:   z.array(z.string()).optional(),
  input_payload: z.unknown().optional(),
  provider:   z.enum(['openai', 'claude']).optional(),
  model:      z.string().max(128).optional(),
});

const PatchRunSchema = z.object({
  action:     z.string().min(1).max(64),
  result:     z.string().optional(),
  error:      z.string().optional(),
  entry:      z.unknown().optional(),
  decision:   z.unknown().optional(),
  memory_ids: z.array(z.string()).optional(),
  status:     z.enum(['running','succeeded','failed','retrying']).optional(),
});

type CreateRunBody = z.infer<typeof CreateRunSchema>;
type PatchRunBody  = z.infer<typeof PatchRunSchema>;

interface IdParam { id: string }

export function agentRunsRouter(db: Pool): Router {
  const router = Router();
  const repo = new AgentRunRepository(db);

  /**
   * POST /api/v1/agent-runs
   * Create a run record at the start of agent execution.
   */
  router.post('/', async (req: Request, res: Response) => {
    const parsed = CreateRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const body: CreateRunBody = parsed.data;
    try {
      const run = await repo.create({
        project_id: body.project_id,
        agent_key: body.agent_key,
        goal: body.goal,
        plan_steps: body.plan_steps,
        input_payload: body.input_payload,
        provider: body.provider,
        model: body.model,
      });
      res.status(201).json(run);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[agent-runs] create error:', message);
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/agent-runs/:id
   * Fetch a single run by ID.
   */
  router.get('/:id', async (req: Request<IdParam>, res: Response) => {
    try {
      const run = await repo.findById(req.params.id);
      if (!run) { res.status(404).json({ error: 'Agent run not found' }); return; }
      res.json(run);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * GET /api/v1/agent-runs?project_id=...
   * List runs for a project (most recent first, limit 50).
   */
  router.get('/', async (req: Request, res: Response) => {
    const project_id = req.query.project_id as string | undefined;
    if (!project_id) {
      res.status(400).json({ error: 'project_id query param required' });
      return;
    }
    try {
      const runs = await repo.findByProject(project_id);
      res.json(runs);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  /**
   * PATCH /api/v1/agent-runs/:id
   * Update an in-progress run. Supported actions:
   *   succeed | fail | append_tool_trace | append_decision | set_memory_reads | set_status
   */
  router.patch('/:id', async (req: Request<IdParam>, res: Response) => {
    const { id } = req.params;
    const body = req.body as PatchRunBody;

    if (!body.action) {
      res.status(400).json({ error: 'action is required' });
      return;
    }

    try {
      switch (body.action) {
        case 'succeed': {
          if (!body.result) { res.status(400).json({ error: 'result required for succeed' }); return; }
          await repo.markSucceeded(id, body.result);
          res.json({ ok: true });
          break;
        }
        case 'fail': {
          if (!body.error) { res.status(400).json({ error: 'error required for fail' }); return; }
          await repo.markFailed(id, body.error);
          res.json({ ok: true });
          break;
        }
        case 'append_tool_trace': {
          if (!body.entry) { res.status(400).json({ error: 'entry required' }); return; }
          await repo.appendToolTrace(id, body.entry);
          res.json({ ok: true });
          break;
        }
        case 'append_decision': {
          if (!body.decision) { res.status(400).json({ error: 'decision required' }); return; }
          await repo.appendDecision(id, body.decision);
          res.json({ ok: true });
          break;
        }
        case 'set_memory_reads': {
          if (!Array.isArray(body.memory_ids)) { res.status(400).json({ error: 'memory_ids array required' }); return; }
          await repo.setMemoryReads(id, body.memory_ids);
          res.json({ ok: true });
          break;
        }
        case 'set_status': {
          if (!body.status) { res.status(400).json({ error: 'status required' }); return; }
          await repo.updateStatus(id, body.status);
          res.json({ ok: true });
          break;
        }
        default:
          res.status(400).json({ error: `Unknown action: ${body.action}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error(`[agent-runs] patch ${body.action} error:`, message);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
