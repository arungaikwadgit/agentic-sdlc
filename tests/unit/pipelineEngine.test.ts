// tests/unit/pipelineEngine.test.ts (Appendix K1)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../../frontend/src/services/api';

describe('api.callAgent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns extracted text from OpenAI response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
        usage: { total_tokens: 10 },
      }),
    });

    const result = await api.callAgent({ systemPrompt: 'You are a PM', userPrompt: 'Write a PRD' });
    expect(api.extractText(result)).toBe('Hello world');
  });

  it('retries once on JSON parse failure', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => { throw new Error('JSON parse error'); } };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Retry success' }, finish_reason: 'stop' }],
        }),
      };
    });

    const result = await api.callAgent({ systemPrompt: '', userPrompt: '' });
    expect(api.extractText(result)).toBe('Retry success');
    expect(callCount).toBe(2);
  });

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(api.callAgent({ systemPrompt: '', userPrompt: '' })).rejects.toThrow('401: Unauthorized');
  });

  it('uses the proxy token from the current environment when present on localhost', async () => {
    vi.stubEnv('VITE_PROXY_TOKEN', 'token-123');
    vi.stubGlobal('location', new URL('http://localhost/'));
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    await api.callAgent({ systemPrompt: 'test', userPrompt: 'test' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Token': 'token-123' }),
      }),
    );
  });

  it('does not send the proxy token on non-local production hosts', async () => {
    vi.stubEnv('VITE_PROXY_TOKEN', 'token-123');
    vi.stubGlobal('location', new URL('https://example.com/'));
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    await api.callAgent({ systemPrompt: 'test', userPrompt: 'test' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({ 'X-API-Token': 'token-123' }),
      }),
    );
  });
});
