/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Model Catalog — the admin-configurable list of models (paid + free/open)
 * an agent can be assigned to run on.
 *
 * DEFAULT_MODEL_CATALOG below is a seed only. The long-term source of truth
 * is meant to be the admin "Models" settings screen (Step 0 of the SDLC
 * Orchestrator agentic plan) persisted the same way AGENT_PROVIDER_MAP is
 * today — that persistence layer is NOT built yet. Until it exists,
 * PipelineEngine.buildContext() reads this static array directly.
 *
 * Free/open entries default to enabled:false deliberately. Rate limits on
 * free tiers (as low as 20 requests/minute on some gateways) and unverified
 * tool-call/structured-output compliance are real risks for this app's L3
 * runtime, which depends on the model reliably emitting TOOL_CALL/
 * FINAL_OUTPUT markers. An admin has to opt in per model, not get it by
 * default. See resolveModelForAgent() below for the "fall back to whatever
 * IS available" behavior requested for rate-limit handling.
 */
import type { ModelCapability, ModelCatalogEntry, ModelCostTier } from '@/types/model.types';

export const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [
  // ── Paid, already wired through proxy.js's existing provider routing ──────
  {
    id: 'anthropic-default',
    label: 'Claude (configured default)',
    providerType: 'anthropic',
    costTier: 'paid',
    contextWindow: 200_000,
    capabilities: ['reasoning', 'coding', 'long-context', 'structured-output', 'tool-calling'],
    enabled: true,
    reliabilityNote: 'Resolves to whatever ANTHROPIC_MODEL is set to on the backend. Fix the stale/inconsistent default there (proxy.js lines ~184 and ~1191) before relying on this for deep-reasoning agents.',
  },
  {
    id: 'openai-default',
    label: 'OpenAI (configured default)',
    providerType: 'openai',
    costTier: 'paid',
    contextWindow: 128_000,
    capabilities: ['reasoning', 'coding', 'structured-output', 'tool-calling'],
    enabled: true,
    reliabilityNote: 'Resolves to whatever OPENAI_MODEL is set to on the backend (currently defaults to the stale "gpt-4o" — worth updating).',
  },

  // ── Free/open, via a generic OpenAI-compatible gateway branch (not yet ────
  // ── built in proxy.js — see the backend note in this file's header) ──────
  {
    id: 'qwen3-coder-480b',
    label: 'Qwen3-Coder-480B-A35B (free)',
    providerType: 'openai-compatible',
    endpointUrl: undefined, // set to the chosen gateway's OpenAI-compatible base URL (OpenRouter, HF Inference Providers, etc.)
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    costTier: 'free',
    contextWindow: 256_000,
    capabilities: ['coding'],
    rateLimits: { requestsPerMinute: 20, requestsPerDay: 50 },
    enabled: false,
    reliabilityNote: 'Best open coding model on SWE-bench Verified as of mid-2026 (~70%). Confirm the exact model slug against your chosen gateway before enabling — slugs differ per gateway for the same underlying model. Best fit: codeSnippets, workingPrototype.',
  },
  {
    id: 'glm-5.2',
    label: 'GLM-5.2 (free)',
    providerType: 'openai-compatible',
    endpointUrl: undefined,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    costTier: 'free',
    contextWindow: 128_000,
    capabilities: ['reasoning', 'coding'],
    rateLimits: { requestsPerMinute: 20, requestsPerDay: 50 },
    enabled: false,
    reliabilityNote: 'Leads open-weight models on general reasoning/agentic benchmarks as of mid-2026. Reasonable candidate for standard-tier document agents once enabled and verified.',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash (free, Google AI Studio)',
    providerType: 'openai-compatible',
    endpointUrl: undefined,
    apiKeyEnvVar: 'GOOGLE_AI_STUDIO_API_KEY',
    costTier: 'free',
    contextWindow: 1_000_000,
    capabilities: ['long-context', 'structured-output'],
    rateLimits: { requestsPerMinute: 60 },
    enabled: false,
    reliabilityNote: 'Most generous free tier found (60 RPM, no credit card, 1M context). Best free candidate for high-volume standard-tier work if Google AI Studio\'s API is acceptable for this deployment.',
  },
  {
    id: 'llama-4-scout',
    label: 'Llama 4 Scout (free)',
    providerType: 'openai-compatible',
    endpointUrl: undefined,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    costTier: 'free',
    contextWindow: 10_000_000,
    capabilities: ['long-context'],
    rateLimits: { requestsPerMinute: 20, requestsPerDay: 50 },
    enabled: false,
    reliabilityNote: 'Longest context window of anything reviewed. Candidate for sdlcOrchestrator itself, which reads the most prior context, once enabled and verified.',
  },
];

const COST_TIER_PREFERENCE: Record<ModelCostTier, number> = { paid: 0, 'low-cost': 1, free: 2 };

/**
 * Picks a model for an agent to run on, per the "default to the available
 * model as available" rule: try the preferred model, fall back to the best
 * enabled model matching the required capabilities, and only if nothing
 * matches capabilities, fall back to any enabled model at all. Never returns
 * undefined unless the entire catalog is disabled — that's a real config
 * error the caller should surface, not silently swallow.
 *
 * `unavailableIds` is for runtime rate-limit/failure tracking (e.g. a caller
 * that just got a 429 from a specific model can pass its id here to force
 * the resolver past it on the next attempt). No live rate-limit tracker
 * exists yet — this parameter is the hook for Step 2's retry logic to use
 * once it does.
 */
export function resolveModelForAgent(
  catalog: ModelCatalogEntry[],
  preferredModelId: string | undefined,
  requiredCapabilities: ModelCapability[] = [],
  unavailableIds: Set<string> = new Set(),
): ModelCatalogEntry | undefined {
  const candidates = catalog.filter((m) => m.enabled && !unavailableIds.has(m.id));
  if (candidates.length === 0) return undefined;

  if (preferredModelId) {
    const exact = candidates.find((m) => m.id === preferredModelId);
    if (exact) return exact;
  }

  const byCostTier = (a: ModelCatalogEntry, b: ModelCatalogEntry) =>
    COST_TIER_PREFERENCE[a.costTier] - COST_TIER_PREFERENCE[b.costTier];

  const capable = candidates.filter((m) => requiredCapabilities.every((c) => m.capabilities.includes(c)));
  if (capable.length > 0) return [...capable].sort(byCostTier)[0];

  // Nothing matches the requested capabilities exactly — still return the
  // best available rather than blocking the agent entirely.
  return [...candidates].sort(byCostTier)[0];
}
