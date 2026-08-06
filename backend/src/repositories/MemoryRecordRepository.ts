import { Pool } from 'pg';
import type {
  MemoryRecord,
  MemoryRecordScope,
  CreateMemoryRecordRequest,
} from '@agentic-sdlc/shared-types';

export class MemoryRecordRepository {
  constructor(private db: Pool) {}

  async create(
    project_id: string,
    created_by: string | undefined,
    data: CreateMemoryRecordRequest
  ): Promise<MemoryRecord> {
    const { rows } = await this.db.query<MemoryRecord>(
      `INSERT INTO memory_records
         (project_id, scope, domain_id, title, content, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        project_id,
        data.scope,
        data.domain_id ?? null,
        data.title,
        data.content,
        data.tags ?? [],
        created_by ?? null,
      ]
    );
    return rows[0];
  }

  /**
   * Retrieve memory records for injection into agent context.
   * MANDATORY filter: project_id match OR (domain_id match AND approved=true).
   * Tags/keyword filtering applied when provided.
   */
  async retrieve(opts: {
    project_id: string;
    domain_id?: string;
    tags?: string[];
    keyword?: string;
    limit?: number;
  }): Promise<MemoryRecord[]> {
    const { project_id, domain_id, tags, keyword, limit = 20 } = opts;
    const params: unknown[] = [project_id];
    let domainClause = 'FALSE';

    if (domain_id) {
      params.push(domain_id);
      domainClause = `(scope = 'domain_shared' AND domain_id = $${params.length} AND approved = TRUE)`;
    }

    let tagClause = '';
    if (tags && tags.length > 0) {
      params.push(tags);
      tagClause = `AND tags && $${params.length}::text[]`;
    }

    let kwClause = '';
    if (keyword) {
      params.push(`%${keyword}%`);
      kwClause = `AND (title ILIKE $${params.length} OR content ILIKE $${params.length})`;
    }

    params.push(limit);
    const limitClause = `LIMIT $${params.length}`;

    const { rows } = await this.db.query<MemoryRecord>(
      `SELECT * FROM memory_records
       WHERE (project_id = $1 OR ${domainClause})
         ${tagClause}
         ${kwClause}
       ORDER BY updated_at DESC
       ${limitClause}`,
      params
    );
    return rows;
  }

  async findById(id: string): Promise<MemoryRecord | null> {
    const { rows } = await this.db.query<MemoryRecord>(
      'SELECT * FROM memory_records WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  async findPendingApproval(limit = 50): Promise<MemoryRecord[]> {
    const { rows } = await this.db.query<MemoryRecord>(
      `SELECT * FROM memory_records
       WHERE scope = 'domain_shared' AND approved = FALSE
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  }

  async approve(id: string, approved_by: string): Promise<void> {
    await this.db.query(
      `UPDATE memory_records
       SET approved = TRUE, approved_by = $2, approved_at = NOW()
       WHERE id = $1`,
      [id, approved_by]
    );
  }

  async findByProject(project_id: string): Promise<MemoryRecord[]> {
    const { rows } = await this.db.query<MemoryRecord>(
      'SELECT * FROM memory_records WHERE project_id = $1 ORDER BY updated_at DESC',
      [project_id]
    );
    return rows;
  }
}
