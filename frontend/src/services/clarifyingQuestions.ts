/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Clarifying Questions — pre-generation Q&A flow for agents flagged with
 * AgentDefinition.needsClarifyingQuestions (currently 'brd' and 'userStory').
 * PipelineEngine calls generateClarifyingQuestions() the first time it's
 * about to run one of these agents with no saved answers yet (see
 * pipelineEngine.ts's runAgent()); the result is shown via
 * AgentClarifyingQuestionsModal, and the user's answers are persisted to
 * project.clarifyingAnswers[agentId] before the agent's real generation call
 * runs. Question generation is a separate, lightweight LLM call — it never
 * runs inside an agent's own tool loop, so it has no access to agent tools.
 */
import { api } from './api';
import type { AgentId, AgentPromptContext } from '@/types/agent.types';

const REQUIREMENT_ID_PATTERN = /\b([A-Z]{2,4}-\d{3,})\b/g;

/**
 * Extracts unique requirement IDs with the given prefix (e.g. "BR") from
 * text, in first-appearance order. Mirrors the pattern used by
 * agents/tools.ts's get_requirement_ids tool — kept as a separate copy here
 * since question generation runs outside any agent's own tool loop and has
 * no access to that tool.
 */
export function extractRequirementIds(text: string, prefix: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(REQUIREMENT_ID_PATTERN)) {
    const id = match[1];
    if (id.startsWith(`${prefix}-`) && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

/**
 * Parses the LLM's question-generation response into a plain string array.
 * Tolerant of common LLM formatting drift: a fenced ```json block, stray
 * prose before/after the array, or a bare newline-separated list if JSON
 * parsing fails outright — question generation is a nice-to-have step and
 * must degrade gracefully rather than throw.
 */
export function parseQuestionList(raw: string, max: number): string[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const parsed = JSON.parse(candidate.trim());
    if (Array.isArray(parsed)) {
      const questions = parsed
        .map((q) => (typeof q === 'string' ? q : String((q as { question?: string })?.question ?? '')))
        .map((q) => q.trim())
        .filter(Boolean);
      if (questions.length > 0) return questions.slice(0, max);
    }
  } catch {
    /* fall through to line-splitting below */
  }
  // Fallback: treat each non-empty line as one question, stripping common
  // list markers ("1.", "-", "*") the LLM might use outside strict JSON.
  return raw
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

const QUESTION_GEN_SYSTEM_PROMPT =
  'You are a senior business analyst preparing to write project documentation. Your only job right now is to ask ' +
  'the smallest set of sharp, specific clarifying questions that would materially change what you write — not ' +
  'generic questions a template could answer. Respond with ONLY a JSON array of question strings, nothing else — ' +
  'no preamble, no markdown fences, no numbering.';

const DEFAULT_BRD_QUESTIONS = [
  'Is this project replacing an existing system or process, and if so, what is it?',
  'Are there budget or timeline constraints that should shape the business case?',
  "Are there compliance/regulatory bodies involved beyond what's typical for this domain?",
  'Are there existing organizational constraints (vendor contracts, union rules, legacy integrations) that affect change management?',
];

async function generateBrdQuestions(ctx: AgentPromptContext, projectId?: string): Promise<string[]> {
  const userPrompt = [
    `Project: ${ctx.projectName}`,
    `Domain: ${ctx.domain}`,
    `Project Description: ${ctx.projectDescription}`,
    `PRD Summary:\n${ctx.priorOutputs.manager?.slice(0, 1500) ?? '(not yet available)'}`,
    '',
    "You're about to write a Business Requirements Document. Ask 3-4 clarifying questions whose answers would " +
      'change the business requirements, current/future-state process descriptions, or compliance section — e.g. ' +
      'legacy systems being replaced, budget/timeline constraints on the business case, or compliance bodies ' +
      "beyond the domain's typical defaults. Return ONLY a JSON array of question strings.",
  ].join('\n');

  try {
    const resp = await api.callAgent({
      systemPrompt: QUESTION_GEN_SYSTEM_PROMPT,
      userPrompt,
      agentId: 'brd',
      projectId,
      signal: AbortSignal.timeout(45_000),
    });
    const questions = parseQuestionList(api.extractText(resp), 4);
    return questions.length > 0 ? questions : DEFAULT_BRD_QUESTIONS;
  } catch {
    // Question generation failing must never block the pipeline — fall back
    // to a fixed, still-useful question set rather than surfacing an error
    // for what's meant to be a lightweight, optional-value step.
    return DEFAULT_BRD_QUESTIONS;
  }
}

const MAX_USER_STORY_QUESTIONS = 10;

const DEFAULT_USER_STORY_QUESTIONS = [
  'Are there specific user personas beyond the obvious end-user that need their own stories (e.g. admin, support staff, auditor)?',
  'Are there workflow edge cases or exception paths that should become their own stories rather than being folded into acceptance criteria?',
  'Is there a specific non-functional requirement (performance, accessibility, security) that deserves its own story rather than a generic placeholder?',
];

async function generateUserStoryQuestions(ctx: AgentPromptContext, projectId?: string): Promise<string[]> {
  const brdText = ctx.priorOutputs.brd ?? '';
  const brIds = extractRequirementIds(brdText, 'BR');

  if (brIds.length === 0) {
    // BRD hasn't run yet, or produced no numbered BR-xxx items — fall back
    // to generic story-scoping questions rather than blocking on something
    // that can't be extracted.
    return DEFAULT_USER_STORY_QUESTIONS;
  }

  // Give the LLM the actual BR text (not just IDs) so it can ask something
  // specific, and let IT decide how to group when there are more BRs than
  // the question cap allows — that's a judgment call the model is better
  // positioned to make than a mechanical slice/cluster here.
  const brExcerpts = brIds
    .map((id) => {
      const idx = brdText.indexOf(id);
      const excerpt = idx >= 0 ? brdText.slice(idx, idx + 200).replace(/\n/g, ' ') : '';
      return `${id}: ${excerpt}`;
    })
    .join('\n');

  const userPrompt = [
    `Project: ${ctx.projectName}`,
    `Domain: ${ctx.domain}`,
    `Business Requirements from the BRD:\n${brExcerpts}`,
    '',
    `You're about to write the User Story backlog for these business requirements. Ask at most ${MAX_USER_STORY_QUESTIONS} ` +
      'clarifying questions, each about persona, workflow variation, edge cases, or acceptance criteria for one or ' +
      'more of the BR-xxx items above. Prefix each question with the BR-xxx ID(s) it addresses in brackets, e.g. ' +
      '"[BR-003] ...". If there are more BRs than questions, group related BRs into a single question rather than ' +
      'dropping any BR entirely. Return ONLY a JSON array of question strings.',
  ].join('\n');

  try {
    const resp = await api.callAgent({
      systemPrompt: QUESTION_GEN_SYSTEM_PROMPT,
      userPrompt,
      agentId: 'userStory',
      projectId,
      signal: AbortSignal.timeout(45_000),
    });
    const questions = parseQuestionList(api.extractText(resp), MAX_USER_STORY_QUESTIONS);
    return questions.length > 0 ? questions : DEFAULT_USER_STORY_QUESTIONS;
  } catch {
    return DEFAULT_USER_STORY_QUESTIONS;
  }
}

/**
 * Dispatches to the right question generator for the given agent. Callers
 * (PipelineEngine.runAgent) should only invoke this for agents where
 * AgentDefinition.needsClarifyingQuestions is true.
 */
export async function generateClarifyingQuestions(
  agentId: AgentId,
  ctx: AgentPromptContext,
  projectId?: string
): Promise<string[]> {
  switch (agentId) {
    case 'brd':
      return generateBrdQuestions(ctx, projectId);
    case 'userStory':
      return generateUserStoryQuestions(ctx, projectId);
    default:
      return [];
  }
}
