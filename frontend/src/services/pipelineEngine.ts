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
import { getPromptDefaults } from '@/agents/promptDefaults';
import { DOMAINS } from '@/agents/domains';
import { buildTeamRoster } from '@/data/roleTemplates';
import { api } from './api';
import { updateAgentRun, updateProject, getProject } from '@/db/projectRepository';
import type { Project, ReviewGateId } from '@/types/project.types';
import type { AgentId, PhaseId } from '@/types/agent.types';

export interface PipelineCallbacks {
  onAgentStart: (agentId: AgentId) => void;
  onAgentComplete: (agentId: AgentId, output: string) => void;
  onAgentError: (agentId: AgentId, error: string) => void;
  onPhaseComplete: (phase: PhaseId) => void;
  onGateReached: (gateId: ReviewGateId) => void;
  onPipelineComplete: () => void;
  onPipelineError: (error: string) => void;
}

// Which phases precede each gate — derive lookup from REVIEW_GATES
const GATE_BEFORE_PHASE: Partial<Record<PhaseId, ReviewGateId>> = {};
for (const [gateId, phases] of Object.entries(REVIEW_GATES)) {
  // Gate fires after the last phase listed; block the *next* phase sequence
  const lastPhase = phases[phases.length - 1] as PhaseId;
  GATE_BEFORE_PHASE[lastPhase] = gateId as ReviewGateId;
}

// Map gate → which phase follows it
const GATE_AFTER_PHASE_INDEX: Record<ReviewGateId, number> = {
  gate1: PHASE_ORDER.indexOf('phase2'),
  gate2_3: PHASE_ORDER.indexOf('phase4'),
  gate5: PHASE_ORDER.indexOf('phase6'),
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

    this.callbacks.onAgentStart(agentId);
    await updateAgentRun(this.projectId, agentId, { agentId, status: 'running', startedAt: Date.now() });

    try {
      const ctx = this.buildContext(project);

      // Resolve system prompt with precedence:
      // 1. project-level override (promptOverrides) — set via Review Gate "Save for this project"
      // 2. app-level default (app:promptDefaults) — set via App Settings → Agent Prompts
      // 3. hardcoded AGENT_DEFINITIONS[agentId].systemPrompt
      const appDefaults = await getPromptDefaults();
      let systemPrompt = appDefaults[agentId] ?? def.systemPrompt;

      const override = project.promptOverrides.find((o) => o.agentId === agentId);
      if (override) {
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
      const resp = await api.callAgent({ systemPrompt, userPrompt });
      const output = api.extractText(resp);
      const tokensUsed = resp.usage?.total_tokens ?? 0;

      await updateAgentRun(this.projectId, agentId, {
        agentId,
        status: 'complete',
        output,
        tokensUsed,
        completedAt: Date.now(),
      });
      this.callbacks.onAgentComplete(agentId, output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateAgentRun(this.projectId, agentId, {
        agentId,
        status: 'error',
        error: msg,
        completedAt: Date.now(),
      });
      this.callbacks.onAgentError(agentId, msg);
      throw err; // re-throw so phase runner can decide whether to stop
    }
  }


  private buildContext(project: Project) {
    const domain = DOMAINS[project.domain];
    const priorOutputs: Partial<Record<AgentId, string>> = {};
    for (const [agentId, run] of Object.entries(project.agentRuns)) {
      if (run?.status === 'complete' && run.output) {
        priorOutputs[agentId as AgentId] = run.output;
      }
    }

    const teamRoster = buildTeamRoster(project);

    // Prepend user-edited domain knowledge to the built-in domain context
    const domainContext = project.domainKnowledge
      ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
      : domain.context;

    return {
      projectName: project.name,
      projectDescription: project.description,
      domain: domain.id,
      domainContext,
      priorOutputs,
      teamRoster,
      brandingGuidelines: project.brandingGuidelines,
    };
  }
}
