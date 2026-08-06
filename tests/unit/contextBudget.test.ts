/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Real enforcement of the input side of token usage (2026-07-17): before
// this module existed, every agent received every completed prior agent's
// FULL, untrimmed output via AgentPromptContext.priorOutputs — the Token
// Optimizer Agent's "Progressive Context Plan" recommendations were pure
// advisory text nothing consumed. See agents/contextBudget.ts.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_PRIOR_OUTPUT_CHARS,
  trimPriorOutputText,
  applyContextBudget,
  applyMemoryAwareContextBudget,
  parseTokenOptimizerBudgets,
} from '../../frontend/src/agents/contextBudget';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

describe('trimPriorOutputText', () => {
  it('returns short text unchanged', () => {
    const text = 'short output';
    expect(trimPriorOutputText(text, 5000)).toBe(text);
  });

  it('truncates text over the budget and appends a visible marker', () => {
    const text = 'x'.repeat(6000);
    const result = trimPriorOutputText(text, 5000);
    expect(result.length).toBeGreaterThan(5000); // includes the marker
    expect(result.startsWith('x'.repeat(5000))).toBe(true);
    expect(result).toContain('[...truncated 1000 of 6000 characters');
  });

  it('does not truncate text exactly at the budget', () => {
    const text = 'y'.repeat(5000);
    expect(trimPriorOutputText(text, 5000)).toBe(text);
  });
});

describe('applyContextBudget', () => {
  it('caps every entry to the default budget when no overrides are given', () => {
    const priorOutputs = {
      architecture: 'a'.repeat(10_000),
      userStory: 'short',
    } as Record<string, string>;

    const result = applyContextBudget(priorOutputs as never);
    expect(result.architecture!.length).toBeLessThanOrEqual(
      DEFAULT_MAX_PRIOR_OUTPUT_CHARS + 200 // + truncation marker
    );
    expect(result.architecture!.startsWith('a'.repeat(DEFAULT_MAX_PRIOR_OUTPUT_CHARS))).toBe(true);
    expect(result.userStory).toBe('short'); // untouched, well under budget
  });

  it('applies a per-agent override when supplied, in preference to the default', () => {
    const priorOutputs = { architecture: 'b'.repeat(10_000) } as Record<string, string>;
    const result = applyContextBudget(priorOutputs as never, { architecture: 1000 } as never);
    expect(result.architecture!.startsWith('b'.repeat(1000))).toBe(true);
    expect(result.architecture!.length).toBeLessThan(DEFAULT_MAX_PRIOR_OUTPUT_CHARS);
  });

  it('does not mutate the input object', () => {
    const priorOutputs = { architecture: 'c'.repeat(10_000) } as Record<string, string>;
    const original = priorOutputs.architecture;
    applyContextBudget(priorOutputs as never);
    expect(priorOutputs.architecture).toBe(original);
  });

  it('skips undefined entries', () => {
    const priorOutputs = { architecture: undefined, userStory: 'hi' } as Record<string, string | undefined>;
    const result = applyContextBudget(priorOutputs as never);
    expect(result.architecture).toBeUndefined();
    expect(result.userStory).toBe('hi');
  });
});

describe('parseTokenOptimizerBudgets', () => {
  it('returns {} when there is no tokenOptimizer output', () => {
    expect(parseTokenOptimizerBudgets(undefined)).toEqual({});
  });

  it('returns {} when the output has no parseable per-agent excerpt sizes (the common case)', () => {
    const prose =
      '## 3. Progressive Context Plan\n' +
      'Agents should receive only what they need, retrieving more on demand via get_agent_output. ' +
      'Prefer summaries over full documents where possible.';
    expect(parseTokenOptimizerBudgets(prose)).toEqual({});
  });

  it('extracts a per-agent character budget when explicitly stated near the agent name', () => {
    const arch = Object.values(AGENT_DEFINITIONS).find((d) => d.id === 'architecture')!;
    const prose =
      `## 3. Progressive Context Plan\n` +
      `${arch.name}: max 1,200 characters of prior context is sufficient given its narrow dependency set.\n`;
    const budgets = parseTokenOptimizerBudgets(prose);
    expect(budgets.architecture).toBe(1200);
  });

  it('converts a word-based recommendation to a clamped character estimate', () => {
    const arch = Object.values(AGENT_DEFINITIONS).find((d) => d.id === 'architecture')!;
    const prose = `## 3. Progressive Context Plan\n${arch.name} — limit to 100 words of prior context.\n`;
    const budgets = parseTokenOptimizerBudgets(prose);
    // 100 words * 6 chars/word = 600, clamped up to the 500-char floor is a no-op here.
    expect(budgets.architecture).toBe(600);
  });

  it('clamps an absurdly large recommendation to the safety ceiling', () => {
    const arch = Object.values(AGENT_DEFINITIONS).find((d) => d.id === 'architecture')!;
    const prose = `## 3. Progressive Context Plan\n${arch.name}: 500000 characters recommended.\n`;
    const budgets = parseTokenOptimizerBudgets(prose);
    expect(budgets.architecture).toBe(20_000);
  });

  it('never throws on malformed/empty input', () => {
    expect(() => parseTokenOptimizerBudgets('')).not.toThrow();
    expect(() => parseTokenOptimizerBudgets('   ')).not.toThrow();
    expect(parseTokenOptimizerBudgets('')).toEqual({});
  });
});


describe('applyMemoryAwareContextBudget', () => {
  it('uses a compact excerpt for memory-covered indirect outputs', () => {
    const output = 'x'.repeat(10_000);
    const result = applyMemoryAwareContextBudget(
      { architecture: output } as never,
      {},
      ['architecture'] as never,
      [],
    );
    expect(result.architecture).toContain('[...truncated');
    expect(result.architecture!.length).toBeLessThan(1_050);
  });

  it('retains a larger excerpt for a direct dependency', () => {
    const output = 'x'.repeat(10_000);
    const result = applyMemoryAwareContextBudget(
      { architecture: output } as never,
      {},
      ['architecture'] as never,
      ['architecture'] as never,
    );
    expect(result.architecture!.length).toBeGreaterThan(1_900);
    expect(result.architecture!.length).toBeLessThan(2_200);
  });

  it('does not tighten outputs that have no durable memory coverage', () => {
    const output = 'x'.repeat(10_000);
    const result = applyMemoryAwareContextBudget(
      { architecture: output } as never,
      {},
      [],
      ['architecture'] as never,
    );
    expect(result.architecture!.startsWith('x'.repeat(DEFAULT_MAX_PRIOR_OUTPUT_CHARS))).toBe(true);
  });
});
