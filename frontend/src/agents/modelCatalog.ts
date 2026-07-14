/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Model Catalog — the admin-configurable list of models (paid + free/open)
 * an agent can be assigned to run on.
 *
 * DEFAULT_MODEL_CATALOG below is a seed. The admin-editable source of truth
 * is now the 'app:modelCatalog' app-state config key (see App Settings →
 * AI Providers → Models), persisted the same DB-backed way as
 * 'app:agentProviderHints' — see promptDefaults.ts. This array is the
 * fallback used to seed that config the first time it's loaded and read
 * directly by PipelineEngine.buildContext() until then.
 *
 * Free/open entries default to enabled:false deliberately. Unverified
 * tool-call/structured-output compliance for a given model+task combo is a
 * real risk for this app's L3 runtime, which depends on the model reliably
 * emitting TOOL_CALL/FINAL_OUTPUT markers. An admin has to opt in per model,
 * not get it by default. See resolveModelForAgent() below for the "fall
 * back to whatever IS available" behavior requested for outage/rate-limit
 * handling, and dispatchAgentCall() in backend/src/proxy.js for the
 * automatic one-shot fallback to the default OpenAI model on any failure.
 *
 * Hugging Face Inference Providers entries below route through
 * providerType: 'openai-compatible' against https://router.huggingface.co/v1
 * (OpenAI-SDK-compatible chat-completions endpoint), authenticated via
 * HUGGINGFACE_API_KEY (a fine-grained HF token with "Make calls to
 * Inference Providers" permission). Free-tier access is credit-based
 * ($0.10/month included for free HF accounts), not a fixed requests/minute
 * cap — the earlier placeholder rateLimits on these entries were wrong and
 * have been removed. `id` follows HF's "<org>/<model>:<provider>" routing
 * convention; pinning an explicit `:provider` suffix (rather than omitting
 * it for auto/`:fastest` routing) is HF's own recommendation when
 * tool-calling reliability matters, since it varies by upstream provider.
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

  // ── Free/open, via Hugging Face Inference Providers (OpenAI-compatible) ──
  // id follows HF's "<org>/<model>:<provider>" routing convention. All
  // entries route through callOpenAiCompatible() in proxy.js once an admin
  // sets HUGGINGFACE_API_KEY and enables the entry — see this file's header
  // comment for what's independently verified vs. what an admin should
  // confirm against HF's live model listing before enabling.
  {
    id: 'openai/gpt-oss-120b:fastest',
    label: 'GPT-OSS-120B (Hugging Face, free)',
    providerType: 'openai-compatible',
    endpointUrl: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    costTier: 'free',
    contextWindow: 128_000,
    capabilities: ['reasoning', 'coding', 'tool-calling'],
    enabled: false,
    reliabilityNote: 'Hugging Face\'s own recommendation for reliable tool-calling among open models — this app\'s L3 runtime depends on that (TOOL_CALL/FINAL_OUTPUT markers). Best first candidate to enable and verify against a low-stakes agent before wider rollout.',
  },
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct:fastest',
    label: 'Qwen3-Coder-480B (Hugging Face, free)',
    providerType: 'openai-compatible',
    endpointUrl: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    costTier: 'free',
    contextWindow: 256_000,
    capabilities: ['coding'],
    enabled: false,
    reliabilityNote: 'Coding-specialist open model. Confirm this exact model id is still live on HF\'s router before enabling — HF\'s hosted catalog changes over time. Best fit: codeSnippets, workingPrototype agents (not tool-calling/L3 agents until verified).',
  },
  {
    id: 'zai-org/glm-4.6:fastest',
    label: 'GLM-4.6 (Hugging Face, free)',
    providerType: 'openai-compatible',
    endpointUrl: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    costTier: 'free',
    contextWindow: 128_000,
    capabilities: ['reasoning', 'coding'],
    enabled: false,
    reliabilityNote: 'General reasoning/agentic open model. Confirm this exact model id is still live on HF\'s router before enabling. Reasonable candidate for standard-tier document agents once verified.',
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct:fastest',
    label: 'Llama 4 Scout (Hugging Face, free)',
    providerType: 'openai-compatible',
    endpointUrl: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    costTier: 'free',
    contextWindow: 10_000_000,
    capabilities: ['long-context'],
    enabled: false,
    reliabilityNote: 'Longest context window of anything reviewed — candidate for sdlcOrchestrator itself, which reads the most prior context. Confirm this exact model id is still live on HF\'s router before enabling.',
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
    reliabilityNote: 'Not a Hugging Face model — kept as a non-HF free alternative. Most generous free tier found (60 RPM, no credit card, 1M context) but Google\'s native API is not OpenAI-compatible, so endpointUrl needs an actual OpenAI-compatible proxy in front of it before this entry can work as configured.',
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
