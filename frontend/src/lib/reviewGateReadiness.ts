/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { PHASE_AGENTS, REVIEW_GATES } from '@/agents/constants';
import { GATE_AFTER_PHASE_INDEX, getGateRequiredBeforePhase } from './agentEnablement';
import type { AgentId } from '@/types/agent.types';
import type { Project, ReviewGateId } from '@/types/project.types';

export interface GateReviewReadiness {
  ready: boolean;
  requiredAgentIds: AgentId[];
  pendingAgentIds: AgentId[];
  /**
   * Set when this gate's own required agents are done but it still can't be
   * approved because an earlier gate (per GATE_AFTER_PHASE_INDEX order) is
   * itself unapproved. Approving out of order is exactly how a real project
   * ended up with gate1 marked "approved" on 2026-07-29 while gate0 had
   * never been approved at all -- this readiness check previously only
   * looked at gateId's own required agents, so the review modal would
   * happily open (and let a human click Approve) on gate1 with gate0 still
   * wide open. Reuses getGateRequiredBeforePhase -- the same single source
   * of truth the pipeline engine and manual run-permission checks already
   * share -- so gate approval ordering can't drift from execution ordering.
   */
  blockedByEarlierGate?: ReviewGateId;
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

  const agentsReady = requiredAgentIds.length > 0 && pendingAgentIds.length === 0;

  const phaseIndex = GATE_AFTER_PHASE_INDEX[gateId];
  const earliestPendingGate = getGateRequiredBeforePhase(phaseIndex, project.reviewGates ?? {});
  const blockedByEarlierGate =
    earliestPendingGate && earliestPendingGate !== gateId ? earliestPendingGate : undefined;

  return {
    ready: agentsReady && !blockedByEarlierGate,
    requiredAgentIds,
    pendingAgentIds,
    blockedByEarlierGate,
  };
}
