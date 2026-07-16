/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppConfigValue: vi.fn(),
  setAppConfigValue: vi.fn(),
  getGovernedEffectivePrompt: vi.fn(),
  saveGlobalPromptVersion: vi.fn(),
  seedGlobalPromptVersions: vi.fn(),
}));

vi.mock('../../frontend/src/services/appStateApi', () => ({
  getAppConfigValue: mocks.getAppConfigValue,
  setAppConfigValue: mocks.setAppConfigValue,
}));

vi.mock('../../frontend/src/services/promptGovernance', () => ({
  getGovernedEffectivePrompt: mocks.getGovernedEffectivePrompt,
  saveGlobalPromptVersion: mocks.saveGlobalPromptVersion,
  seedGlobalPromptVersions: mocks.seedGlobalPromptVersions,
}));

import {
  getEffectivePromptDefault,
  savePromptDefault,
  seedBuiltInPromptGovernanceDefaults,
} from '../../frontend/src/agents/promptDefaults';

describe('prompt defaults governance integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppConfigValue.mockResolvedValue({ architecture: 'legacy prompt' });
  });

  it('prefers the active governed global prompt over the legacy app-state value', async () => {
    mocks.getGovernedEffectivePrompt.mockResolvedValue({ prompt: 'governed prompt', source: 'global', version: 2, record: null });
    await expect(getEffectivePromptDefault('architecture')).resolves.toBe('governed prompt');
  });

  it('falls back to the legacy value when the governance API is unavailable', async () => {
    mocks.getGovernedEffectivePrompt.mockRejectedValue(new Error('backend unavailable'));
    await expect(getEffectivePromptDefault('architecture')).resolves.toBe('legacy prompt');
  });

  it('persists both the compatibility value and a governed global version', async () => {
    await savePromptDefault('architecture', 'new prompt');
    expect(mocks.setAppConfigValue).toHaveBeenCalledWith('app:promptDefaults', { architecture: 'new prompt' });
    expect(mocks.saveGlobalPromptVersion).toHaveBeenCalledWith('architecture', expect.any(String), 'new prompt');
  });

  it('seeds every built-in agent definition through the batch governance endpoint', async () => {
    mocks.seedGlobalPromptVersions.mockResolvedValue({ created: 30, skipped: 0 });
    const result = await seedBuiltInPromptGovernanceDefaults();
    expect(result).toEqual({ created: 30, skipped: 0 });
    expect(mocks.seedGlobalPromptVersions).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ agentId: 'architecture', content: expect.any(String) }),
      expect.objectContaining({ agentId: 'dataModel', content: expect.any(String) }),
    ]));
  });
});
