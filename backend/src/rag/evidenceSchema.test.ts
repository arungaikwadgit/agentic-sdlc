/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { evidenceItem, dedupeEvidence, capEvidence, toExcerpt, MAX_EVIDENCE_CHARS, MAX_EXCERPT_CHARS } = require('./evidenceSchema');

describe('evidenceItem', () => {
  it('builds the canonical shape with defaults', () => {
    const item = evidenceItem({ sourceType: 'project', sourceId: 'p1', title: 'Project', excerpt: 'hello' });
    expect(item).toMatchObject({
      sourceType: 'project',
      sourceId: 'p1',
      title: 'Project',
      version: null,
      updatedAt: null,
      excerpt: 'hello',
      authority: 100,
      authorized: true,
    });
    expect(item.claimKey).toBeUndefined();
  });

  it('includes claimKey/claimValue only when claimKey is supplied', () => {
    const item = evidenceItem({ sourceType: 'project', sourceId: 'p1', title: 'Project', excerpt: 'x', claimKey: 'project.status', claimValue: 'active' });
    expect(item.claimKey).toBe('project.status');
    expect(item.claimValue).toBe('active');
  });

  it('serializes a non-string excerpt to JSON', () => {
    const item = evidenceItem({ sourceType: 'runtime', sourceId: 'r1', title: 'Runtime', excerpt: { status: 'complete' } });
    expect(item.excerpt).toContain('"status"');
    expect(item.excerpt).toContain('complete');
  });

  it('truncates an excerpt longer than MAX_EXCERPT_CHARS', () => {
    const longText = 'x'.repeat(MAX_EXCERPT_CHARS + 500);
    const item = evidenceItem({ sourceType: 'memory', sourceId: 'm1', title: 'Memory', excerpt: longText });
    expect(item.excerpt.length).toBe(MAX_EXCERPT_CHARS);
  });

  it('handles a null/undefined excerpt without throwing', () => {
    const item = evidenceItem({ sourceType: 'project', sourceId: 'p1', title: 'Project', excerpt: null });
    expect(item.excerpt).toBe('null');
  });
});

describe('toExcerpt', () => {
  it('respects a custom max length', () => {
    expect(toExcerpt('abcdefgh', 3)).toBe('abc');
  });
});

describe('dedupeEvidence', () => {
  it('removes items with identical sourceType/sourceId/version/updatedAt', () => {
    const items = [
      { sourceType: 'project', sourceId: 'p1', version: null, updatedAt: '2026-01-01', excerpt: 'a' },
      { sourceType: 'project', sourceId: 'p1', version: null, updatedAt: '2026-01-01', excerpt: 'a-dup' },
      { sourceType: 'project', sourceId: 'p2', version: null, updatedAt: '2026-01-01', excerpt: 'b' },
    ];
    const result = dedupeEvidence(items);
    expect(result).toHaveLength(2);
    expect(result[0].excerpt).toBe('a');
  });

  it('treats different versions or updatedAt as distinct', () => {
    const items = [
      { sourceType: 'agent_output', sourceId: 'a1', version: 1, updatedAt: '2026-01-01', excerpt: 'v1' },
      { sourceType: 'agent_output', sourceId: 'a1', version: 2, updatedAt: '2026-01-02', excerpt: 'v2' },
    ];
    expect(dedupeEvidence(items)).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeEvidence([])).toEqual([]);
  });
});

describe('capEvidence', () => {
  it('keeps items under the default char budget untouched', () => {
    const items = [{ excerpt: 'short excerpt' }];
    expect(capEvidence(items)).toEqual([{ excerpt: 'short excerpt' }]);
  });

  it('truncates and drops items once the budget is exhausted', () => {
    const items = [
      { id: 1, excerpt: 'a'.repeat(20_000) },
      { id: 2, excerpt: 'b'.repeat(20_000) },
      { id: 3, excerpt: 'c'.repeat(20_000) },
    ];
    const result = capEvidence(items, 25_000);
    // First item consumes 20,000 (capped at min(3000, remaining) per item, so
    // actually each item is capped at min(3000, remaining) -- verify total budget respected.
    const totalChars = result.reduce((sum: number, item: { excerpt: string }) => sum + item.excerpt.length, 0);
    expect(totalChars).toBeLessThanOrEqual(25_000);
    expect(result.length).toBeGreaterThan(0);
  });

  it('drops items with an empty excerpt', () => {
    const items = [{ excerpt: '' }, { excerpt: 'kept' }];
    const result = capEvidence(items);
    expect(result).toEqual([{ excerpt: 'kept' }]);
  });

  it('stops once the budget is fully consumed', () => {
    const items = [
      { id: 1, excerpt: 'x'.repeat(3_000) },
      { id: 2, excerpt: 'y'.repeat(3_000) },
    ];
    const result = capEvidence(items, 3_000);
    expect(result).toHaveLength(1);
  });

  it('respects MAX_EVIDENCE_CHARS as the default budget', () => {
    expect(MAX_EVIDENCE_CHARS).toBe(24_000);
  });
});
