/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * L3 Agent Runtime
 *
 * Upgrades agents from L2 (single-shot prompt -> output) to L3:
 *   Plan -> Act (tool calls) -> Observe (tool results) -> Revise plan -> Repeat -> Finalise
 *
 * L3 loop phases per iteration:
 *   1. PLAN   - LLM receives goal + tools + prior context, emits a plan + first action
 *   2. ACT    - Runtime executes the tool call, appends result to conversation
 *   3. OBSERVE- LLM sees tool result, decides: call another tool OR output final answer
 *   4. REVISE - If LLM reformulates plan, record PlanRevision; loop continues
 *   5. DONE   - LLM emits FINAL_OUTPUT marker or maxIterations reached
 *
 * The loop is entirely prompt-driven: the LLM uses structured markers in its
 * responses to signal what phase it is in. This approach works with any LLM
 * provider (OpenAI or Claude) without requiring native function-calling APIs.
 *
 * Protocol markers (LLM must emit these in its responses):
 *   TOOL_CALL: <tool_name> <JSON args on next line>
 *   PLAN_REVISION: <reason on next line> | STEPS: <numbered list>
 *   FINAL_OUTPUT: <everything after this line is the deliverable>
 *
 * If none of those markers are found, the full response is treated as FINAL_OUTPUT
 * (graceful degradation to L2 behaviour).
 */

import { api, getAuthHeader } from './api';
import { assessGovernedOutput } from './outputGovernance';
import { hasMermaidDiagram } from '@/agents/diagramUtils';
import type {
  AgentDefinition,
  AgentPromptContext,
  AgentTool,
  ToolTraceEntry,
  PlanRevision,
  AgentDecision,
  L3RuntimeMeta,
} from '@/types/agent.types';

// --- Types -------------------------------------------------------------------

export interface L3RunOptions {
  systemPrompt: string;
  userPrompt: string;
  agentId: string;
  /** 'openai', 'claude', or a MODEL_CATALOG entry id (e.g. an assigned Hugging Face model) — see AgentRequest.provider in api.ts. */
  provider?: 'openai' | 'claude' | (string & {});
  /** Forwarded to every api.callAgent call in the L3 loop so the backend's per-agent authorizeAgentRun() check has a project to check against. */
  projectId?: string;
}

export interface L3RunResult {
  output: string;
  tokensUsed: number;
  provider?: 'openai' | 'claude' | 'openai-compatible';
  model?: string;
  l3: L3RuntimeMeta;
}

// --- Marker constants --------------------------------------------------------

const MARKER_TOOL_CALL    = 'TOOL_CALL:';
const MARKER_PLAN_REVISED = 'PLAN_REVISION:';
const MARKER_FINAL_OUTPUT = 'FINAL_OUTPUT:';
const MARKER_STEPS        = 'STEPS:';
// AI Governance MVP-0 (2026-07-21) -- see agents/definitions.ts's aiGovernance
// section 12 and govern-ai-gap-assessment-and-implementation-plan.md, F1.
const MARKER_GOVERNANCE_DECISION_JSON = 'GOVERNANCE_DECISION_JSON:';

// --- Prompt builders ---------------------------------------------------------

function buildToolsBlock(tools: AgentTool[]): string {
  if (tools.length === 0) return '';
  const entries = tools.map((t) => {
    const params = Object.entries(
      (t.inputSchema as { properties?: Record<string, { type: string; description?: string }> })
        .properties ?? {}
    )
      .map(([k, v]) => `    - ${k} (${v.type}): ${v.description ?? ''}`)
      .join('\n');
    return `### ${t.name}\n${t.description}\nParameters:\n${params || '    (none)'}`;
  });

  return `
## Available Tools
You have access to the following tools. Call them to gather information before writing your final output.

${entries.join('\n\n')}

## How to use tools
When you want to call a tool, emit EXACTLY this format (nothing before or after on those lines):

TOOL_CALL: <tool_name>
{"arg1": "value1", "arg2": "value2"}

You may call multiple tools across iterations - call one per response.

## How to revise your plan
If after seeing tool results you need to change your approach, emit:

PLAN_REVISION: <one-line reason>
STEPS: 1. <step> 2. <step> 3. <step> ...

## How to deliver your final output
When you have gathered enough information and are ready to write the final document, emit:

FINAL_OUTPUT:
<your complete document here>

Everything after FINAL_OUTPUT: is the deliverable. Do not include any markers inside the document itself.
`;
}

function buildL3SystemPrompt(
  originalSystemPrompt: string,
  goal: string,
  tools: AgentTool[],
  initialPlanSteps: string[]
): string {
  const toolsBlock = buildToolsBlock(tools);
  const planBlock =
    initialPlanSteps.length > 0
      ? `\n## Your Initial Plan\n${initialPlanSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
      : '';

  return `${originalSystemPrompt}

=====================================
## L3 AGENT MODE
You are operating as an L3 autonomous agent. You do NOT just respond immediately - you first plan, then gather information using tools, then write your output.

## Your Goal
${goal}

${planBlock}${toolsBlock}

## Execution Rules
- Start by calling the tools most relevant to your goal.
- After each tool result, decide: do you have enough information? If yes, emit FINAL_OUTPUT. If not, call another tool or revise your plan.
- Do NOT produce the final document until you have called at least one tool (or have confirmed prior context is sufficient).
- Your final document (after FINAL_OUTPUT:) must be complete, not a summary.
- Maximum iterations: you will be reminded when you are approaching the limit.
=====================================`;
}

// --- Response parser ---------------------------------------------------------

interface ParsedResponse {
  type: 'tool_call' | 'plan_revision' | 'final_output' | 'passthrough';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  planReason?: string;
  planSteps?: string[];
  finalOutput?: string;
  rawText: string;
}

function parseResponse(text: string): ParsedResponse {
  const lines = text.split('\n');

  // Check for FINAL_OUTPUT marker
  const finalIdx = lines.findIndex((l) => l.trim().startsWith(MARKER_FINAL_OUTPUT));
  if (finalIdx !== -1) {
    return {
      type: 'final_output',
      finalOutput: lines.slice(finalIdx + 1).join('\n').trim(),
      rawText: text,
    };
  }

  // Check for TOOL_CALL marker
  const toolIdx = lines.findIndex((l) => l.trim().startsWith(MARKER_TOOL_CALL));
  if (toolIdx !== -1) {
    const toolLine = lines[toolIdx].trim().slice(MARKER_TOOL_CALL.length).trim();
    const argsLine = lines.slice(toolIdx + 1).find((l) => l.trim().startsWith('{'));
    let toolArgs: Record<string, unknown> = {};
    if (argsLine) {
      try { toolArgs = JSON.parse(argsLine.trim()); } catch { /* ignore */ }
    }
    return {
      type: 'tool_call',
      toolName: toolLine,
      toolArgs,
      rawText: text,
    };
  }

  // Check for PLAN_REVISION marker
  const planIdx = lines.findIndex((l) => l.trim().startsWith(MARKER_PLAN_REVISED));
  if (planIdx !== -1) {
    const reason = lines[planIdx].trim().slice(MARKER_PLAN_REVISED.length).trim();
    const stepsLine = lines.slice(planIdx + 1).find((l) => l.includes(MARKER_STEPS));
    let steps: string[] = [];
    if (stepsLine) {
      const raw = stepsLine.slice(stepsLine.indexOf(MARKER_STEPS) + MARKER_STEPS.length);
      steps = raw
        .split(/\d+\.\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return {
      type: 'plan_revision',
      planReason: reason,
      planSteps: steps,
      rawText: text,
    };
  }

  // Passthrough - treat full text as final output (graceful L2 degradation)
  return { type: 'passthrough', finalOutput: text.trim(), rawText: text };
}

// --- Rate-limit retry wrapper ------------------------------------------------

/**
 * Parse the suggested retry-after seconds from a 429 error message.
 * OpenAI embeds "Please try again in Xs" in the error body.
 */
function parse429WaitMs(errorMsg: string): number {
  const match = errorMsg.match(/try again in (\d+(?:\.\d+)?)(s| seconds?)/i);
  if (match) {
    return Math.ceil(parseFloat(match[1])) * 1000 + 500; // add 500ms buffer
  }
  return 10_000; // default: 10s
}

async function callWithRetry(
  req: Parameters<typeof api.callAgent>[0],
  maxAttempts = 3
): Promise<Awaited<ReturnType<typeof api.callAgent>>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await api.callAgent(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429');
      if (is429 && attempt < maxAttempts) {
        const waitMs = parse429WaitMs(msg);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  // Unreachable but TypeScript needs a return
  throw new Error('callWithRetry: exceeded max attempts');
}

// --- AI Governance decision extraction (MVP-0, 2026-07-21) -------------------
// See agents/definitions.ts's aiGovernance section 12 (the
// GOVERNANCE_DECISION_JSON block it's instructed to emit) and
// govern-ai-gap-assessment-and-implementation-plan.md, finding F1: today's
// Governance Decision is free text inside a prose report nothing else reads.
// This is the other half — pulling that structured block back out of
// FINAL_OUTPUT and persisting it via backend/src/routes/governance.js, which
// is what actually gives Gate 0 something to enforce against.

interface ParsedGovernanceFinding {
  controlId: string;
  severity: string;
  gap?: string;
  recommendation?: string;
  ownerRole?: string;
}

interface ParsedGovernanceDecision {
  decision: string;
  riskTier: string;
  confidence?: number;
  decisionReason?: string;
  findings: ParsedGovernanceFinding[];
}

/**
 * Finds the MARKER_GOVERNANCE_DECISION_JSON marker in `text`, then brace-
 * matches (tracking quoted-string state so braces inside string values don't
 * throw off the count) to find the JSON object that follows it — more
 * robust than assuming the block is single-line or relying on a markdown
 * code fence the model was explicitly told not to add. Returns null if the
 * marker is missing, the JSON doesn't parse, or required fields are absent —
 * any of which should be treated as "no decision produced", not a crash.
 */
function extractGovernanceDecisionBlock(
  text: string
): { decision: ParsedGovernanceDecision; strippedOutput: string } | null {
  const markerIdx = text.indexOf(MARKER_GOVERNANCE_DECISION_JSON);
  if (markerIdx === -1) return null;

  const afterMarker = text.slice(markerIdx + MARKER_GOVERNANCE_DECISION_JSON.length);
  const braceStart = afterMarker.indexOf('{');
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = -1;
  for (let i = braceStart; i < afterMarker.length; i++) {
    const ch = afterMarker[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return null;

  const jsonStr = afterMarker.slice(braceStart, endIdx + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.decision !== 'string' || typeof obj.riskTier !== 'string') return null;

  const findings: ParsedGovernanceFinding[] = Array.isArray(obj.findings)
    ? obj.findings
        .filter((f): f is Record<string, unknown> =>
          !!f && typeof f === 'object' &&
          typeof (f as Record<string, unknown>).controlId === 'string' &&
          typeof (f as Record<string, unknown>).severity === 'string')
        .map((f) => ({
          controlId: String(f.controlId),
          severity: String(f.severity),
          gap: typeof f.gap === 'string' ? f.gap : undefined,
          recommendation: typeof f.recommendation === 'string' ? f.recommendation : undefined,
          ownerRole: typeof f.ownerRole === 'string' ? f.ownerRole : undefined,
        }))
    : [];

  const decision: ParsedGovernanceDecision = {
    decision: obj.decision,
    riskTier: obj.riskTier,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
    decisionReason: typeof obj.decisionReason === 'string' ? obj.decisionReason : undefined,
    findings,
  };

  // Strip the marker + JSON from the human-facing document (trimEnd cleans
  // up the blank line the marker's own preceding newline leaves behind) —
  // the report a human reads should end at section 11, not with a raw JSON
  // blob appended after it.
  const strippedOutput = (text.slice(0, markerIdx) + afterMarker.slice(endIdx + 1)).trimEnd();
  return { decision, strippedOutput };
}

/**
 * Fire-and-forget POST to backend/src/routes/governance.js. Deliberately
 * never thrown/awaited by the caller in a way that could fail the agent run
 * or discard its (human-readable) output — a governance persistence hiccup
 * must not block a user from seeing their assessment, it just means Gate 0
 * enforcement has no machine-readable record for this run until retried
 * (same fail-open posture as the rest of this feature's backend half; see
 * proxy.js's authorizeAgentRun kill-switch comment).
 */
async function persistGovernanceDecision(
  projectId: string,
  decision: ParsedGovernanceDecision
): Promise<void> {
  try {
    const apiBase = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
    const authHeaders = await getAuthHeader();
    const resp = await fetch(`${apiBase}/governance/${projectId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        decision: decision.decision,
        riskTier: decision.riskTier,
        confidence: decision.confidence,
        decisionReason: decision.decisionReason,
        findings: decision.findings,
      }),
    });
    if (!resp.ok) {
      console.error(`[l3Runtime] governance decision persistence responded ${resp.status} for project ${projectId}`);
    }
  } catch (err) {
    console.error('[l3Runtime] Failed to persist governance decision:', err instanceof Error ? err.message : err);
  }
}

// --- Main L3 run function ----------------------------------------------------

export async function runL3Agent(
  def: AgentDefinition,
  ctx: AgentPromptContext,
  options: L3RunOptions
): Promise<L3RunResult> {
  const tools = def.tools ?? [];
  const maxIterations = def.maxIterations ?? 3;
  const goal = def.goal ? def.goal(ctx) : options.userPrompt.slice(0, 200);

  // Derive initial plan steps from the user prompt structure
  const initialPlanSteps = deriveInitialPlan(def, ctx);

  const l3Meta: L3RuntimeMeta = {
    goal,
    planRevisions: [{ revision: 0, steps: initialPlanSteps, reason: 'Initial plan', timestamp: Date.now() }],
    toolTrace: [],
    decisions: [],
    iterationCount: 0,
    iterationTokens: [],
  };

  // Build the enriched system prompt
  const l3SystemPrompt = buildL3SystemPrompt(options.systemPrompt, goal, tools, initialPlanSteps);
  // See AgentDefinition.intermediateSystemPrompt — a shorter variant used
  // in place of l3SystemPrompt while required tools are still outstanding
  // (selected per-iteration below, near the call site, since it depends on
  // tool-trace state that only exists once the loop starts). Precomputed
  // once here since goal/tools/initialPlanSteps are constant across
  // iterations. Falls back to the full prompt when the agent doesn't
  // define one — every agent except sdlcOrchestrator today.
  const l3SystemPromptIntermediate = def.intermediateSystemPrompt
    ? buildL3SystemPrompt(def.intermediateSystemPrompt, goal, tools, initialPlanSteps)
    : l3SystemPrompt;

  // Conversation history (system + turns)
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: options.userPrompt },
  ];

  let totalTokens = 0;
  let lastProvider: 'openai' | 'claude' | 'openai-compatible' | undefined;
  let lastModel: string | undefined;
  let finalOutput = '';

  // Required-tool enforcement (see AgentDefinition.requiredTools). Bounded so
  // a persistently uncooperative model can't burn the whole iteration budget
  // just re-nudging — after this many corrections we accept whatever it
  // produces and flag the gap instead of looping indefinitely.
  const requiredTools = def.requiredTools ?? [];
  const MAX_CORRECTION_ATTEMPTS = 2;
  let correctionAttempts = 0;
  const requiresGovernedOutput =
    def.systemPrompt.includes('Agentic Governance Requirements') ||
    options.systemPrompt.includes('Agentic Governance Requirements');
  const MAX_GOVERNANCE_CORRECTIONS = 1;
  let governanceCorrectionAttempts = 0;
  // Diagram enforcement (see AgentDefinition.requiresDiagram / diagramUtils.ts).
  // Same bounded-retry-then-flag shape as governance above: agents like
  // dataModel/architecture/apiDesign/interaction already instruct themselves
  // to include Mermaid diagrams, but until now nothing checked the final
  // output actually contained one — a model could drop the diagram under
  // token pressure and nobody would notice until a human opened the
  // (empty) Diagrams view.
  const MAX_DIAGRAM_CORRECTIONS = 1;
  let diagramCorrectionAttempts = 0;

  // L3 loop
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    l3Meta.iterationCount = iteration + 1;

    const nearLimit = iteration >= maxIterations - 1;
    const limitReminder = nearLimit
      ? '\n\n[WARNING] This is your LAST iteration. You MUST emit FINAL_OUTPUT: now with your complete document.'
      : '';

    // Build the current user turn content
    const userContent = turns[turns.length - 1].role === 'user'
      ? turns[turns.length - 1].content + limitReminder
      : limitReminder || 'Continue. Call another tool or emit FINAL_OUTPUT: with your complete document.';

    // Inter-iteration delay to spread token usage across time (avoids TPM limits).
    // Configurable via VITE_L3_ITER_DELAY_MS (default: 1500ms). Set to 0 in tests
    // or reduce in local dev to speed up iteration.
    if (iteration > 0) {
      const delayMs = Number(import.meta.env.VITE_L3_ITER_DELAY_MS ?? 1500);
      await new Promise((r) => setTimeout(r, isNaN(delayMs) ? 1500 : delayMs));
    }

    // Output-token enforcement (2026-07-17): every non-final iteration is
    // expected, by this loop's own design (see buildL3SystemPrompt's
    // Execution Rules and the "call one tool per response" instruction), to
    // produce a short TOOL_CALL/PLAN_REVISION marker, not the full
    // deliverable — yet every call used to allow the same 8192-token output
    // budget as the call that actually writes the document. Only the
    // last-chance iteration (explicitly told "emit FINAL_OUTPUT: now") gets
    // the full budget; every other iteration is capped lower — 2048 tokens
    // (~1,500 words) is far more than a TOOL_CALL/PLAN_REVISION marker ever
    // needs, but generous enough that a model finishing early with a
    // moderate-length real document on a low-maxIterations agent still
    // fits. This is primarily a runaway-output ceiling (well-behaved short
    // responses stop naturally long before hitting either cap); its
    // guaranteed savings are on any call that would otherwise have padded
    // toward 8192.
    const INTERMEDIATE_MAX_TOKENS = 2048;

    // System-prompt condensation (2026-07-17, see AgentDefinition.
    // intermediateSystemPrompt): while at least one required tool is still
    // outstanding, the runtime's own requiredTools enforcement below
    // guarantees this call can't legitimately produce FINAL_OUTPUT — so the
    // full prompt's output-format instructions aren't needed for it yet.
    // Once every required tool has been called (or the agent has none), or
    // on the last-chance iteration, always use the full prompt.
    const calledToolNamesSoFar = new Set(l3Meta.toolTrace.map((t) => t.tool));
    const stillGatheringRequiredTools =
      requiredTools.length > 0 && requiredTools.some((t) => !calledToolNamesSoFar.has(t));
    const useIntermediatePrompt = stillGatheringRequiredTools && !nearLimit;

    const resp = await callWithRetry({
      systemPrompt: useIntermediatePrompt ? l3SystemPromptIntermediate : l3SystemPrompt,
      userPrompt: buildConversationPrompt(turns, userContent, iteration),
      agentId: options.agentId,
      provider: options.provider,
      projectId: options.projectId,
      maxTokens: nearLimit ? undefined : INTERMEDIATE_MAX_TOKENS,
    });

    const rawText = api.extractText(resp);
    const iterationTokenCount = resp.usage?.total_tokens ?? 0;
    totalTokens += iterationTokenCount;
    lastProvider = resp.provider;
    lastModel = resp.model;
    l3Meta.iterationTokens.push({
      iteration: iteration + 1,
      tokens: iterationTokenCount,
      promptVariant: useIntermediatePrompt ? 'intermediate' : 'full',
      timestamp: Date.now(),
    });

    const parsed = parseResponse(rawText);

    // Handle FINAL_OUTPUT
    if (parsed.type === 'final_output' || parsed.type === 'passthrough') {
      const calledToolNames = new Set(l3Meta.toolTrace.map((t) => t.tool));
      const missingRequired = requiredTools.filter((t) => !calledToolNames.has(t));

      // Required-tool gap, and we still have budget to push back rather than
      // silently accept a plan built on incomplete grounding (see comment on
      // requiredTools above — this is what actually happened in runs that
      // finished suspiciously early, e.g. "3i" when the goal mandates 6+
      // tool calls before writing).
      if (missingRequired.length > 0 && correctionAttempts < MAX_CORRECTION_ATTEMPTS && iteration < maxIterations - 1) {
        correctionAttempts++;
        l3Meta.decisions.push({
          type: 'retry',
          rationale: `Attempted to finish without calling required tool(s): ${missingRequired.join(', ')}. Pushed back for correction (${correctionAttempts}/${MAX_CORRECTION_ATTEMPTS}).`,
          confidence: 0.6,
          timestamp: Date.now(),
        });
        turns.push({ role: 'assistant', content: rawText });
        turns.push({
          role: 'user',
          content:
            `You have not yet called these required tools: ${missingRequired.join(', ')}. ` +
            'You MUST call them before producing FINAL_OUTPUT — do not write the final document yet. ' +
            `Call ${missingRequired[0]} now.`,
        });
        continue;
      }

      const candidateOutput = parsed.finalOutput ?? rawText;
      // Soft-warn, don't hard-block: a failed governance assessment used to
      // discard the agent's real output and replace it with a placeholder
      // "[Artifact blocked...]" message — given the confidence-score parser
      // is a brittle regex (assessGovernedOutput in outputGovernance.ts)
      // against free-text LLM output, that meant a plausible near-miss (e.g.
      // "Confidence: High" instead of "Confidence Score: 98%") threw away a
      // perfectly usable artifact. Now the real output is always kept;
      // l3Meta.outputGovernance still records pass/fail so the UI (see the
      // gap-warning banner in AgentThinkingPanel.tsx, same treatment as
      // incompleteRequiredTools below) can flag it for review instead.
      let governanceFailed = false;
      if (requiresGovernedOutput) {
        const assessment = assessGovernedOutput(candidateOutput);
        if (!assessment.passed && governanceCorrectionAttempts < MAX_GOVERNANCE_CORRECTIONS && iteration < maxIterations - 1) {
          governanceCorrectionAttempts++;
          l3Meta.decisions.push({
            type: 'retry',
            rationale: 'Output governance validation failed: ' + assessment.issues.join(' '),
            confidence: assessment.score ?? 0.1,
            timestamp: Date.now(),
          });
          turns.push({ role: 'assistant', content: rawText });
          turns.push({
            role: 'user',
            content:
              'Your artifact cannot be finalized because governance validation failed: ' + assessment.issues.join(' ') + '\n' +
              'Reassess the evidence and produce a corrected complete artifact ending with a "Validation & Confidence" section and an evidence-based Confidence Score of at least 98%.',
          });
          continue;
        }
        l3Meta.outputGovernance = { ...assessment, blocked: false };
        governanceFailed = !assessment.passed;
      }

      let diagramMissing = false;
      if (def.requiresDiagram) {
        const hasDiagram = hasMermaidDiagram(candidateOutput);
        if (!hasDiagram && diagramCorrectionAttempts < MAX_DIAGRAM_CORRECTIONS && iteration < maxIterations - 1) {
          diagramCorrectionAttempts++;
          l3Meta.decisions.push({
            type: 'retry',
            rationale: `Attempted to finish without a required Mermaid diagram. Pushed back for correction (${diagramCorrectionAttempts}/${MAX_DIAGRAM_CORRECTIONS}).`,
            confidence: 0.6,
            timestamp: Date.now(),
          });
          turns.push({ role: 'assistant', content: rawText });
          turns.push({
            role: 'user',
            content:
              'Your document is missing a required diagram — it must include at least one fenced ```mermaid code block ' +
              '(see the Diagram Requirement in your instructions). Add the diagram(s) now and produce the corrected, complete document.',
          });
          continue;
        }
        diagramMissing = !hasDiagram;
      }

      finalOutput = candidateOutput;
      if (missingRequired.length > 0) {
        // Retries exhausted (or no iterations left) — accept what we have
        // rather than loop forever, but flag it so the UI and anyone
        // reviewing the run can see the plan may be incompletely grounded.
        l3Meta.incompleteRequiredTools = missingRequired;
      }
      if (diagramMissing) {
        l3Meta.missingDiagram = true;
      }
      {
        const gaps: string[] = [];
        if (missingRequired.length > 0) gaps.push(`missing required tool(s): ${missingRequired.join(', ')}`);
        if (governanceFailed) gaps.push('failed governance validation');
        if (diagramMissing) gaps.push('missing required diagram');
        l3Meta.decisions.push({
          type: 'output_accepted',
          rationale: gaps.length > 0
            ? `Final output accepted after ${iteration + 1} iteration(s) despite ${gaps.join(' and ')}.`
            : `Final output produced after ${iteration + 1} iteration(s).`,
          confidence: gaps.length > 0 ? 0.5 : 0.9,
          timestamp: Date.now(),
        });
      }
      break;
    }

    // Handle TOOL_CALL
    if (parsed.type === 'tool_call' && parsed.toolName) {
      const tool = tools.find((t) => t.name === parsed.toolName);
      const args = parsed.toolArgs ?? {};
      const callStart = Date.now();

      l3Meta.decisions.push({
        type: 'tool_selected',
        rationale: `Selected tool "${parsed.toolName}" to gather information.`,
        confidence: 0.85,
        timestamp: callStart,
      });

      let toolResult: unknown;
      if (!tool) {
        toolResult = { error: `Tool "${parsed.toolName}" is not available.` };
      } else {
        try {
          toolResult = await tool.execute(args, ctx);
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : String(err) };
        }
      }

      const traceEntry: ToolTraceEntry = {
        step: l3Meta.toolTrace.length + 1,
        tool: parsed.toolName,
        args,
        result: toolResult,
        timestamp: callStart,
        durationMs: Date.now() - callStart,
      };
      l3Meta.toolTrace.push(traceEntry);

      // Append the assistant's tool call and the tool result to conversation.
      // Cap tool result size to avoid blowing up the context on large outputs
      // (e.g. get_agent_output returning a full 10k-char prior document).
      const MAX_TOOL_RESULT_CHARS = 4_000;
      const rawToolResult = JSON.stringify(toolResult, null, 2);
      const toolResultStr = rawToolResult.length > MAX_TOOL_RESULT_CHARS
        ? rawToolResult.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...[result truncated — full output available in prior context]'
        : rawToolResult;

      turns.push({ role: 'assistant', content: rawText });
      turns.push({
        role: 'user',
        content:
          `TOOL_RESULT for ${parsed.toolName}:\n${toolResultStr}\n\n` +
          'Based on this result, continue your plan. Call another tool or emit FINAL_OUTPUT: with your complete document.',
      });
      continue;
    }

    // Handle PLAN_REVISION
    if (parsed.type === 'plan_revision') {
      const revision: PlanRevision = {
        revision: l3Meta.planRevisions.length,
        steps: parsed.planSteps ?? [],
        reason: parsed.planReason ?? 'Agent revised plan.',
        timestamp: Date.now(),
      };
      l3Meta.planRevisions.push(revision);
      l3Meta.decisions.push({
        type: 'plan_revised',
        rationale: parsed.planReason ?? 'Agent revised its plan.',
        confidence: 0.8,
        timestamp: Date.now(),
      });
      turns.push({ role: 'assistant', content: rawText });
      turns.push({
        role: 'user',
        content:
          `Plan revision acknowledged. New plan:\n${revision.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
          'Continue executing your revised plan. Call a tool or emit FINAL_OUTPUT:.',
      });
      continue;
    }
  }

  // If the loop exhausted maxIterations without the LLM ever emitting
  // FINAL_OUTPUT/passthrough, don't fall back to whatever raw text it last
  // produced. If that last turn was itself a dangling "TOOL_CALL: ..."
  // request (e.g. an agent whose instructed workflow needs more tool calls
  // than its configured maxIterations allows), that request text would
  // otherwise get saved as the agent's "output" instead of a real document
  // -- which is exactly what surfaced as a missing/broken artifact for the
  // stakeholder agent. Instead, make one bounded, tool-free forced-
  // finalization call: same conversation history, but a system prompt with
  // no tools block at all (so there's nothing left to call) and an
  // explicit instruction to write the complete document right now.
  if (!finalOutput) {
    l3Meta.iterationCount += 1;
    const forceContent =
      'You have used all available tool-call iterations. Tool calls are no longer available. ' +
      'Write your complete final document now, using everything you have already gathered above. ' +
      'Do not summarize what you would have done — produce the actual, complete document.';
    try {
      const forcedResp = await callWithRetry({
        systemPrompt: options.systemPrompt, // no tools block — nothing left to call
        userPrompt: buildConversationPrompt(turns, forceContent, turns.length),
        agentId: options.agentId,
        provider: options.provider,
      });
      const forcedRawText = api.extractText(forcedResp);
      const forcedTokenCount = forcedResp.usage?.total_tokens ?? 0;
      totalTokens += forcedTokenCount;
      lastProvider = forcedResp.provider;
      lastModel = forcedResp.model;
      l3Meta.iterationTokens.push({
        iteration: -1,
        tokens: forcedTokenCount,
        promptVariant: 'forced-final',
        timestamp: Date.now(),
      });

      const forcedParsed = parseResponse(forcedRawText);
      // If it STILL tries to call a tool even with none offered, reject it
      // rather than saving that request text as the document.
      const candidate = forcedParsed.type === 'tool_call'
        ? ''
        : (forcedParsed.finalOutput ?? forcedRawText).trim();

      finalOutput = candidate;
      const calledToolNames = new Set(l3Meta.toolTrace.map((t) => t.tool));
      const missingRequired = requiredTools.filter((t) => !calledToolNames.has(t));
      if (missingRequired.length > 0) {
        l3Meta.incompleteRequiredTools = missingRequired;
      }
      // Diagram check applies here too — this call bypasses the normal
      // FINAL_OUTPUT branch above, so it needs its own (no-retry-possible,
      // since iterations are exhausted) flag.
      if (def.requiresDiagram && candidate && !hasMermaidDiagram(candidate)) {
        l3Meta.missingDiagram = true;
      }
      l3Meta.decisions.push({
        type: 'output_accepted',
        rationale: candidate
          ? `Final output produced via a forced tool-free finalization call after exhausting ${maxIterations} iteration(s).` +
            (missingRequired.length > 0 ? ` Missing required tool(s): ${missingRequired.join(', ')}.` : '')
          : `Forced finalization call also failed to produce a usable document after exhausting ${maxIterations} iteration(s).`,
        confidence: candidate ? (missingRequired.length > 0 ? 0.4 : 0.6) : 0.1,
        timestamp: Date.now(),
      });
    } catch (err) {
      l3Meta.decisions.push({
        type: 'output_accepted',
        rationale: `Forced finalization call failed: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0.1,
        timestamp: Date.now(),
      });
    }
  }

  // Last-resort: if even the forced call produced nothing usable, surface a
  // clear, honest error message rather than silently saving a dangling
  // TOOL_CALL: request (or blank text) as if it were a finished artifact.
  if (!finalOutput) {
    finalOutput =
      `[This agent did not produce a complete document within ${maxIterations} iteration(s), ` +
      'and a forced finalization attempt also failed to produce usable output. Try re-running ' +
      'this agent — if this happens consistently, its maxIterations may need to be increased.]';
  }

  // Forced finalization can bypass the normal FINAL_OUTPUT branch; run the
  // same assessment before returning so it's still flagged — but, as above,
  // keep the real (forced) output rather than discarding it behind a
  // placeholder message.
  if (requiresGovernedOutput && !l3Meta.outputGovernance) {
    const assessment = assessGovernedOutput(finalOutput);
    l3Meta.outputGovernance = { ...assessment, blocked: false };
  }

  // AI Governance MVP-0 (2026-07-21): extract and persist the structured
  // decision block aiGovernance's own definition (section 12) instructs it
  // to emit. Runs after every other finalization path above (normal
  // FINAL_OUTPUT, forced tool-free finalization, or the last-resort
  // placeholder) so it applies no matter how this run actually finished.
  if (def.id === 'aiGovernance') {
    const extracted = extractGovernanceDecisionBlock(finalOutput);
    if (extracted) {
      finalOutput = extracted.strippedOutput;
      if (options.projectId) {
        // Deliberately not awaited — see persistGovernanceDecision's own
        // comment for why this must never block returning the (already
        // human-readable) output to the caller.
        void persistGovernanceDecision(options.projectId, extracted.decision);
      } else {
        console.warn('[l3Runtime] aiGovernance produced a decision block but no projectId was provided in L3RunOptions — decision was not persisted.');
      }
    } else {
      console.warn('[l3Runtime] aiGovernance finished without a parseable GOVERNANCE_DECISION_JSON block — Gate 0 will have no machine-readable decision for this run.');
    }
  }

  return {
    output: finalOutput,
    tokensUsed: totalTokens,
    provider: lastProvider,
    model: lastModel,
    l3: l3Meta,
  };
}

// --- Helpers -----------------------------------------------------------------

/**
 * Build a single user prompt string that includes the conversation history
 * so far, for LLMs that don't support multi-turn natively via the API wrapper.
 *
 * Each historical turn is capped at MAX_TURN_CHARS to prevent the prompt from
 * growing unboundedly across iterations (3 iterations × large tool results
 * can easily exceed 50k chars without this guard).
 *
 * 2026-07-19 — stale tool-result compaction (see requiredTools/
 * intermediateSystemPrompt rollout in agents/definitions.ts for the related
 * systemPrompt-side fix). A TOOL_RESULT turn was being re-embedded at the
 * same up-to-MAX_TURN_CHARS size on EVERY iteration after it happened, not
 * just the iteration right after — this is the dominant driver of the
 * per-iteration token growth reported 2026-07-19 (a PRD run climbed
 * 4,989 -> 6,253 tokens across 5 calls with no new information, just the
 * same earlier tool results getting re-sent in full each time). Fix: once a
 * TOOL_RESULT turn is no longer part of the most recent exchange, cap it at
 * MAX_STALE_TURN_CHARS instead of MAX_TURN_CHARS.
 *
 * Deliberately NOT dropping stale turns entirely, and deliberately using a
 * moderate cap (1,200 chars) rather than an aggressive one: this history is
 * the model's ONLY memory of earlier tool results (callAgent is single-shot
 * per call, not a stateful multi-turn API — see the module doc comment
 * above), so over-truncating risks a real quality regression on agents
 * whose self-check step needs to recall specific details (e.g. named
 * FR-xxx IDs, specific roster names) from a tool result fetched several
 * iterations earlier. 1,200 chars keeps the substantive content of most
 * tool results (get_team_roster, get_domain_context, get_style_guide are
 * well under that; get_agent_output excerpts are the main thing actually
 * being compacted here, already pre-truncated to 4,000 chars at the point
 * they're captured — see MAX_TOOL_RESULT_CHARS above). Only the most recent
 * exchange (last 2 turns) is exempt and stays at full MAX_TURN_CHARS, since
 * that's what the model is actively reasoning from on this call.
 */
const MAX_TURN_CHARS = 3_000;
const MAX_STALE_TURN_CHARS = 1_200;

function isToolResultTurn(content: string): boolean {
  return content.startsWith('TOOL_RESULT for ');
}

function buildConversationPrompt(
  history: Array<{ role: string; content: string }>,
  currentUserContent: string,
  iteration: number
): string {
  if (iteration === 0) {
    // First turn: just the original user prompt (already in turns[0])
    return currentUserContent;
  }

  // For subsequent turns: embed the conversation history so the LLM has full context.
  // Truncate each historical turn independently so no single large tool result
  // crowds out the rest of the context. The most recent exchange (the last 2
  // entries — typically one assistant turn + its immediate user-side
  // result/ack) is exempt from stale compaction; see doc comment above.
  const recentExchangeCount = 2;
  const staleBoundary = Math.max(0, history.length - recentExchangeCount);

  const historyBlock = history
    .map((t, idx) => {
      const isStale = idx < staleBoundary;
      const cap = isStale && isToolResultTurn(t.content) ? MAX_STALE_TURN_CHARS : MAX_TURN_CHARS;
      const body = t.content.length > cap
        ? t.content.slice(0, cap) + '\n[...turn truncated for context length]'
        : t.content;
      return `[${t.role.toUpperCase()}]:\n${body}`;
    })
    .join('\n\n---\n\n');

  return `${historyBlock}\n\n---\n\n[USER]:\n${currentUserContent}`;
}

/**
 * Derive sensible initial plan steps from the agent definition.
 * Uses available tools as the basis for planning steps.
 */
function deriveInitialPlan(def: AgentDefinition, ctx: AgentPromptContext): string[] {
  const hasTools = (def.tools?.length ?? 0) > 0;
  const toolNames = def.tools?.map((t) => t.name) ?? [];

  const steps: string[] = [];

  if (hasTools) {
    if (toolNames.includes('get_domain_context')) {
      steps.push(`Retrieve domain context for "${ctx.domain}" to ground all decisions`);
    }
    if (toolNames.includes('get_team_roster')) {
      steps.push('Retrieve team roster to assign real names to owners and approvers');
    }
    if (toolNames.includes('get_agent_output') && def.dependsOn && def.dependsOn.length > 0) {
      steps.push(`Read full outputs from dependent agents: ${def.dependsOn.join(', ')}`);
    }
    if (toolNames.includes('search_prior_outputs')) {
      steps.push('Search prior outputs for relevant requirements, constraints, and decisions');
    }
    if (toolNames.includes('get_requirement_ids')) {
      steps.push('Extract requirement IDs for traceability cross-references');
    }
  }

  steps.push('Draft the document section by section using gathered context');

  if (toolNames.includes('validate_output_completeness')) {
    steps.push('Validate draft completeness against required sections');
    steps.push('Revise any missing or incomplete sections');
  }

  steps.push('Emit final complete document');

  return steps;
}
