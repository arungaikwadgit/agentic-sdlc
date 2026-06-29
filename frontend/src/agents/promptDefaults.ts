/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
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
import type { LlmProvider } from '@/services/api';

const SETTINGS_KEY = 'app:promptDefaults';
const PROVIDER_HINTS_KEY = 'app:agentProviderHints';

export type PromptDefaultsMap = Partial<Record<AgentId, string>>;

/**
 * Per-agent LLM provider routing hints, e.g. { uxMockups: 'claude' }.
 * 'auto' (or missing) means "use the app default provider".
 * Resolved server-side in /api/agent via AGENT_PROVIDER_MAP, but also
 * surfaced here so the Settings UI can edit/save them.
 */
export type ProviderHint = LlmProvider | 'auto';
export type AgentProviderHintsMap = Partial<Record<AgentId, ProviderHint>>;

/** Load the app-level per-agent provider routing hints (empty object if none saved yet). */
export async function getAgentProviderHints(): Promise<AgentProviderHintsMap> {
  const row = await db.settings.get(PROVIDER_HINTS_KEY);
  if (row?.value && typeof row.value === 'object') {
    return row.value as AgentProviderHintsMap;
  }
  return {};
}

/** Save (or clear, via 'auto') the provider hint for one agent. */
export async function saveAgentProviderHint(agentId: AgentId, hint: ProviderHint): Promise<void> {
  const hints = await getAgentProviderHints();
  const next: AgentProviderHintsMap = { ...hints };
  if (hint === 'auto') {
    delete next[agentId];
  } else {
    next[agentId] = hint;
  }
  await db.settings.put({ key: PROVIDER_HINTS_KEY, value: next });
}

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

// ── Quality initialisation ────────────────────────────────────────────────────

const QUALITY_INIT_KEY = 'app:qualityDefaultsInitialized';

/**
 * Seeds commercial-grade UX quality defaults on first launch.
 * Only runs once — if the user has already customised an agent prompt
 * this will NOT overwrite it.
 * Called once from App.tsx on mount.
 */
// M-03 fix: module-level promise lock prevents double-seeding across concurrent
// calls (multiple browser tabs both calling initializeQualityDefaults on startup).
let _initPromise: Promise<void> | null = null;

export function initializeQualityDefaults(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = _doInit().finally(() => { _initPromise = null; });
  return _initPromise;
}

async function _doInit(): Promise<void> {
  const already = await db.settings.get(QUALITY_INIT_KEY);
  if (already?.value) return;

  const current = await getPromptDefaults();
  const updates: PromptDefaultsMap = {};

  // Only seed agents that haven't been customised yet
  const uxEnhancement = `\n\n## COMMERCIAL-GRADE UX MOCKUP REQUIREMENTS
Every HTML mockup you produce MUST meet ALL of the following:
1. STICKY NAVIGATION — top nav bar with brand logo, primary nav links, and a CTA button; must use position:sticky or position:fixed.
2. MINIMUM 4 DISTINCT FEATURE SECTIONS — each section must have a heading, real descriptive copy (no "Lorem ipsum"), and realistic data.
3. REAL DATA — use plausible names, metrics, dates, and values that match the project domain. Never use placeholder text.
4. STATUS BADGES & INDICATORS — at least one section must include status badges, progress bars, or metric cards with live-looking values.
5. PROFESSIONAL DESIGN SYSTEM — consistent spacing (8px grid), colour palette with primary/secondary/neutral tokens, Inter or system font stack.
6. RESPONSIVE LAYOUT — mobile-first CSS, minimum two breakpoints (mobile ≤ 768px, desktop ≥ 1024px).
7. INTERACTIVE ELEMENTS — hover states on buttons/cards, at least one modal or dropdown component.
8. FOOTER — with copyright year 2026, links, and contact info. Always use 2026 as the copyright year, never 2024 or 2025.
All sections must be self-contained in a single HTML file with embedded CSS and vanilla JS. No external dependencies beyond Google Fonts.`;

  if (!current['uxMockups']) {
    updates['uxMockups'] = (AGENT_DEFINITIONS['uxMockups']?.systemPrompt ?? '') + uxEnhancement;
  }

  if (Object.keys(updates).length > 0) {
    await db.settings.put({ key: SETTINGS_KEY, value: { ...current, ...updates } });
  }

  await db.settings.put({ key: QUALITY_INIT_KEY, value: true });
}
