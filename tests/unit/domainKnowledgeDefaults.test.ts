// tests/unit/domainKnowledgeDefaults.test.ts
// Unit tests for agents/domainKnowledgeDefaults.ts — app-level domain
// knowledge defaults precedence over built-in templates.
// Covers TS-197 through TS-201 from
// docs/test-plans/dashboard-and-project-creation-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @/db/database — db.settings.get/put ──
const settingsStore = new Map<string, { key: string; value: unknown }>();
const getMock = vi.fn(async (key: string) => settingsStore.get(key));
const putMock = vi.fn(async (row: { key: string; value: unknown }) => {
  settingsStore.set(row.key, row);
});

vi.mock('@/db/database', () => ({
  db: {
    settings: {
      get: (...args: [string]) => getMock(...args),
      put: (...args: [{ key: string; value: unknown }]) => putMock(...args),
    },
  },
}));

vi.mock('@/services/appStateApi', () => ({
  getAppConfigValue: async (key: string, fallback: unknown) =>
    settingsStore.get(key)?.value ?? fallback,
  setAppConfigValue: async (key: string, value: unknown) =>
    putMock({ key, value }),
}));

// ── Mock @/agents/domainKnowledgeTemplates ──
// NOTE: vi.mock factories are hoisted above top-level const declarations, so
// any value referenced inside the factory must itself be created via
// vi.hoisted() to avoid a "Cannot access before initialization" error.
const FAKE_TEMPLATES = vi.hoisted<Record<string, string>>(() => ({
  saas: '# SaaS Template',
  fintech: '# FinTech Template',
  healthcare: '# Healthcare Template',
}));
vi.mock('@/agents/domainKnowledgeTemplates', () => ({
  DOMAIN_KNOWLEDGE_TEMPLATES: FAKE_TEMPLATES,
}));

// Import after mocks are registered.
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
    getMock.mockClear();
    putMock.mockClear();
  });

  it('returns the app-level default when one is set for the domain (TS-197)', async () => {
    settingsStore.set(SETTINGS_KEY, { key: SETTINGS_KEY, value: { fintech: 'custom brief' } });

    const result = await getEffectiveDomainKnowledgeDefault('fintech' as DomainId);

    expect(result).toBe('custom brief');
  });

  it('falls back to DOMAIN_KNOWLEDGE_TEMPLATES when no app-level default exists for the domain (TS-198)', async () => {
    // No row in settingsStore at all.
    const result = await getEffectiveDomainKnowledgeDefault('healthcare' as DomainId);
    expect(result).toBe(FAKE_TEMPLATES.healthcare);

    // Row exists but doesn't include this domain.
    settingsStore.set(SETTINGS_KEY, { key: SETTINGS_KEY, value: { fintech: 'custom brief' } });
    const result2 = await getEffectiveDomainKnowledgeDefault('healthcare' as DomainId);
    expect(result2).toBe(FAKE_TEMPLATES.healthcare);
  });

  it('getDomainKnowledgeDefaults returns {} when the row is missing or value is not an object (TS-199)', async () => {
    // Missing row.
    expect(await getDomainKnowledgeDefaults()).toEqual({});

    // Row present but value is not an object.
    settingsStore.set(SETTINGS_KEY, { key: SETTINGS_KEY, value: 'not-an-object' });
    expect(await getDomainKnowledgeDefaults()).toEqual({});
  });

  it('saveDomainKnowledgeDefault then getEffectiveDomainKnowledgeDefault round-trips the saved value (TS-200)', async () => {
    await saveDomainKnowledgeDefault('saas' as DomainId, 'new brief');

    expect(putMock).toHaveBeenCalledWith({
      key: SETTINGS_KEY,
      value: { saas: 'new brief' },
    });

    const result = await getEffectiveDomainKnowledgeDefault('saas' as DomainId);
    expect(result).toBe('new brief');
  });

  it('resetDomainKnowledgeDefault removes the override, falling back to the template again (TS-201)', async () => {
    await saveDomainKnowledgeDefault('saas' as DomainId, 'custom saas brief');
    expect(await getEffectiveDomainKnowledgeDefault('saas' as DomainId)).toBe('custom saas brief');

    await resetDomainKnowledgeDefault('saas' as DomainId);

    expect(await getEffectiveDomainKnowledgeDefault('saas' as DomainId)).toBe(FAKE_TEMPLATES.saas);

    const stored = settingsStore.get(SETTINGS_KEY);
    expect(stored?.value).toEqual({});
  });

  it('resetDomainKnowledgeDefault is a no-op when no override exists for the domain', async () => {
    settingsStore.set(SETTINGS_KEY, { key: SETTINGS_KEY, value: { fintech: 'fintech brief' } });
    putMock.mockClear();

    await resetDomainKnowledgeDefault('saas' as DomainId);

    expect(putMock).not.toHaveBeenCalled();
  });
});
