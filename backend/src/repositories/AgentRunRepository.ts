import { Pool } from 'pg';
import type { AgentRun, AgentRunStatus } from '@agentic-sdlc/shared-types';

export class AgentRunRepository {
  constructor(private db: Pool) {}

  async create(data: {
    project_id: string;
    agent_key: string;
    goal?: string;
    plan_steps?: string[];
    input_payload?: unknown;
    provider?: string;
    model?: string;
  }): Promise<AgentRun> {
    const { rows } = await this.db.query<AgentRun>(
      `INSERT INTO agent_runs
         (project_id, agent_key, goal, plan_steps, input_payload, provider, model, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        data.project_id,
        data.agent_key,
        data.goal ?? null,
        data.plan_steps ? JSON.stringify(data.plan_steps) : null,
        data.input_payload ? JSON.stringify(data.input_payload) : null,
        data.provider ?? null,
        data.model ?? null,
      ]
    );
    return rows[0];
  }

  async findById(id: string): Promise<AgentRun | null> {
    const { rows } = await this.db.query<AgentRun>(
      'SELECT * FROM agent_runs WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  async findByProject(project_id: string, limit = 50): Promise<AgentRun[]> {
    const { rows } = await this.db.query<AgentRun>(
      'SELECT * FROM agent_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
      [project_id, limit]
    );
    return rows;
  }

  async findFailedByProject(project_id: string, limit = 50): Promise<AgentRun[]> {
    const { rows } = await this.db.query<AgentRun>(
      `SELECT * FROM agent_runs
       WHERE project_id = $1 AND status = 'failed'
       ORDER BY created_at DESC LIMIT $2`,
      [project_id, limit]
    );
    return rows;
  }

  async markSucceeded(id: string, result: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_runs
       SET status = 'succeeded', result = $2, completed_at = NOW()
       WHERE id = $1`,
      [id, result]
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_runs
       SET status = 'failed', error = $2, completed_at = NOW()
       WHERE id = $1`,
      [id, error]
    );
  }

  async appendToolTrace(id: string, entry: unknown): Promise<void> {
    await this.db.query(
      `UPDATE agent_runs
       SET tool_trace = COALESCE(tool_trace, '[]'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify(entry)]
    );
  }

  async appendDecision(id: string, decision: unknown): Promise<void> {
    await this.db.query(
      `UPDATE agent_runs
       SET decisions = COALESCE(decisions, '[]'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify(decision)]
    );
  }

  async setMemoryReads(id: string, memoryIds: string[]): Promise<void> {
    await this.db.query(
      `UPDATE agent_runs SET memory_reads = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(memoryIds)]
    );
  }

  async updateStatus(id: string, status: AgentRunStatus): Promise<void> {
    await this.db.query(
      'UPDATE agent_runs SET status = $2 WHERE id = $1',
      [id, status]
    );
  }
}
