/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { fetchSemanticEvidence } from './semanticMemory';

describe('fetchSemanticEvidence', () => {
  const ORIGINAL_URL = process.env.RUNTIME_API_URL;
  const ORIGINAL_TOKEN = process.env.RUNTIME_API_TOKEN_INTERNAL;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.RUNTIME_API_URL = ORIGINAL_URL;
    process.env.RUNTIME_API_TOKEN_INTERNAL = ORIGINAL_TOKEN;
    global.fetch = originalFetch;
  });

  it('returns null without calling fetch when RUNTIME_API_URL is not configured', async () => {
    delete process.env.RUNTIME_API_URL;
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'token';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'cost optimization' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling fetch when RUNTIME_API_TOKEN_INTERNAL is not configured', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    delete process.env.RUNTIME_API_TOKEN_INTERNAL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'cost optimization' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the runtime similarity endpoint with the expected query params and auth header', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com/';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ found: true, items: [], confidence: 0, sufficient: false }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchSemanticEvidence({ projectId: 'proj-1', query: 'token budget', domainId: 'saas', limit: 4 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://runtime.example.com/api/v1/memory-records/similar?project_id=proj-1&query=token+budget&limit=4&domain_id=saas');
    expect((init.headers as Record<string, string>)['X-API-Token']).toBe('internal-secret');
  });

  it('returns the parsed result on a successful response', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    const payload = {
      found: true,
      items: [{ sourceType: 'memory', sourceId: 'rec-1', title: 'T', version: null, updatedAt: null, excerpt: 'x', authority: 80, authorized: true }],
      confidence: 80,
      sufficient: false,
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'q' });
    expect(result).toEqual(payload);
  });

  it('returns null on a non-ok HTTP response', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'q' });
    expect(result).toBeNull();
  });

  it('returns null when the response shape is missing an items array', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ found: false }) }) as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'q' });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when fetch itself rejects', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'q' });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when the response body is not valid JSON', async () => {
    process.env.RUNTIME_API_URL = 'https://runtime.example.com';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } }) as unknown as typeof fetch;

    const result = await fetchSemanticEvidence({ projectId: 'p1', query: 'q' });
    expect(result).toBeNull();
  });
});
