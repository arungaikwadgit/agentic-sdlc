/**
 * App-level default Domain Knowledge briefs, one per domain.
 *
 * Precedence (resolved in NewProjectModal when a domain is selected):
 *   1. project.domainKnowledge                          (project-level, edited per-project after creation)
 *   2. app:domainKnowledgeDefaults[domainId]             (app-level, set via App Settings → Domain Knowledge)
 *   3. DOMAIN_KNOWLEDGE_TEMPLATES[domainId]              (hardcoded starter template)
 *
 * Stored in the existing `settings` Dexie table under a single key so no schema migration is required.
 */
import { db } from '@/db/database';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from './domainKnowledgeTemplates';
import type { DomainId } from '@/types/domain.types';

const SETTINGS_KEY = 'app:domainKnowledgeDefaults';

export type DomainKnowledgeDefaultsMap = Partial<Record<DomainId, string>>;

/** Load the full app-level domain knowledge defaults map (empty object if none saved yet). */
export async function getDomainKnowledgeDefaults(): Promise<DomainKnowledgeDefaultsMap> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (row?.value && typeof row.value === 'object') {
    return row.value as DomainKnowledgeDefaultsMap;
  }
  return {};
}

/** Get the effective default brief for a domain: app-level override if set, else the hardcoded template. */
export async function getEffectiveDomainKnowledgeDefault(domainId: DomainId): Promise<string> {
  const defaults = await getDomainKnowledgeDefaults();
  return defaults[domainId] ?? DOMAIN_KNOWLEDGE_TEMPLATES[domainId] ?? '';
}

/** Save the app-level default Domain Knowledge brief for one domain. */
export async function saveDomainKnowledgeDefault(domainId: DomainId, brief: string): Promise<void> {
  const defaults = await getDomainKnowledgeDefaults();
  const next: DomainKnowledgeDefaultsMap = { ...defaults, [domainId]: brief };
  await db.settings.put({ key: SETTINGS_KEY, value: next });
}

/** Remove the app-level override for a domain, reverting it to the hardcoded template. */
export async function resetDomainKnowledgeDefault(domainId: DomainId): Promise<void> {
  const defaults = await getDomainKnowledgeDefaults();
  if (domainId in defaults) {
    const next = { ...defaults };
    delete next[domainId];
    await db.settings.put({ key: SETTINGS_KEY, value: next });
  }
}
