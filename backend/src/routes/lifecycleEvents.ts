import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { AgentJobRepository } from '../repositories/AgentJobRepository';
import { selectBackgroundAgents, LifecycleEventType } from '../lifecycle/lifecyclePolicy';

interface LifecycleBody {
  project_id: string;
  event_type: LifecycleEventType;
  idempotency_key: string;
  agent_key?: string;
  tokens_used?: number;
  context_chars?: number;
  contexts?: Record<string, { systemPrompt: string; userPrompt: string; provider?: string }>;
}

const EVENT_TYPES = new Set<LifecycleEventType>([
  'agent_rerun', 'agent_completed', 'token_threshold_exceeded',
  'prompt_changed', 'model_changed', 'tool_changed', 'data_changed',
  'permission_changed', 'uat_requested', 'deployment_requested',
  'incident_reported', 'scheduled_review',
]);

async function resolveLifecycleContext(
  db: Pool,
  body: LifecycleBody,
  agentKey: string,
): Promise<{ systemPrompt: string; userPrompt: string; provider?: string } | null> {
  const supplied = body.contexts?.[agentKey];
  if (supplied?.systemPrompt && supplied?.userPrompt) return supplied;

  const { rows } = await db.query(
    `SELECT p.name, p.description, p.domain, p.data,
            ma.name AS agent_name, ma.description AS agent_description,
            apv.content AS governed_prompt
     FROM projects p
     LEFT JOIN master_agents ma ON ma.id = $2
     LEFT JOIN LATERAL (
       SELECT content FROM agent_prompt_versions
       WHERE agent_id = $2 AND active = TRUE
         AND (project_id = p.id OR project_id IS NULL)
       ORDER BY (project_id = p.id) DESC, version DESC
       LIMIT 1
     ) apv ON TRUE
     WHERE p.id = $1`,
    [body.project_id, agentKey],
  );
  const project = rows[0];
  if (!project) return null;

  const safeData = JSON.stringify(project.data ?? {}).slice(0, 12_000);
  return {
    systemPrompt: project.governed_prompt
      ?? `You are the ${project.agent_name ?? agentKey}. ${project.agent_description ?? ''}`,
    userPrompt: [
      `Run an internal background assessment for lifecycle event: ${body.event_type}.`,
      `Project: ${project.name}`,
      `Description: ${project.description ?? ''}`,
      `Domain: ${project.domain ?? ''}`,
      `Source agent: ${body.agent_key ?? 'not specified'}`,
      `Tokens used: ${body.tokens_used ?? 'not specified'}`,
      `Project state snapshot: ${safeData}`,
      'Return an evidence-based assessment with findings, risk, recommended action, owner, due date, confidence, and explicit stop/escalation conditions.',
    ].join('\n'),
  };
}

export function lifecycleEventsRouter(db: Pool): Router {
  const router = Router();
  const jobs = new AgentJobRepository(db);

  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as LifecycleBody;
    if (!body.project_id || !body.event_type || !body.idempotency_key) {
      res.status(400).json({ error: 'project_id, event_type, and idempotency_key are required' });
      return;
    }
    if (!EVENT_TYPES.has(body.event_type)) {
      res.status(400).json({ error: 'Unsupported lifecycle event type' });
      return;
    }

    const selected = selectBackgroundAgents({
      type: body.event_type,
      agentKey: body.agent_key,
      tokensUsed: body.tokens_used,
      contextChars: body.context_chars,
    });

    try {
      await db.query(
        `INSERT INTO lifecycle_events (project_id, event_type, idempotency_key, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, idempotency_key) DO NOTHING`,
        [body.project_id, body.event_type, body.idempotency_key, JSON.stringify(body)],
      );

      const created = [];
      for (const agentKey of selected) {
        const context = await resolveLifecycleContext(db, body, agentKey);
        if (!context) continue;
        created.push(await jobs.create({
          project_id: body.project_id,
          agent_key: agentKey,
          trigger_type: body.event_type,
          idempotency_key: body.idempotency_key + ':' + agentKey,
          input_payload: { ...context, sourceAgentKey: body.agent_key, eventType: body.event_type },
        }));
      }
      res.status(202).json({ event: body.event_type, jobs: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'unknown' });
    }
  });

  return router;
}
