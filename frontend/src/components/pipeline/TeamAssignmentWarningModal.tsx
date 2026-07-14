/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * TeamAssignmentWarningModal
 *
 * Shown before the pipeline's first run (see ProjectWorkspace's Run
 * Pipeline button) when one or more agents have nobody assigned to them.
 * Only a project owner or admin can confirm — everyone else sees the same
 * information but must ask an owner/admin to proceed, mirroring how gate0
 * approval is scoped in ReviewGateModal.
 */
import { useState } from 'react';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import type { AgentId, PhaseId } from '@/types/agent.types';
import styles from './TeamAssignmentWarningModal.module.css';

interface Props {
  unassignedAgentIds: AgentId[];
  isAdmin: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onGoToTeamSetup: () => void;
}

export default function TeamAssignmentWarningModal({
  unassignedAgentIds, isAdmin, onConfirm, onCancel, onGoToTeamSetup,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const unassignedSet = new Set(unassignedAgentIds);

  const phaseGroups = PHASE_ORDER
    .map((phase) => {
      const agentsInPhase = PHASE_AGENTS[phase] ?? [];
      const unassignedInPhase = agentsInPhase.filter((a) => unassignedSet.has(a));
      return { phase, agentsInPhase, unassignedInPhase };
    })
    .filter((g) => g.unassignedInPhase.length > 0);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>⚠ Some agents have no team member assigned</h2>
          <p className={styles.subtitle}>
            {unassignedAgentIds.length} agent{unassignedAgentIds.length === 1 ? '' : 's'} listed below will be
            skipped when the pipeline runs — no one is assigned to produce their output. If an entire phase has
            no one assigned, that phase is skipped entirely. You can assign team members now instead, or continue
            and skip them (an admin can re-enable a skipped agent later).
          </p>
        </div>

        <div className={styles.body}>
          {phaseGroups.map(({ phase, agentsInPhase, unassignedInPhase }) => (
            <div key={phase} className={styles.phaseGroup}>
              <div className={styles.phaseLabel}>
                {PHASE_LABELS[phase as PhaseId]}
                {unassignedInPhase.length === agentsInPhase.length ? ' — entire phase will be skipped' : ''}
              </div>
              {unassignedInPhase.map((agentId) => (
                <div key={agentId} className={styles.agentRow}>
                  <span className={styles.warnIcon}>⚠</span>
                  <span>{AGENT_DEFINITIONS[agentId]?.name ?? agentId}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          {!isAdmin && (
            <span className={styles.footerNote}>
              Only a project owner or admin can confirm this — ask them to continue, or set up the team yourself.
            </span>
          )}
          <button className="btn-secondary" onClick={onGoToTeamSetup} disabled={confirming}>
            Set Up Team
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={confirming}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!isAdmin || confirming}
            title={!isAdmin ? 'Only a project owner or admin can confirm.' : undefined}
          >
            {confirming ? 'Continuing…' : 'Continue & Skip These Agents'}
          </button>
        </div>
      </div>
    </div>
  );
}
