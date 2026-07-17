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
import type { AgentId, AgentPromptContext, ClarifyingAnswer } from '@/types/agent.types';

const REQUIREMENT_ID_PATTERN = /\b([A-Z]{2,4}-\d{3,})\b/g;

export function hasMeaningfulClarifyingAnswers(
  answers: ClarifyingAnswer[] | undefined,
  expectedCount = 1,
): boolean {
  if (!answers || expectedCount < 1) return false;
  return answers.filter((item) => item.question.trim() && item.answer.trim()).length >= expectedCount;
}

export function mergeClarifyingAnswers(
  existing: ClarifyingAnswer[] = [],
  incoming: ClarifyingAnswer[] = [],
): ClarifyingAnswer[] {
  const merged = new Map<string, ClarifyingAnswer>();
  for (const item of [...existing, ...incoming]) {
    const question = item.question.trim();
    const answer = item.answer.trim();
    if (question && answer) merged.set(question.toLocaleLowerCase(), { question, answer });
  }
  return [...merged.values()];
}

function freshQuestions(
  generated: string[],
  fallback: string[],
  ctx: AgentPromptContext,
  finalFallback: string,
): string[] {
  const answered = new Set(
    (ctx.clarifyingAnswers ?? [])
      .filter((item) => item.answer.trim())
      .map((item) => item.question.trim().toLocaleLowerCase()),
  );
  const filterFresh = (questions: string[]) => questions.filter(
    (question) => !answered.has(question.trim().toLocaleLowerCase()),
  );
  const freshGenerated = filterFresh(generated);
  if (freshGenerated.length > 0) return freshGenerated;
  const freshFallback = filterFresh(fallback);
  return freshFallback.length > 0 ? freshFallback : [finalFallback];
}

function projectContextBlock(ctx: AgentPromptContext): string {
  const documents = (ctx.contextDocuments ?? []).slice(0, 4).map((doc) =>
    `### ${doc.name} (${doc.kind})\n${doc.content.slice(0, 700)}`,
  ).join('\n\n');
  const priorAnswers = (ctx.clarifyingAnswers ?? []).filter((item) => item.answer.trim()).map((item) =>
    `- Q: ${item.question}\n  A: ${item.answer}`,
  ).join('\n');
  return [
    `Project: ${ctx.projectName}`,
    `Domain: ${ctx.domain}`,
    `Project Description: ${ctx.projectDescription}`,
    ctx.projectType ? `Project Type: ${ctx.projectType}` : '',
    ctx.projectExecutionStyle ? `Execution Style: ${ctx.projectExecutionStyle}` : '',
    ctx.techStack ? `Technology Stack: ${ctx.techStack}` : '',
    `Domain Knowledge:\n${ctx.domainContext.slice(0, 1800)}`,
    documents ? `Uploaded Project Context:\n${documents}` : '',
    priorAnswers ? `Previously Answered Clarifications (do not ask these again):\n${priorAnswers}` : '',
  ].filter(Boolean).join('\n');
}

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
    projectContextBlock(ctx),
    `PRD Dependency Output:\n${ctx.priorOutputs.manager?.slice(0, 2500) ?? '(not yet available)'}`,
    ctx.priorOutputs.brd
      ? `Current BRD Output (rerun context; ask only about unresolved or changed gaps):\n${ctx.priorOutputs.brd.slice(0, 1800)}`
      : '',
    '',
    "You're about to write a Business Requirements Document. Ask 3-4 clarifying questions whose answers would " +
      'change the business requirements, current/future-state process descriptions, or compliance section — e.g. ' +
      'legacy systems being replaced, budget/timeline constraints on the business case, or compliance bodies ' +
      "beyond the domain's typical defaults. Do not repeat previously answered clarifications. Return ONLY a JSON array of question strings.",
  ].filter(Boolean).join('\n');

  try {
    const resp = await api.callAgent({
      systemPrompt: QUESTION_GEN_SYSTEM_PROMPT,
      userPrompt,
      agentId: 'brd',
      projectId,
      signal: AbortSignal.timeout(45_000),
    });
    return freshQuestions(
      parseQuestionList(api.extractText(resp), 4),
      DEFAULT_BRD_QUESTIONS,
      ctx,
      `What material requirement, constraint, or assumption has changed for ${ctx.projectName} since the previous BRD clarifications?`,
    );
  } catch {
    // Question generation failing must never block the pipeline — fall back
    // to a fixed, still-useful question set rather than surfacing an error
    // for what's meant to be a lightweight, optional-value step.
    return freshQuestions(
      [],
      DEFAULT_BRD_QUESTIONS,
      ctx,
      `What material requirement, constraint, or assumption has changed for ${ctx.projectName} since the previous BRD clarifications?`,
    );
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

  // Give the LLM the actual BR text (not just IDs) so it can ask something
  // specific, and let IT decide how to group when there are more BRs than
  // the question cap allows — that's a judgment call the model is better
  // positioned to make than a mechanical slice/cluster here.
  const brExcerpts = brIds.length > 0
    ? brIds.map((id) => {
        const idx = brdText.indexOf(id);
        const excerpt = idx >= 0 ? brdText.slice(idx, idx + 300).replace(/\n/g, ' ') : '';
        return `${id}: ${excerpt}`;
      }).join('\n')
    : brdText.slice(0, 2500) || '(BRD dependency output not available)';

  const idInstruction = brIds.length > 0
    ? 'Prefix each question with the BR-xxx ID(s) it addresses, e.g. "[BR-003] ...". Group related BRs when needed.'
    : 'The BRD has no numbered BR-xxx IDs yet, so cite the specific BRD statement or project fact that triggered each question.';
  const userPrompt = [
    projectContextBlock(ctx),
    `PRD Dependency Output:\n${ctx.priorOutputs.manager?.slice(0, 2200) ?? '(not yet available)'}`,
    `BRD Dependency Output:\n${brExcerpts}`,
    ctx.priorOutputs.userStory
      ? `Current User Story Output (rerun context; ask only about unresolved or changed gaps):\n${ctx.priorOutputs.userStory.slice(0, 1800)}`
      : '',
    '',
    `You're about to write the User Story backlog. Ask at most ${MAX_USER_STORY_QUESTIONS} project-specific questions ` +
      'about personas, workflow variations, exception paths, acceptance criteria, and measurable non-functional needs. ' +
      `${idInstruction} Do not repeat previously answered clarifications. Return ONLY a JSON array of question strings.`,
  ].filter(Boolean).join('\n');

  try {
    const resp = await api.callAgent({
      systemPrompt: QUESTION_GEN_SYSTEM_PROMPT,
      userPrompt,
      agentId: 'userStory',
      projectId,
      signal: AbortSignal.timeout(45_000),
    });
    return freshQuestions(
      parseQuestionList(api.extractText(resp), MAX_USER_STORY_QUESTIONS),
      DEFAULT_USER_STORY_QUESTIONS,
      ctx,
      `What persona, workflow, exception, or acceptance condition has changed for ${ctx.projectName} since the previous backlog clarifications?`,
    );
  } catch {
    return freshQuestions(
      [],
      DEFAULT_USER_STORY_QUESTIONS,
      ctx,
      `What persona, workflow, exception, or acceptance condition has changed for ${ctx.projectName} since the previous backlog clarifications?`,
    );
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
