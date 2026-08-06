/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import { seedGlobalPromptVersions } from '../../frontend/src/services/promptGovernance';

it('uses a seed endpoint that cannot be shadowed by global/:agentId', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true, created: 1, skipped: 0 }), { status: 200 }),
  );
  await seedGlobalPromptVersions([{ agentId: 'architecture', agentName: 'Architecture Agent', content: 'prompt' }]);
  expect(fetchMock).toHaveBeenCalledWith('/api/prompt-governance/seed/global', expect.any(Object));
});
