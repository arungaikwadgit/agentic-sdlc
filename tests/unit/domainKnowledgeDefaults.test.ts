// tests/unit/domainKnowledgeDefaults.test.ts
// Unit tests for agents/domainKnowledgeDefaults.ts - app-level domain
// knowledge defaults precedence over built-in templates.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsStore = new Map<string, unknown>();
const getAppConfigValueMock = vi.fn(async <T,>(key: string, fallback: T): Promise<T> => {
  return (settingsStore.has(key) ? settingsStore.get(key) : fallback) as T;
});
const setAppConfigValueMock = vi.fn(async (key: string, value: unknown): Promise<void> => {
  settingsStore.set(key, value);
});

vi.mock('@/services/appStateApi', () => ({
  getAppConfigValue: <T,>(key: string, fallback: T) => getAppConfigValueMock(key, fallback),
  setAppConfigValue: (key: string, value: unknown) => setAppConfigValueMock(key, value),
}));

const FAKE_TEMPLATES = vi.hoisted<Record<string, string>>(() => ({
  saas: '# SaaS Template',
  fintech: '# FinTech Template',
  healthcare: '# Healthcare Template',
}));
vi.mock('@/agents/domainKnowledgeTemplates', () => ({
  DOMAIN_KNOWLEDGE_TEMPLATES: FAKE_TEMPLATES,
}));

import {
  getDomainKnowledgeDefaults,
  getEffectiveDomainKnowledgeDefault,
  saveDomainKnowledgeDefault,
  resetDomainKnowledgeDefault,
} from '../../frontend/src/agents/domainKnowledgeDefaults';
import type { DomainId } from '../../frontend/src/types/domain.types';

const SETTINGS_KEY = 'app:domainKnowledgeDefaults';

describe('domainKnowledgeDefaults', () => {
  beforeEach(() => {
    settingsStore.clear();
    getAppConfigValueMock.mockClear();
    setAppConfigValueMock.mockClear();
  });

  it('returns the app-level default when one is set for the domain (TS-197)', async () => {
    settingsStore.set(SETTINGS_KEY, { fintech: 'custom brief' });

    const result = await getEffectiveDomainKnowledgeDefault('fintech' as DomainId);

    expect(result).toBe('custom brief');
  });

  it('falls back to DOMAIN_KNOWLEDGE_TEMPLATES when no app-level default exists for the domain (TS-198)', async () => {
    const result = await getEffectiveDomainKnowledgeDefault('healthcare' as DomainId);
    expect(result).toBe(FAKE_TEMPLATES.healthcare);

    settingsStore.set(SETTINGS_KEY, { fintech: 'custom brief' });
    const result2 = await getEffectiveDomainKnowledgeDefault('healthcare' as DomainId);
    expect(result2).toBe(FAKE_TEMPLATES.healthcare);
  });

  it('getDomainKnowledgeDefaults returns {} when the row is missing or value is not an object (TS-199)', async () => {
    expect(await getDomainKnowledgeDefaults()).toEqual({});

    settingsStore.set(SETTINGS_KEY, 'not-an-object');
    expect(await getDomainKnowledgeDefaults()).toEqual('not-an-object');
  });

  it('saveDomainKnowledgeDefault then getEffectiveDomainKnowledgeDefault round-trips the saved value (TS-200)', async () => {
    await saveDomainKnowledgeDefault('saas' as DomainId, 'new brief');

    expect(setAppConfigValueMock).toHaveBeenCalledWith(SETTINGS_KEY, { saas: 'new brief' });

    const result = await getEffectiveDomainKnowledgeDefault('saas' as DomainId);
    expect(result).toBe('new brief');
  });

  it('resetDomainKnowledgeDefault removes the override, falling back to the template again (TS-201)', async () => {
    await saveDomainKnowledgeDefault('saas' as DomainId, 'custom saas brief');
    expect(await getEffectiveDomainKnowledgeDefault('saas' as DomainId)).toBe('custom saas brief');

    await resetDomainKnowledgeDefault('saas' as DomainId);

    expect(await getEffectiveDomainKnowledgeDefault('saas' as DomainId)).toBe(FAKE_TEMPLATES.saas);
    expect(settingsStore.get(SETTINGS_KEY)).toEqual({});
  });

  it('resetDomainKnowledgeDefault is a no-op when no override exists for the domain', async () => {
    settingsStore.set(SETTINGS_KEY, { fintech: 'fintech brief' });
    setAppConfigValueMock.mockClear();

    await resetDomainKnowledgeDefault('saas' as DomainId);

    expect(setAppConfigValueMock).not.toHaveBeenCalled();
  });
});
