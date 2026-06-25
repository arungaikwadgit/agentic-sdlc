/**
 * AI Eval Harness — Eval Runner
 *
 * Orchestrates scoring for a single agent output:
 *  1. Runs all applicable scorers
 *  2. Checks injection resistance if a probe is present
 *  3. Aggregates into AgentEvalResult
 *  4. Applies thresholds and sets overallPass
 *
 * This module is provider-agnostic. In real eval runs, you supply the
 * `output` string (from a real LLM call) and `tokensUsed` (from the API
 * response). For unit tests, a mock output is used (see eval.test.ts).
 */

import {
  scoreFactualGrounding,
  scoreCompleteness,
  scoreInjectionResistance,
  scoreCostGuard,
  scoreFormatCompliance,
} from './scorers.js';
import type {
  AgentEvalResult,
  CategoryScore,
  EvalThreshold,
  GoldenFixture,
} from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';

export interface RunEvalOptions {
  fixture: GoldenFixture;
  output: string;
  tokensUsed: number;
  provider?: 'openai' | 'anthropic' | 'mock';
  model?: string;
  thresholds?: Partial<EvalThreshold>;
  /**
   * If fixture has an injectionProbe, pass the output produced when the
   * probe was injected. Leave undefined to skip injection resistance check.
   */
  injectedOutput?: string;
}

export function runEval(opts: RunEvalOptions): AgentEvalResult {
  const {
    fixture,
    output,
    tokensUsed,
    provider = 'mock',
    model = 'mock',
    thresholds: overrides = {},
    injectedOutput,
  } = opts;

  const thresholds: EvalThreshold = { ...DEFAULT_THRESHOLDS, ...overrides };
  const scores: CategoryScore[] = [];

  // 1. Factual grounding
  scores.push(scoreFactualGrounding(output, fixture, thresholds.factual_grounding));

  // 2. Completeness
  scores.push(scoreCompleteness(output, fixture, thresholds.completeness));

  // 3. Injection resistance (only if probe and injectedOutput supplied)
  if (fixture.injectionProbe && injectedOutput !== undefined) {
    scores.push(
      scoreInjectionResistance(injectedOutput, fixture.injectionProbe, 'PWNED')
    );
  }

  // 4. Cost guard
  scores.push(scoreCostGuard(tokensUsed, fixture.tokenBudget, thresholds.cost_guard_multiplier));

  // 5. Format compliance
  scores.push(scoreFormatCompliance(output, thresholds.format_compliance));

  const overallPass = scores.every((s) => s.passed);

  return {
    agentId: fixture.agentId,
    fixtureName: fixture.name,
    timestamp: new Date().toISOString(),
    provider,
    model,
    tokensUsed,
    tokenBudget: fixture.tokenBudget,
    scores,
    overallPass,
    outputSnippet: output.slice(0, 2000),
  };
}

/**
 * Pretty-print a single eval result to the console.
 * Used by the CLI runner.
 */
export function printResult(result: AgentEvalResult): void {
  const status = result.overallPass ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status}  ${result.agentId} / ${result.fixtureName}`);
  console.log(`  Provider: ${result.provider} | Model: ${result.model}`);
  console.log(`  Tokens: ${result.tokensUsed} / budget ${result.tokenBudget}`);
  for (const s of result.scores) {
    const mark = s.passed ? '  ✓' : '  ✗';
    console.log(`${mark} [${s.category}] score=${s.score.toFixed(2)} — ${s.detail}`);
  }
}

/**
 * Aggregate multiple results into a summary line.
 */
export function summarizeResults(results: AgentEvalResult[]): void {
  const passed = results.filter((r) => r.overallPass).length;
  const failed = results.length - passed;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Eval summary: ${passed} passed, ${failed} failed (${results.length} total)`);

  if (failed > 0) {
    console.log('\nFailed agents:');
    for (const r of results.filter((r) => !r.overallPass)) {
      const failedCats = r.scores.filter((s) => !s.passed).map((s) => s.category);
      console.log(`  ✗ ${r.agentId} — ${failedCats.join(', ')}`);
    }
    process.exit(1);
  }
}
