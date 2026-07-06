/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { updateProject, updateAgentRun } from '@/db/projectRepository';
import { PipelineEngine, runSingleAgent } from '@/services/pipelineEngine';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS, REVIEW_GATES, PHASE_SDLC_STAGE, TOTAL_AGENTS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { getPromptDefaults } from '@/agents/promptDefaults';
import { api } from '@/services/api';
import DocumentViewer from '../documents/DocumentViewer';
import ReviewGateModal from '../reviewGate/ReviewGateModal';
import ProjectSettings from '../settings/ProjectSettings';
import { initials } from '../settings/ProjectSettings';
import type { Tab as ProjectSettingsTab, InviteLinkInfo, InviteErrorInfo } from '../settings/ProjectSettings';
import ExportMenu from '../documents/ExportMenu';
import GithubPushModal from '../documents/GithubPushModal';
import AgentThinkingPanel from './AgentThinkingPanel';
import ReviewImprovePanel from './ReviewImprovePanel';
import MockupPreview from '../documents/MockupPreview';
import DiagramPreview from '../documents/DiagramPreview';
import OrchestratorView from './OrchestratorView';
import PrototypeViewer from '../documents/PrototypeViewer';
import AgentContextUploader from './AgentContextUploader';
import { useProject } from '@/hooks/useProject';
import { useAuth } from '@/contexts/AuthContext';
import { exportTraceabilityCSV } from '@/services/traceability';
import { checkPromptInjection } from '@/utils/sanitize';
import { exportAllArtifactsZip } from '@/services/exporters/documentExporter';
import { exportPipelineMetricsXlsx } from '@/services/exporters/excelExporter';
import { getDownstreamDependents } from '@/agents/dependencyGraph';
import { getInviteSession } from '@/services/inviteSession';
import { getProjectExportPermission, getProjectMember, isProjectAdminUser } from '@/lib/projectAccess';
import { ROLE_PERMISSIONS } from '@/types/project.types';
import type { AgentId, PhaseId } from '@/types/agent.types';
import type { ReviewGateId } from '@/types/project.types';
import styles from './ProjectWorkspace.module.css';

// ── Gate locking ──────────────────────────────────────────────────────────────
// Maps gate → last phase covered by the gate. Phases AFTER this phase are
// locked until the gate is approved. Must stay in sync with REVIEW_GATES.
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1b',
  gate2: 'phase2a',  // gate2 covers [phase2, phase2a]; lock phases after phase2a
  gate3: 'phase3b',  // gate3 covers [phase3, phase3a, phase3c, phase3b]; lock after phase3b
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

const MERMAID_START_RE = /(?:^|\n)(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|C4Context|C4Container|C4Component|C4Dynamic)\b/i;

function providerLabel(p?: string): string {
  if (!p || p === 'auto') return '';
  return p === 'claude' ? 'Claude' : 'OpenAI';
}

// ── ProtoStylePicker: style selector for Working Prototype re-runs ────────────
// Reads persisted UX Mockup version styles + any "→ Prototype" saved style from
// localStorage and renders color-swatch buttons the user can pick to inject into
// the workingPrototype agent via prompt and CSS post-processing.

interface ProtoStyleEntry { version: string; style: Record<string, unknown> }

interface ProtoStylePickerProps {
  projectId: string;
  protoStyleSelection: ProtoStyleEntry | null;
  onSelect: (sel: ProtoStyleEntry | null) => void;
}

function ProtoStylePicker({ projectId, protoStyleSelection, onSelect }: ProtoStylePickerProps) {
  const protoKey  = 'sdlc_proto_style_'   + projectId;
  const mockupKey = 'sdlc_mockup_styles_' + projectId;
  let savedProto: ProtoStyleEntry | null = null;
  let mockupVersionStyles: Record<number, Record<string, unknown>> = {};
  try { const r = localStorage.getItem(protoKey);  if (r) savedProto         = JSON.parse(r); } catch { /* ignore */ }
  try { const r = localStorage.getItem(mockupKey); if (r) mockupVersionStyles = JSON.parse(r); } catch { /* ignore */ }

  const versionEntries = Object.entries(mockupVersionStyles);
  if (versionEntries.length === 0 && !savedProto) return null;

  const savedColor = savedProto?.style?.primaryColor ? String(savedProto.style.primaryColor) : '';
  const savedAlreadyInVersions = versionEntries.some(([, s]) => {
    const st = s as Record<string, string>;
    return st.primaryColor && st.primaryColor === savedColor;
  });

  const noneActive  = protoStyleSelection === null;
  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' };
  const swatchStyle = (color: string): React.CSSProperties => ({ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block', border: '1px solid rgba(0,0,0,.15)' });

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-alt, #f8fafc)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>
        Apply UX Mockup Style to Prototype
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Pick a version — colors will be injected via prompt and CSS post-processing.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>

        <button
          style={{ ...btnBase, border: '2px solid ' + (noneActive ? 'var(--accent)' : 'var(--border)'), background: noneActive ? 'var(--accent)' : 'transparent', color: noneActive ? '#fff' : 'var(--text)' }}
          onClick={() => onSelect(null)}
        >None</button>

        {versionEntries.map(([idxStr, rawStyle]) => {
          const idx    = parseInt(idxStr, 10);
          const vl     = String.fromCharCode(65 + idx);
          const s      = rawStyle as Record<string, string>;
          const active = protoStyleSelection?.version === vl;
          const color  = s.primaryColor || '';
          return (
            <button key={idx}
              style={{ ...btnBase, border: '2px solid ' + (active ? 'var(--accent)' : 'var(--border)'), background: active ? 'var(--accent-muted, #ede9fe)' : 'transparent' }}
              onClick={() => onSelect({ version: vl, style: s })}
              title={'Use Version ' + vl + ' colors: ' + (color || 'original')}
            >
              {color && <span style={swatchStyle(color)} />}
              <span style={{ fontWeight: active ? 700 : 400 }}>Ver {vl}</span>
              {color && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{color}</span>}
            </button>
          );
        })}

        {savedProto && !savedAlreadyInVersions && (
          <button
            style={{ ...btnBase, border: '2px solid ' + (protoStyleSelection?.version === savedProto.version ? 'var(--accent)' : 'var(--border)'), background: protoStyleSelection?.version === savedProto.version ? 'var(--accent-muted, #ede9fe)' : 'transparent' }}
            onClick={() => onSelect(savedProto)}
            title={'Last saved style from Version ' + savedProto.version}
          >
            {savedColor && <span style={swatchStyle(savedColor)} />}
            <span>Saved ({savedProto.version})</span>
          </button>
        )}
      </div>
      {protoStyleSelection && (
        <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 6 }}>
          Version {protoStyleSelection.version} style will be applied via prompt + CSS injection.
        </p>
      )}
    </div>
  );
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
  const { user, adminMode, loading: authLoading } = useAuth();
  const { project, loading: projectLoading } = useProject(projectId);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [pendingGate, setPendingGate] = useState<ReviewGateId | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [teamPanelKey, setTeamPanelKey] = useState(0);
  // Persists the last-active Project Settings tab across remounts of
  // <ProjectSettings> (its `key={teamPanelKey}` below forces a fresh mount
  // each time the panel is (re)opened). Without this, saving anything inside
  // e.g. the Domain Knowledge tab and having the panel remount for any reason
  // would silently reset the view back to the Team Members tab.
  const [settingsTab, setSettingsTab] = useState<ProjectSettingsTab>('team');
  // Same remount problem as settingsTab above, but for the per-member invite
  // link/error shown after Send/Resend Invite — see the matching comment on
  // initialInviteLink/onInviteLinkChange in ProjectSettings' Props.
  const [teamInviteLink, setTeamInviteLink] = useState<InviteLinkInfo>(null);
  const [teamInviteError, setTeamInviteError] = useState<InviteErrorInfo>(null);
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
  const [uploadedContext, setUploadedContext] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<import('@/components/pipeline/AgentContextUploader').ExtractedFile[]>([]);
  // Selected mockup-version style to inject into Working Prototype (null = no selection)
  const [protoStyleSelection, setProtoStyleSelection] = useState<ProtoStyleEntry | null>(null);
  const [promptSaved, setPromptSaved] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [rerunPendingProvider, setRerunPendingProvider] = useState<'openai' | 'claude' | 'auto'>('auto');
  const [rerunInjectionWarning, setRerunInjectionWarning] = useState<string | null>(null);
  const [rerunSuccess, setRerunSuccess] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  // When set, the re-run panel shows a cascade-reset warning before proceeding.
  // Value is the list of downstream agents that will be reset.
  const [pendingCascadeRerun, setPendingCascadeRerun] = useState<AgentId[] | null>(null);

  // Close the ⋯ More dropdown when the user clicks outside it
  useEffect(() => {
    if (!showMoreMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showMoreMenu]);

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

  function openTeamPanel() {
    setTeamPanelKey((prev) => prev + 1);
    setShowTeamPanel(true);
  }

  // Restore persisted context documents when the project first loads
  useEffect(() => {
    if (!project?.contextDocuments?.length) return;
    setUploadedFiles(project.contextDocuments as any);
    const parts = project.contextDocuments.map((f) => `### Attached file: ${f.name}\n${f.content}`);
    const combined = parts.join('\n\n---\n\n');
    setUploadedContext(combined.length > 8_000 ? combined.slice(0, 8_000) + '\n\n[...truncated]' : combined);
  // Run once per project load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Check API/provider availability only after auth state is settled.
  // In production, a one-time pre-auth check can incorrectly freeze this
  // banner into the "no key configured" state even when the backend is fine.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function checkApiReady() {
      // If the user is not authenticated yet, defer rather than showing a
      // misleading "no key configured" error.
      if (!user && !adminMode) {
        if (!cancelled) setApiReady(null);
        return;
      }

      if (!cancelled) setApiReady(null);

      try {
        const openAi = await api.testProviderConnection('openai');
        if (openAi.ok) {
          if (!cancelled) setApiReady(true);
          return;
        }

        const claude = await api.testProviderConnection('claude');
        if (!cancelled) setApiReady(claude.ok);
      } catch {
        if (!cancelled) setApiReady(false);
      }
    }

    checkApiReady();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, adminMode]);

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
    setProtoStyleSelection(null);
    // NOTE: uploadedContext is intentionally NOT reset here — persisted docs survive re-run panel open/close
    setShowAdvanced(true);
    setRerunError(null);
    setPromptSaved(false);
  }

  // ── Persist context documents into the backend-backed project record ────────
  async function handleFilesChange(files: import('@/components/pipeline/AgentContextUploader').ExtractedFile[]) {
    setUploadedFiles(files);
    await updateProject(projectId, (p) => {
      p.contextDocuments = files.map(({ id, name, sizeKb, kind, content }) => ({ id, name, sizeKb, kind, content }));
    });
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
        setPendingCascadeRerun(null);
        // Start the full pipeline from Phase 0
        startPipeline(undefined);
      } catch (e) {
        setRerunError(String(e));
      } finally {
        setRerunning(false);
      }
      return;
    }

    // ── Cascade-reset check ───────────────────────────────────────────────────
    // Compute all agents that would be reset by re-running this agent.
    // If any have outputs (non-idle), show a warning first so the user can
    // confirm before we wipe their work. `pendingCascadeRerun` being set means
    // the user already confirmed — skip the check and proceed.
    const downstream = getDownstreamDependents(agentIdToRun);
    if (!pendingCascadeRerun) {
      const willReset = downstream.filter((id) => {
        const run = project.agentRuns[id];
        return run?.status && run.status !== 'idle';
      });
      if (willReset.length > 0) {
        setPendingCascadeRerun(willReset);
        return; // Wait for the user to confirm in the cascade warning UI
      }
    }

    setRerunning(true);
    setRerunError(null);
    setRerunSuccess(false);

    // Mirror ReviewGateModal's injection check — flag but don't hard-block
    if (rerunUserExtra.trim()) {
      const injCheck = checkPromptInjection(rerunUserExtra);
      if (!injCheck.safe) {
        setRerunInjectionWarning(`⚠ Possible prompt injection detected: ${injCheck.matchedPattern}`);
        setRerunning(false);
        return;
      }
    }
    setRerunInjectionWarning(null);

    try {
      // Combine user-typed extra instructions + uploaded document context into
      // the userPromptExtra arg that runSingleAgent appends to the built prompt.
      const extraParts: string[] = [];
      if (rerunUserExtra.trim()) extraParts.push(`Additional instructions: ${rerunUserExtra.trim()}`);
      if (uploadedContext.trim()) extraParts.push(`## Attached document context:\n${uploadedContext.trim()}`);

      // For workingPrototype: inject the selected UX Mockup style as explicit CSS tokens
      if (agentIdToRun === 'workingPrototype' && protoStyleSelection) {
        const { version, style } = protoStyleSelection;
        const str = (key: string) => (style[key] ? String(style[key]) : '');
        const lines = [
          `=== Selected Color Style from UX Mockup Version ${version} ===`,
          `Apply these exact color values throughout the prototype as CSS custom properties:`,
          str('primaryColor')   ? `--color-primary: ${str('primaryColor')};`   : '',
          str('secondaryColor') ? `--color-secondary: ${str('secondaryColor')};` : '',
          str('surfaceColor')   ? `--color-surface: ${str('surfaceColor')};`   : '',
          str('textColor')      ? `--color-text: ${str('textColor')};`         : '',
          str('fontFamily')     ? `Font family: ${str('fontFamily')}`          : '',
          str('radius')         ? `Border radius: ${str('radius')}px`          : '',
          style.darkMode === true ? `Dark mode: yes`                            : '',
          `Density: ${str('density') || 'comfortable'}`,
          `Ensure ALL backgrounds, buttons, headers, navbars and cards use the primary color system above.`,
          `Do not use any colors that conflict with this palette.`,
        ].filter(Boolean);
        extraParts.push(lines.join('\n'));
      }

      const userPromptExtra = extraParts.join('\n\n');

      // runSingleAgent handles L3/L2 routing, corrective check, agentRun status
      // updates (including status='running' before the call), and runtime sync.
      let agentSucceeded = false;
      // Capture the selected style before any state changes in the async callbacks
      const capturedStyleSelection = agentIdToRun === 'workingPrototype' ? protoStyleSelection : null;

      await runSingleAgent(
        projectId,
        agentIdToRun,
        rerunPrompt,
        {
          onComplete: async (output: string) => {
            agentSucceeded = true;
            // CSS post-processing for workingPrototype: inject selected style vars into HTML blocks
            if (capturedStyleSelection && output) {
              const { style } = capturedStyleSelection;
              const sv = (k: string) => (style[k] ? String(style[k]) : '');
              const cssVars = [
                sv('primaryColor')   ? `--color-primary:${sv('primaryColor')}`   : '',
                sv('secondaryColor') ? `--color-secondary:${sv('secondaryColor')}` : '',
                sv('surfaceColor')   ? `--color-surface:${sv('surfaceColor')}`   : '',
                sv('textColor')      ? `--color-text:${sv('textColor')}`         : '',
                sv('fontFamily')     ? `--font-family:${sv('fontFamily')}`       : '',
                sv('radius')         ? `--radius:${sv('radius')}px`              : '',
              ].filter(Boolean).join(';');

              if (cssVars) {
                const overrideTag = `<style id="__proto_style_override__">:root{${cssVars}}</style>`;
                const patched = output.replace(/```html\s*\n([\s\S]*?)```/g, (_m, code) => {
                  const patchedCode = code.includes('</body>')
                    ? code.replace('</body>', `${overrideTag}\n</body>`)
                    : code + `\n${overrideTag}`;
                  return `\`\`\`html\n${patchedCode}\`\`\``;
                });
                if (patched !== output) {
                  await updateAgentRun(projectId, agentIdToRun, { output: patched });
                }
              }
            }
          },
          onError: (error) => { setRerunError(error); },
        },
        userPromptExtra,
        { providerOverride: rerunPendingProvider },
      );

      if (!agentSucceeded) return; // error already surfaced via onError callback

      // ── Success notification ──────────────────────────────────────────────
      setRerunSuccess(true);
      setTimeout(() => setRerunSuccess(false), 4000);

      // ── Cascade reset all transitive downstream dependents ────────────────
      // After the re-run succeeds, reset every agent that depends on this one
      // back to idle, and unapprove any review gates covering their phases.
      if (downstream.length > 0) {
        await updateProject(projectId, (p) => {
          for (const depId of downstream) {
            if (p.agentRuns[depId]) {
              p.agentRuns[depId] = { agentId: depId, status: 'idle' };
            }
          }
          // Unapprove gates whose covered phases contain at least one reset agent
          for (const [gateId, gatePhases] of Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][]) {
            const gateAgentIds = (gatePhases as PhaseId[]).flatMap(
              (ph) => PHASE_AGENTS[ph] ?? []
            );
            const hasResetAgent = gateAgentIds.some((a) => downstream.includes(a));
            if (hasResetAgent && p.reviewGates[gateId as ReviewGateId]?.approved) {
              p.reviewGates[gateId as ReviewGateId] = {
                ...p.reviewGates[gateId as ReviewGateId]!,
                approved: false,
                approvedAt: undefined,
                approvedBy: undefined,
                notes: `Auto-reset: upstream agent "${def.name}" was re-run`,
              };
            }
          }
        });
      }

      // ── Gate / pipeline continuation ──────────────────────────────────────
      const agentPhase = def.phase as PhaseId;
      const coveringGate = gateForPhase(agentPhase);
      if (coveringGate) {
        // The re-run agent's phase has a review gate — reset it so the user
        // must re-approve before the downstream pipeline continues.
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
      } else if (downstream.length > 0) {
        // No review gate after this phase — auto-continue the pipeline from
        // this phase so the reset downstream agents re-run immediately.
        // PipelineEngine skips agents still 'complete'; runs the idle ones.
        startPipeline(agentPhase);
      }

      setPendingCascadeRerun(null);
      setSelectedAgent(agentIdToRun);
      setRerunAgent(null);
    } catch (e) {
      setRerunError(String(e));
    } finally {
      setRerunning(false);
    }
  }

  // ── Quick re-run for UX Mockups (no panel needed) ────────────────────────────
  // Called from the ↻ Update button inside MockupPreview toolbar.
  // Uses runSingleAgent so the L3 tool loop (style guide lookup, prior output
  // reading) runs correctly, and the corrective retry fires when the LLM
  // produces fewer HTML blocks than the desired version count.
  async function quickRerunMockups() {
    if (!project) return;
    const agentId = 'uxMockups' as AgentId;
    const def = AGENT_DEFINITIONS[agentId];
    if (!def) return;

    setRerunning(true);
    setRerunError(null);
    try {
      // Resolve system prompt: project override → app-level default → built-in
      const saved = project.promptOverrides?.find(o => o.agentId === agentId);
      const appDefaults = await getPromptDefaults();
      const systemPrompt = saved?.fullPrompt ?? appDefaults[agentId] ?? def.systemPrompt;

      await runSingleAgent(
        projectId,
        agentId,
        systemPrompt,
        {
          onComplete: () => { setSelectedAgent(agentId); },
          onError:    (error) => { setRerunError(error); },
        },
        uploadedContext.trim(),
      );
    } finally {
      setRerunning(false);
    }
  }

  if (projectLoading) {
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
          This project may have been deleted or you may no longer have access to it.
        </p>
        <button className="btn-primary" onClick={onBack}>{'← Back to Dashboard'}</button>
      </div>
    );
  }

  const members = project.teamMembers ?? [];
  const inviteSession = getInviteSession();
  const currentMember = getProjectMember(project, {
    adminMode,
    userEmail: user?.email ?? inviteSession?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  });
  const currentPermissions = currentMember ? ROLE_PERMISSIONS[currentMember.appRole] : null;
  const isAdmin = isProjectAdminUser(project, {
    adminMode,
    userEmail: user?.email ?? inviteSession?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  });
  const canRunProjectAgents = !!(adminMode || currentPermissions?.canRunAgents);
  const canEditProjectSettings = !!(adminMode || currentPermissions?.canEditSettings);
  const exportPermission = getProjectExportPermission(project, {
    adminMode,
    userEmail: user?.email ?? inviteSession?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  });
  const canExportArtifacts = exportPermission.canExport;
  const exportDisabledReason = exportPermission.reason;
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
      setRerunError('No completed artifacts to download yet.');
      setTimeout(() => setRerunError(null), 4000);
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
    // NOTE: uploadedContext intentionally NOT reset — persisted docs survive panel transitions
    setPromptSaved(false);
  }

  // Helpers: avoid backtick string literals inside JSX (causes TSC JSX parse errors)
  const BACKTICK = String.fromCharCode(96);
  const hasMermaid = (s?: string | null) => {
    const text = s ?? '';
    return text.includes(BACKTICK + BACKTICK + BACKTICK + 'mermaid') || MERMAID_START_RE.test(text);
  };
  const hasHtml    = (s?: string | null) => (s ?? '').includes(BACKTICK + BACKTICK + BACKTICK + 'html');

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <button className="btn-secondary" onClick={onBack} style={{ fontSize: 12 }}>&#8592; Dashboard</button>
        <div className={styles.projectInfo}>
          <h2>{project.name}</h2>
          <span className={styles.modeBadge}>{project.mode === 'expert' ? 'Expert' : 'Simple'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* U1 — pipeline progress counter */}
          {(() => {
            const completedCount = allAgentIds.filter((a) => project.agentRuns[a]?.status === 'complete').length;
            if (completedCount === 0 && !engineRunning) return null;
            return (
              <span className={styles.progressCounter + (engineRunning ? ' ' + styles.running : '')}>
                {completedCount}/{TOTAL_AGENTS}
              </span>
            );
          })()}

          {engineRunning ? (
            <button className="btn-danger" onClick={handleStop}>Stop</button>
          ) : (
            <button
              className="btn-primary"
              onClick={() => startPipeline(project.currentPhase)}
              disabled={project.status === 'complete' || !teamReady || !canRunProjectAgents}
              title={
                !teamReady
                  ? 'Add at least one team member to run the pipeline'
                  : !canRunProjectAgents
                    ? 'Your assigned project role cannot run agents.'
                    : undefined
              }
            >
              {project.status === 'draft' ? 'Run Pipeline' :
               project.status === 'paused' ? 'Resume Pipeline' :
               project.status === 'complete' ? 'Complete' : 'Run Pipeline'}
            </button>
          )}

          <button
            className="btn-secondary"
            onClick={openTeamPanel}
            disabled={!canEditProjectSettings}
            title={!canEditProjectSettings ? 'Your assigned project role cannot edit settings.' : undefined}
          >
            Settings
          </button>
          <button className="btn-secondary" onClick={() => updateProject(projectId, (p) => { p.mode = p.mode === 'simple' ? 'expert' : 'simple'; })}>
            {project.mode === 'simple' ? 'Expert Mode' : 'Simple Mode'}
          </button>

          {/* U3 — overflow dropdown for secondary export actions */}
          <div className={styles.moreMenuWrap} ref={moreMenuRef}>
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              disabled={!canExportArtifacts}
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              aria-label="More export actions"
              title={!canExportArtifacts ? (exportDisabledReason ?? 'Export is disabled for your current access level.') : undefined}
              onClick={() => canExportArtifacts && setShowMoreMenu((v) => !v)}
              onKeyDown={(e) => { if (e.key === 'Escape') setShowMoreMenu(false); }}
            >
              ⋯ More
            </button>
            {showMoreMenu && (
              <div className={styles.moreDropdown}>
                <button
                  className={styles.moreDropdownItem}
                  onClick={() => { exportPipelineMetricsXlsx(project); setShowMoreMenu(false); }}
                >
                  📊 Metrics XLSX
                </button>
                <button
                  className={styles.moreDropdownItem}
                  onClick={() => { exportTraceabilityCSV(projectId, project.name); setShowMoreMenu(false); }}
                >
                  🔗 Traceability CSV
                </button>
                <button
                  className={styles.moreDropdownItem}
                  disabled={downloadingArtifacts}
                  onClick={() => { downloadAllArtifacts(); setShowMoreMenu(false); }}
                >
                  {downloadingArtifacts ? '⟳ Zipping…' : '⬇ Download All'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!teamReady && canEditProjectSettings && (
        <div className={styles.teamRequiredBanner}>
          <span>Add at least one team member before running the pipeline.</span>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={openTeamPanel}>Set Up Team</button>
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
              <div key={phase} className={styles.phaseGroup + ' ' + (isPhaseGateLocked ? styles.phaseGroupLocked : '')}>
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
                    <div
                      key={agentId}
                      className={styles.agentRow + (isSelected ? ' ' + styles.agentSelected : '') + (isPhaseGateLocked ? ' ' + styles.agentLocked : '')}
                      role="button"
                      tabIndex={isPhaseGateLocked ? -1 : 0}
                      aria-disabled={isPhaseGateLocked || !isClickable}
                      onClick={() => isClickable && setSelectedAgent(agentId)}
                      onKeyDown={(e) => {
                        if (isPhaseGateLocked || !isClickable) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedAgent(agentId);
                        }
                      }}
                      title={
                        isPhaseGateLocked ? 'Approve preceding gate to unlock' :
                        assignedMembers.length > 0 ? ('Assigned: ' + (assignedMembers as any[]).map((m: any) => m.name).join(', ')) : undefined
                      }
                    >
                      <span
                        className={status === 'running' && !isPhaseGateLocked ? styles.spinIcon : undefined}
                        style={{ color: isPhaseGateLocked ? 'var(--text-muted)' : STATUS_COLOR[status], fontFamily: 'monospace', fontSize: 13 }}
                      >
                        {isPhaseGateLocked ? '🔒' : status === 'running' ? '⟳' : STATUS_ICON[status]}
                      </span>
                      <span className={styles.agentName}>{def?.name ?? agentId}</span>
                      {hasCustomPrompt && (
                        <span className={styles.customPromptBadge} title="Custom prompt saved">&#x270F;</span>
                      )}
                      {/* U4 — inline retry button on errored rows */}
                      {status === 'error' && !isPhaseGateLocked && (
                        <button
                          className={styles.agentRetryBtn}
                          onClick={(e) => { e.stopPropagation(); startPipeline(def?.phase as PhaseId); }}
                          title={'Retry ' + (def?.name ?? agentId) + ' from its phase'}
                        >
                          ↻
                        </button>
                      )}
                      {/* F4 — run-from-here button (visible on hover, hidden when locked/running) */}
                      {status !== 'error' && (
                        <button
                          className={styles.agentRunFromBtn}
                          onClick={(e) => { e.stopPropagation(); startPipeline(def?.phase as PhaseId); }}
                          disabled={engineRunning || isPhaseGateLocked || !teamReady || (apiReady === false)}
                          title={'Run pipeline from ' + (def?.name ?? agentId)}
                        >
                          ▶
                        </button>
                      )}
                      <span className={styles.agentAvatars}>
                        {(assignedMembers as any[]).slice(0, 3).map((m: any) => (
                          <span key={m.id} className={styles.agentAvatar} style={{ background: m.avatarColor }} title={m.name}>
                            {initials(m.name)}
                          </span>
                        ))}
                        {assignedMembers.length > 3 && <span className={styles.agentAvatarMore}>+{assignedMembers.length - 3}</span>}
                      </span>
                    </div>
                  );
                })}

                {gateAfterThisPhase && (
                  <div
                    className={styles.gateIndicator + ' ' + (isActiveGate ? styles.gateActive : gateAfterState?.approved ? styles.gateApproved : styles.gatePending)}
                    onClick={isActiveGate ? () => setPendingGate(gateAfterThisPhase as ReviewGateId) : undefined}
                    title={isActiveGate ? 'Waiting for approval — click to review' : gateAfterState?.approved ? ('Approved' + (gateApprover ? ' by ' + gateApprover.name : '')) : 'Review gate'}
                  >
                    {isActiveGate ? 'Waiting for your approval' :
                     gateAfterState?.approved ? ('Approved' + (gateApprover ? ' by ' + gateApprover.name : '')) :
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

              {/* ── Document context upload ── */}
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Attach a document for additional context (PDF, Word, Excel, CSV, image, text):
                </p>
                <AgentContextUploader
                  onContextChange={setUploadedContext}
                  onFilesChange={handleFilesChange}
                  initialFiles={uploadedFiles}
                />
                {uploadedContext && (
                  <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                    ✓ Document context attached — will be included in the prompt
                  </p>
                )}
              </div>

              {/* ── Additional instructions (user-facing extra prompt) ── */}
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Additional instructions (appended to the prompt):
                </p>
                <textarea
                  className={styles.rerunTextarea}
                  value={rerunUserExtra}
                  onChange={(e) => setRerunUserExtra(e.target.value)}
                  rows={3}
                  placeholder="e.g. Focus on the onboarding flow, use a two-column layout…"
                />
              </div>

              {/* ── Working Prototype: style picker from UX Mockup versions ── */}
              {rerunAgent === 'workingPrototype' && project && (
                <ProtoStylePicker
                  projectId={project.id}
                  protoStyleSelection={protoStyleSelection}
                  onSelect={setProtoStyleSelection}
                />
              )}

              {/* B2 — provider selector */}
              <div className={styles.providerSelector}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Provider:</span>
                {(['auto', 'openai', 'claude'] as const).map((p) => (
                  <button
                    key={p}
                    className={styles.providerBtn + (rerunPendingProvider === p ? ' ' + styles.providerBtnActive : '')}
                    onClick={() => setRerunPendingProvider(p)}
                    disabled={rerunning}
                    aria-pressed={rerunPendingProvider === p}
                    aria-label={'Use ' + (p === 'auto' ? 'automatic provider selection' : p === 'openai' ? 'OpenAI' : 'Claude')}
                  >
                    {p === 'auto' ? 'Auto' : p === 'openai' ? 'OpenAI' : 'Claude'}
                  </button>
                ))}
              </div>

              {/* Version count for uxMockups is set from the Preview toolbar */}
              {rerunAgent === 'uxMockups' && project && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                  Will generate <strong>{project.mockupVersionCount ?? 2} version{(project.mockupVersionCount ?? 2) > 1 ? 's' : ''}</strong> (set in the Preview toolbar).
                </p>
              )}

              {rerunError && <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>{rerunError}</p>}
              {rerunInjectionWarning && <p style={{ fontSize: 12, color: 'var(--warning, #f59e0b)', margin: 0 }}>{rerunInjectionWarning}</p>}
              {rerunSuccess && <p style={{ fontSize: 12, color: 'var(--success)', margin: 0 }}>✓ Agent re-run completed successfully.</p>}
              {promptSaved && <p style={{ fontSize: 12, color: 'var(--success)', margin: 0 }}>Saved as project default.</p>}

              {/* ── Cascade-reset warning ── */}
              {pendingCascadeRerun && (
                <div className={styles.cascadeWarning}>
                  <p className={styles.cascadeWarningTitle}>
                    ⚠ Re-running this agent will reset {pendingCascadeRerun.length} downstream artifact{pendingCascadeRerun.length !== 1 ? 's' : ''}
                  </p>
                  <p className={styles.cascadeWarningBody}>
                    The following agents will be cleared and re-run from scratch once this agent completes:
                  </p>
                  <ul className={styles.cascadeAgentList}>
                    {pendingCascadeRerun.map((id) => (
                      <li key={id}>
                        <span className={styles.cascadeAgentStatus}>○</span>
                        {AGENT_DEFINITIONS[id]?.name ?? id}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.cascadeWarningActions}>
                    <button
                      className="btn-primary"
                      onClick={confirmRerun}
                      disabled={rerunning}
                    >
                      {rerunning ? 'Running...' : 'Yes, Reset & Re-run'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setPendingCascadeRerun(null)}
                      disabled={rerunning}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!pendingCascadeRerun && (
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
                <button className="btn-secondary" onClick={() => { setRerunAgent(null); setRerunError(null); setPromptSaved(false); setRerunUserExtra(''); setShowAdvanced(false); setPendingCascadeRerun(null); setProtoStyleSelection(null); }} disabled={rerunning}>
                  Cancel
                </button>
              </div>
              )}
            </div>
          )}

          {selectedRun?.status === 'complete' && selectedDef && !rerunAgent ? (
            <div className={styles.docArea}>
              <div className={styles.docHeader}>
                <div>
                  <h3>{selectedDef.outputLabel}</h3>
                  <span className={styles.docMeta}>
                    {selectedRun.provider ? ((selectedRun.provider === 'claude' ? 'Claude' : 'OpenAI') + (selectedRun.model ? ' · ' + selectedRun.model : '')) : ''}
                    {selectedRun.tokensUsed ? ((selectedRun.provider ? ' · ' : '') + selectedRun.tokensUsed.toLocaleString() + ' tokens') : ''}
                    {selectedRun.completedAt ? (' · ' + new Date(selectedRun.completedAt).toLocaleTimeString()) : ''}
                    {promptOverrideMap.has(selectedAgent!) && (
                      <span className={styles.docCustomBadge} title="Generated with a custom saved prompt"> · custom prompt</span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selectedAgent && DIAGRAM_AGENTS.has(selectedAgent) && hasMermaid(selectedRun.output) && (
                    <div className={styles.docTabs}>
                      <button className={styles.docTab + ' ' + (docViewMode === 'spec' ? styles.docTabActive : '')} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={styles.docTab + ' ' + (docViewMode === 'preview' ? styles.docTabActive : '')} onClick={() => setDocViewMode('preview')}>Diagrams</button>
                    </div>
                  )}
                  {selectedAgent === 'uxMockups' && hasHtml(selectedRun.output) && (
                    <div className={styles.docTabs}>
                      <button className={styles.docTab + ' ' + (docViewMode === 'spec' ? styles.docTabActive : '')} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={styles.docTab + ' ' + (docViewMode === 'preview' ? styles.docTabActive : '')} onClick={() => setDocViewMode('preview')}>Preview</button>
                    </div>
                  )}
                  {selectedAgent === 'sdlcOrchestrator' && (selectedRun.output ?? '').length > 100 && (
                    <div className={styles.docTabs}>
                      <button className={styles.docTab + ' ' + (docViewMode === 'spec' ? styles.docTabActive : '')} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={styles.docTab + ' ' + (docViewMode === 'preview' ? styles.docTabActive : '')} onClick={() => setDocViewMode('preview')}>Pipeline Plan</button>
                    </div>
                  )}
                  {selectedAgent === 'workingPrototype' && (selectedRun.output ?? '').length > 100 && (
                    <div className={styles.docTabs}>
                      <button className={styles.docTab + ' ' + (docViewMode === 'spec' ? styles.docTabActive : '')} onClick={() => setDocViewMode('spec')}>Spec</button>
                      <button className={styles.docTab + ' ' + (docViewMode === 'preview' ? styles.docTabActive : '')} onClick={() => setDocViewMode('preview')}>Prototype</button>
                    </div>
                  )}
                  <button
                    className={styles.thinkingBtn + ' ' + (docViewMode === 'thinking' ? styles.thinkingBtnActive : '')}
                    onClick={() => setDocViewMode(docViewMode === 'thinking' ? 'spec' : 'thinking')}
                    title={selectedRun?.l3 ? ('L3 trace — ' + selectedRun.l3.iterationCount + ' iterations, ' + selectedRun.l3.toolTrace.length + ' tool calls') : 'Agent execution mode'}
                  >
                    Thinking{selectedRun?.l3 ? (' (' + selectedRun.l3.iterationCount + 'i)') : ''}
                  </button>
                  <button
                    className={styles.rerunBtn}
                    onClick={() => openRerun(selectedAgent!)}
                    title="Re-run this agent with an editable prompt"
                  >
                    Re-run
                  </button>
                  <button
                    className={styles.reviewBtn + (showReview ? ' ' + styles.reviewBtnActive : '')}
                    onClick={() => { setShowReview((v) => !v); setRerunAgent(null); }}
                    title="AI-powered gap analysis — get questions to improve this document"
                  >
                    ✦ Review
                  </button>
                  <ExportMenu
                    agentId={selectedAgent!}
                    project={project}
                    canExport={canExportArtifacts}
                    disabledReason={exportDisabledReason}
                  />
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
                  canExport={canExportArtifacts}
                  exportDisabledReason={exportDisabledReason}
                />
              ) : selectedAgent === 'workingPrototype' && docViewMode === 'preview' ? (
                <PrototypeViewer
                  markdown={selectedRun.output ?? ''}
                  projectName={project.name}
                  canDownload={canExportArtifacts}
                  downloadDisabledReason={exportDisabledReason}
                />
              ) : selectedAgent === 'uxMockups' && docViewMode === 'preview' && hasHtml(selectedRun.output) ? (
                <MockupPreview
                  markdown={selectedRun.output ?? ''}
                  projectId={projectId}
                  versionCount={project?.mockupVersionCount ?? 2}
                  onVersionCountChange={(n) => {
                    updateProject(projectId, (p) => { p.mockupVersionCount = n; });
                  }}
                  onRerun={quickRerunMockups}
                  isRerunning={rerunning}
                />
              ) : selectedAgent && DIAGRAM_AGENTS.has(selectedAgent) && docViewMode === 'preview' && hasMermaid(selectedRun.output) ? (
                <DiagramPreview
                  markdown={selectedRun.output ?? ''}
                  canDownload={canExportArtifacts}
                  downloadDisabledReason={exportDisabledReason}
                />
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
            <div className={styles.skeletonWrap} aria-busy="true" aria-label={(selectedDef?.name ?? selectedAgent ?? '') + ' is generating…'}>
              <div className={styles.skeletonHeader}>
                <span className={styles.agentSpinner} aria-hidden="true" />
                <div className={styles.skeletonLine} style={{ width: '60%', height: 22 }} />
                <div className={styles.skeletonBadge} />
              </div>
              {[100, 85, 92, 70, 88].map((w, i) => (
                <div key={i} className={styles.skeletonLine} style={{ width: w + '%', animationDelay: (i * 0.1) + 's' }} />
              ))}
              <div className={styles.skeletonLine} style={{ width: '40%', marginTop: 16 }} />
              {[95, 80, 88, 75].map((w, i) => (
                <div key={i + 5} className={styles.skeletonLine} style={{ width: w + '%', animationDelay: ((i + 5) * 0.1) + 's' }} />
              ))}
              <p className={styles.skeletonLabel}>
                <span className={styles.agentSpinner} aria-hidden="true" />
                {rerunning ? ('Re-running ' + (selectedDef?.name ?? selectedAgent)) : ((selectedDef?.name ?? selectedAgent) + ' is generating')}
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
          onReject={() => setPendingGate(n