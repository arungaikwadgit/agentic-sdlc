/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { assessEvidence, sourceSatisfies, CHAT_SOURCE_ALIASES } = require('./evidenceAssessment');

describe('sourceSatisfies', () => {
  it('matches via an alias set', () => {
    expect(sourceSatisfies('agent_run', 'runtime')).toBe(true);
    expect(sourceSatisfies('agent_output', 'outputs')).toBe(true);
  });

  it('falls back to an exact match when the requirement has no alias entry', () => {
    expect(sourceSatisfies('custom_source', 'custom_source')).toBe(true);
    expect(sourceSatisfies('custom_source', 'other_source')).toBe(false);
  });

  it('accepts a caller-supplied alias map instead of the default', () => {
    const customAliases = { widgets: new Set(['widget_a', 'widget_b']) };
    expect(sourceSatisfies('widget_a', 'widgets', customAliases)).toBe(true);
    expect(sourceSatisfies('widget_c', 'widgets', customAliases)).toBe(false);
  });

  it('default alias map covers every documented requirement', () => {
    expect(Object.keys(CHAT_SOURCE_ALIASES)).toEqual(
      expect.arrayContaining(['project', 'catalog', 'runtime', 'outputs', 'gates', 'memory', 'external']),
    );
  });
});

describe('assessEvidence', () => {
  it('returns zero confidence and full requirements missing for no evidence', () => {
    const result = assessEvidence([], ['project']);
    expect(result).toEqual({ confidence: 0, sufficient: false, missing: ['project'], contradictions: [] });
  });

  it('caps confidence at 97 when a requirement is missing', () => {
    const result = assessEvidence(
      [{ sourceType: 'project', sourceId: 'p1', authority: 100, excerpt: 'x' }],
      ['project', 'runtime'],
    );
    expect(result.confidence).toBeLessThanOrEqual(97);
    expect(result.missing).toEqual(['runtime']);
    expect(result.sufficient).toBe(false);
  });

  it('caps confidence at 85 when claims contradict', () => {
    const result = assessEvidence(
      [
        { sourceType: 'project', sourceId: 'p1', authority: 100, excerpt: 'x', claimKey: 'project.status', claimValue: 'active' },
        { sourceType: 'project', sourceId: 'p2', authority: 100, excerpt: 'y', claimKey: 'project.status', claimValue: 'archived' },
      ],
      ['project'],
    );
    expect(result.contradictions).toEqual(['project.status']);
    expect(result.confidence).toBeLessThanOrEqual(85);
    expect(result.sufficient).toBe(false);
  });

  it('marks sufficient at full confidence with no gaps or contradictions', () => {
    const result = assessEvidence(
      [
        { sourceType: 'project', sourceId: 'p1', authority: 100, excerpt: 'x' },
        { sourceType: 'runtime', sourceId: 'r1', authority: 100, excerpt: 'y' },
      ],
      ['project', 'runtime'],
    );
    expect(result).toEqual({ confidence: 100, sufficient: true, missing: [], contradictions: [] });
  });

  it('excludes unauthorized or excerpt-less items from the authority average', () => {
    const result = assessEvidence(
      [
        { sourceType: 'project', sourceId: 'p1', authority: 100, excerpt: 'x' },
        { sourceType: 'project', sourceId: 'p2', authority: 0, authorized: false, excerpt: 'y' },
        { sourceType: 'project', sourceId: 'p3', authority: 100, excerpt: '' },
      ],
      ['project'],
    );
    expect(result.confidence).toBe(100);
  });

  it('clamps out-of-range authority values into 0-100', () => {
    const result = assessEvidence(
      [{ sourceType: 'project', sourceId: 'p1', authority: 500, excerpt: 'x' }],
      ['project'],
    );
    expect(result.confidence).toBe(100);
  });

  it('defaults a missing authority field to 80', () => {
    const result = assessEvidence(
      [{ sourceType: 'project', sourceId: 'p1', excerpt: 'x' }],
      ['project'],
    );
    expect(result.confidence).toBe(80);
  });
});
