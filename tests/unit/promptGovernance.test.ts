/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthHeaderMock = vi.hoisted(() => vi.fn(async () => ({ Authorization: 'Bearer test-token' })));

vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: getAuthHeaderMock,
}));

import {
  approveProjectPromptVersion,
  createProjectPromptDraft,
  requestProjectPromptChanges,
  rejectProjectPromptVersion,
  rollbackProjectPromptVersion,
  seedGlobalPromptVersions,
  submitProjectPromptVersion,
} from '../../frontend/src/services/promptGovernance';

describe('prompt governance API client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '/api');
    vi.restoreAllMocks();
    getAuthHeaderMock.mockResolvedValue({ Authorization: 'Bearer test-token' });
  });

  it('creates an immutable project draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'v1', version: 1 }), { status: 200 }));
    await createProjectPromptDraft('project-1', 'architecture', 'Architecture Agent', 'governed prompt', { changeReason: 'Project constraints' });
    expect(fetchMock).toHaveBeenCalledWith('/api/prompt-governance/project/project-1/architecture/draft', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Project constraints'),
    }));
  });

  it.each([
    ['submit', submitProjectPromptVersion],
    ['approve', approveProjectPromptVersion],
    ['reject', rejectProjectPromptVersion],
    ['changes-requested', requestProjectPromptChanges],
  ])('calls the %s lifecycle endpoint', async (suffix, action) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await action('project-1', 'architecture', 'version-1', 'review comment');
    expect(fetchMock).toHaveBeenCalledWith(`/api/prompt-governance/project/project-1/architecture/version-1/${suffix}`, expect.objectContaining({ method: 'POST' }));
  });

  it('requests rollback as a new governed version', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await rollbackProjectPromptVersion('project-1', 'architecture', 'version-1', 'Regression in latest prompt');
    expect(fetchMock).toHaveBeenCalledWith('/api/prompt-governance/project/project-1/architecture/version-1/rollback', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Regression in latest prompt'),
    }));
  });

  it('seeds missing global defaults in one authenticated request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, created: 2, skipped: 1 }), { status: 200 }));
    const result = await seedGlobalPromptVersions([
      { agentId: 'architecture', agentName: 'Architecture Agent', content: 'architecture prompt' },
      { agentId: 'dataModel', agentName: 'Data Model Agent', content: 'data prompt' },
    ]);
    expect(result).toEqual({ created: 2, skipped: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/prompt-governance/seed/global', expect.objectContaining({ method: 'POST' }));
  });
});
