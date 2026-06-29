/**
 * © 2025 Arun Gaikwad. All rights reserved.
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

import { api } from './api';
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
  provider?: 'openai' | 'claude';
}

export interface L3RunResult {
  output: string;
  tokensUsed: number;
  provider?: 'openai' | 'claude';
  model?: string;
  l3: L3RuntimeMeta;
}

// --- Marker constants --------------------------------------------------------

const MARKER_TOOL_CALL    = 'TOOL_CALL:';
const MARKER_PLAN_REVISED = 'PLAN_REVISION:';
const MARKER_FINAL_OUTPUT = 'FINAL_OUTPUT:';
const MARKER_STEPS        = 'STEPS:';

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
  };

  // Build the enriched system prompt
  const l3SystemPrompt = buildL3SystemPrompt(options.systemPrompt, goal, tools, initialPlanSteps);

  // Conversation history (system + turns)
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: options.userPrompt },
  ];

  let totalTokens = 0;
  let lastProvider: 'openai' | 'claude' | undefined;
  let lastModel: string | undefined;
  let finalOutput = '';

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

    // Call the LLM - retries automatically on 429 with backoff
    const resp = await callWithRetry({
      systemPrompt: l3SystemPrompt,
      userPrompt: buildConversationPrompt(turns, userContent, iteration),
      agentId: options.agentId,
      provider: options.provider,
    });

    const rawText = api.extractText(resp);
    totalTokens += resp.usage?.total_tokens ?? 0;
    lastProvider = resp.provider;
    lastModel = resp.model;

    const parsed = parseResponse(rawText);

    // Handle FINAL_OUTPUT
    if (parsed.type === 'final_output' || parsed.type === 'passthrough') {
      finalOutput = parsed.finalOutput ?? rawText;
      l3Meta.decisions.push({
        type: 'output_accepted',
        rationale: `Final output produced after ${iteration + 1} iteration(s).`,
        confidence: 0.9,
        timestamp: Date.now(),
      });
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

  // If loop exhausted without FINAL_OUTPUT, use last LLM response as output
  if (!finalOutput) {
    finalOutput = turns
      .filter((t) => t.role === 'assistant')
      .map((t) => t.content)
      .pop() ?? '';
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
 */
const MAX_TURN_CHARS = 3_000;

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
  // crowds out the rest of the context.
  const historyBlock = history
    .map((t) => {
      const body = t.content.length > MAX_TURN_CHARS
        ? t.content.slice(0, MAX_TURN_CHARS) + '\n[...turn truncated for context length]'
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
