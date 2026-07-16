/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Model catalog types — the admin-configurable list of LLMs (paid and free)
 * available for agents to run on. See frontend/src/agents/modelCatalog.ts for
 * the seed data and selection logic, and docs on the SDLC Orchestrator design
 * for why this exists: the orchestrator can't choose a model it can't see.
 */

/** What a model is good at — used to match a model to an agent's task tier. */
export type ModelCapability =
  | 'reasoning'
  | 'coding'
  | 'long-context'
  | 'structured-output'
  | 'tool-calling';

export type ModelCostTier = 'free' | 'low-cost' | 'paid';

/** How the proxy talks to this model. 'openai-compatible' covers any provider
 *  exposing an OpenAI-style chat completions endpoint (Hugging Face Inference
 *  Providers, Groq, OpenRouter, Together, Cerebras, etc.) via one generic branch
 *  instead of a bespoke integration per provider. */
export type ModelProviderType = 'openai' | 'anthropic' | 'openai-compatible';

export interface ModelRateLimits {
  requestsPerMinute?: number;
  requestsPerDay?: number;
}

export interface ModelCatalogEntry {
  /** Unique id used in ExecutionPlan.agentRunPlan[].assignedModel and by resolveModelForAgent(). */
  id: string;
  label: string;
  providerType: ModelProviderType;
  /** Required for 'openai-compatible'; the base URL of the OpenAI-style endpoint. */
  endpointUrl?: string;
  /** Name of the backend env var holding the API key for this entry — never the key itself. */
  apiKeyEnvVar?: string;
  costTier: ModelCostTier;
  contextWindow: number;
  capabilities: ModelCapability[];
  rateLimits?: ModelRateLimits;
  /** Free-text caveat surfaced in the admin UI, e.g. reliability/compliance notes. */
  reliabilityNote?: string;
  /** Admin opt-in switch. Defaults to false for newly added free/open models —
   *  see modelCatalog.ts DEFAULT_MODEL_CATALOG for the reasoning. */
  enabled: boolean;
}
