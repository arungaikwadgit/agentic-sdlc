import { MemoryRecordRepository } from './MemoryRecordRepository';

const { toPgvectorLiteral: realToPgvectorLiteral } = jest.requireActual('../embeddings');

jest.mock('../embeddings', () => ({
  generateEmbedding: jest.fn(),
  toPgvectorLiteral: jest.requireActual('../embeddings').toPgvectorLiteral,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateEmbedding } = jest.requireMock('../embeddings') as { generateEmbedding: jest.Mock };

function makeEmbedding(length = 1536): number[] {
  return Array.from({ length }, (_, i) => i / length);
}

describe('MemoryRecordRepository', () => {
  beforeEach(() => {
    generateEmbedding.mockReset();
  });

  describe('create', () => {
    it('generates an embedding from title+content and stores it as a pgvector literal, excluding embedding from the returned row', async () => {
      const embedding = makeEmbedding();
      generateEmbedding.mockResolvedValue(embedding);
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'rec-1', project_id: 'proj-1' }] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.create('proj-1', 'user-1', {
        scope: 'project',
        title: 'API Design',
        content: 'Uses REST with OpenAPI 3.1',
        tags: ['api'],
      });

      expect(generateEmbedding).toHaveBeenCalledWith('API Design\n\nUses REST with OpenAPI 3.1');
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('INSERT INTO memory_records');
      expect(sql).not.toMatch(/RETURNING \*/);
      expect(sql).toContain('embedding');
      expect(sql).not.toContain('SELECT *');
      const embeddingParam = params[7];
      expect(embeddingParam).toBe(realToPgvectorLiteral(embedding));
    });

    it('stores a null embedding when generation fails (never blocks the write)', async () => {
      generateEmbedding.mockResolvedValue(null);
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'rec-1' }] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.create('proj-1', undefined, {
        scope: 'project',
        title: 'T',
        content: 'C',
      });

      const [, params] = query.mock.calls[0];
      expect(params[7]).toBeNull();
    });
  });

  describe('retrieve', () => {
    it('excludes embedding from the selected columns', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieve({ project_id: 'proj-1' });

      const [sql] = query.mock.calls[0];
      expect(sql).not.toContain('SELECT *');
      expect(sql).toContain('id, project_id');
    });

    it('applies the domain_shared + approved dual-filter when domain_id is supplied', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieve({ project_id: 'proj-1', domain_id: 'saas' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("scope = 'domain_shared'");
      expect(sql).toContain('approved = TRUE');
      expect(params).toContain('saas');
    });

    it('applies a tag-overlap filter when tags are supplied', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieve({ project_id: 'proj-1', tags: ['api', 'backend'] });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('tags &&');
      expect(params).toContainEqual(['api', 'backend']);
    });

    it('applies a keyword ILIKE filter on title/content when keyword is supplied', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieve({ project_id: 'proj-1', keyword: 'openapi' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(params).toContain('%openapi%');
    });

    it('combines domain_id, tags, and keyword filters together', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieve({
        project_id: 'proj-1',
        domain_id: 'saas',
        tags: ['api'],
        keyword: 'rest',
        limit: 5,
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("scope = 'domain_shared'");
      expect(sql).toContain('tags &&');
      expect(sql).toContain('ILIKE');
      expect(params).toEqual(['proj-1', 'saas', ['api'], '%rest%', 5]);
    });
  });

  describe('retrieveBySimilarity', () => {
    it('runs a cosine-distance query scoped to project_id, excludes rows with a null embedding, and returns a similarity score', async () => {
      const embedding = makeEmbedding();
      const query = jest.fn().mockResolvedValue({
        rows: [{ id: 'rec-1', project_id: 'proj-1', similarity: 0.87 }],
      });
      const repo = new MemoryRecordRepository({ query } as never);

      const result = await repo.retrieveBySimilarity({ project_id: 'proj-1', queryEmbedding: embedding });

      expect(result).toEqual([{ id: 'rec-1', project_id: 'proj-1', similarity: 0.87 }]);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('embedding <=> $2::vector');
      expect(sql).toContain('embedding IS NOT NULL');
      expect(sql).toContain('1 - (embedding <=> $2::vector) AS similarity');
      expect(params[0]).toBe('proj-1');
      expect(params[1]).toBe(realToPgvectorLiteral(embedding));
      expect(params[2]).toBe(10); // default limit
    });

    it('applies the domain_shared + approved dual-filter when domain_id is supplied, matching retrieve()', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieveBySimilarity({
        project_id: 'proj-1',
        domain_id: 'saas',
        queryEmbedding: makeEmbedding(),
        limit: 5,
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("scope = 'domain_shared'");
      expect(sql).toContain('approved = TRUE');
      expect(params).toEqual(expect.arrayContaining(['saas', 5]));
    });

    it('excludes embedding from the selected columns', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);

      await repo.retrieveBySimilarity({ project_id: 'proj-1', queryEmbedding: makeEmbedding() });

      const [sql] = query.mock.calls[0];
      expect(sql).not.toContain('SELECT *');
    });
  });

  describe('findById / findByProject / findPendingApproval', () => {
    it('findById excludes embedding from the selected columns', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'rec-1' }] });
      const repo = new MemoryRecordRepository({ query } as never);
      await repo.findById('rec-1');
      expect(query.mock.calls[0][0]).not.toContain('SELECT *');
    });

    it('findById returns null when no row matches', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);
      const result = await repo.findById('missing-id');
      expect(result).toBeNull();
    });

    it('findByProject excludes embedding from the selected columns', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);
      await repo.findByProject('proj-1');
      expect(query.mock.calls[0][0]).not.toContain('SELECT *');
    });

    it('findPendingApproval excludes embedding from the selected columns', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);
      await repo.findPendingApproval();
      expect(query.mock.calls[0][0]).not.toContain('SELECT *');
    });
  });

  describe('approve', () => {
    it('updates approval fields by id', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const repo = new MemoryRecordRepository({ query } as never);
      await repo.approve('rec-1', 'admin-user');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE memory_records'),
        ['rec-1', 'admin-user'],
      );
    });
  });
});
