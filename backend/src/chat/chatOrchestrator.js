/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const {
  normalizeChatRequest,
  parsePlannerResponse,
  assessEvidence,
  buildPlannerPrompt,
  buildSynthesisPrompt,
} = require('./chatPlanner');
const { findMemoryAnswer } = require('./chatMemory');

const MAX_PLAN_ROUNDS = 2;
const TOOL_TIMEOUT_MS = 15_000;
const DASHBOARD_TOOL_NAMES = new Set(['get_agent_catalog', 'research_external_sources']);
const PROJECT_TOOL_NAMES = new Set([
  'get_project_context',
  'get_agent_run_statuses',
  'get_latest_agent_outputs',
  'get_review_gate_state',
  'get_project_memory',
]);

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function publicEvidence(items) {
  return items.map(({ excerpt: _excerpt, authorized: _authorized, claimKey: _claimKey, claimValue: _claimValue, ...metadata }) => metadata);
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceType}:${item.sourceId}:${item.version ?? ''}:${item.updatedAt ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUsage(value) {
  const usage = value && typeof value === 'object' ? value : {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens)) || 0;
  return { promptTokens, completionTokens, totalTokens };
}

function normalizeModelResult(value) {
  if (typeof value === 'string') {
    return { text: value, usage: normalizeUsage(null), provider: null, model: null };
  }
  return {
    text: String(value?.text ?? ''),
    usage: normalizeUsage(value?.usage),
    provider: value?.provider ? String(value.provider) : null,
    model: value?.model ? String(value.model) : null,
  };
}

function addUsage(total, call) {
  total.promptTokens += call.usage.promptTokens;
  total.completionTokens += call.usage.completionTokens;
  total.totalTokens += call.usage.totalTokens;
  total.modelCalls += 1;
  if (call.provider) total.providers.add(call.provider);
  if (call.model) total.models.add(call.model);
}

function publicTokenUsage(total, avoidedModelCalls = 0) {
  return {
    promptTokens: total.promptTokens,
    completionTokens: total.completionTokens,
    totalTokens: total.totalTokens,
    modelCalls: total.modelCalls,
    avoidedModelCalls,
    providers: [...total.providers],
    models: [...total.models],
  };
}

async function runChatOrchestrator({
  request,
  caller,
  planWithModel,
  synthesizeWithModel,
  executeTool,
  now = () => Date.now(),
  signal,
}) {
  const normalized = normalizeChatRequest(request);
  const evidence = [];
  const trace = [];
  const executedCalls = new Set();
  const tokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    modelCalls: 0,
    providers: new Set(),
    models: new Set(),
  };
  let requirements = normalized.projectId ? [] : ['catalog'];
  let assessment = assessEvidence([], requirements);

  // Check approved project memory before either model call. Strong,
  // non-volatile matches avoid planner and synthesis tokens entirely.
  if (normalized.projectId) {
    const memoryStartedAt = now();
    try {
      const memoryItems = await withTimeout(
        Promise.resolve(executeTool('get_project_memory', {}, {
          caller,
          projectId: normalized.projectId,
          currentView: normalized.currentView,
          signal,
        })),
        TOOL_TIMEOUT_MS,
        'get_project_memory',
      );
      executedCalls.add('get_project_memory:{}');
      evidence.push(...memoryItems);
      trace.push({
        stage: 'memory',
        name: 'get_project_memory',
        status: 'checked',
        sourceCount: memoryItems.length,
        elapsedMs: now() - memoryStartedAt,
      });

      const memoryAnswer = findMemoryAnswer(normalized.question, memoryItems);
      if (memoryAnswer) {
        trace.push({ stage: 'memory', name: 'memory_match', status: 'answered', sourceCount: 1 });
        return {
          answer: memoryAnswer.answer,
          confidence: memoryAnswer.confidence,
          supported: true,
          evidence: publicEvidence([memoryAnswer.evidence]),
          trace,
          followUp: null,
          responseMode: 'memory',
          tokenUsage: publicTokenUsage(tokenUsage, 2),
        };
      }
      trace.push({ stage: 'memory', name: 'memory_match', status: 'miss', sourceCount: 0 });
    } catch (error) {
      const status = Number(error?.status);
      if ([400, 403, 404].includes(status)) throw error;
      trace.push({
        stage: 'memory',
        name: 'get_project_memory',
        status: 'error',
        sourceCount: 0,
        elapsedMs: now() - memoryStartedAt,
      });
    }
  }

  for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
    if (signal?.aborted) throw new Error('Chat request was cancelled.');
    const startedAt = now();
    const plannerResult = normalizeModelResult(await planWithModel(buildPlannerPrompt({
      ...normalized,
      observation: round === 1 ? null : {
        missing: assessment.missing,
        contradictions: assessment.contradictions,
        completedTools: [...executedCalls],
      },
    }), { signal }));
    addUsage(tokenUsage, plannerResult);
    let plan = parsePlannerResponse(plannerResult.text);

    if (!normalized.projectId) {
      const dashboardCalls = plan.toolCalls.filter((call) => DASHBOARD_TOOL_NAMES.has(call.name));
      if (!dashboardCalls.some((call) => call.name === 'get_agent_catalog')) {
        dashboardCalls.unshift({ name: 'get_agent_catalog', args: {} });
      }
      plan = {
        intent: plan.intent,
        requiredEvidence: [...new Set(['catalog', ...plan.requiredEvidence.filter((item) => item === 'external')])],
        toolCalls: dashboardCalls,
      };
    }
    requirements = [...new Set([...requirements, ...plan.requiredEvidence])];
    trace.push({ stage: 'plan', round, status: 'complete', toolCount: plan.toolCalls.length, elapsedMs: now() - startedAt });

    const pendingCalls = plan.toolCalls.filter((call) => {
      if (!normalized.projectId && PROJECT_TOOL_NAMES.has(call.name)) return false;
      const key = `${call.name}:${JSON.stringify(call.args ?? {})}`;
      if (executedCalls.has(key)) return false;
      executedCalls.add(key);
      return true;
    });

    const observations = await Promise.all(pendingCalls.map(async (call) => {
      const toolStartedAt = now();
      try {
        const items = await withTimeout(
          Promise.resolve(executeTool(call.name, call.args ?? {}, {
            caller,
            projectId: normalized.projectId,
            currentView: normalized.currentView,
            signal,
          })),
          TOOL_TIMEOUT_MS,
          call.name,
        );
        trace.push({ stage: 'tool', name: call.name, status: 'complete', sourceCount: items.length, elapsedMs: now() - toolStartedAt });
        return items;
      } catch (error) {
        const status = Number(error?.status);
        if ([400, 403, 404].includes(status)) throw error;
        trace.push({ stage: 'tool', name: call.name, status: 'error', sourceCount: 0, elapsedMs: now() - toolStartedAt });
        return [];
      }
    }));
    evidence.push(...observations.flat());
    const uniqueEvidence = dedupeEvidence(evidence);
    evidence.splice(0, evidence.length, ...uniqueEvidence);
    assessment = assessEvidence(evidence, requirements);
    trace.push({
      stage: 'observe',
      round,
      status: assessment.sufficient ? 'sufficient' : 'insufficient',
      sourceCount: evidence.length,
      confidence: assessment.confidence,
    });
    if (assessment.sufficient) break;
  }

  const synthesisResult = normalizeModelResult(await synthesizeWithModel(buildSynthesisPrompt({
    question: normalized.question,
    history: normalized.history,
    evidence,
    assessment,
    trace,
  }), { signal }));
  addUsage(tokenUsage, synthesisResult);
  const answer = synthesisResult.text.trim();

  return {
    answer: answer || 'I could not produce a supported answer from the available project evidence.',
    confidence: assessment.confidence,
    supported: assessment.sufficient,
    evidence: publicEvidence(evidence),
    trace,
    followUp: assessment.sufficient
      ? null
      : `Missing authoritative evidence: ${assessment.missing.join(', ') || 'additional project context'}.`,
    responseMode: 'model',
    tokenUsage: publicTokenUsage(tokenUsage),
  };
}

module.exports = {
  MAX_PLAN_ROUNDS,
  runChatOrchestrator,
};
