import { Pool } from 'pg';
import type {
  ActionProposal,
  ActionProposalStatus,
  ActionType,
  RiskLevel,
} from '@agentic-sdlc/shared-types';

// v1 taxonomy (ADR-005) — validated on create
const V1_ACTION_TYPES: ActionType[] = [
  'generate_document',
  'tag_memory_record',
  'flag_for_review',
];

export class ActionProposalRepository {
  constructor(private db: Pool) {}

  async create(data: {
    project_id: string;
    agent_run_id: string;
    action_type: ActionType;
    risk_level: RiskLevel;
    payload?: unknown;
    status: ActionProposalStatus;
  }): Promise<ActionProposal> {
    if (!V1_ACTION_TYPES.includes(data.action_type)) {
      throw new Error(
        `Unknown action_type '${data.action_type}'. v1 taxonomy: ${V1_ACTION_TYPES.join(', ')}`
      );
    }

    const { rows } = await this.db.query<ActionProposal>(
      `INSERT INTO action_proposals
         (project_id, agent_run_id, action_type, risk_level, payload, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.project_id,
        data.agent_run_id,
        data.action_type,
        data.risk_level,
        JSON.stringify(data.payload ?? {}),
        data.status,
      ]
    );
    return rows[0];
  }

  async findByAgentRun(agent_run_id: string): Promise<ActionProposal[]> {
    const { rows } = await this.db.query<ActionProposal>(
      'SELECT * FROM action_proposals WHERE agent_run_id = $1 ORDER BY created_at ASC',
      [agent_run_id]
    );
    return rows;
  }

  async findPendingByProject(
    project_id: string,
    status?: ActionProposalStatus
  ): Promise<ActionProposal[]> {
    if (status) {
      const { rows } = await this.db.query<ActionProposal>(
        `SELECT * FROM action_proposals
         WHERE project_id = $1 AND status = $2
         ORDER BY created_at DESC`,
        [project_id, status]
      );
      return rows;
    }
    const { rows } = await this.db.query<ActionProposal>(
      `SELECT * FROM action_proposals
       WHERE project_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [project_id]
    );
    return rows;
  }

  async findById(id: string): Promise<ActionProposal | null> {
    const { rows } = await this.db.query<ActionProposal>(
      'SELECT * FROM action_proposals WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: ActionProposalStatus,
    decided_by?: string
  ): Promise<ActionProposal> {
    const { rows } = await this.db.query<ActionProposal>(
      `UPDATE action_proposals
       SET status = $2, decided_by = $3, decided_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, decided_by ?? null]
    );
    if (!rows[0]) throw new Error(`ActionProposal ${id} not found`);
    return rows[0];
  }
}
