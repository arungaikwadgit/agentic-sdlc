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
  let requirements = normalized.projectId ? [] : ['catalog'];
  let assessment = assessEvidence([], requirements);

  for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
    if (signal?.aborted) throw new Error('Chat request was cancelled.');
    const startedAt = now();
    const plannerText = await planWithModel(buildPlannerPrompt({
      ...normalized,
      observation: round === 1 ? null : {
        missing: assessment.missing,
        contradictions: assessment.contradictions,
        completedTools: [...executedCalls],
      },
    }), { signal });
    let plan = parsePlannerResponse(plannerText);

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

  const answer = String(await synthesizeWithModel(buildSynthesisPrompt({
    question: normalized.question,
    history: normalized.history,
    evidence,
    assessment,
    trace,
  }), { signal })).trim();

  return {
    answer: answer || 'I could not produce a supported answer from the available project evidence.',
    confidence: assessment.confidence,
    supported: assessment.sufficient,
    evidence: publicEvidence(evidence),
    trace,
    followUp: assessment.sufficient
      ? null
      : `Missing authoritative evidence: ${assessment.missing.join(', ') || 'additional project context'}.`,
  };
}

module.exports = {
  MAX_PLAN_ROUNDS,
  runChatOrchestrator,
};
