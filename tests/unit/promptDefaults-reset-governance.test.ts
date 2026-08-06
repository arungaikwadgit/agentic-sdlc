/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppConfigValue: vi.fn(async () => ({ architecture: 'custom prompt' })),
  setAppConfigValue: vi.fn(),
  saveGlobalPromptVersion: vi.fn(),
}));

vi.mock('../../frontend/src/services/appStateApi', () => ({
  getAppConfigValue: mocks.getAppConfigValue,
  setAppConfigValue: mocks.setAppConfigValue,
}));
vi.mock('../../frontend/src/services/promptGovernance', () => ({
  getGovernedEffectivePrompt: vi.fn(),
  saveGlobalPromptVersion: mocks.saveGlobalPromptVersion,
  seedGlobalPromptVersions: vi.fn(),
}));

import { resetPromptDefault } from '../../frontend/src/agents/promptDefaults';

it('reset activates a governed version containing the built-in prompt', async () => {
  await resetPromptDefault('architecture');
  expect(mocks.setAppConfigValue).toHaveBeenCalledWith('app:promptDefaults', {});
  expect(mocks.saveGlobalPromptVersion).toHaveBeenCalledWith(
    'architecture',
    expect.any(String),
    expect.stringContaining('Architecture'),
  );
});
