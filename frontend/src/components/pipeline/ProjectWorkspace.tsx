/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { updateProject, updateAgentRun } from '@/db/projectRepository';
import { PipelineEngine } from '@/services/pipelineEngine';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS, REVIEW_GATES, PHASE_SDLC_STAGE } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { getPromptDefaults } from '@/agents/promptDefaults';
import { api } from '@/services/api';
import DocumentViewer from '../documents/DocumentViewer';
import ReviewGateModal from '../reviewGate/ReviewGateModal';
import ProjectSettings from '../settings/ProjectSettings';
import { initials } from '../settings/ProjectSettings';
import ExportMenu from '../documents/ExportMenu';
import GithubPushModal from '../documents/GithubPushModal';
import AgentThinkingPanel from './AgentThinkingPanel';
import ReviewImprovePanel from './ReviewImprovePanel';
import MockupPreview from '../documents/MockupPreview';
import DiagramPreview from '../documents/DiagramPreview';
import OrchestratorView from './OrchestratorView';
import PrototypeViewer from '../documents/PrototypeViewer';
import { exportTraceabilityCSV } from '@/services/traceability';
import { exportAllArtifactsZip } from '@/services/exporters/documentExporter';
import { exportPipelineMetricsXlsx } from '@/services/exporters/excelExporter';
import type { AgentId, PhaseId } from '@/types/agent.types';
import type { ReviewGateId } from '@/types/project.types';
import styles from './ProjectWorkspace.module.css';

// ── Gate locking ──────────────────────────────────────────────────────────────
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1b',
  gate2: 'phase2',
  gate3: 'phase3b',
  gate5: 'phase5',
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

// Agents whose output contains Mermaid diagrams
const DIAGRAM_AGENTS = new Set<AgentId>([
  'dataModel', 'architecture', 'apiDesign', 'devopsEngineer', 'infraEngineer', 'observabilityEngineer',
]);

function providerLabel(p?: string): string {
  if (!p || p === 'auto') return '';
  return p === 'claude' ? 'Claude' : 'OpenAI';
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
  // useLiveQuery returns `undefined` while the query is initialising.
  // Once it resolves, undefined means "not found", so we track the first non-undefined result.
  const queryResult = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const hasResolved = useRef(false);
  if (queryResult !== undefined) hasResolved.current = true;
  const project = queryResult;
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [pendingGate, setPendingGate] = useState<ReviewGateId | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [downloadingArtifacts, setDownloadingArtifacts] = useState(false);
  const [showGithubPush, setShowGithubPush] = useState(false);
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const [docViewMode, setDocViewMode] = useState<'spec' | 'preview' | 'thinking'>('spec');
  const [showReview, setShowReview] = useState(false);
  const engineRef = useRef<PipelineEngine | null>(null);

  // ── Re-run state ────────────────────────────────────────────────────────────
  const [rerunAgent, setRerunAgent] = useState<AgentId | null>(null);
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunUserExtra, setRerunUserExtra] = useState('');
  const [promptSaved, setPromptSaved] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [rerunPendingProvider, setRerunPendingProvider] = useState<'openai' | 'claude' | 'auto'>('auto');

  // Auto-start flag: set by EditProjectModal "Save & Restart Pipeline"
  const [shouldAutoStart, setShouldAutoStart] = useState(() => {
    const key = `sdlc_autostart_${projectId}`;
    if (sessionStorage.getItem(key)) { sessionStorage.removeItem(key); return true; }
    return false;
  });

  // Once project loads and auto-start is requested, kick off the full pipeline
  useEffect(() => {
    if (!shouldAutoStart || !project) return;
    setShouldAutoStart(false);
    // Small delay so the workspace finishes rendering first
    const t = setTimeout(() => startPipeline(undefined), 300);
    return () => clearTimeout(t);
  }, [shouldAutoStart, project]);

  useEffect(() => {
    if (project && (project.teamMembers ?? []).length === 0) setShowTeamPanel(true);
  }, [project?.id]);

  // Check API key availability
  useEffect(() => {
    api.callAgent({ systemPrompt: 'ping', userPrompt: 'ping', testMode: true })
      .then(() => setApiReady(true))
      .catch(() => setApiReady(false));
  }, []);

  // Auto-switch to preview for orchestrator and prototype agents
  useEffect(() => {
    if (selectedAgent === 'sdlcOrchestrator' || selectedAgent === 'workingPrototype') {
      const run = project?.agentRuns[selectedAgent];
      if (run?.status === 'complete' && (run.output ?? '').length > 100) {
        setDocViewMode('preview');
      }
    } else {
      setDocViewMode('spec');
    }
    setShowReview(false);
  }, [selectedAgent]);

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

  // ── Re-run: open panel, pre-fill respecting the same 3-level precedence as pipelineEngine ──
  // Level 1: project.promptOverrides[agentId]          (project-specific saved prompt)
  // Level 2: app:promptDefaults[agentId]               (app-wide default via App Settings)
  // Level 3: AGENT_DEFINITIONS[agentId].systemPrompt   (hardcoded — always quality-upgraded)
  async function openRerun(agentId: AgentId) {
    const def = AGENT_DEFINITIONS[agentId];
    const savedOverride = project?.promptOverrides?.find((o) => o.agentId === agentId);
    let effectivePrompt: string;
    if (savedOverride?.fullPrompt) {
      effectivePrompt = savedOverride.fullPrompt;                          // Level 1
    } else {
      const appDefaults = await getPromptDefaults();
      effectivePrompt = appDefaults[agentId] ?? def?.systemPrompt ?? '';  // Level 2 or 3
    }
    setRerunAgent(agentId);
    setRerunPrompt(effectivePrompt);
    setRerunUserExtra('');
    setShowAdvanced(true);
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

  // ── Reset saved override back to the effective default (level 2 or 3) ──────
  async function resetPromptOverride(agentId: AgentId) {
    await updateProject(projectId, (p) => {
      p.promptOverrides = p.promptOverrides.filter((o) => o.agentId !== agentId);
    });
    if (rerunAgent === agentId) {
      const def = AGENT_DEFINITIONS[agentId];
      const appDefaults = await getPromptDefaults();
      setRerunPrompt(appDefaults[agentId] ?? def?.systemPrompt ?? '');
      setPromptSaved(false);
    }
  }

  async function confirmRerun() {
    if (!rerunAgent || !project) return;
    const def = AGENT_DEFINITIONS[rerunAgent];
    if (!def) return;

    const agentIdToRun = rerunAgent;

    // ── Full restart when re-running Phase 0 (sdlcOrchestrator) ──────────────
    // Clear all agent runs and review gates, save the (possibly edited) prompt
    // override, reset project status to draft, then kick off the full pipeline
    // from scratch so all phases re-run in sequence.
    if (agentIdToRun === 'sdlcOrchestrator') {
      setRerunning(true);
      setRerunError(null);
      try {
        await updateProject(projectId, (p) => {
          // Save the current rerun prompt as the persistent override for this agent
          const existing = p.promptOverrides.findIndex((o) => o.agentId === 'sdlcOrchestrator');
          const entry = { agentId: 'sdlcOrchestrator' as AgentId, patch: [] as object[], fullPrompt: rerunPrompt, updatedAt: Date.now() };
          if (existing >= 0) p.promptOverrides[existing] = entry;
          else p.promptOverrides.push(entry);

          // Wipe all previous runs and approvals
          p.agentRuns = {} as typeof p.agentRuns;
          p.reviewGates = {} as typeof p.reviewGates;
          p.status = 'draft';
          p.currentPhase = 'phase0';
        });
        setRerunAgent(null);
        setSelectedAgent(null);
        setPendingGate(null);
        // Start the full pipeline from Phase 0
        startPipeline(undefined);
      } catch (e) {
        setRerunError(String(e));
      } finally {
        setRerunning(false);
      }
      return;
    }

    setRerunning(true);
    setRerunError(null);

    try {
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
      const domainContext = project.domainKnowledge
        ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
        : domain.context;
      const ctx = {
        projectName: project.name, projectDescription: project.description,
        domain: domain.id, domainContext, priorOutputs, teamRoster,
        brandingGuidelines: project.brandingGuidelines,
      };

      const userPromptBase = def.buildUserPrompt(ctx);
      const userPrompt = rerunUserExtra.trim()
        ? `${userPromptBase}\n\n---\nAdditional instructions: ${rerunUserExtra.trim()}`
        : userPromptBase;

      const resp = await api.callAgent({
        systemPrompt: rerunPrompt,
        userPrompt,
        provider: rerunPendingProvider === 'auto' ? undefined : rerunPendingProvider,
        agentId: agentIdToRun,
      });
      const output = api.extractText(resp);

      await updateAgentRun(projectId, agentIdToRun, {
        agentId: agentIdToRun, status: 'complete', output,
        tokensUsed: resp.usage?.total_tokens ?? 0,
        completedAt: Date.now(),
        provider: resp.provider,
        model: resp.model,
      });

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

      setSelectedAgent(agentIdToRun);
      setRerunAgent(null);
    } catch (e) {
      setRerunError(String(e));
    } finally {
      setRerunning(false);
    }
  }

  // Still initialising (first render before useLiveQuery resolves)
  if (!hasResolved.current) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>Loading project…</p>
      </div>
    );
  }
  // Resolved but project is undefined — project doesn't exist in this database
  if (!project) {
    return (
      <div className={styles.loading} style={{ flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 48 }}>🔍</div>
        <h2 style={{ color: 'var(--text)', margin: 0 }}>Project not found</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          This project may have been deleted or doesn&apos;t exist on this device.
        </p>
        <button className="btn-primary" onClick={onBack}>{'← Back to Dashboard'}</button>
      </div>
    );
  }

  const members = project.teamMembers ?? [];
  const isAdmin = !!project.activeAdminId && members.find((m) => m.id === project.activeAdminId)?.isAdmin;
  const assignments = project.agentAssignments ?? [];
  const allAgentIds = PHASE_ORDER.flatMap((ph) => PHASE_AGENTS[ph]);
  const unmappedAgents = allAgentIds.filter(
    (a) => !(assignments.find((x) => x.agentId === a)?.memberIds?.length)
  );
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

  // ── Review & Improve: save enriched prompt and trigger re-run ───────────────
  async function handleReviewRegenerate(enrichedPrompt: string, _userExtra: string) {
    if (!selectedAgent || !project) return;
    // Save as project-level prompt override so it persists
    await updateProject(projectId, (p) => {
      const existing = p.promptOverrides.findIndex((o) => o.agentId === selectedAgent);
      const entry = {
        agentId: selectedAgent,
        patch: [] as object[],
        fullPrompt: enrichedPrompt,
        updatedAt: Date.now(),
      };
      if (existing >= 0) p.promptOverrides[existing] = entry;
      else p.promptOverrides.push(entry);
    });
    setShowReview(false);
    // Open the re-run panel pre-filled with the enriched prompt
    setRerunAgent(selectedAgent);
    setRerunPrompt(enrichedPrompt);
    setRerunUserExtra('');
    setPromptSaved(false);
  }

  // Helpers: avoid backtick string literals inside JSX (causes TSC JSX parse errors)
  const BACKTICK = String.fromCharCode(96);
  const hasMermaid = (s?: string | null) => (s ?? '').includes(BACKTICK + BACKTICK + BACKTICK + 'mermaid');
  const hasHtml    = (s?: string | null) => (s ?? '').includes(BACKTICK + BACKTICK + BACKTICK + 'html');

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <button className="btn-secondary" onClick={onBack} style={{ fontSize: 12 }}>&#8592; Dashboard</button>
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
               project.status === 'complete' ? 'Complete' : 'Run Pipeline'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => exportPipelineMetricsXlsx(project)} style={{ fontSize: 12 }}>Metrics XLSX</button>
          <button className="btn-secondary" onClick={() => exportTraceabilityCSV(projectId, project.name)} style={{ fontSize: 12 }}>Traceability CSV</button>
          <button className="btn-secondary" onClick={downloadAllArtifacts} disabled={downloadingArtifacts} style={{ fontSize: 12 }}>
            {downloadingArtifacts ? 'Zipping...' : 'Download All'}
          </button>
          <button className="btn-secondary" onClick={() => setShowTeamPanel(true)}>Settings</button>
          <button className="btn-secondary" onClick={() => updateProject(projectId, (p) => { p.mode = p.mode === 'simple' ? 'expert' : 'simple'; })}>
            {project.mode === 'simple' ? 'Expert Mode' : 'Simple Mode'}
          </button>
        </div>
      </header>

      {!teamReady && (
        <div className={styles.teamRequiredBanner}>
          <span>Add at least one team member before running the pipeline.</span>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setShowTeamPanel(true)}>Set Up Team</button>
        </div>
      )}

      {apiReady === false && (
        <div className={styles.noKeyBanner}>
          <span>No API key configured — agents cannot run.</span>
          <span className={styles.noKeyHint}>Go to Dashboard &#8594; App Settings &#8594; API &amp; Model tab to add your OpenAI or Claude key.</span>
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
                  <span className={styles.phaseHeaderText}>
                    <span className={styles.phaseLabel}>{PHASE_LABELS[phase]}</span>
                    {PHASE_SDLC_STAGE[phase] && (
                      <span className={styles.phaseStage}>{PHASE_SDLC_STAGE[phase]}</span>
                    )}
                  </span>
                  {isPhaseGateLocked
                    ? <span className={styles.phaseLockIcon}>&#x1F512;</span>
                    : allComplete && <span style={{ color: 'var(--success)', fontSize: 12 }}>&#x2713;</span>}
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
                        <span className={styles.customPromptBadge} title="Custom prompt saved">&#x270F;</span>
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
                    {isActiveGate ? 'Waiting for your approval' :
                     gateAfterState?.approved ? `Approved${gateApprover ? ` by ${gateApprover.name}` : ''}` :
                     'Review gate'}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main className={styles.content}>
          {/* ── Re-run panel ── */}
          {rerunAgent && (
            <div className={styles.rerunPanel}>
              <div className={styles.rerunPanelTitle}>
                Re-run: {AGENT_DEFINITIONS[rerunAgent]?.name}
                {gateForPhase(AGENT_DEFINITIONS[rerunAgent]?.phase as PhaseId) && (
                  <span className={styles.rerunWarning}>
                    {' '}&mdash; Re-running will reset the gate and require re-approval.
                  </span>
                )}
              </div>

              {promptOverrideMap.has(rerunAgent) && !promptSaved && (
                <p className={styles.overrideActive}>
                  Using saved custom prompt for this agent.{' '}
                  <button className={styles.resetPromptBtn} onClick={() => resetPromptOverride(rerunAgent)}>
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
              {rerunError && <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>{rerunError}</p>}
              {promptSaved && <p style={{ fontSize: 12, color: 'var(--success)', margin: 0 }}>Saved as project default.</p>}
              <div className={styles.rerunActions}>
                <button className="btn-primary" onClick={confirmRerun} disabled={rerunning}>
                  {rerunning ? 'Running...' : 'Confirm Re-run'}
                </button>
                <button
                  className={styles.savePromptBtn}
                  onClick={savePromptOverride}
                  disabled={rerunning || promptSaved}
                >
                  {promptSaved ? 'Saved' : 'Save as project default'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={enhanceRerunPrompt}
                  disabled={rerunning || enhancing || !rerunPrompt.trim()}
                >
                  {enhancing ? 'Enhancing...' : 'Enhance prompt'}
                </button>
                <button className="btn-secondary" onClick={() => { setRerunAgent(null); setRerunError(null); setPromptSaved(false); setRerunUserExtra(''); setShowAdvanced(false); }} disabled={rerunning}>
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
                    {selectedRun.provider ? `${selectedRun.provider === 'claude' ? 'Claude' : 'OpenAI'}${selectedRun.model ? ` · ${selectedRun.model}` : ''}` : ''}
                    {selectedRun.tokensUsed ? `${selectedRun.provider ? ' · ' : ''}${selectedRun.tokensUsed.toLocaleString()} tokens` : ''}
                    {selectedRun.completedAt ? ` · ${new Date(selectedRun.completedAt).toLocaleTimeString()}` : ''}
                    {promptOverrideMap.has(selectedAgent!) && (
                      <span className={styles.docCustomBadge} title="Generated with a custom saved prompt"> · custom prompt</span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selectedAgent && DIAGRAM_AGENTS.has(selectedAgent) && hasMermaid(selectedRun.output) && (
                    <div className={styles.docTabs}>
                      <button className={`${styles.docTab} ${docViewMode === 'spec' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={`${styles.docTab} ${docViewMode === 'preview' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('preview')}>Diagrams</button>
                    </div>
                  )}
                  {selectedAgent === 'uxMockups' && hasHtml(selectedRun.output) && (
                    <div className={styles.docTabs}>
                      <button className={`${styles.docTab} ${docViewMode === 'spec' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={`${styles.docTab} ${docViewMode === 'preview' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('preview')}>Preview</button>
                    </div>
                  )}
                  {selectedAgent === 'sdlcOrchestrator' && (selectedRun.output ?? '').length > 100 && (
                    <div className={styles.docTabs}>
                      <button className={`${styles.docTab} ${docViewMode === 'spec' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={`${styles.docTab} ${docViewMode === 'preview' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('preview')}>Pipeline Plan</button>
                    </div>
                  )}
                  {selectedAgent === 'workingPrototype' && (selectedRun.output ?? '').length > 100 && (
                    <div className={styles.docTabs}>
                      <button className={`${styles.docTab} ${docViewMode === 'spec' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={`${styles.docTab} ${docViewMode === 'preview' ? styles.docTabActive : ''}`} onClick={() => setDocViewMode('preview')}>Prototype</button>
                    </div>
                  )}
                  <button
                    className={`${styles.thinkingBtn} ${docViewMode === 'thinking' ? styles.thinkingBtnActive : ''}`}
                    onClick={() => setDocViewMode(docViewMode === 'thinking' ? 'spec' : 'thinking')}
                    title={selectedRun?.l3 ? `L3 trace — ${selectedRun.l3.iterationCount} iterations, ${selectedRun.l3.toolTrace.length} tool calls` : 'Agent execution mode'}
                  >
                    Thinking{selectedRun?.l3 ? ` (${selectedRun.l3.iterationCount}i)` : ''}
                  </button>
                  <button
                    className={styles.rerunBtn}
                    onClick={() => openRerun(selectedAgent!)}
                    title="Re-run this agent with an editable prompt"
                  >
                    Re-run
                  </button>
                  <button
                    className={`${styles.reviewBtn}${showReview ? ` ${styles.reviewBtnActive}` : ''}`}
                    onClick={() => { setShowReview((v) => !v); setRerunAgent(null); }}
                    title="AI-powered gap analysis — get questions to improve this document"
                  >
                    ✦ Review
                  </button>
                  <ExportMenu agentId={selectedAgent!} project={project} />
                  {isAdmin && project.githubIntegrationId && (selectedAgent === 'sprintPlanner' || selectedAgent === 'taskBreakdown') && (
                    <button
                      className="btn-secondary"
                      onClick={() => setShowGithubPush(true)}
                    >
                      Push to GitHub
                    </button>
                  )}
                </div>
              </div>
              {showReview ? (
                <ReviewImprovePanel
                  agentId={selectedAgent!}
                  project={project}
                  onRegenerate={handleReviewRegenerate}
                  onClose={() => setShowReview(false)}
                />
              ) : docViewMode === 'thinking' ? (
                <AgentThinkingPanel run={selectedRun} />
              ) : selectedAgent === 'sdlcOrchestrator' && docViewMode === 'preview' ? (
                <OrchestratorView
                  markdown={selectedRun.output ?? ''}
                  projectId={projectId}
                  onRunAll={() => startPipeline('phase1')}
                  isRunning={engineRunning}
                />
              ) : selectedAgent === 'workingPrototype' && docViewMode === 'preview' ? (
                <PrototypeViewer
                  markdown={selectedRun.output ?? ''}
                  projectName={project.name}
                />
              ) : selectedAgent === 'uxMockups' && docViewMode === 'preview' && hasHtml(selectedRun.output) ? (
                <MockupPreview markdown={selectedRun.output ?? ''} />
              ) : selectedAgent && DIAGRAM_AGENTS.has(selectedAgent) && docViewMode === 'preview' && hasMermaid(selectedRun.output) ? (
                <DiagramPreview markdown={selectedRun.output ?? ''} />
              ) : (
                <DocumentViewer markdown={selectedRun.output ?? ''} />
              )}
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
            // M-09 fix: content skeleton instead of blank spinner — gives users
            // visual structure so the wait feels shorter on slow connections.
            <div className={styles.skeletonWrap} aria-busy="true" aria-label={`${selectedDef?.name ?? selectedAgent} is generating…`}>
              <div className={styles.skeletonHeader}>
                <div className={styles.skeletonLine} style={{ width: '60%', height: 22 }} />
                <div className={styles.skeletonBadge} />
              </div>
              {[100, 85, 92, 70, 88].map((w, i) => (
                <div key={i} className={styles.skeletonLine} style={{ width: `${w}%`, animationDelay: `${i * 0.1}s` }} />
              ))}
              <div className={styles.skeletonLine} style={{ width: '40%', marginTop: 16 }} />
              {[95, 80, 88, 75].map((w, i) => (
                <div key={i + 5} className={styles.skeletonLine} style={{ width: `${w}%`, animationDelay: `${(i + 5) * 0.1}s` }} />
              ))}
              <p className={styles.skeletonLabel}>
                {rerunning ? `Re-running ${selectedDef?.name ?? selectedAgent}` : `${selectedDef?.name ?? selectedAgent} is generating`}
                {'…'}&nbsp;
                <span style={{ opacity: 0.6, fontWeight: 400 }}>
                  {providerLabel(rerunning ? rerunPendingProvider : selectedRun?.pendingProvider)}
                </span>
              </p>
            </div>
          ) : selectedRun?.status === 'error' ? (
            <div className={styles.placeholder} style={{ color: 'var(--error)' }}>
              <p>Error: {selectedRun.error}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" onClick={() => startPipeline(project.currentPhase)}>Retry Pipeline</button>
                <button className="btn-secondary" onClick={() => openRerun(selectedAgent!)}>Re-run with edited prompt</button>
              </div>
            </div>
          ) : !rerunAgent ? (
            <div className={styles.placeholder}>
              {(!!selectedAgent && !!selectedDef) ? (
                <div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>This agent has not run yet.</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      className="btn-primary"
                      disabled={engineRunning || !teamReady || (apiReady === false)}
                      onClick={() => { if (selectedDef) startPipeline(selectedDef.phase); }}
                    >
                      Run {selectedDef!.name}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => { if (selectedAgent) openRerun(selectedAgent); }}
                    >
                      Edit prompt and run
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Select an agent from the left panel.</p>
              )}
            </div>
          ) : null}
        </main>
      </div>

      {pendingGate && (
        <ReviewGateModal
          gateId={pendingGate}
          project={project}
          onApprove={async (notes, approvedById) => {
            const gateToNext: Record<string, PhaseId> = {
              gate1: 'phase2',
              gate2: 'phase3',
              gate3: 'phase4',
              gate5: 'phase6',
            };
            await updateProject(projectId, (p) => {
              p.reviewGates[pendingGate] = {
                // id and afterPhases satisfy ReviewGate interface; afterPhases not needed post-approval
                id: pendingGate,
                afterPhases: [],
                approved: true,
                approvedAt: Date.now(),
                approvedBy: approvedById,
                notes,
              };
              p.status = 'running';
            });
            const nextPhase = gateToNext[pendingGate] as PhaseId | undefined;
            setPendingGate(null);
            if (nextPhase) startPipeline(nextPhase);
          }}
          onReject={() => setPendingGate(null)}
          onClose={() => setPendingGate(null)}
        />
      )}
    </div>
  );
}
