import { Pool } from 'pg';
import type { AgentJob, AgentJobStatus } from '@agentic-sdlc/shared-types';

export class AgentJobRepository {
  constructor(private db: Pool) {}

  async create(data: {
    project_id: string;
    agent_key: string;
    input_payload?: unknown;
    trigger_type?: string;
    idempotency_key?: string;
  }): Promise<AgentJob> {
    const { rows } = await this.db.query<AgentJob>(
      `INSERT INTO agent_jobs (project_id, agent_key, input_payload, trigger_type, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, agent_key, idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO UPDATE SET input_payload = EXCLUDED.input_payload
       RETURNING *`,
      [data.project_id, data.agent_key, JSON.stringify(data.input_payload ?? {}), data.trigger_type ?? null, data.idempotency_key ?? null]
    );
    return rows[0];
  }

  async findById(id: string, project_id?: string): Promise<AgentJob | null> {
    const { rows } = await this.db.query<AgentJob>(
      project_id
        ? 'SELECT * FROM agent_jobs WHERE id = $1 AND project_id = $2'
        : 'SELECT * FROM agent_jobs WHERE id = $1',
      project_id ? [id, project_id] : [id]
    );
    return rows[0] ?? null;
  }

  async findByProject(project_id: string, status?: AgentJobStatus): Promise<AgentJob[]> {
    if (status) {
      const { rows } = await this.db.query<AgentJob>(
        'SELECT * FROM agent_jobs WHERE project_id = $1 AND status = $2 ORDER BY created_at DESC',
        [project_id, status]
      );
      return rows;
    }
    const { rows } = await this.db.query<AgentJob>(
      'SELECT * FROM agent_jobs WHERE project_id = $1 ORDER BY created_at DESC',
      [project_id]
    );
    return rows;
  }

  async findFailedByProject(project_id: string, limit = 50): Promise<AgentJob[]> {
    const { rows } = await this.db.query<AgentJob>(
      `SELECT * FROM agent_jobs
       WHERE project_id = $1 AND status = 'failed'
       ORDER BY created_at DESC LIMIT $2`,
      [project_id, limit]
    );
    return rows;
  }

  /**
   * Atomically claim the next queued job using SELECT FOR UPDATE SKIP LOCKED.
   * Only one worker process will receive a given job.
   */
  async lockNextQueued(): Promise<AgentJob | null> {
    const { rows } = await this.db.query<AgentJob>(
      `SELECT * FROM agent_jobs
       WHERE status = 'queued'
         AND (next_attempt_after IS NULL OR next_attempt_after <= NOW())
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    return rows[0] ?? null;
  }

  async claimNextQueued(): Promise<AgentJob | null> {
    const { rows } = await this.db.query<AgentJob>(
      `UPDATE agent_jobs SET status = 'running', started_at = NOW(), attempts = attempts + 1
       WHERE id = (SELECT id FROM agent_jobs WHERE status = 'queued'
         AND (next_attempt_after IS NULL OR next_attempt_after <= NOW())
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`
    );
    return rows[0] ?? null;
  }

  async markRunning(id: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_jobs
       SET status = 'running', started_at = NOW(), attempts = attempts + 1
       WHERE id = $1`,
      [id]
    );
  }

  async markSucceeded(id: string, result: string, agent_run_id: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_jobs
       SET status = 'succeeded', result = $2, agent_run_id = $3, completed_at = NOW()
       WHERE id = $1`,
      [id, result, agent_run_id]
    );
  }

  /**
   * On failure: re-queue with backoff if attempts < 3, else mark failed permanently.
   * Backoff: attempt 1 → +30s, attempt 2 → +2min, attempt 3 → final failure
   */
  async markFailedOrRetry(
    id: string,
    error: string,
    currentAttempts: number,
    retryDelayMs?: number  // override for tests via TEST_RETRY_DELAY_MS
  ): Promise<void> {
    if (currentAttempts >= 3) {
      await this.db.query(
        `UPDATE agent_jobs
         SET status = 'failed', error = $2, completed_at = NOW()
         WHERE id = $1`,
        [id, error]
      );
      return;
    }

    const baseDelays = retryDelayMs
      ? [retryDelayMs, retryDelayMs * 4]
      : [30_000, 120_000]; // 30s, 2min
    const delayMs = baseDelays[currentAttempts - 1] ?? baseDelays[baseDelays.length - 1];
    const nextAttempt = new Date(Date.now() + delayMs).toISOString();

    await this.db.query(
      `UPDATE agent_jobs
       SET status = 'queued', error = $2, next_attempt_after = $3
       WHERE id = $1`,
      [id, error, nextAttempt]
    );
  }
}
