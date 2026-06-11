/**
 * App-level default system prompts per agent.
 *
 * Precedence (resolved in pipelineEngine.runAgent):
 *   1. project.promptOverrides[agentId].fullPrompt  (project-level, set via Review Gate "Save for this project")
 *   2. app:promptDefaults[agentId]                  (app-level, set via App Settings → Agent Prompts)
 *   3. AGENT_DEFINITIONS[agentId].systemPrompt      (hardcoded fallback)
 *
 * Stored in the existing `settings` Dexie table under a single key so no schema migration is required.
 */
import { db } from '@/db/database';
import { AGENT_DEFINITIONS } from './definitions';
import type { AgentId } from '@/types/agent.types';

const SETTINGS_KEY = 'app:promptDefaults';

export type PromptDefaultsMap = Partial<Record<AgentId, string>>;

/** Load the full app-level prompt defaults map (empty object if none saved yet). */
export async function getPromptDefaults(): Promise<PromptDefaultsMap> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (row?.value && typeof row.value === 'object') {
    return row.value as PromptDefaultsMap;
  }
  return {};
}

/** Get the effective default prompt for an agent: app-level override if set, else the hardcoded definition. */
export async function getEffectivePromptDefault(agentId: AgentId): Promise<string> {
  const defaults = await getPromptDefaults();
  return defaults[agentId] ?? AGENT_DEFINITIONS[agentId]?.systemPrompt ?? '';
}

/** Save (or clear, by passing the hardcoded default) the app-level default prompt for one agent. */
export async function savePromptDefault(agentId: AgentId, prompt: string): Promise<void> {
  const defaults = await getPromptDefaults();
  const next: PromptDefaultsMap = { ...defaults, [agentId]: prompt };
  await db.settings.put({ key: SETTINGS_KEY, value: next });
}

/** Remove the app-level override for an agent, reverting it to the hardcoded definition. */
export async function resetPromptDefault(agentId: AgentId): Promise<void> {
  const defaults = await getPromptDefaults();
  if (agentId in defaults) {
    const next = { ...defaults };
    delete next[agentId];
    await db.settings.put({ key: SETTINGS_KEY, value: next });
  }
}
