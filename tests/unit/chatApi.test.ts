/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer session-token' }),
  getProxyToken: vi.fn().mockReturnValue('local-proxy-token'),
}));

vi.mock('@/services/api', () => authMocks);

import { askAgenticChat } from '@/chatbot/chatApi';

describe('agentic chat API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the bounded request with current authentication headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Supported answer', confidence: 100, supported: true,
        evidence: [], trace: [], followUp: null, responseMode: 'model',
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, modelCalls: 2, avoidedModelCalls: 0, providers: ['openai'], models: ['gpt-4o'] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await askAgenticChat({
      question: 'What is the status?', currentView: 'dashboard', history: [],
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/respond', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer session-token',
        'X-API-Token': 'local-proxy-token',
      }),
    }));
  });

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'missing metadata' }) }));
    await expect(askAgenticChat({ question: 'status?', currentView: 'dashboard', history: [] }))
      .rejects.toThrow(/malformed/i);
  });
});
