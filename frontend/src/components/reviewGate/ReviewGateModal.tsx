/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState } from 'react';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { getEffectivePromptDefault } from '@/agents/promptDefaults';
import { REVIEW_GATES, PHASE_LABELS, PHASE_AGENTS } from '@/agents/constants';
import { getDomain } from '@/agents/domains';
import { updateAgentRun, updateProject } from '@/db/projectRepository';
import { api } from '@/services/api';
import { checkPromptInjection } from '@/utils/sanitize';
import { activateProjectPromptOverride } from '@/services/promptGovernance';
import { buildTeamRoster } from '@/data/roleTemplates';
import { useAuth } from '@/contexts/AuthContext';
import { getProjectExportPermission, getReviewGatePermission } from '@/lib/projectAccess';
import { isInternalAgent } from '@/lib/agentEnablement';
import { applyContextBudget, parseTokenOptimizerBudgets } from '@/agents/contextBudget';
import { DIAGRAM_AGENTS, hasMermaidDiagram } from '@/agents/diagramUtils';
import DocumentViewer from '../documents/DocumentViewer';
import DiagramPreview from '../documents/DiagramPreview';
import ExportMenu from '../documents/ExportMenu';
import type { Project, ReviewGateId } from '@/types/project.types';
import type { AgentId, PhaseId } from '@/types/agent.types';
import styles from './ReviewGateModal.module.css';

/** Which gate covers the given phase (i.e., gate fires AFTER this phase's group)? */
function gateForPhase(phase: PhaseId): ReviewGateId | undefined {
  return (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];
}

const GATE_LABELS: Record<ReviewGateId, string> = {
  gate0: 'Governed Plan Approval Gate',
  gate1: 'Phase 1 Review Gate',
  gate2: 'Phase 2 Review Gate',
  gate3: 'Phase 3 & 3B Review Gate',
  gate5: 'Phase 5 Review Gate',
  // gate6 is unused — phase6 is empty (securityCompliance now lives in phase3b,
  // covered by gate3). Retained only to satisfy Record<ReviewGateId, string>.
  gate6: '(Unused) Phase 6 Review Gate',
};

interface Props {
  gateId: ReviewGateId;
  project: Project;
  onApprove: (notes: string, approvedById?: string) => void;
  /** Rejection now always carries the (mandatory) review comment explaining
   *  why; actingAsId is the optional "Approving as..." selection, reused
   *  here for audit purposes even though selecting it isn't required to
   *  reject (only to approve — see approvedById validation below). */
  onReject: (notes: string, actingAsId?: string) => void;
  onClose: () => void;
}

type PanelMode = 'view' | 'edit' | 'prompt';

function initials(name: string) {
  return name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

// Which members are assigned to any agent in this gate's phases?
function getGateAssignees(project: Project, agents: AgentId[]) {
  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];
  const seen = new Set<string>();
  const result: Array<{ member: typeof members[0] }> = [];
  for (const agentId of agents) {
    const a = assignments.find((x) => x.agentId === agentId);
    if (a) {
      for (const memberId of (a.memberIds ?? [])) {
        if (!seen.has(memberId)) {
          const m = members.find((m) => m.id === memberId);
          if (m) { seen.add(memberId); result.push({ member: m }); }
        }
      }
    }
  }
  return result;
}

export default function ReviewGateModal({ gateId, project, onApprove, onReject, onClose }: Props) {
  const { user, adminMode, isAppAdmin } = useAuth();
  const phases = REVIEW_GATES[gateId];
  const agents: AgentId[] = phases.flatMap((p) => PHASE_AGENTS[p as PhaseId] ?? []).filter((agentId) => !isInternalAgent(agentId));
  const exportPermission = getProjectExportPermission(project, {
    adminMode,
    userEmail: user?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  });

  // Gate 0 is the mandatory governed-plan checkpoint. Unlike later gates,
  // it may be approved/rejected only by the authenticated Project Owner or
  // app admin; job-title exceptions are intentionally not accepted here.
  // PipelineEngine independently blocks Phase 1 until gate0 is approved.
  // Later gates retain the configured management/architecture-title policy.
  const gatePermission = getReviewGatePermission(project, {
    adminMode,
    isAppAdmin,
    userEmail: user?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  }, gateId);
  const canActOnGate = gatePermission.canAct;

  const [selectedAgent, setSelectedAgent] = useState<AgentId>(agents[0]);
  const [notes, setNotes] = useState('');
  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [approvedById, setApprovedById] = useState<string>('');
  const gate0ActorId = gatePermission.member?.id ?? user?.id ?? user?.email ?? '';
  const effectiveApprovedById = gateId === 'gate0' ? gate0ActorId : approvedById;
  // "Show Diagram" toggle for View mode — same DIAGRAM_AGENTS/hasMermaidDiagram
  // gating and Spec/Diagram tab pattern already used in ProjectWorkspace.tsx,
  // now also available in the review gate modal (2026-07-17).
  const [showDiagram, setShowDiagram] = useState(false);

  const members = project.teamMembers ?? [];
  const gateAssignees = getGateAssignees(project, agents);

  // Every agent under this gate must have a completed artifact before the
  // pipeline can be approved past this gate — otherwise downstream phases
  // would start from missing/partial context. Skipped agents (no team
  // member assigned — see lib/agentEnablement.ts) never produce an
  // artifact by design, so they don't block approval.
  const incompleteAgents = agents.filter((a) => {
    const status = project.agentRuns[a]?.status;
    return status !== 'complete' && status !== 'skipped';
  });
  const allAgentsComplete = incompleteAgents.length === 0;

  // Editable output state
  const [editedOutput, setEditedOutput] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Prompt sandbox state
  const [editedPrompt, setEditedPrompt] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [injectionWarning, setInjectionWarning] = useState<string | null>(null);
  // When true, the user has acknowledged the injection warning and wants to proceed
  const [injectionOverride, setInjectionOverride] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  const def = AGENT_DEFINITIONS[selectedAgent];
  const run = project.agentRuns[selectedAgent];

  // Agents that declare selectedAgent in their dependsOn — these consumed this agent's
  // output as input, so if its output changes they should be re-run to pick it up.
  const downstreamAgents = Object.values(AGENT_DEFINITIONS)
    .filter((d) => d.dependsOn?.includes(selectedAgent))
    .map((d) => d.name);

  function handleSelectAgent(agentId: AgentId) {
    setSelectedAgent(agentId);
    setPanelMode('view');
    setEditedOutput('');
    setEditedPrompt('');
    setDryRunResult(null);
    setInjectionWarning(null);
    setPromptSaved(false);
    setShowDiagram(false);
  }

  function startEdit() {
    setEditedOutput(run?.output ?? '');
    setPanelMode('edit');
  }

  async function startPromptEdit() {
    const savedOverride = project.promptOverrides?.find((o) => o.agentId === selectedAgent);
    if (savedOverride?.fullPrompt) {
      setEditedPrompt(savedOverride.fullPrompt);
    } else {
      // Fall back to the app-level default (App Settings → Agent Prompts), then the hardcoded prompt
      setEditedPrompt(await getEffectivePromptDefault(selectedAgent));
    }
    setInjectionWarning(null);
    setDryRunResult(null);
    setPromptSaved(false);
    setPanelMode('prompt');
  }

  // ── Save the current edited prompt as the project default for this agent ───
  async function savePromptForProject() {
    if (!editedPrompt.trim()) return;
    setSavingPrompt(true);
    try {
      await updateProject(project.id, (p) => {
        const existing = p.promptOverrides.findIndex((o) => o.agentId === selectedAgent);
        const entry = {
          agentId: selectedAgent,
          patch: [],
          fullPrompt: editedPrompt,
          updatedAt: Date.now(),
        };
        if (existing >= 0) {
          p.promptOverrides[existing] = entry;
        } else {
          p.promptOverrides.push(entry);
        }
      });
      setPromptSaved(true);
    } finally {
      setSavingPrompt(false);
    }
  }

  // ── AI-enhance the current edited prompt ────────────────────────────────────
  async function enhancePromptInSandbox() {
    if (!editedPrompt.trim()) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const improved = await api.enhancePrompt(editedPrompt, def?.name);
      if (improved) {
        handlePromptChange(improved);
        setPromptSaved(false);
      }
    } catch (e) {
      setEnhanceError(`Enhance failed: ${String(e)}`);
    } finally {
      setEnhancing(false);
    }
  }

  async function saveEdit() {
    if (!editedOutput.trim()) return;
    setSavingEdit(true);
    try {
      await updateAgentRun(project.id, selectedAgent, { output: editedOutput });
      setPanelMode('view');
    } finally {
      setSavingEdit(false);
    }
  }

  function handlePromptChange(value: string) {
    setEditedPrompt(value);
    setPromptSaved(false);
    setInjectionOverride(false);
    const check = checkPromptInjection(value);
    setInjectionWarning(check.safe ? null : `⚠ Possible prompt injection detected: ${check.matchedPattern}`);
  }

  async function runDryRun(forceRun = false) {
    if (!def) return;
    // If there's an injection warning and the user hasn't explicitly overridden it,
    // surface an inline confirmation instead of using the native confirm() dialog.
    if (injectionWarning && !injectionOverride && !forceRun) {
      // The JSX below shows a "Run anyway" button when injectionWarning is set
      // and injectionOverride is false — clicking it calls runDryRun(true).
      return;
    }
    setDryRunning(true);
    setDryRunResult(null);
    try {
      const domain = getDomain(project.domain);
      const rawPriorOutputs: Partial<Record<AgentId, string>> = {};
      for (const [id, run] of Object.entries(project.agentRuns)) {
        if (run?.status === 'complete' && run.output) rawPriorOutputs[id as AgentId] = run.output;
      }
      // Same context budget enforcement as the real pipeline run — see
      // agents/contextBudget.ts and buildAgentPromptContext() in
      // pipelineEngine.ts.
      const priorOutputs = applyContextBudget(
        rawPriorOutputs,
        parseTokenOptimizerBudgets(rawPriorOutputs.tokenOptimizer)
      );
      const domainContext = project.domainKnowledge
        ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
        : domain.context;
      const ctx = {
        projectName: project.name,
        projectDescription: project.description,
        domain: domain.id,
        domainContext,
        priorOutputs,
        teamRoster: buildTeamRoster(project),
      };
      const userPrompt = def.buildUserPrompt(ctx);
      const resp = await api.callAgent({
        systemPrompt: editedPrompt,
        userPrompt,
      });
      const output = api.extractText(resp);
      setDryRunResult(output);

      // Save this run as the agent's new artifact
      await updateAgentRun(project.id, selectedAgent, {
        agentId: selectedAgent,
        status: 'complete',
        output,
        tokensUsed: resp.usage?.total_tokens ?? 0,
        provider: resp.provider,
        model: resp.model,
        completedAt: Date.now(),
      });

      // The underlying document changed — require re-approval of its review gate
      const agentPhase = def.phase as PhaseId;
      const coveringGate = gateForPhase(agentPhase);
      if (coveringGate) {
        await updateProject(project.id, (p) => {
          if (p.reviewGates[coveringGate]) {
            p.reviewGates[coveringGate] = {
              ...p.reviewGates[coveringGate]!,
              approved: false,
              approvedAt: undefined,
              approvedBy: undefined,
              notes: `Prompt sandbox run of ${def.name} — re-approval required`,
            };
          }
          p.status = 'paused';
          p.currentPhase = agentPhase;
        });
      }

      // Show the new artifact immediately
      setPanelMode('view');
    } catch (e) {
      setDryRunResult(`Error: ${String(e)}`);
    } finally {
      setDryRunning(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <h2>{GATE_LABELS[gateId]}</h2>
            <p className={styles.subtitle}>
              Review outputs before the pipeline continues.
              Phases: {phases.map((p) => PHASE_LABELS[p as PhaseId]).join(', ')}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.closeBtn}
              onClick={onClose}
              title="Close (pipeline stays paused, no approval/rejection recorded)"
              aria-label="Close"
            >
              ✕
            </button>
            {/* Assigned reviewers badges */}
            {gateAssignees.length > 0 && (
              <div className={styles.assigneeBadges}>
                <span className={styles.assigneeLabel}>Assigned:</span>
                {gateAssignees.map(({ member }) => (
                  <span
                    key={member.id}
                    className={styles.assigneeBadge}
                    style={{ background: member.avatarColor }}
                    title={member.name + ' (' + member.role + ')'}
                  >
                    {initials(member.name)}
                  </span>
                ))}
              </div>
            )}
            {/* Approve/Reject controls: hidden entirely (not just disabled)
                when this viewer isn't allowed to act on the gate, or when an
                agent in these phases hasn't finished running yet — both are
                "not available" conditions, not "available but blocked" ones.
                This applies uniformly to every gate, including gate0 — see
                canActOnGate above. */}
            {!canActOnGate ? (
              <span className={styles.gateRestrictedNote} title={gatePermission.reason ?? undefined}>
                🔒 {gatePermission.reason}
              </span>
            ) : !allAgentsComplete ? (
              <span className={styles.gateRestrictedNote}>
                ⏳ Waiting on {incompleteAgents.length} agent{incompleteAgents.length === 1 ? '' : 's'} to finish: {' '}
                {incompleteAgents.map((a) => AGENT_DEFINITIONS[a]?.name ?? a).join(', ')}
              </span>
            ) : (
              <>
                {/* Approver selector — mandatory to approve (not to reject) */}
                {gateId === 'gate0' ? (
                  <span className={styles.actionRequiredHint}>
                    Approving as {gatePermission.member?.name ?? user?.email ?? 'authorized administrator'}
                  </span>
                ) : members.length > 0 && (
                  <select
                    value={approvedById}
                    onChange={(e) => setApprovedById(e.target.value)}
                    className={styles.approverSelect}
                    title="Who is approving?"
                  >
                    <option value="">Approving as... *</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                )}
                {/* Data-entry requirement hints — deliberately distinct from
                    .gateRestrictedNote (which means "you can't act on this
                    gate at all"). These mean "you can act, but this button
                    needs one more field filled in first" — the Review Notes
                    textarea is at the bottom of the modal, easy to miss, so
                    without this a disabled Reject button reads as a
                    permission bug instead of a validation state. */}
                {!notes.trim() && (
                  <span className={styles.actionRequiredHint}>* Comment required to reject (see Review Notes below)</span>
                )}
                <button
                  className="btn-danger"
                  onClick={() => onReject(notes, effectiveApprovedById || undefined)}
                  disabled={!notes.trim()}
                  title={!notes.trim() ? 'Add a review comment explaining the rejection before rejecting.' : undefined}
                >
                  Reject &amp; Stop
                </button>
                {!effectiveApprovedById && (
                  <span className={styles.actionRequiredHint}>* Select approver to continue</span>
                )}
                <button
                  className="btn-primary"
                  onClick={() => onApprove(notes, effectiveApprovedById || undefined)}
                  disabled={!effectiveApprovedById}
                  title={!effectiveApprovedById ? 'Select who is approving before continuing.' : undefined}
                >
                  Approve &amp; Continue ›
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.body}>
          {/* Agent list */}
          <div className={styles.agentList}>
            {agents.map((agentId) => {
              const d = AGENT_DEFINITIONS[agentId];
              const r = project.agentRuns[agentId];
              return (
                <button
                  key={agentId}
                  className={styles.agentTab + (selectedAgent === agentId ? ' ' + styles.activeTab : '')}
                  onClick={() => handleSelectAgent(agentId)}
                >
                  <span style={{ color: r?.status === 'complete' ? 'var(--success)' : 'var(--text-muted)', fontSize: 12 }}>
                    {r?.status === 'complete' ? '✓' : '○'}
                  </span>
                  <span>{d?.outputLabel ?? agentId}</span>
                </button>
              );
            })}
          </div>

          {/* Document panel */}
          <div className={styles.docPanel}>
            {/* Panel tab bar */}
            <div className={styles.panelTabs}>
              <button
                className={panelMode === 'view' ? styles.tabActive : styles.tab}
                onClick={() => setPanelMode('view')}
              >View</button>
              <button
                className={panelMode === 'edit' ? styles.tabActive : styles.tab}
                onClick={startEdit}
                disabled={run?.status !== 'complete'}
              >Edit Output</button>
              <button
                className={panelMode === 'prompt' ? styles.tabActive : styles.tab}
                onClick={startPromptEdit}
              >Prompt Sandbox</button>
              {/* Spec/Show Diagram toggle — same pattern and DIAGRAM_AGENTS
                  gating as ProjectWorkspace.tsx's own doc tabs, only shown
                  when this agent's output actually contains a Mermaid
                  diagram (see agents/diagramUtils.ts). */}
              {panelMode === 'view' && selectedAgent && DIAGRAM_AGENTS.has(selectedAgent) && hasMermaidDiagram(run?.output) && (
                <div className={styles.panelTabs} style={{ marginLeft: 12 }}>
                  <button
                    className={!showDiagram ? styles.tabActive : styles.tab}
                    onClick={() => setShowDiagram(false)}
                  >Spec</button>
                  <button
                    className={showDiagram ? styles.tabActive : styles.tab}
                    onClick={() => setShowDiagram(true)}
                  >Show Diagram</button>
                </div>
              )}
              {run?.status === 'complete' && run.output && (
                <div style={{ marginLeft: 'auto' }}>
                  <ExportMenu
                    agentId={selectedAgent}
                    project={project}
                    canExport={exportPermission.canExport}
                    disabledReason={exportPermission.reason}
                  />

                </div>
              )}
            </div>

            {/* View mode */}
            {panelMode === 'view' && (
              run?.status === 'complete' && run.output
                ? (showDiagram && DIAGRAM_AGENTS.has(selectedAgent) && hasMermaidDiagram(run.output)
                    ? (
                      <DiagramPreview
                        markdown={run.output}
                        canDownload={exportPermission.canExport}
                        downloadDisabledReason={exportPermission.reason}
                      />
                    )
                    : <DocumentViewer markdown={run.output} />)
                : <div className={styles.noOutput}>No output available for {def?.name}</div>
            )}

            {/* Edit output mode */}
            {panelMode === 'edit' && (
              <div className={styles.editPanel}>
                <p className={styles.editHint}>
                  Edit the agent output directly. Changes are saved to the project and will be used by downstream agents.
                </p>
                <textarea
                  value={editedOutput}
                  onChange={(e) => setEditedOutput(e.target.value)}
                  className={styles.editTextarea}
                />
                <div className={styles.editActions}>
                  <button className="btn-secondary" onClick={() => setPanelMode('view')}>Cancel</button>
                  <button className="btn-primary" onClick={saveEdit} disabled={savingEdit}>
                    {savingEdit ? 'Saving...' : 'Save Edits'}
                  </button>
                </div>
              </div>
            )}

            {/* Prompt sandbox mode */}
            {panelMode === 'prompt' && (
              <div className={styles.editPanel}>
                <p className={styles.editHint}>
                  Edit the system prompt for <strong>{def?.name}</strong>. "Run &amp; Update Output" executes this prompt against the OpenAI API,
                  replaces this agent's output with the result (visible in the View tab and exportable to Word), and resets this review gate for
                  re-approval. "Save for this project" makes this prompt the default for future runs of this agent.
                </p>
                {project.promptOverrides?.some((o) => o.agentId === selectedAgent) && !promptSaved && (
                  <p className={styles.editHint} style={{ color: 'var(--accent)' }}>
                    ✏ This agent has a saved custom prompt for this project.
                  </p>
                )}
                {injectionWarning && (
                  <div className={styles.injectionWarning}>
                    {injectionWarning}
                    {!injectionOverride && (
                      <button
                        style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}
                        className="btn-secondary"
                        onClick={() => { setInjectionOverride(true); runDryRun(true); }}
                      >
                        Run anyway
                      </button>
                    )}
                  </div>
                )}
                <textarea
                  value={editedPrompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  className={styles.editTextarea}
                  style={{ height: 180 }}
                />
                {enhanceError && (
                  <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>
                    ⚠ {enhanceError}
                  </p>
                )}
                {promptSaved && (
                  <p style={{ fontSize: 12, color: 'var(--success)', margin: 0 }}>
                    ✓ Saved as project default. Future runs of this agent will use this prompt.
                  </p>
                )}
                {downstreamAgents.length > 0 && (
                  <p className={styles.editHint} style={{ color: 'var(--accent)' }}>
                    ℹ {downstreamAgents.join(', ')} {downstreamAgents.length === 1 ? 'depends' : 'depend'} on this
                    agent's output. If you change it here, re-run {downstreamAgents.length === 1 ? 'that agent' : 'those agents'} too
                    so their inputs reflect the update — re-running picks up the latest saved output automatically.
                  </p>
                )}
                <div className={styles.editActions}>
                  <button className="btn-secondary" onClick={() => runDryRun()} disabled={dryRunning}>
                    {dryRunning ? '⟳ Running...' : '▷ Run & Update Output'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={enhancePromptInSandbox}
                    disabled={enhancing || !editedPrompt.trim()}
                    title="Use AI to rewrite this prompt for clarity and output quality"
                  >
                    {enhancing ? '⟳ Enhancing...' : '✨ Enhance prompt'}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={savePromptForProject}
                    disabled={savingPrompt || promptSaved || !editedPrompt.trim()}
                    title="Save this prompt as the default for future runs of this agent in this project"
                  >
                    {promptSaved ? '✓ Saved' : savingPrompt ? 'Saving...' : '💾 Save for this project'}
                  </button>
                </div>
                {dryRunResult && (
                  <div className={styles.dryRunResult}>
                    <strong>{dryRunResult.startsWith('Error:') ? 'Run failed:' : 'New output saved as artifact — see the View tab.'}</strong>
                    <pre>{dryRunResult}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Notes bar */}
        {/* Notes bar */}
        <div className={styles.notesBar}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Review Notes (optional to approve — required to reject)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes or feedback for this review gate... required if you're rejecting"
            rows={2}
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
}
