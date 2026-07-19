/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { PHASE_AGENTS, REVIEW_GATES } from '@/agents/constants';
import type { AgentId } from '@/types/agent.types';
import type { Project, ReviewGateId } from '@/types/project.types';

export interface GateReviewReadiness {
  ready: boolean;
  requiredAgentIds: AgentId[];
  pendingAgentIds: AgentId[];
}

export function getGateReviewReadiness(
  project: Project,
  gateId: ReviewGateId,
): GateReviewReadiness {
  const requiredAgentIds = (REVIEW_GATES[gateId] ?? [])
    .flatMap((phase) => PHASE_AGENTS[phase] ?? []);

  const pendingAgentIds = requiredAgentIds.filter((agentId) => {
    const run = project.agentRuns[agentId];
    if (run?.status === 'skipped') return false;
    return run?.status !== 'complete' || !(run.output ?? '').trim();
  });

  return {
    ready: requiredAgentIds.length > 0 && pendingAgentIds.length === 0,
    requiredAgentIds,
    pendingAgentIds,
  };
}
