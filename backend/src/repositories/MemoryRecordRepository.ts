import { Pool } from 'pg';
import type {
  MemoryRecord,
  MemoryRecordScope,
  CreateMemoryRecordRequest,
} from '@agentic-sdlc/shared-types';
import { generateEmbedding, toPgvectorLiteral } from '../embeddings';

// Explicit column list, excluding `embedding` (migration
// 025_pgvector_memory_embeddings.sql) -- a 1536-float array has no use to
// any consumer of these methods (the routes in ../routes/memoryRecords.ts,
// ultimately the frontend) and would needlessly bloat every response.
// Only retrieveBySimilarity below ever needs the embedding column itself
// (to compute distance), never to return it.
const PUBLIC_COLUMNS = `
  id, project_id, scope, domain_id, approved, approved_by, approved_at,
  title, content, tags, created_by, created_at, updated_at
`;

export class MemoryRecordRepository {
  constructor(private db: Pool) {}

  async create(
    project_id: string,
    created_by: string | undefined,
    data: CreateMemoryRecordRequest
  ): Promise<MemoryRecord> {
    // Best-effort (embeddings.ts's generateEmbedding never throws) -- a
    // failure here must not block the memory-record write itself, per the
    // Step 4 Wave 3 spec's NFR. `title` is included alongside `content`
    // since it often carries signal content alone doesn't (e.g. a short,
    // descriptive title on terse content).
    const embedding = await generateEmbedding(`${data.title}\n\n${data.content}`);

    const { rows } = await this.db.query<MemoryRecord>(
      `INSERT INTO memory_records
         (project_id, scope, domain_id, title, content, tags, created_by, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
       RETURNING ${PUBLIC_COLUMNS}`,
      [
        project_id,
        data.scope,
        data.domain_id ?? null,
        data.title,
        data.content,
        data.tags ?? [],
        created_by ?? null,
        embedding ? toPgvectorLiteral(embedding) : null,
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
      `SELECT ${PUBLIC_COLUMNS} FROM memory_records
       WHERE (project_id = $1 OR ${domainClause})
         ${tagClause}
         ${kwClause}
       ORDER BY updated_at DESC
       ${limitClause}`,
      params
    );
    return rows;
  }

  /**
   * Item #4 (Step 6 prioritization matrix) -- semantic search over
   * memory_records via pgvector cosine distance (migration
   * 025_pgvector_memory_embeddings.sql). Same MANDATORY project/domain
   * access filter as retrieve() above (ADR-004's dual-filter rule applies
   * identically to semantic and keyword retrieval -- security posture
   * doesn't change based on how a match was found). Rows with no embedding
   * (pre-migration rows, or a row whose embedding generation failed) are
   * excluded rather than surfaced with a meaningless distance value.
   *
   * `similarity` is `1 - cosine distance` (via `<=>`), so 1.0 = identical,
   * 0.0 = orthogonal, more intuitive for a caller than raw distance.
   */
  async retrieveBySimilarity(opts: {
    project_id: string;
    domain_id?: string;
    queryEmbedding: number[];
    limit?: number;
  }): Promise<Array<MemoryRecord & { similarity: number }>> {
    const { project_id, domain_id, queryEmbedding, limit = 10 } = opts;
    const queryVector = toPgvectorLiteral(queryEmbedding);
    const params: unknown[] = [project_id, queryVector];
    let domainClause = 'FALSE';

    if (domain_id) {
      params.push(domain_id);
      domainClause = `(scope = 'domain_shared' AND domain_id = $${params.length} AND approved = TRUE)`;
    }

    params.push(limit);
    const limitClause = `LIMIT $${params.length}`;

    const { rows } = await this.db.query<MemoryRecord & { similarity: number }>(
      `SELECT ${PUBLIC_COLUMNS}, 1 - (embedding <=> $2::vector) AS similarity
       FROM memory_records
       WHERE (project_id = $1 OR ${domainClause})
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       ${limitClause}`,
      params
    );
    return rows;
  }

  async findById(id: string): Promise<MemoryRecord | null> {
    const { rows } = await this.db.query<MemoryRecord>(
      `SELECT ${PUBLIC_COLUMNS} FROM memory_records WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findPendingApproval(limit = 50): Promise<MemoryRecord[]> {
    const { rows } = await this.db.query<MemoryRecord>(
      `SELECT ${PUBLIC_COLUMNS} FROM memory_records
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
      `SELECT ${PUBLIC_COLUMNS} FROM memory_records WHERE project_id = $1 ORDER BY updated_at DESC`,
      [project_id]
    );
    return rows;
  }
}
