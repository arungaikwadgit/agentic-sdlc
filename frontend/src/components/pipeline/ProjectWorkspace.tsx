import { useState, useRef, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { updateProject, updateAgentRun } from '@/db/projectRepository';
import { PipelineEngine } from '@/services/pipelineEngine';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS, REVIEW_GATES } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { api } from '@/services/api';
import DocumentViewer from '../documents/DocumentViewer';
import ReviewGateModal from '../reviewGate/ReviewGateModal';
import ProjectSettings from '../settings/ProjectSettings';
import { initials } from '../settings/ProjectSettings';
import ExportMenu from '../documents/ExportMenu';
import GithubPushModal from '../documents/GithubPushModal';
import { exportTraceabilityCSV } from '@/services/traceability';
import { exportAllArtifactsZip } from '@/services/exporters/documentExporter';
import { exportPipelineMetricsXlsx } from '@/services/exporters/excelExporter';
import type { AgentId, PhaseId } from '@/types/agent.types';
import type { ReviewGateId } from '@/types/project.types';
import styles from './ProjectWorkspace.module.css';

// ── Gate locking ──────────────────────────────────────────────────────────────
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1',
  gate2_3: 'phase3',
  gate5: 'phase5',
  gate6: 'phase6',
};

function getLockedPhases(project: import('@/types/project.types').Project): Set<string> {
  const locked = new Set<string>();
  const phaseIndex = Object.fromEntries(PHASE_ORDER.map((p, i) => [p, i]));
  for (const [gateId, lastCoveredPhase] of Object.entries(GATE_UNLOCKS_AFTER)) {
    const gate = project.reviewGates?.[gateId as ReviewGateId];
    if (!gate?.approved) {
      const cutoff = phaseIndex[lastCoveredPhase] ?? -1;
      PHASE_ORDER.forEach((ph, i) => { if (i > cutoff) locked.add(ph); });
    }
  }
  return locked;
}

/** Which gate covers the given phase (i.e., gate fires AFTER this phase's group)? */
function gateForPhase(phase: PhaseId): ReviewGateId | undefined {
  return (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];
}

interface Props {
  projectId: string;
  onBack: () => void;
}

const STATUS_ICON: Record<string, string> = {
  idle: '○', running: '◌', complete: '✓', error: '✕', skipped: '–',
};
const STATUS_COLOR: Record<string, string> = {
  idle: 'var(--text-muted)', running: 'var(--accent)', complete: 'var(--success)',
  error: 'var(--error)', skipped: 'var(--text-muted)',
};

export default function ProjectWorkspace({ projectId, onBack }: Props) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [pendingGate, setPendingGate] = useState<ReviewGateId | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [downloadingArtifacts, setDownloadingArtifacts] = useState(false);
  const [showGithubPush, setShowGithubPush] = useState(false);
  const engineRef = useRef<PipelineEngine | null>(null);

  // ── Re-run state ────────────────────────────────────────────────────────────
  const [rerunAgent, setRerunAgent] = useState<AgentId | null>(null);
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [promptSaved, setPromptSaved] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  useEffect(() => {
    if (project && (project.teamMembers ?? []).length === 0) setShowTeamPanel(true);
  }, [project?.id]);

  const startPipeline = useCallback(async (fromPhase?: PhaseId) => {
    if (!project) return;
    setEngineRunning(true);
    const engine = new PipelineEngine(projectId, {
      onAgentStart: (agentId) => { setSelectedAgent(agentId); },
      onAgentComplete: (agentId) => { setSelectedAgent(agentId); },
      onAgentError: (_agentId, _err) => {},
      onPhaseComplete: (_phase) => {},
      onGateReached: (gateId) => { setEngineRunning(false); setPendingGate(gateId); },
      onPipelineComplete: () => { setEngineRunning(false); },
      onPipelineError: (_err) => { setEngineRunning(false); },
    });
    engineRef.current = engine;
    await engine.run(fromPhase);
  }, [project, projectId]);

  const handleStop = () => {
    engineRef.current?.abort();
    setEngineRunning(false);
    updateProject(projectId, (p) => { p.status = 'paused'; });
  };

  // ── Re-run: open panel, pre-fill with saved override or built-in default ───
  function openRerun(agentId: AgentId) {
    const def = AGENT_DEFINITIONS[agentId];
    const savedOverride = project?.promptOverrides?.find((o) => o.agentId === agentId);
    setRerunAgent(agentId);
    setRerunPrompt(savedOverride?.fullPrompt ?? def?.systemPrompt ?? '');
    setRerunError(null);
    setPromptSaved(false);
  }

  // ── Save the current rerunPrompt as the project default for this agent ─────
  async function savePromptOverride() {
    if (!rerunAgent || !project) return;
    await updateProject(projectId, (p) => {
      const existing = p.promptOverrides.findIndex((o) => o.agentId === rerunAgent);
      const entry = {
        agentId: rerunAgent,
        patch: [],
        fullPrompt: rerunPrompt,
        updatedAt: Date.now(),
      };
      if (existing >= 0) {
        p.promptOverrides[existing] = entry;
      } else {
        p.promptOverrides.push(entry);
      }
    });
    setPromptSaved(true);
  }

  // ── AI-enhance the current rerun prompt ─────────────────────────────────────
  async function enhanceRerunPrompt() {
    if (!rerunAgent) return;
    setEnhancing(true);
    setRerunError(null);
    try {
      const improved = await api.enhancePrompt(rerunPrompt, AGENT_DEFINITIONS[rerunAgent]?.name);
      if (improved) {
        setRerunPrompt(improved);
        setPromptSaved(false);
      }
    } catch (e) {
      setRerunError(`Enhance failed: ${String(e)}`);
    } finally {
      setEnhancing(false);
    }
  }

  // ── Reset saved override back to the built-in default ─────────────────────
  async function resetPromptOverride(agentId: AgentId) {
    await updateProject(projectId, (p) => {
      p.promptOverrides = p.promptOverrides.filter((o) => o.agentId !== agentId);
    });
    if (rerunAgent === agentId) {
      const def = AGENT_DEFINITIONS[agentId];
      setRerunPrompt(def?.systemPrompt ?? '');
      setPromptSaved(false);
    }
  }

  async function confirmRerun() {
    if (!rerunAgent || !project) return;
    const def = AGENT_DEFINITIONS[rerunAgent];
    if (!def) return;
    setRerunning(true);
    setRerunError(null);

    try {
      // Build context same as pipeline engine
      const { DOMAINS } = await import('@/agents/domains');
      const domain = DOMAINS[project.domain];
      const members = project.teamMembers ?? [];
      const assignments = project.agentAssignments ?? [];
      const priorOutputs: Partial<Record<AgentId, string>> = {};
      for (const [id, run] of Object.entries(project.agentRuns)) {
        if (run?.status === 'complete' && run.output) priorOutputs[id as AgentId] = run.output;
      }
      const teamRoster = members.map((m) => ({
        name: m.name, role: m.role,
        agents: assignments.filter((a) => a.memberIds.includes(m.id)).map((a) => a.agentId),
      }));
      // Prepend domain knowledge if set
      const domainContext = project.domainKnowledge
        ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
        : domain.context;
      const ctx = {
        projectName: project.name, projectDescription: project.description,
        domain: domain.id, domainContext, priorOutputs, teamRoster,
      };

      const userPrompt = def.buildUserPrompt(ctx);
      const resp = await api.callAgent({ systemPrompt: rerunPrompt, userPrompt });
      const output = api.extractText(resp);

      await updateAgentRun(projectId, rerunAgent, {
        agentId: rerunAgent, status: 'complete', output,
        tokensUsed: resp.usage?.total_tokens ?? 0, completedAt: Date.now(),
      });

      // If this agent lives in a gated phase, reset that gate so it needs re-approval
      const agentPhase = def.phase as PhaseId;
      const coveringGate = gateForPhase(agentPhase);
      if (coveringGate) {
        await updateProject(projectId, (p) => {
          if (p.reviewGates[coveringGate]) {
            p.reviewGates[coveringGate] = {
              ...p.reviewGates[coveringGate]!,
              approved: false,
              approvedAt: undefined,
              approvedBy: undefined,
              notes: `Re-run of ${def.name} — re-approval required`,
            };
            p.status = 'paused';
            p.currentPhase = agentPhase;
          }
        });
        setPendingGate(coveringGate);
      }

      setSelectedAgent(rerunAgent);
      setRerunAgent(null);
    } catch (e) {
      setRerunError(String(e));
    } finally {
      setRerunning(false);
    }
  }

  if (!project) return <div className={styles.loading}>Loading project...</div>;

  const members = project.teamMembers ?? [];
  const isAdmin = !!project.activeAdminId && members.find((m) => m.id === project.activeAdminId)?.isAdmin;
  const assignments = project.agentAssignments ?? [];
  const allAgentIds = PHASE_ORDER.flatMap((ph) => PHASE_AGENTS[ph]);
  const unmappedAgents = allAgentIds.filter(
    (a) => !(assignments.find((x) => x.agentId === a)?.memberIds?.length)
  );
  // Only one hard requirement: at least one team member. Agent mapping is optional.
  const teamReady = members.length > 0;
  const lockedPhases = getLockedPhases(project);
  const selectedRun = selectedAgent ? project.agentRuns[selectedAgent] : null;
  const selectedDef = selectedAgent ? AGENT_DEFINITIONS[selectedAgent] : null;
  const promptOverrideMap = new Set((project.promptOverrides ?? []).filter((o) => o.fullPrompt).map((o) => o.agentId));

  async function downloadAllArtifacts() {
    if (!project) return;
    const artifacts = allAgentIds
      .map((agentId) => {
        const run = project.agentRuns[agentId];
        if (run?.status !== 'complete' || !run.output) return null;
        const def = AGENT_DEFINITIONS[agentId];
        const agentLabel = def?.outputLabel ?? agentId;
        const phaseNumber = def ? PHASE_ORDER.indexOf(def.phase) + 1 : 0;
        return { title: agentLabel, markdown: run.output, phaseNumber, agentLabel };
      })
      .filter((a): a is { title: string; markdown: string; phaseNumber: number; agentLabel: string } => a !== null);

    if (artifacts.length === 0) {
      alert('No completed artifacts to download yet.');
      return;
    }

    setDownloadingArtifacts(true);
    try {
      await exportAllArtifactsZip(artifacts, project.name);
    } finally {
      setDownloadingArtifacts(false);
    }
  }

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <button className="btn-secondary" onClick={onBack} style={{ fontSize: 12 }}>← Dashboard</button>
        <div className={styles.projectInfo}>
          <h2>{project.name}</h2>
          <span className={styles.modeBadge}>{project.mode === 'expert' ? 'Expert' : 'Simple'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {engineRunning ? (
            <button className="btn-danger" onClick={handleStop}>Stop</button>
          ) : (
            <button
              className="btn-primary"
              onClick={() => startPipeline(project.currentPhase)}
              disabled={project.status === 'complete' || !teamReady}
              title={!teamReady ? 'Add at least one team member to run the pipeline' : undefined}
            >
              {project.status === 'draft' ? 'Run Pipeline' :
               project.status === 'paused' ? 'Resume Pipeline' :
               project.status === 'complete' ? 'Complete ✓' : 'Run Pipeline'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => exportPipelineMetricsXlsx(project)} style={{ fontSize: 12 }}>Metrics XLSX</button>
          <button className="btn-secondary" onClick={() => exportTraceabilityCSV(projectId, project.name)} style={{ fontSize: 12 }}>Traceability CSV</button>
          <button className="btn-secondary" onClick={downloadAllArtifacts} disabled={downloadingArtifacts} style={{ fontSize: 12 }}>
            {downloadingArtifacts ? 'Zipping...' : 'Download All Artifacts'}
          </button>
          <button className="btn-secondary" onClick={() => setShowTeamPanel(true)}>⚙ Settings</button>
          <button className="btn-secondary" onClick={() => updateProject(projectId, (p) => { p.mode = p.mode === 'simple' ? 'expert' : 'simple'; })}>
            {project.mode === 'simple' ? 'Expert Mode' : 'Simple Mode'}
          </button>
        </div>
      </header>

      {!teamReady && (
        <div className={styles.teamRequiredBanner}>
          <span>⚠ Add at least one team member before running the pipeline.</span>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setShowTeamPanel(true)}>Set Up Team →</button>
        </div>
      )}

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          {PHASE_ORDER.map((phase) => {
            const agents = PHASE_AGENTS[phase];
            const allComplete = agents.every((a) => project.agentRuns[a]?.status === 'complete');
            const isPhaseGateLocked = lockedPhases.has(phase);

            const gateAfterThisPhase = (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
              .find(([, phases]) => phases[phases.length - 1] === phase)?.[0];
            const gateBeforeThisPhase = (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
              .find(([gateId]) => {
                const cutoffPhase = GATE_UNLOCKS_AFTER[gateId];
                const cutoffIdx = PHASE_ORDER.indexOf(cutoffPhase as PhaseId);
                const phaseIdx = PHASE_ORDER.indexOf(phase as PhaseId);
                return phaseIdx === cutoffIdx + 1;
              })?.[0];
            const blockingGateState = gateBeforeThisPhase ? project.reviewGates?.[gateBeforeThisPhase] : undefined;
            const gateAfterState = gateAfterThisPhase ? project.reviewGates?.[gateAfterThisPhase] : undefined;
            const gateApprover = gateAfterState?.approvedBy
              ? project.teamMembers?.find((m) => m.id === gateAfterState.approvedBy)
              : undefined;
            const isActiveGate = pendingGate === gateAfterThisPhase;

            return (
              <div key={phase} className={`${styles.phaseGroup} ${isPhaseGateLocked ? styles.phaseGroupLocked : ''}`}>
                <div className={styles.phaseHeader}>
                  <span className={styles.phaseLabel}>{PHASE_LABELS[phase]}</span>
                  {isPhaseGateLocked
                    ? <span className={styles.phaseLockIcon}>🔒</span>
                    : allComplete && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓</span>}
                </div>
                {isPhaseGateLocked && (
                  <div className={styles.phaseLockedHint}>
                    Approve {blockingGateState ? 'the review gate above' : 'preceding gate'} to unlock
                  </div>
                )}
                {agents.map((agentId) => {
                  const run = project.agentRuns[agentId];
                  const def = AGENT_DEFINITIONS[agentId];
                  const status = run?.status ?? 'idle';
                  const isSelected = selectedAgent === agentId;
                  const isAgentUnmapped = unmappedAgents.includes(agentId);
                  const hasCustomPrompt = promptOverrideMap.has(agentId);
                  const assignment = project.agentAssignments?.find((a) => a.agentId === agentId);
                  const assignedMembers = assignment
                    ? (assignment.memberIds ?? []).map((id) => project.teamMembers?.find((m) => m.id === id)).filter(Boolean)
                    : [];
                  const isClickable = !isPhaseGateLocked && teamReady;
                  return (
                    <button
                      key={agentId}
                      className={`${styles.agentRow} ${isSelected ? styles.agentSelected : ''} ${isPhaseGateLocked ? styles.agentLocked : ''}`}
                      onClick={() => isClickable && setSelectedAgent(agentId)}
                      disabled={isPhaseGateLocked}
                      title={
                        isPhaseGateLocked ? 'Approve preceding gate to unlock' :
                        assignedMembers.length > 0 ? `Assigned: ${(assignedMembers as any[]).map((m: any) => m.name).join(', ')}` : undefined
                      }
                    >
                      <span style={{ color: isPhaseGateLocked ? 'var(--text-muted)' : STATUS_COLOR[status], fontFamily: 'monospace', fontSize: 13 }}>
                        {isPhaseGateLocked ? '🔒' : status === 'running' ? '⟳' : STATUS_ICON[status]}
                      </span>
                      <span className={styles.agentName}>{def?.name ?? agentId}</span>
                      {hasCustomPrompt && (
                        <span className={styles.customPromptBadge} title="Custom prompt saved">✏</span>
                      )}
                      <span className={styles.agentAvatars}>
                        {(assignedMembers as any[]).slice(0, 3).map((m: any) => (
                          <span key={m.id} className={styles.agentAvatar} style={{ background: m.avatarColor }} title={m.name}>
                            {initials(m.name)}
                          </span>
                        ))}
                        {assignedMembers.length > 3 && <span className={styles.agentAvatarMore}>+{assignedMembers.length - 3}</span>}
                      </span>
                    </button>
                  );
                })}

                {gateAfterThisPhase && (
                  <div
                    className={`${styles.gateIndicator} ${isActiveGate ? styles.gateActive : gateAfterState?.approved ? styles.gateApproved : styles.gatePending}`}
                    onClick={isActiveGate ? () => setPendingGate(gateAfterThisPhase as ReviewGateId) : undefined}
                    title={isActiveGate ? 'Waiting for approval — click to review' : gateAfterState?.approved ? `Approved${gateApprover ? ` by ${gateApprover.name}` : ''}` : 'Review gate'}
                  >
                    {isActiveGate ? '⏸ Waiting for your approval' :
                     gateAfterState?.approved ? `✓ Approved${gateApprover ? ` · ${gateApprover.name}` : ''}` :
                     '🔒 Review gate'}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main className={styles.content}>
          {/* ── Re-run panel (shown when user clicks Re-run) ── */}
          {rerunAgent && (
            <div className={styles.rerunPanel}>
              <div className={styles.rerunPanelTitle}>
                ↺ Re-run: {AGENT_DEFINITIONS[rerunAgent]?.name}
                {gateForPhase(AGENT_DEFINITIONS[rerunAgent]?.phase as PhaseId) && (
                  <span className={styles.rerunWarning}>
                    {' '}&mdash; Re-running will reset the gate and require re-approval.
                  </span>
                )}
              </div>

              {/* Saved-override indicator */}
              {promptOverrideMap.has(rerunAgent) && !promptSaved && (
                <p className={styles.overrideActive}>
                  ✏ Using saved custom prompt for this agent.{' '}
                  <button
                    className={styles.resetPromptBtn}
                    onClick={() => resetPromptOverride(rerunAgent)}
                  >
                    Reset to built-in default
                  </button>
                </p>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Edit the system prompt below. Save it as the project default so future pipeline runs also use it.
              </p>
              <textarea
                className={styles.rerunTextarea}
                value={rerunPrompt}
                onChange={(e) => { setRerunPrompt(e.target.value); setPromptSaved(false); }}
                rows={6}
              />
              {rerunError && <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>⚠ {rerunError}</p>}
              {promptSaved && <p style={{ fontSize: 12, color: 'var(--success)', margin: 0 }}>✓ Saved as project default. Future runs will use this prompt.</p>}
              <div className={styles.rerunActions}>
                <button className="btn-primary" onClick={confirmRerun} disabled={rerunning}>
                  {rerunning ? '⟳ Running...' : '▶ Confirm Re-run'}
                </button>
                <button
                  className={styles.savePromptBtn}
                  onClick={savePromptOverride}
                  disabled={rerunning || promptSaved}
                  title="Save this prompt as the default for future pipeline runs of this agent"
                >
                  {promptSaved ? '✓ Saved' : '💾 Save as project default'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={enhanceRerunPrompt}
                  disabled={rerunning || enhancing || !rerunPrompt.trim()}
                  title="Use AI to rewrite this prompt for clarity and output quality"
                >
                  {enhancing ? '⟳ Enhancing...' : '✨ Enhance prompt'}
                </button>
                <button className="btn-secondary" onClick={() => { setRerunAgent(null); setRerunError(null); setPromptSaved(false); }} disabled={rerunning}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedRun?.status === 'complete' && selectedDef && !rerunAgent ? (
            <div className={styles.docArea}>
              <div className={styles.docHeader}>
                <div>
                  <h3>{selectedDef.outputLabel}</h3>
                  <span className={styles.docMeta}>
                    {selectedRun.tokensUsed ? `${selectedRun.tokensUsed.toLocaleString()} tokens` : ''}
                    {selectedRun.completedAt ? ` · ${new Date(selectedRun.completedAt).toLocaleTimeString()}` : ''}
                    {promptOverrideMap.has(selectedAgent!) && (
                      <span className={styles.docCustomBadge} title="Generated with a custom saved prompt"> · ✏ custom prompt</span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className={styles.rerunBtn}
                    onClick={() => openRerun(selectedAgent!)}
                    title="Re-run this agent with an editable prompt"
                  >
                    ↺ Re-run
                  </button>
                  <ExportMenu agentId={selectedAgent!} project={project} />
                  {isAdmin && project.githubIntegrationId && (selectedAgent === 'sprintPlanner' || selectedAgent === 'taskBreakdown') && (
                    <button
                      className="btn-secondary"
                      onClick={() => setShowGithubPush(true)}
                      title="Parse this document into GitHub issues and push them to the connected repo"
                    >
                      ⇪ Push to GitHub
                    </button>
                  )}
                </div>
              </div>
              <DocumentViewer markdown={selectedRun.output ?? ''} />
              {showGithubPush && selectedAgent && (
                <GithubPushModal
                  project={project}
                  markdown={selectedRun.output ?? ''}
                  extraLabels={[selectedAgent === 'sprintPlanner' ? 'sprint-plan' : 'task-breakdown']}
                  sourceLabel={selectedDef?.outputLabel ?? selectedAgent}
                  onClose={() => setShowGithubPush(false)}
                />
              )}
            </div>
          ) : selectedRun?.status === 'running' || rerunning ? (
            <div className={styles.placeholder}>
              <div className={styles.spinner} />
              <p>{rerunning ? `Re-running ${selectedDef?.name ?? selectedAgent}...` : `${selectedDef?.name ?? selectedAgent} is running...`}</p>
            </div>
          ) : selectedRun?.status === 'error' ? (
            <div className={styles.placeholder} style={{ color: 'var(--error)' }}>
              <p>⚠ Error: {selectedRun.error}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" onClick={() => startPipeline(project.currentPhase)}>Retry Pipeline</button>
                <button className="btn-secondary" onClick={() => openRerun(selectedAgent!)}>↺ Re-run with edited prompt</button>
              </div>
            </div>
          ) : !rerunAgent ? (
            <div className={styles.placeholder}>
              <p style={{ color: 'var(--text-muted)' }}>
                {selectedAgent ? 'Run the pipeline to generate this document.' : 'Select an agent from the left panel.'}
              </p>
            </div>
          ) : null}
        </main>
      </div>

      {pendingGate && (
        <ReviewGateModal
          gateId={pendingGate}
          project={project}
          onApprove={async (notes, approvedById) => {
            await updateProject(projectId, (p) => {
              p.reviewGates[pendingGate] = {
                id: pendingGate, afterPhases: [], approved: true,
                approvedAt: Date.now(), approvedBy: approvedById, notes,
              };
            });
            setPendingGate(null);
            setEngineRunning(true);
            startPipeline(project.currentPhase);
          }}
          onReject={() => {
            setPendingGate(null);
            setEngineRunning(false);
            updateProject(projectId, (p) => { p.status = 'paused'; });
          }}
          onClose={() => setPendingGate(null)}
        />
      )}

      {showTeamPanel && (
        <ProjectSettings project={project} onClose={() => setShowTeamPanel(false)} />
      )}
    </div>
  );
}
