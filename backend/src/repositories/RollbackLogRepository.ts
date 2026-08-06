import { Pool } from 'pg';
import type { RollbackLog } from '@agentic-sdlc/shared-types';

export class RollbackLogRepository {
  constructor(private db: Pool) {}

  async create(data: {
    agent_run_id: string;
    project_id: string;
    action_type: string;
    snapshot: unknown;
    rolled_back_by?: string;
  }): Promise<RollbackLog> {
    const { rows } = await this.db.query<RollbackLog>(
      `INSERT INTO rollback_log
         (agent_run_id, project_id, action_type, snapshot, rolled_back_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.agent_run_id,
        data.project_id,
        data.action_type,
        JSON.stringify(data.snapshot),
        data.rolled_back_by ?? null,
      ]
    );
    return rows[0];
  }

  async findByAgentRun(agent_run_id: string): Promise<RollbackLog[]> {
    const { rows } = await this.db.query<RollbackLog>(
      'SELECT * FROM rollback_log WHERE agent_run_id = $1 ORDER BY created_at DESC',
      [agent_run_id]
    );
    return rows;
  }

  async findByProject(project_id: string, limit = 50): Promise<RollbackLog[]> {
    const { rows } = await this.db.query<RollbackLog>(
      `SELECT * FROM rollback_log
       WHERE project_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [project_id, limit]
    );
    return rows;
  }

  async findById(id: string): Promise<RollbackLog | null> {
    const { rows } = await this.db.query<RollbackLog>(
      'SELECT * FROM rollback_log WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }
}
