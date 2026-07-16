import { Pool } from 'pg';
import { AgentJobRepository } from '../repositories/AgentJobRepository';
import { AgentRunRepository } from '../repositories/AgentRunRepository';
import type { AgentJob } from '@agentic-sdlc/shared-types';

interface JobPayload {
  systemPrompt?: string;
  userPrompt?: string;
  provider?: string;
  eventType?: string;
}

export async function executeLifecycleJob(
  db: Pool,
  job: AgentJob,
  callAgent: (payload: JobPayload) => Promise<{ output: string; provider?: string; model?: string }>,
): Promise<void> {
  const jobs = new AgentJobRepository(db);
  const runs = new AgentRunRepository(db);
  const payload = (job.input_payload ?? {}) as JobPayload;
  if (!payload.systemPrompt || !payload.userPrompt) {
    await jobs.markFailedOrRetry(job.id, 'Lifecycle job is missing prompts', job.attempts);
    return;
  }

  const run = await runs.create({
    project_id: job.project_id,
    agent_key: job.agent_key,
    goal: 'Background lifecycle assessment: ' + (payload.eventType ?? 'unspecified'),
    input_payload: { eventType: payload.eventType },
    provider: payload.provider,
  });
  try {
    const result = await callAgent(payload);
    await runs.markSucceeded(run.id, result.output);
    await jobs.markSucceeded(job.id, result.output, run.id);
    const latest = JSON.stringify({
      agentId: job.agent_key,
      status: 'complete',
      output: result.output,
      provider: result.provider,
      model: result.model,
      completedAt: Date.now(),
      background: true,
      triggerType: payload.eventType,
      runtimeRunId: run.id,
    });
    await db.query(
      `UPDATE projects
       SET data = jsonb_set(
         jsonb_set(COALESCE(data, '{}'::jsonb), '{agentRuns}', COALESCE(data->'agentRuns', '{}'::jsonb), true),
         ARRAY['agentRuns', $2], $3::jsonb, true
       ), updated_at = NOW()
       WHERE id = $1`,
      [job.project_id, job.agent_key, latest],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    await runs.markFailed(run.id, message);
    await jobs.markFailedOrRetry(job.id, message, job.attempts);
  }
}

export function startLifecycleWorker(db: Pool): NodeJS.Timeout | null {
  const proxyUrl = (process.env.PROXY_API_URL ?? '').replace(/\/$/, '');
  const proxyToken = process.env.PROXY_TOKEN ?? '';
  if (!proxyUrl || !proxyToken || process.env.BACKGROUND_WORKER_ENABLED === 'false') {
    console.warn('[lifecycle-worker] disabled: PROXY_API_URL/PROXY_TOKEN missing or explicitly disabled');
    return null;
  }
  const jobs = new AgentJobRepository(db);
  const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const job = await jobs.claimNextQueued();
      if (!job) return;
      await executeLifecycleJob(db, job, async (payload) => {
        const response = await fetch(proxyUrl + '/api/agents/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': proxyToken },
          body: JSON.stringify({
            systemPrompt: payload.systemPrompt,
            userPrompt: payload.userPrompt,
            provider: payload.provider,
            agentId: job.agent_key,
          }),
        });
        if (!response.ok) throw new Error('Proxy returned ' + response.status + ': ' + await response.text());
        const body = await response.json() as any;
        const output = body?.choices?.[0]?.message?.content ?? body?.content?.[0]?.text;
        if (!output) throw new Error('Proxy returned an empty lifecycle assessment');
        return { output, provider: body.provider, model: body.model };
      });
    } catch (error) {
      console.error('[lifecycle-worker]', error);
    } finally {
      busy = false;
    }
  }, Number.isFinite(pollMs) ? pollMs : 2000);
  return timer;
}


export function startScheduledLifecycleReviews(db: Pool, port: number): NodeJS.Timeout | null {
  const hours = Number(process.env.BACKGROUND_SCHEDULED_REVIEW_HOURS ?? 0);
  const runtimeToken = process.env.RUNTIME_API_TOKEN ?? '';
  if (!Number.isFinite(hours) || hours <= 0 || !runtimeToken) return null;

  return setInterval(async () => {
    try {
      const { rows } = await db.query('SELECT id FROM projects');
      const windowKey = new Date().toISOString().slice(0, 13);
      await Promise.allSettled(rows.map((row) => fetch(
        'http://127.0.0.1:' + port + '/api/v1/lifecycle-events',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': runtimeToken },
          body: JSON.stringify({
            project_id: row.id,
            event_type: 'scheduled_review',
            idempotency_key: 'scheduled-review:' + row.id + ':' + windowKey,
          }),
        },
      )));
    } catch (error) {
      console.error('[lifecycle-scheduler]', error);
    }
  }, hours * 60 * 60 * 1000);
}
