/**
 * © 2026 Arun Gaikwad. All rights reserved.
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
  /** Admin/owner-only: run every unassigned agent normally instead of
   *  marking them skipped — see handleRunAnywayTeamWarning in
   *  ProjectWorkspace.tsx. Undefined for non-admin viewers (button hidden). */
  onRunAnyway?: () => void | Promise<void>;
  onCancel: () => void;
  onGoToTeamSetup: () => void;
}

export default function TeamAssignmentWarningModal({
  unassignedAgentIds, isAdmin, onConfirm, onRunAnyway, onCancel, onGoToTeamSetup,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [runningAnyway, setRunningAnyway] = useState(false);
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

  async function handleRunAnyway() {
    if (!onRunAnyway) return;
    setRunningAnyway(true);
    try {
      await onRunAnyway();
    } finally {
      setRunningAnyway(false);
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
            no one assigned, that phase is skipped entirely. You can assign team members now instead, skip them and
            continue (re-enable individually later from the sidebar), or — Admin/Owner only — run them all anyway
            without assigning anyone.
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
          <button className="btn-secondary" onClick={onGoToTeamSetup} disabled={confirming || runningAnyway}>
            Set Up Team
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={confirming || runningAnyway}>
            Cancel
          </button>
          {isAdmin && onRunAnyway && (
            <button
              className="btn-secondary"
              onClick={handleRunAnyway}
              disabled={confirming || runningAnyway}
              title="Run every listed agent normally instead of skipping it — no assignment required."
            >
              {runningAnyway ? 'Starting…' : 'Run All Agents Anyway'}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!isAdmin || confirming || runningAnyway}
            title={!isAdmin ? 'Only a project owner or admin can confirm.' : undefined}
          >
            {confirming ? 'Continuing…' : 'Continue & Skip These Agents'}
          </button>
        </div>
      </div>
    </div>
  );
}
