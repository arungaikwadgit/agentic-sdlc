/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Pipeline Engine — orchestrates agent execution across phases.
 *
 * - Sequential phases: run agents one by one
 * - Parallel phases: run agents concurrently (p-queue, concurrency=3)
 * - Review gates: pause before proceeding to next phase group
 * - Emits progress via callbacks so UI can update in real-time
 */

import PQueue from 'p-queue';
import { PHASE_ORDER, PARALLEL_PHASES, PHASE_AGENTS, REVIEW_GATES } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { getPromptDefaults, getAgentProviderHints, getAgentModelAssignments } from '@/agents/promptDefaults';
import { getGovernedEffectivePrompt } from '@/services/promptGovernance';
import { getDomain } from '@/agents/domains';
import { buildTeamRoster } from '@/data/roleTemplates';
import { api } from './api';
import { runL3Agent } from './l3Runtime';
import { syncRunStart, syncRunSucceed, syncRunFail } from './runtimeApi';
import { updateAgentRun, updateProject, getProject } from '@/db/projectRepository';
import { DEFAULT_MODEL_CATALOG } from '@/agents/modelCatalog';
import { isAgentSkipped, isInternalAgent } from '@/lib/agentEnablement';
import { generateClarifyingQuestions, hasMeaningfulClarifyingAnswers } from './clarifyingQuestions';
import { emitLifecycleEvent } from './lifecycleEvents';
import type { Project, ReviewGateId } from '@/types/project.types';
import type { AgentCatalogEntry, AgentId, AgentPromptContext, PhaseId, PhaseRulesSnapshot, L3RuntimeMeta } from '@/types/agent.types';

// Lightweight, read-only view of the agent fleet for the get_agent_catalog tool.
// Built once per context — deliberately excludes systemPrompt/goal/tools so the
// tool can't be used to read prompt internals back out through the LLM.
// `enabled: false` marks agents skipped due to no team assignment (see
// lib/agentEnablement.ts) so the orchestrator can plan around the actual
// available fleet instead of assuming every agent will run.
function buildAgentCatalog(project: Project): AgentCatalogEntry[] {
  return Object.values(AGENT_DEFINITIONS).map((def) => ({
    id: def.id,
    name: def.name,
    phase: def.phase,
    description: def.description,
    dependsOn: def.dependsOn,
    enabled: !isAgentSkipped(project, def.id),
  }));
}

function buildPhaseRules(): PhaseRulesSnapshot {
  return {
    phaseOrder: PHASE_ORDER,
    phaseAgents: PHASE_AGENTS,
    parallelPhases: [...PARALLEL_PHASES],
    reviewGates: REVIEW_GATES,
  };
}

function buildAgentRunMetrics(project: Project) {
  return Object.entries(project.agentRuns).map(([id, run]) => ({
    agentId: id as AgentId,
    status: run?.status ?? 'idle',
    tokensUsed: Math.max(0, run?.tokensUsed ?? 0),
    provider: run?.provider,
    model: run?.model,
  }));
}

function buildGovernanceSnapshot(project: Project) {
  return {
    reviewGates: Object.entries(project.reviewGates ?? {}).map(([id, gate]) => ({
      id,
      approved: !!gate?.approved,
      approvedAt: gate?.approvedAt,
      approvedBy: gate?.approvedBy,
    })),
    promptOverrideAgentIds: (project.promptOverrides ?? []).map((item) => item.agentId),
    contextDocuments: (project.contextDocuments ?? []).map((doc) => ({
      name: doc.name,
      kind: doc.kind,
      sizeKb: doc.sizeKb,
    })),
    creationApproval: project.creationApproval
      ? {
          approverRole: project.creationApproval.approverRole,
          approvedAt: project.creationApproval.approvedAt,
        }
      : null,
  };
}

export function buildAgentPromptContext(project: Project, agentId?: AgentId): AgentPromptContext {
  const domain = getDomain(project.domain);
  const priorOutputs: Partial<Record<AgentId, string>> = {};
  for (const [completedAgentId, run] of Object.entries(project.agentRuns)) {
    if (run?.status === 'complete' && run.output) priorOutputs[completedAgentId as AgentId] = run.output;
  }
  return {
    projectName: project.name,
    projectDescription: project.description,
    domain: domain.id,
    domainContext: project.domainKnowledge ? `${project.domainKnowledge}\n\n---\n\n${domain.context}` : domain.context,
    priorOutputs,
    teamRoster: buildTeamRoster(project),
    brandingGuidelines: project.brandingGuidelines,
    techStack: project.techStack,
    contextDocuments: project.contextDocuments,
    mockupVersionCount: project.mockupVersionCount,
    projectType: project.projectType,
    projectExecutionStyle: project.projectExecutionStyle,
    agentCatalog: buildAgentCatalog(project),
    phaseRules: buildPhaseRules(),
    modelCatalog: DEFAULT_MODEL_CATALOG,
    agentRunMetrics: buildAgentRunMetrics(project),
    governanceSnapshot: buildGovernanceSnapshot(project),
    clarifyingAnswers: agentId ? project.clarifyingAnswers?.[agentId] : undefined,
  };
}
export interface PipelineCallbacks {
  onAgentStart: (agentId: AgentId) => void;
  onAgentComplete: (agentId: AgentId, output: string) => void;
  onAgentError: (agentId: AgentId, error: string) => void;
  onPhaseComplete: (phase: PhaseId) => void;
  onGateReached: (gateId: ReviewGateId) => void;
  /**
   * Fired instead of running an agent's generation call when
   * AgentDefinition.needsClarifyingQuestions is true and
   * project.clarifyingAnswers has no entry for it yet (see
   * services/clarifyingQuestions.ts). The pipeline halts exactly like a
   * review gate — the caller shows a modal, persists the answers to
   * project.clarifyingAnswers[agentId], and resumes the pipeline from the
   * same phase once submitted.
   */
  onClarifyingQuestionsNeeded: (agentId: AgentId, questions: string[]) => void;
  onPipelineComplete: () => void;
  onPipelineError: (error: string) => void;
}

// Which phases precede each gate — derive lookup from REVIEW_GATES
const GATE_BEFORE_PHASE: Partial<Record<PhaseId, ReviewGateId>> = {};
for (const [gateId, phases] of Object.entries(REVIEW_GATES)) {
  // Gate fires after the last phase listed; block the *next* phase sequence.
  // Gates with no phases (e.g. gate6, now unused since phase6 is empty) never fire.
  if (phases.length === 0) continue;
  const lastPhase = phases[phases.length - 1] as PhaseId;
  GATE_BEFORE_PHASE[lastPhase] = gateId as ReviewGateId;
}

// Map gate → which phase follows it
const GATE_AFTER_PHASE_INDEX: Record<ReviewGateId, number> = {
  // gate0 blocks phase1 (and everything after) until orchestration, token optimization,
  // plan (phase0) is approved by a project owner or admin.
  gate0: PHASE_ORDER.indexOf('phase1'),
  gate1: PHASE_ORDER.indexOf('phase2'),
  gate2: PHASE_ORDER.indexOf('phase3'),
  gate3: PHASE_ORDER.indexOf('phase4'),
  // phase6 is now empty (securityCompliance moved to phase3b, gated by gate3), so gate5
  // unlocks phase7 directly, skipping the empty phase6.
  gate5: PHASE_ORDER.indexOf('phase7'),
  // gate6 is unused (phase6 has no agents to gate) — value is never consulted because
  // GATE_BEFORE_PHASE never maps to 'gate6' (REVIEW_GATES.gate6 is empty), but the
  // Record<ReviewGateId, number> type requires an entry.
  gate6: PHASE_ORDER.indexOf('phase7'),
};

export class PipelineEngine {
  private projectId: string;
  private callbacks: PipelineCallbacks;
  private aborted = false;
  private queue = new PQueue({ concurrency: 3 });

  constructor(projectId: string, callbacks: PipelineCallbacks) {
    this.projectId = projectId;
    this.callbacks = callbacks;
  }

  abort() {
    this.aborted = true;
    this.queue.clear();
  }

  async run(startFromPhase?: PhaseId): Promise<void> {
    const project = await getProject(this.projectId);
    if (!project) {
      this.callbacks.onPipelineError('Project not found');
      return;
    }

    // Mark project as running
    await updateProject(this.projectId, (p) => { p.status = 'running'; });

    const startIdx = startFromPhase ? PHASE_ORDER.indexOf(startFromPhase) : 0;

    try {
      for (let i = startIdx; i < PHASE_ORDER.length; i++) {
        if (this.aborted) break;

        const phase = PHASE_ORDER[i];

        // Check if a review gate precedes this phase index
        // (i.e., gate must have been approved before we run this phase)
        const requiredGate = this.getGateRequiredBefore(i);
        if (requiredGate) {
          const freshProject = await getProject(this.projectId);
          const gate = freshProject?.reviewGates[requiredGate];
          if (!gate?.approved) {
            // Pause — emit gate event and stop
            this.callbacks.onGateReached(requiredGate);
            await updateProject(this.projectId, (p) => { p.status = 'paused'; p.currentPhase = phase; });
            return;
          }
        }

        await updateProject(this.projectId, (p) => { p.currentPhase = phase; });
        await this.runPhase(phase);
        this.callbacks.onPhaseComplete(phase);

        // Check if a gate fires *after* this phase
        const gateAfter = GATE_BEFORE_PHASE[phase];
        if (gateAfter) {
          const freshProject = await getProject(this.projectId);
          const gate = freshProject?.reviewGates[gateAfter];
          if (!gate?.approved) {
            this.callbacks.onGateReached(gateAfter);
            // Set currentPhase to the NEXT phase so resume starts there, not here
            const nextPhase = PHASE_ORDER[i + 1] as PhaseId | undefined;
            await updateProject(this.projectId, (p) => {
              p.status = 'paused';
              if (nextPhase) p.currentPhase = nextPhase;
            });
            return;
          }
        }
      }

      if (!this.aborted) {
        await updateProject(this.projectId, (p) => { p.status = 'complete'; });
        this.callbacks.onPipelineComplete();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateProject(this.projectId, (p) => { p.status = 'error'; });
      this.callbacks.onPipelineError(msg);
    }
  }

  private getGateRequiredBefore(phaseIndex: number): ReviewGateId | null {
    for (const [gateId, phaseIdx] of Object.entries(GATE_AFTER_PHASE_INDEX)) {
      if (phaseIdx === phaseIndex) return gateId as ReviewGateId;
    }
    return null;
  }

  private async runPhase(phase: PhaseId): Promise<void> {
    const agentIds = PHASE_AGENTS[phase];
    const isParallel = PARALLEL_PHASES.has(phase);

    if (isParallel) {
      await Promise.all(agentIds.map((agentId) => this.queue.add(() => this.runAgent(agentId))));
      await this.queue.onIdle();
    } else {
      for (const agentId of agentIds) {
        if (this.aborted) return;
        await this.runAgent(agentId);
      }
    }
  }

  private async runAgent(agentId: AgentId): Promise<void> {
    if (this.aborted) return;

    const def = AGENT_DEFINITIONS[agentId];
    if (!def) throw new Error(`Agent definition not found: ${agentId}`);

    const project = await getProject(this.projectId);
    if (!project) throw new Error('Project disappeared');

    // Skip if already complete (resume support)
    if (project.agentRuns[agentId]?.status === 'complete') return;

    // Skip if nobody's assigned to this agent (see lib/agentEnablement.ts) —
    // marks the run 'skipped' rather than calling the LLM. Already-skipped
    // runs are also short-circuited here so re-running the phase doesn't
    // re-attempt them. An admin can override via project.skippedAgentIds.
    if (isAgentSkipped(project, agentId)) {
      if (project.agentRuns[agentId]?.status !== 'skipped') {
        await updateAgentRun(this.projectId, agentId, {
          agentId,
          status: 'skipped',
          completedAt: Date.now(),
        });
      }
      return;
    }

    // Pre-generation clarifying questions (see AgentDefinition.needsClarifyingQuestions,
    // services/clarifyingQuestions.ts). Initial pipeline execution pauses until
    // the agent has at least one persisted, meaningful answer set. Manual reruns
    // deliberately ask a fresh round in ProjectWorkspace using the latest
    // project and dependency context. Halts exactly like a review gate: sets this.aborted
    // so the outer run() loop stops advancing (same mechanism the Stop button
    // uses), and leaves the project 'paused' at this agent's phase for the UI
    // to resume from once the modal is answered.
    if (def.needsClarifyingQuestions && !hasMeaningfulClarifyingAnswers(project.clarifyingAnswers?.[agentId])) {
      const ctx = this.buildContext(project, agentId);
      const questions = await generateClarifyingQuestions(agentId, ctx, this.projectId);
      this.aborted = true;
      this.callbacks.onClarifyingQuestionsNeeded(agentId, questions);
      await updateProject(this.projectId, (p) => { p.status = 'paused'; p.currentPhase = def.phase; });
      return;
    }

    this.callbacks.onAgentStart(agentId);

    // Per-agent provider routing: a specific MODEL_CATALOG assignment (e.g.
    // an admin-assigned Hugging Face model) takes priority over the legacy
    // openai/claude hint, which takes priority over the backend default.
    // Resolved up front so the UI can show which provider is expected to
    // execute this agent while the run is still in progress.
    const modelAssignments = await getAgentModelAssignments();
    const providerHints = await getAgentProviderHints();
    const assignedModelId = modelAssignments[agentId];
    const providerHint = providerHints[agentId];
    const provider = assignedModelId ?? (providerHint && providerHint !== 'auto' ? providerHint : undefined);

    await updateAgentRun(this.projectId, agentId, {
      agentId,
      status: 'running',
      startedAt: Date.now(),
      pendingProvider: provider ?? 'auto',
    });

    // Persist to runtime DB (fire-and-forget — down runtime must not block execution)
    const runtimeRunId = await syncRunStart({
      project_id: this.projectId,
      agent_key: agentId,
      goal: typeof def.goal === 'function' ? def.goal(this.buildContext(project, agentId)) : undefined,
      provider: provider ?? 'auto',
    });

    try {
      const ctx = this.buildContext(project, agentId);

      // Resolve system prompt with precedence:
      // 1. project-level override (promptOverrides) — set via Review Gate "Save for this project"
      // 2. app-level default (app:promptDefaults) — set via App Settings → Agent Prompts
      // 3. hardcoded AGENT_DEFINITIONS[agentId].systemPrompt
      const appDefaults = await getPromptDefaults();
      let systemPrompt = appDefaults[agentId] ?? def.systemPrompt;
      try {
        const governed = await getGovernedEffectivePrompt(agentId, this.projectId);
        if (governed.prompt) systemPrompt = governed.prompt;
      } catch {
        // Governance APIs are progressive enhancement; keep legacy resolution available.
      }

      const override = project.promptOverrides.find((o) => o.agentId === agentId);
      if (override && systemPrompt === (appDefaults[agentId] ?? def.systemPrompt)) {
        if (override.fullPrompt) {
          // Full replacement prompt saved by the user
          systemPrompt = override.fullPrompt;
        } else if (override.patch.length > 0 && project.mode === 'expert') {
          // Legacy JSON Patch — dynamic import to keep bundle lean
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { applyPatch } = await import('fast-json-patch') as any;
          const doc = { systemPrompt };
          applyPatch(doc, override.patch);
          systemPrompt = doc.systemPrompt;
        }
      }

      const userPrompt = def.buildUserPrompt(ctx);

      // ── L3 path: agent declares goal + tools → plan/act/observe/revise loop ──
      const isL3 = typeof def.goal === 'function' && (def.tools?.length ?? 0) > 0;

      let output: string;
      let tokensUsed: number;
      let respProvider: 'openai' | 'claude' | 'openai-compatible' | undefined;
      let respModel: string | undefined;
      let l3Meta: L3RuntimeMeta | undefined;

      if (isL3) {
        const l3Result = await runL3Agent(def, ctx, {
          systemPrompt,
          userPrompt,
          agentId,
          provider,
          projectId: this.projectId,
        });
        output = l3Result.output;
        tokensUsed = l3Result.tokensUsed;
        respProvider = l3Result.provider;
        respModel = l3Result.model;
        l3Meta = l3Result.l3;
      } else {
        // ── L2 path (original single-shot call) ─────────────────────────────
        // H-07 fix: 120s per-agent timeout
        const resp = await api.callAgent({ systemPrompt, userPrompt, agentId, provider, projectId: this.projectId, signal: AbortSignal.timeout(120_000) });
        output = api.extractText(resp);
        tokensUsed = resp.usage?.total_tokens ?? 0;
        respProvider = resp.provider;
        respModel = resp.model;
      }

      // ── Corrective check for uxMockups — fires for BOTH L3 and L2 paths ──
      if (agentId === 'uxMockups') {
        const desiredHtmlCount = Math.min(Math.max(ctx.mockupVersionCount ?? 2, 1), 4);
        const corrected = await applyUxMockupsCorrectiveCheck(systemPrompt, userPrompt, output, desiredHtmlCount, provider, this.projectId);
        if (corrected.output !== output) {
          output = corrected.output;
          tokensUsed += corrected.extraTokens;
          if (corrected.provider) respProvider = corrected.provider;
          if (corrected.model) respModel = corrected.model;
        }
      } else if (agentId === 'architecture') {
        const corrected = await applyArchitectureCorrectiveCheck(systemPrompt, userPrompt, output, provider, this.projectId);
        if (corrected.output !== output) {
          output = corrected.output;
          tokensUsed += corrected.extraTokens;
          if (corrected.provider) respProvider = corrected.provider;
          if (corrected.model) respModel = corrected.model;
        }
      }

      await updateAgentRun(this.projectId, agentId, {
        agentId,
        status: 'complete',
        output,
        tokensUsed,
        provider: respProvider,
        model: respModel,
        completedAt: Date.now(),
        ...(l3Meta ? { l3: l3Meta } : {}),
      });
      if (!isInternalAgent(agentId)) {
        const eventContext: AgentPromptContext = {
          ...ctx,
          priorOutputs: { ...ctx.priorOutputs, [agentId]: output },
        };
        void emitLifecycleEvent({
          projectId: this.projectId,
          eventType: 'agent_completed',
          idempotencyKey: 'agent-completed:' + this.projectId + ':' + agentId + ':' + (runtimeRunId ?? Date.now()),
          agentKey: agentId,
          tokensUsed,
          contextChars: JSON.stringify(eventContext).length,
          context: eventContext,
        }).catch((error) => console.warn('[lifecycle] completion event was not queued:', error));
      }
      syncRunSucceed(runtimeRunId, output);
      this.callbacks.onAgentComplete(agentId, output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateAgentRun(this.projectId, agentId, {
        agentId,
        status: 'error',
        error: msg,
        completedAt: Date.now(),
      });
      syncRunFail(runtimeRunId, msg);
      this.callbacks.onAgentError(agentId, msg);
      throw err;
    }
  }


  private buildContext(project: Project, agentId?: AgentId) {
    return buildAgentPromptContext(project, agentId);
  }
}

// ─── Standalone single-agent runner (used by Re-run in ProjectWorkspace) ──────
//
// This is the canonical path for running a single agent — it goes through the
// same L3/L2 routing logic as the full pipeline, writes l3Meta to the run, and
// fires onAgentStart / onAgentComplete / onAgentError callbacks so the UI
// updates in real-time exactly the same way as the full pipeline does.
//
// ProjectWorkspace re-run MUST call this instead of api.callAgent directly.

export interface SingleAgentCallbacks {
  onStart?: () => void;
  onComplete?: (output: string) => void;
  onError?: (error: string) => void;
}

export interface SingleAgentOptions {
  /** Override the provider resolved from app-level hints. 'auto' behaves the same as omitting. */
  providerOverride?: 'openai' | 'claude' | 'auto';
}

// ─── Shared corrective check for uxMockups ────────────────────────────────────
// Fires after both L2 and L3 paths. If the LLM produced fewer HTML blocks than
// `desiredHtmlCount`, retries once with a targeted corrective prompt.
// Used by both PipelineEngine.runAgent and runSingleAgent so the logic never drifts.
async function applyUxMockupsCorrectiveCheck(
  systemPrompt: string,
  userPrompt: string,
  existingOutput: string,
  desiredHtmlCount: number,
  provider?: 'openai' | 'claude' | (string & {}),
  projectId?: string,
): Promise<{ output: string; extraTokens: number; provider?: 'openai' | 'claude' | 'openai-compatible'; model?: string }> {
  const htmlBlockCount = (existingOutput.match(/```html/g) ?? []).length;
  if (htmlBlockCount >= desiredHtmlCount) {
    return { output: existingOutput, extraTokens: 0 };
  }
  try {
    const correctivePrompt =
      userPrompt +
      `\n---\nYour response contained ${htmlBlockCount} \`\`\`html fenced code block${
        htmlBlockCount !== 1 ? 's' : ''
      } but you must produce EXACTLY ${desiredHtmlCount}. Do not describe screens in prose, do not use placeholder image links (e.g. via.placeholder.com). Respond again with EXACTLY ${desiredHtmlCount} complete \`\`\`html fenced code blocks, each a full standalone HTML document starting with <!DOCTYPE html> and containing all mockup markup and inline <style>. Each version must use its assigned distinct color theme — no color overlap between versions.`;
    const retryResp = await api.callAgent({
      systemPrompt,
      userPrompt: correctivePrompt,
      agentId: 'uxMockups',
      provider,
      projectId,
      signal: AbortSignal.timeout(180_000),
    });
    const retryOutput = api.extractText(retryResp);
    if ((retryOutput.match(/```html/g) ?? []).length > htmlBlockCount) {
      return {
        output: retryOutput,
        extraTokens: retryResp.usage?.total_tokens ?? 0,
        provider: retryResp.provider,
        model: retryResp.model,
      };
    }
  } catch {
    /* corrective retry failed — keep original output */
  }
  return { output: existingOutput, extraTokens: 0 };
}

async function applyArchitectureCorrectiveCheck(
  systemPrompt: string,
  userPrompt: string,
  existingOutput: string,
  provider?: 'openai' | 'claude' | (string & {}),
  projectId?: string,
): Promise<{ output: string; extraTokens: number; provider?: 'openai' | 'claude' | 'openai-compatible'; model?: string }> {
  const diagramCount = (existingOutput.match(/```mermaid\s*[\r\n]/gi) ?? []).length;
  if (diagramCount >= 4) return { output: existingOutput, extraTokens: 0 };

  try {
    const retryResp = await api.callAgent({
      systemPrompt,
      userPrompt: userPrompt +
        '\n---\nARCHITECTURE OUTPUT CORRECTION REQUIRED: The response contained ' + diagramCount +
        ' fenced Mermaid diagram(s), but at least four separate image-renderable diagrams are required. Regenerate the COMPLETE ADD and include separate mermaid fenced blocks for: (1) System Context flowchart, (2) Container/Component flowchart, (3) Deployment/Infrastructure flowchart, and (4) Core Runtime sequenceDiagram. Preserve the user latest rerun instructions and all ten ADD sections. Do not substitute ASCII diagrams.',
      agentId: 'architecture',
      provider,
      projectId,
      signal: AbortSignal.timeout(180_000),
    });
    const retryOutput = api.extractText(retryResp);
    const retryDiagramCount = (retryOutput.match(/```mermaid\s*[\r\n]/gi) ?? []).length;
    if (retryDiagramCount >= 4) {
      return {
        output: retryOutput,
        extraTokens: retryResp.usage?.total_tokens ?? 0,
        provider: retryResp.provider,
        model: retryResp.model,
      };
    }
  } catch {
    // Keep the original output when the targeted correction fails.
  }
  return { output: existingOutput, extraTokens: 0 };
}

export async function runSingleAgent(
  projectId: string,
  agentId: AgentId,
  systemPromptOverride: string,
  callbacks: SingleAgentCallbacks = {},
  userPromptExtra = '',
  options: SingleAgentOptions = {},
): Promise<void> {
  const def = AGENT_DEFINITIONS[agentId];
  if (!def) throw new Error(`Agent definition not found: ${agentId}`);

  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  callbacks.onStart?.();

  // Resolve provider: explicit override → assigned MODEL_CATALOG entry → app-level hint → undefined (backend default)
  const modelAssignments = await getAgentModelAssignments();
  const providerHints = await getAgentProviderHints();
  const overrideVal = options.providerOverride && options.providerOverride !== 'auto'
    ? options.providerOverride
    : undefined;
  const assignedModelId = modelAssignments[agentId];
  const hintVal = providerHints[agentId] && providerHints[agentId] !== 'auto'
    ? (providerHints[agentId] as 'openai' | 'claude')
    : undefined;
  const provider = overrideVal ?? assignedModelId ?? hintVal;

  await updateAgentRun(projectId, agentId, {
    agentId,
    status: 'running',
    startedAt: Date.now(),
    pendingProvider: provider ?? 'auto',
  });

  // Persist to runtime DB (fire-and-forget — down runtime must not block execution)
  const runtimeRunId = await syncRunStart({
    project_id: projectId,
    agent_key: agentId,
    provider: provider ?? 'auto',
  });

  try {
    const ctx = buildAgentPromptContext(project, agentId);
    const userPrompt = def.buildUserPrompt(ctx) +
      (userPromptExtra.trim() ? `

---

## Additional Instructions
${userPromptExtra.trim()}` : '');

    // ── L3 or L2 routing — same logic as PipelineEngine.runAgent ──────────
    const isL3 = typeof def.goal === 'function' && (def.tools?.length ?? 0) > 0;

    let output: string;
    let tokensUsed: number;
    let respProvider: 'openai' | 'claude' | 'openai-compatible' | undefined;
    let respModel: string | undefined;
    let l3Meta: L3RuntimeMeta | undefined;

    if (isL3) {
      const l3Result = await runL3Agent(def, ctx, {
        systemPrompt: systemPromptOverride,
        userPrompt,
        agentId,
        provider,
        projectId,
      });
      output = l3Result.output;
      tokensUsed = l3Result.tokensUsed;
      respProvider = l3Result.provider;
      respModel = l3Result.model;
      l3Meta = l3Result.l3;
    } else {
      // H-07 fix: 120s timeout on single-agent re-run path
      const resp = await api.callAgent({
        systemPrompt: systemPromptOverride,
        userPrompt,
        agentId,
        provider,
        projectId,
        signal: AbortSignal.timeout(120_000),
      });

      output = api.extractText(resp);
      tokensUsed = resp.usage?.total_tokens ?? 0;
      respProvider = resp.provider;
      respModel = resp.model;
    }

    // ── Corrective check for uxMockups — fires for BOTH L3 and L2 paths ──
    if (agentId === 'uxMockups') {
      const desiredHtmlCount = Math.min(Math.max(ctx.mockupVersionCount ?? 2, 1), 4);
      const corrected = await applyUxMockupsCorrectiveCheck(systemPromptOverride, userPrompt, output, desiredHtmlCount, provider, projectId);
      if (corrected.output !== output) {
        output = corrected.output;
        tokensUsed += corrected.extraTokens;
        if (corrected.provider) respProvider = corrected.provider;
        if (corrected.model) respModel = corrected.model;
      }
    } else if (agentId === 'architecture') {
      const corrected = await applyArchitectureCorrectiveCheck(systemPromptOverride, userPrompt, output, provider, projectId);
      if (corrected.output !== output) {
        output = corrected.output;
        tokensUsed += corrected.extraTokens;
        if (corrected.provider) respProvider = corrected.provider;
        if (corrected.model) respModel = corrected.model;
      }
    }

    await updateAgentRun(projectId, agentId, {
      agentId,
      status: 'complete',
      output,
      tokensUsed,
      provider: respProvider,
      model: respModel,
      completedAt: Date.now(),
      ...(l3Meta ? { l3: l3Meta } : {}),
    });

    if (!isInternalAgent(agentId)) {
      const eventContext: AgentPromptContext = {
        ...ctx,
        priorOutputs: { ...ctx.priorOutputs, [agentId]: output },
      };
      void emitLifecycleEvent({
        projectId,
        eventType: 'agent_rerun',
        idempotencyKey: 'agent-rerun:' + projectId + ':' + agentId + ':' + (runtimeRunId ?? Date.now()),
        agentKey: agentId,
        tokensUsed,
        contextChars: JSON.stringify(eventContext).length,
        context: eventContext,
      }).catch((error) => console.warn('[lifecycle] rerun event was not queued:', error));
    }
    syncRunSucceed(runtimeRunId, output);
    callbacks.onComplete?.(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAgentRun(projectId, agentId, {
      agentId,
      status: 'error',
      error: msg,
      completedAt: Date.now(),
    });
    syncRunFail(runtimeRunId, msg);
    callbacks.onError?.(msg);
  }
}
