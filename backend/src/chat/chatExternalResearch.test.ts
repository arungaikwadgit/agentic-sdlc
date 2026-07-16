/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { createExternalResearch } = require('./chatExternalResearch');

describe('backend-only external research', () => {
  it('fails closed when no provider key is configured', async () => {
    const research = createExternalResearch({ apiKey: '', fetchImpl: jest.fn() });
    await expect(research.search('latest payment regulation')).rejects.toMatchObject({ status: 503 });
  });

  it('uses the fixed Tavily endpoint and returns bounded source evidence', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 8 }, (_, index) => ({
          title: `Source ${index}`,
          url: `https://example.com/${index}`,
          content: 'x'.repeat(5000),
          score: 0.9,
        })),
      }),
    });
    const research = createExternalResearch({ apiKey: 'server-secret', fetchImpl });
    const evidence = await research.search('latest payment regulation');

    expect(fetchImpl).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.api_key).toBe('server-secret');
    expect(body.max_results).toBe(5);
    expect(evidence).toHaveLength(5);
    expect(evidence[0].excerpt.length).toBeLessThanOrEqual(3000);
    expect(JSON.stringify(evidence)).not.toContain('server-secret');
  });

  it('rejects blank and oversized search queries', async () => {
    const research = createExternalResearch({ apiKey: 'server-secret', fetchImpl: jest.fn() });
    await expect(research.search('   ')).rejects.toMatchObject({ status: 400 });
    await expect(research.search('x'.repeat(501))).rejects.toMatchObject({ status: 400 });
  });
});

export {};
