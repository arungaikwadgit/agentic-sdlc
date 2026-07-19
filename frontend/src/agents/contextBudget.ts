/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Context budget enforcement for prior-agent outputs.
 *
 * Added 2026-07-17. Before this file existed, the Token Optimizer Agent
 * (tokenOptimizer, phase0a) produced a "Progressive Context Plan" and
 * per-agent "maximum excerpt sizes" as free-text advice that NOTHING
 * consumed programmatically — every downstream agent still received every
 * completed prior agent's FULL, untrimmed output via
 * AgentPromptContext.priorOutputs (see buildAgentPromptContext() in
 * pipelineEngine.ts). A handful of agent definitions applied their own
 * ad hoc `.slice(0, N)` when hand-picking a specific dependency key inside
 * buildUserPrompt, but that only covered the keys each agent happened to
 * reference directly — the raw ctx.priorOutputs dict (and therefore the
 * get_agent_output L3 tool, which reads straight from it — see
 * agents/tools.ts) was never capped at all.
 *
 * This module makes tokenOptimizer's advice — and a safe fallback when
 * that advice isn't present or isn't parseable — actually enforced: every
 * entry in priorOutputs is capped before it reaches an agent, uniformly,
 * regardless of which specific prompt-building code path reads it.
 */
import { AGENT_DEFINITIONS } from './definitions';
import type { AgentId } from '@/types/agent.types';

/** Hard ceiling applied to any prior-agent output that has no more specific
 *  budget — chosen to sit at/below the largest ad hoc slice already in use
 *  (tokenOptimizer's own 8000-char read of sdlcOrchestrator) so this acts as
 *  a real global backstop, not just a no-op for the entries that already had
 *  manual slicing. ~1,250 tokens per entry. */
export const DEFAULT_MAX_PRIOR_OUTPUT_CHARS = 5000;

/** Absolute floor/ceiling for any per-agent override — even a tokenOptimizer
 *  recommendation this large or this small is clamped, so a mis-parsed
 *  number (or a deliberately extreme recommendation) can't zero out an
 *  agent's context or blow the budget back open. */
const MIN_BUDGET_CHARS = 500;
const MAX_BUDGET_CHARS = 20_000;

function clamp(n: number): number {
  return Math.min(MAX_BUDGET_CHARS, Math.max(MIN_BUDGET_CHARS, Math.round(n)));
}

/**
 * Truncate a single prior-output string to a character budget, keeping the
 * beginning (documents front-load their most load-bearing content — titles,
 * summaries, key decisions) and appending a visible marker so truncation is
 * debuggable rather than silent.
 */
export function trimPriorOutputText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  return `${kept}\n\n[...truncated ${text.length - maxChars} of ${text.length} characters to control token usage — use the get_agent_output tool for more if this agent has it]`;
}

/**
 * Best-effort parse of tokenOptimizer's "Progressive Context Plan" section
 * for explicit per-agent excerpt-size recommendations (e.g. "Architecture
 * Agent: max 3,000 characters" or "PRD Agent — 800 words"). This is prose
 * written by an LLM, not a structured schema, so failure to find a number
 * for a given agent is the expected common case, not an error — callers
 * must always have DEFAULT_MAX_PRIOR_OUTPUT_CHARS as a fallback. Never
 * throws; returns {} if the plan is missing or nothing parses.
 */
export function parseTokenOptimizerBudgets(
  tokenOptimizerOutput: string | undefined
): Partial<Record<AgentId, number>> {
  const result: Partial<Record<AgentId, number>> = {};
  if (!tokenOptimizerOutput) return result;

  // Scope to the Progressive Context Plan section if present, so a number
  // mentioned elsewhere (e.g. in the Workload Baseline) isn't mistaken for
  // an excerpt-size recommendation.
  const sectionMatch = tokenOptimizerOutput.match(
    /Progressive Context Plan[\s\S]*?(?=\n#{1,3}\s|\n\d\.\s|$)/i
  );
  const scope = sectionMatch ? sectionMatch[0] : tokenOptimizerOutput;

  for (const def of Object.values(AGENT_DEFINITIONS)) {
    // Try both the display name ("Architecture Agent") and output label
    // ("Architecture") — tokenOptimizer's prose may use either.
    const labels = [def.name, def.outputLabel].filter(Boolean) as string[];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Look for "<label> ... <number> (characters|chars|words|tokens)" within ~120 chars of the label.
      const re = new RegExp(`${escaped}[^\\n]{0,120}?(\\d[\\d,]{2,6})\\s*(characters?|chars?|words?|tokens?)`, 'i');
      const m = scope.match(re);
      if (m) {
        const raw = parseInt(m[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(raw) && raw > 0) {
          const unit = m[2].toLowerCase();
          // Normalize to characters: words/tokens are ~4-6 chars each on average.
          const chars = unit.startsWith('word') ? raw * 6 : unit.startsWith('token') ? raw * 4 : raw;
          result[def.id] = clamp(chars);
          break;
        }
      }
    }
  }
  return result;
}

/**
 * Apply the context budget to a full priorOutputs dict, returning a new
 * dict — never mutates the input. Per-agent overrides (from a parsed
 * tokenOptimizer plan) win when present; every other entry falls back to
 * DEFAULT_MAX_PRIOR_OUTPUT_CHARS.
 */
export function applyContextBudget(
  priorOutputs: Partial<Record<AgentId, string>>,
  overrides: Partial<Record<AgentId, number>> = {}
): Partial<Record<AgentId, string>> {
  const result: Partial<Record<AgentId, string>> = {};
  for (const [id, text] of Object.entries(priorOutputs)) {
    if (text === undefined) continue;
    const budget = overrides[id as AgentId] ?? DEFAULT_MAX_PRIOR_OUTPUT_CHARS;
    result[id as AgentId] = trimPriorOutputText(text, budget);
  }
  return result;
}


/** When a durable memory digest already represents an output, keep only a
 * compact excerpt of that raw artifact. Direct dependencies retain more
 * detail; indirect context is reduced aggressively. This avoids paying for
 * both the full prior artifact and its memory summary on every rerun. */
export function applyMemoryAwareContextBudget(
  priorOutputs: Partial<Record<AgentId, string>>,
  overrides: Partial<Record<AgentId, number>>,
  coveredAgentKeys: readonly AgentId[],
  directDependencyKeys: readonly AgentId[],
): Partial<Record<AgentId, string>> {
  const covered = new Set(coveredAgentKeys);
  const direct = new Set(directDependencyKeys);
  const memoryOverrides: Partial<Record<AgentId, number>> = { ...overrides };

  for (const id of Object.keys(priorOutputs) as AgentId[]) {
    if (!covered.has(id)) continue;
    const memoryBudget = direct.has(id) ? 2_000 : 800;
    memoryOverrides[id] = Math.min(memoryOverrides[id] ?? DEFAULT_MAX_PRIOR_OUTPUT_CHARS, memoryBudget);
  }

  return applyContextBudget(priorOutputs, memoryOverrides);
}
