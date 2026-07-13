/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useEffect, useRef } from 'react';
import { updateProject, deleteProject, restoreProject as restoreProjectApi, checkIsAppAdmin } from '@/db/projectRepository';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { ROLE_TEMPLATES } from '@/data/roleTemplates';
import { DOMAINS, getDomain } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import { api } from '@/services/api';
import { useIntegrations } from '@/hooks/useIntegrations';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { getInviteSession } from '@/services/inviteSession';
import { getProjectMember } from '@/lib/projectAccess';
import { initials } from '@/utils/text';
import type { Project, TeamMember, AgentAssignment, AppRole } from '@/types/project.types';
import type { DomainId } from '@/types/domain.types';
import { INVITABLE_APP_ROLES, ROLE_PERMISSIONS } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import type { GithubCredentials } from '@/types/integration.types';
import styles from './ProjectSettings.module.css';

// ─── helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#4f46e5','#0891b2','#059669','#d97706',
  '#dc2626','#7c3aed','#db2777','#0d9488',
];


const INVITE_ROLES: AppRole[] = INVITABLE_APP_ROLES;

export type Tab = 'general' | 'team' | 'assignments' | 'knowledge';

export type InviteLinkInfo = { memberId: string; link: string; emailSent?: boolean; password?: string } | null;
export type InviteErrorInfo = { memberId: string; message: string } | null;
export type ResetPasswordResult = { memberId: string; password: string; emailSent: boolean } | null;

interface Props {
  project: Project;
  onClose: () => void;
  /** Called after domain/techStack is saved — triggers full pipeline restart from Phase 0 */
  onRestartPipeline?: () => void;
  /**
   * Which tab to open on. Lets the parent remember the last-active tab across
   * remounts of this component (e.g. ProjectWorkspace remounts this panel via
   * a `key` bump each time it's reopened) so saving on one tab — e.g. "Save
   * Domain Knowledge" — never silently kicks the user back to Team Members.
   * Defaults to 'team' to preserve existing behavior when not provided.
   */
  initialTab?: Tab;
  /** Called whenever the active tab changes, so the parent can persist it. */
  onTabChange?: (tab: Tab) => void;
  /**
   * Same remount problem as initialTab/onTabChange above, but for the
   * per-member invite link/error shown right after Send/Resend Invite:
   * updateProject() (called both to add the member and, moments later, to
   * record the invite token) fires a repository-change event that causes
   * this panel to remount, which would otherwise wipe the just-set invite
   * link right as it appears — the link would flash and vanish before the
   * admin could copy it. Lifting this state into the parent (same pattern
   * as initialTab) makes it survive the remount.
   */
  initialInviteLink?: InviteLinkInfo;
  onInviteLinkChange?: (v: InviteLinkInfo) => void;
  initialInviteError?: InviteErrorInfo;
  onInviteErrorChange?: (v: InviteErrorInfo) => void;
}

/** Parse a legacy "A + B + C" or "A, B, C" tech stack string into individual tags. */
function parseTechTags(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  // Split on comma or " + " (the old preset format)
  return value
    .split(/,|\s\+\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────
interface InviteModalProps {
  existingMember?: TeamMember;   // set when inviting / re-inviting an existing member
  prefill?: { name: string; email: string; jobRole: string };  // pre-fill for new member flow
  /** Current project.agentAssignments — used to seed the agent picker for an existing member being resent an invite, and to find role-template suggestions. */
  assignments: AgentAssignment[];
  onSubmit: (data: { name: string; email: string; jobRole: string; appRole: AppRole; agentIds: AgentId[] }) => void;
  onClose: () => void;
  sending: boolean;
}

// Exported (named export) so it's independently unit-testable without
// mounting the rest of ProjectSettings (which needs AuthContext/AlertContext
// and a live project) — InviteModal itself is pure props-in/callback-out,
// no context hooks. See tests/unit/InviteModal-agentPicker.test.tsx.
export function InviteModal({ existingMember, prefill, assignments, onSubmit, onClose, sending }: InviteModalProps) {
  const [name,    setName]    = useState(existingMember?.name  ?? prefill?.name    ?? '');
  const [email,   setEmail]   = useState(existingMember?.email ?? prefill?.email   ?? '');
  const [jobRole, setJobRole] = useState(existingMember?.role  ?? prefill?.jobRole ?? '');
  const [appRole, setAppRole] = useState<AppRole>(existingMember?.appRole ?? 'viewer');
  const [err,     setErr]     = useState('');

  // Agents this member will be able to run/edit once appRole === 'editor'.
  // Every other agent stays view-only for them — see authorizeAgentRun() in
  // backend/src/proxy.js and the per-agent gating in ProjectWorkspace.tsx.
  // Seeded from the member's existing assignment when resending/editing an
  // already-invited member; empty for a brand-new invite.
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(() => {
    if (!existingMember) return new Set<AgentId>();
    return new Set(
      assignments.filter((a) => a.memberIds.includes(existingMember.id)).map((a) => a.agentId)
    );
  });

  // Pre-checks a role template's suggestedAgents the first time the current
  // Job title text matches a known template (e.g. "Tech Lead"). Only ADDS
  // suggestions, never removes a selection the admin already made, and only
  // fires once per distinct matched template so unchecking a suggested agent
  // sticks instead of reappearing on the next keystroke. Custom job titles
  // (typed via "Custom role..." in the inline Add Team Member form, or any
  // free text with no matching template) simply never match here, so the
  // picker starts/stays empty and relies entirely on manual selection — same
  // mandatory-at-least-one rule applies either way (see submit() below).
  const appliedTemplateRef = useRef<string | null>(null);
  useEffect(() => {
    const template = ROLE_TEMPLATES.find((r) => r.title.toLowerCase() === jobRole.trim().toLowerCase());
    if (!template || appliedTemplateRef.current === template.id) return;
    appliedTemplateRef.current = template.id;
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      template.suggestedAgents.forEach((id) => next.add(id));
      return next;
    });
  }, [jobRole]);

  function toggleAgent(agentId: AgentId) {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  }

  const needsAgents = appRole === 'editor';
  const agentSelectionMissing = needsAgents && selectedAgents.size === 0;

  function submit() {
    if (!name.trim())                              { setErr('Name is required'); return; }
    if (!email.trim() || !email.includes('@'))     { setErr('Valid email is required'); return; }
    if (agentSelectionMissing) { setErr('Select at least one agent this Editor can run before sending the invite.'); return; }
    setErr('');
    onSubmit({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      jobRole: jobRole.trim(),
      appRole,
      agentIds: Array.from(selectedAgents),
    });
  }

  const isResend = !!existingMember;

  return (
    <div className={styles.inviteOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.inviteModal}>
        <div className={styles.inviteModalHeader}>
          <h3>{isResend ? `Send Invite to ${existingMember!.name}` : 'Invite a Team Member'}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.formGroup}>
          <label>Full name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jane Doe" disabled={isResend}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>

        <div className={styles.formGroup}>
          <label>Email address *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@company.com" disabled={isResend}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>

        <div className={styles.formGroup}>
          <label>Job title</label>
          <input value={jobRole} onChange={(e) => setJobRole(e.target.value)}
            placeholder="e.g. Product Manager"
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>

        <div className={styles.formGroup}>
          <label>Access role</label>
          <select value={appRole} onChange={(e) => setAppRole(e.target.value as AppRole)}
            className={styles.roleSelect}>
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>
            ))}
          </select>
          {appRole && (
            <p className={styles.roleHint}>{ROLE_PERMISSIONS[appRole].description}</p>
          )}
          <p className={styles.fieldHint}>Invite links are unique and locked to this project. Project Owner grants full control, including inviting others.</p>
        </div>

        {/* Role permissions mini-grid */}
        <div className={styles.permGrid} style={{ marginBottom: 12 }}>
          <div className={styles.permGridHeader}>
            <span>Permission</span>
            {INVITE_ROLES.map((r) => <span key={r}>{ROLE_PERMISSIONS[r].label}</span>)}
          </div>
          {([
            ['Run Agents',     'canRunAgents'],
            ['Edit Settings',  'canEditSettings'],
            ['Invite Members', 'canInvite'],
            ['Approve Gates',  'canCommentApprove'],
            ['View Outputs',   'canViewOutputs'],
          ] as [string, string][]).map(([label, key]) => (
            <div key={key} className={styles.permGridRow}>
              <span>{label}</span>
              {INVITE_ROLES.map((r) => (
                <span key={r} style={{ color: (ROLE_PERMISSIONS[r] as any)[key] ? 'var(--success)' : 'var(--text-muted)' }}>
                  {(ROLE_PERMISSIONS[r] as any)[key] ? '✓' : '–'}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* Mandatory agent picker for Editor invites — governs what this
            member can actually run/edit (see authorizeAgentRun() in
            backend/src/proxy.js and per-agent gating in ProjectWorkspace.tsx).
            Not shown for Project Owner (always full access regardless of
            assignment) or Reviewer/Viewer (can't run any agent regardless of
            assignment — canRunAgents is false for both at the appRole level). */}
        {needsAgents && (
          <div className={styles.formGroup}>
            <label>Agents this Editor can run *</label>
            <p className={styles.fieldHint}>
              Required — this Editor will only be able to run and edit the agents checked below.
              Every other agent stays view-only for them (they can still see its output, just can't run or edit it).
            </p>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px' }}>
              {PHASE_ORDER.map((phase) => (
                <div key={phase}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '8px 0 4px' }}>
                    {PHASE_LABELS[phase]}
                  </div>
                  {PHASE_AGENTS[phase].map((agentId) => (
                    <label key={agentId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedAgents.has(agentId)} onChange={() => toggleAgent(agentId)} />
                      {AGENT_DEFINITIONS[agentId]?.name ?? agentId}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {agentSelectionMissing && (
              <p className={styles.error}>Select at least one agent.</p>
            )}
          </div>
        )}

        {err && <p className={styles.error}>{err}</p>}

        <div className={styles.addRow} style={{ marginTop: 4 }}>
          <button className="btn-primary" onClick={submit} disabled={sending || agentSelectionMissing}>
            {sending ? 'Sending…' : isResend ? 'Resend Invite' : 'Send Invite'}
          </button>
          <button className={styles.actionBtn} onClick={onClose} disabled={sending}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProjectSettings({
  project, onClose, onRestartPipeline, initialTab, onTabChange,
  initialInviteLink, onInviteLinkChange, initialInviteError, onInviteErrorChange,
}: Props) {
  const { user, adminMode } = useAuth();
  const { showAlert } = useAlert();
  const [tab, setTabState] = useState<Tab>(initialTab ?? 'team');
  function setTab(t: Tab) {
    setTabState(t);
    onTabChange?.(t);
  }

  const [adminSessionId, setAdminSessionId] = useState<string>(
    project.activeAdminId ?? project.teamMembers?.find((m) => m.appRole === 'project_owner')?.id ?? ''
  );

  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];
  const inviteSession = getInviteSession();
  const currentMember = getProjectMember(project, {
    adminMode,
    userEmail: user?.email ?? inviteSession?.email ?? null,
    userId: user?.id ?? null,
    fallbackMemberId: project.activeAdminId ?? null,
  });
  // The ONE place this panel decides "can the current viewer edit anything
  // here" — derived solely from appRole === 'project_owner' (see
  // frontend/src/lib/projectAccess.ts's isProjectAdminUser, which this
  // mirrors). There used to be a second, independent `currentMember.isAdmin`
  // boolean that could disagree with appRole; that duplication is retired.
  const isAdmin = !!adminMode || currentMember?.appRole === 'project_owner';

  // App-wide admin (ADMIN_EMAIL_ALLOWLIST on the server) — separate from the
  // per-project `isAdmin` above. Only app admins may soft-delete or restore a
  // project; `isAdmin` here still governs regular team-management actions.
  const [isAppAdminUser, setIsAppAdminUser] = useState(false);
  useEffect(() => {
    let active = true;
    checkIsAppAdmin().then((result) => { if (active) setIsAppAdminUser(result); });
    return () => { active = false; };
  }, []);

  // ── Team tab state ──
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRoleCustom, setNewRoleCustom] = useState('');
  const [addError, setAddError] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ── Invite modal state ──
  // null = closed, 'new' = adding new member, TeamMember = re-invite existing
  const [inviteTarget,  setInviteTarget]  = useState<'new' | TeamMember | null>(null);
  const [invitePrefill, setInvitePrefill] = useState<{ name: string; email: string; jobRole: string } | undefined>(undefined);
  const [invSending, setInvSending]     = useState<string | null>(null);
  // inviteLink/inviteError are seeded from — and written back through to —
  // the parent (see initialInviteLink/onInviteLinkChange in Props above).
  // This panel gets remounted by ProjectWorkspace on repository-change events
  // (the same `key`-bump remount documented for `tab`/initialTab), which
  // would otherwise wipe these right as they're set, making the invite link
  // flash and disappear before it could be copied.
  const [inviteLink, setInviteLinkState] = useState<InviteLinkInfo>(initialInviteLink ?? null);
  function setInviteLink(v: InviteLinkInfo) {
    setInviteLinkState(v);
    onInviteLinkChange?.(v);
  }
  // Inline, per-member email-delivery-failed message (replaces a global modal
  // warning — see sendInvite()). Rendered directly under that member's
  // Resend/Send Invite button rather than as a popup that could cover the
  // invite link banner.
  const [inviteError, setInviteErrorState] = useState<InviteErrorInfo>(initialInviteError ?? null);
  function setInviteError(v: InviteErrorInfo) {
    setInviteErrorState(v);
    onInviteErrorChange?.(v);
  }

  // Admin-triggered "Reset Password" for an already-accepted member. Separate
  // from inviteLink/invSending above (those are for the initial invite flow)
  // — reset-password has no link, just a freshly generated password.
  const [resetPasswordResult, setResetPasswordResult] = useState<ResetPasswordResult>(null);
  const [resetPwSending, setResetPwSending] = useState<string | null>(null);

  // ── Assignments tab state ──
  const [roleFilterId, setRoleFilterId] = useState<string>('all');

  // ── General tab state ──
  const [projectName, setProjectName] = useState(project.name);
  const [projectDesc, setProjectDesc] = useState(project.description);
  const [projectDomain, setProjectDomain] = useState<DomainId>(project.domain);
  const [techTags, setTechTags]     = useState<string[]>(() => parseTechTags(project.techStack));
  const [techInput, setTechInput]   = useState('');
  const [generalSaved, setGeneralSaved] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // ── Archive state ──
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // ── Integrations (GitHub) state ──
  const { saveCredential, loadCredential, removeCredential } = useIntegrations();
  const [githubToken, setGithubToken] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubLoadingExisting, setGithubLoadingExisting] = useState(true);
  const [githubSaving, setGithubSaving] = useState(false);
  const [githubSaveMsg, setGithubSaveMsg] = useState('');
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubTestResult, setGithubTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Knowledge tab state ──
  const [domainKnowledge, setDomainKnowledge] = useState(project.domainKnowledge ?? '');
  const [knowledgeSaved, setKnowledgeSaved] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [brandingGuidelines, setBrandingGuidelines] = useState(project.brandingGuidelines ?? '');
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingUrl, setBrandingUrl] = useState('');
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSourceNote, setBrandingSourceNote] = useState<string | null>(null);
  // Figma pull state
  const [showFigmaPull, setShowFigmaPull] = useState(false);
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [figmaLoading, setFigmaLoading] = useState(false);
  const [figmaError, setFigmaError] = useState<string | null>(null);
  const [figmaDone, setFigmaDone] = useState(false);

  // ─── Invite logic ──────────────────────────────────────────────────────────
  async function sendInvite(member: TeamMember) {
    // No client-side block on appRole here — the server is the source of
    // truth (authorizeInviteAction() in backend/src/proxy.js): an app Admin
    // or this project's own Project Owner may grant project_owner too (a
    // Project Owner delegating full ownership). A stale unconditional block
    // used to live here from before that was allowed; removed so the "Send
    // invite granting project_owner" path actually reaches the server.
    setInvSending(member.id);
    setInviteLink(null);
    setInviteError(null);
    try {
      const API   = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      const res   = await fetch(`${API}/invite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          projectId:   project.id,
          projectName: project.name,
          name:        member.name,
          email:       member.email,
          appRole:     member.appRole ?? 'viewer',
          invitedBy:   members.find((m) => m.appRole === 'project_owner')?.name ?? 'Project Owner',
        }),
      });
      const data = await res.json();
      // The manual invite-link is now the primary, always-available path —
      // email is best-effort on top of it. The server responds ok:true with
      // inviteLink/token whenever the invite itself was created, regardless
      // of whether the email actually sent (data.emailSent distinguishes the
      // two). Only a real 4xx/5xx (bad request, unauthorized, DB failure)
      // means no invite was created at all.
      if (res.ok && data.ok && data.inviteLink && data.token) {
        // No modal here anymore — a popup warning was covering the invite
        // link right as the admin went to copy it. Instead: the link always
        // renders inline under this member's tile (below), and if the email
        // itself failed to send, a small inline red message renders right
        // under that member's Resend/Send Invite button — both are scoped to
        // this specific member via memberId, so they show up exactly where
        // the admin clicked, not in a page-level banner or a blocking modal.
        setInviteLink({ memberId: member.id, link: data.inviteLink, emailSent: !!data.emailSent, password: data.password });
        if (!data.emailSent && data.emailError) {
          setInviteError({ memberId: member.id, message: data.emailError });
        }
        await updateProject(project.id, (p) => {
          const m = p.teamMembers.find((x) => x.id === member.id);
          if (m) { m.inviteToken = data.token; m.invitedAt = Date.now(); m.inviteStatus = 'pending'; }
        });
      } else {
        showAlert('Invite failed: ' + (data.error ?? 'Unknown error'), { kind: 'error' });
      }
    } catch (e) {
      showAlert('Invite failed: ' + String(e), { kind: 'error' });
    } finally {
      setInvSending(null);
    }
  }

  async function revokeInvite(member: TeamMember) {
    if (!member.inviteToken) return;
    setInvSending(member.id);
    try {
      const API   = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      await fetch(`${API}/invite/revoke`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ token: member.inviteToken }),
      });
      await updateProject(project.id, (p) => {
        const m = p.teamMembers.find((x) => x.id === member.id);
        if (m) { m.inviteStatus = 'revoked'; m.inviteToken = undefined; }
      });
    } finally {
      setInvSending(null);
    }
  }

  // Regenerates this member's Supabase Auth password (same
  // firstname_ddmmyyyy scheme as a fresh invite) and forces a change on next
  // sign-in. Email delivery isn't reliable in every environment, so the
  // plaintext password is always shown back here regardless of emailSent.
  async function resetMemberPassword(member: TeamMember) {
    setResetPwSending(member.id);
    setResetPasswordResult(null);
    try {
      const API   = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      const res  = await fetch(`${API}/invite/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ projectId: project.id, projectName: project.name, email: member.email }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.password) {
        setResetPasswordResult({ memberId: member.id, password: data.password, emailSent: !!data.emailSent });
      } else {
        showAlert('Reset failed: ' + (data.error ?? 'Unknown error'), { kind: 'error' });
      }
    } catch (e) {
      showAlert('Reset failed: ' + String(e), { kind: 'error' });
    } finally {
      setResetPwSending(null);
    }
  }

  // Reconciles project.agentAssignments so memberId ends up assigned to
  // exactly `agentIds` — adding it to newly-selected agents and removing it
  // from ones that were unchecked (needed for the resend/edit path, where an
  // admin may narrow or widen an already-invited Editor's assignment).
  // Mutates the Immer draft `p` in place; call inside updateProject().
  function applyAgentAssignments(p: Project, memberId: string, agentIds: AgentId[]) {
    const selected = new Set(agentIds);
    p.agentAssignments = p.agentAssignments.map((a) => {
      const has = a.memberIds.includes(memberId);
      const shouldHave = selected.has(a.agentId);
      if (has && !shouldHave) return { ...a, memberIds: a.memberIds.filter((id) => id !== memberId) };
      if (!has && shouldHave) return { ...a, memberIds: [...a.memberIds, memberId] };
      return a;
    });
    for (const agentId of selected) {
      if (!p.agentAssignments.find((a) => a.agentId === agentId)) {
        p.agentAssignments.push({ agentId, memberIds: [memberId] });
      }
    }
  }

  /**
   * Called when the invite modal submits.
   * If inviteTarget === 'new': create the member first, then send invite.
   * If inviteTarget is a TeamMember: update role if changed, then send invite.
   *
   * data.agentIds is mandatory (>=1) from the modal whenever data.appRole is
   * 'editor' (see InviteModal's needsAgents/agentSelectionMissing) — every
   * Editor invited through this path gets agentAccessScoped: true, meaning
   * ProjectWorkspace.tsx and backend/src/proxy.js's authorizeAgentRun() will
   * restrict them to just these agents. Project Owner/Reviewer/Viewer are
   * never scoped (Owner always has full access; Reviewer/Viewer can't run
   * any agent regardless, per ROLE_PERMISSIONS.canRunAgents).
   */
  async function handleInviteSubmit(data: { name: string; email: string; jobRole: string; appRole: AppRole; agentIds: AgentId[] }) {
    if (inviteTarget === 'new') {
      // Create new member then invite
      const newMember: TeamMember = {
        id:           crypto.randomUUID(),
        name:         data.name,
        email:        data.email,
        role:         data.jobRole || 'Team Member',
        appRole:      data.appRole,
        avatarColor:  AVATAR_COLORS[members.length % AVATAR_COLORS.length],
        inviteStatus: 'pending',
        invitedAt:    Date.now(),
        agentAccessScoped: data.appRole === 'editor',
      };
      await updateProject(project.id, (p) => {
        p.teamMembers = [...(p.teamMembers ?? []), newMember];
        if (data.appRole === 'editor') applyAgentAssignments(p, newMember.id, data.agentIds);
      });
      if (members.length === 0) setAdminSessionId(newMember.id);
      setInviteTarget(null);
      await sendInvite(newMember);
      setNewName(''); setNewEmail(''); setNewRole(''); setNewRoleCustom('');
    } else if (inviteTarget) {
      // Existing member — update appRole if changed, then resend
      if (inviteTarget.appRole !== data.appRole || inviteTarget.role !== data.jobRole) {
        if (
          inviteTarget.appRole === 'project_owner' &&
          data.appRole !== 'project_owner' &&
          wouldLeaveNoOwner(inviteTarget.id)
        ) {
          setRemoveError(
            `Cannot change ${inviteTarget.name}'s role — they are the only Project Owner. Make another member Project Owner first.`
          );
          setInviteTarget(null);
          return;
        }
        await updateProject(project.id, (p) => {
          const m = p.teamMembers.find((x) => x.id === (inviteTarget as TeamMember).id);
          if (m) { m.appRole = data.appRole; if (data.jobRole) m.role = data.jobRole; m.agentAccessScoped = data.appRole === 'editor'; }
        });
      }
      if (data.appRole === 'editor') {
        await updateProject(project.id, (p) => { applyAgentAssignments(p, (inviteTarget as TeamMember).id, data.agentIds); });
      }
      const updated = { ...inviteTarget, appRole: data.appRole, role: data.jobRole || inviteTarget.role };
      setInviteTarget(null);
      await sendInvite(updated);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function getMemberIdsForAgent(agentId: AgentId): string[] {
    return assignments.find((a) => a.agentId === agentId)?.memberIds ?? [];
  }

  const disabledRoleIds = project.disabledRoleIds ?? [];
  const visibleRoleTemplates = ROLE_TEMPLATES.filter((r) => !disabledRoleIds.includes(r.id));
  const exportAccess = project.exportAccess ?? {};
  const enabledExportRoles = exportAccess.enabledRoleIds ?? [];
  const enabledExportMembers = exportAccess.enabledMemberIds ?? [];

  async function toggleRoleEnabled(roleId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const current = p.disabledRoleIds ?? [];
      p.disabledRoleIds = current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId];
    });
  }

  async function toggleExportRoleAccess(role: AppRole) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const current = p.exportAccess?.enabledRoleIds ?? [];
      const next = current.includes(role)
        ? current.filter((id) => id !== role)
        : [...current, role];
      p.exportAccess = {
        ...(p.exportAccess ?? {}),
        enabledRoleIds: next,
      };
    });
  }

  async function toggleExportMemberAccess(memberId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const current = p.exportAccess?.enabledMemberIds ?? [];
      const next = current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId];
      p.exportAccess = {
        ...(p.exportAccess ?? {}),
        enabledMemberIds: next,
      };
    });
  }

  async function selectAdminSession(memberId: string) {
    setAdminSessionId(memberId);
    await updateProject(project.id, (p) => { p.activeAdminId = memberId || undefined; });
  }

  const techTagsStr = techTags.join(', ');
  const coreContextChanged =
    projectDomain !== project.domain ||
    (techTagsStr || undefined) !== (project.techStack || undefined);

  async function saveGeneral() {
    if (!projectName.trim()) return;
    if (coreContextChanged) {
      setShowRestartConfirm(true);
      return;
    }
    await commitGeneralSave(false);
  }

  async function commitGeneralSave(restart: boolean) {
    setShowRestartConfirm(false);
    if (!projectName.trim()) return;
    await updateProject(project.id, (p) => {
      p.name = projectName.trim();
      p.description = projectDesc.trim();
      p.domain = projectDomain;
      p.techStack = techTagsStr || undefined;
      if (restart) {
        // Clear all agent outputs and reset pipeline to Phase 0
        p.agentRuns = {} as Project['agentRuns'];
        p.reviewGates = {} as Project['reviewGates'];
        p.status = 'draft';
        p.currentPhase = undefined;
        p.promptOverrides = [];
      }
    });
    setGeneralSaved(true);
    setTimeout(() => setGeneralSaved(false), 2000);
    if (restart && onRestartPipeline) {
      onClose();
      onRestartPipeline();
    }
  }

  async function handleDeleteProject() {
    if (!isAppAdminUser) return;
    if (!archiveReason.trim()) { setArchiveError('A reason is required to delete this project.'); return; }
    setArchiveError(null);
    try {
      // Soft delete — enforced server-side (app-admin + remarks required).
      // See db/projectRepository.ts deleteProject() and server/src/routes/projects.ts.
      await deleteProject(project.id, archiveReason.trim());
      onClose();
    } catch (err) {
      setArchiveError(String(err));
    }
  }

  async function handleRestoreProject() {
    if (!isAppAdminUser) return;
    await restoreProjectApi(project.id);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGithubLoadingExisting(true);
      const id = project.githubIntegrationId;
      if (!id) { if (!cancelled) setGithubLoadingExisting(false); return; }
      const creds = await loadCredential<GithubCredentials>(id);
      if (cancelled) return;
      if (creds) { setGithubOwner(creds.owner); setGithubRepo(creds.repo); setGithubConnected(true); }
      setGithubLoadingExisting(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.githubIntegrationId]);

  async function saveGithubIntegration() {
    if (!isAdmin) return;
    setGithubError(null); setGithubTestResult(null);
    if (!githubOwner.trim() || !githubRepo.trim()) { setGithubError('Owner and repository are required.'); return; }
    if (!githubToken.trim() && !project.githubIntegrationId) { setGithubError('A personal access token is required to connect.'); return; }
    setGithubSaving(true);
    try {
      let token = githubToken.trim();
      if (!token && project.githubIntegrationId) {
        const existing = await loadCredential<GithubCredentials>(project.githubIntegrationId);
        token = existing?.token ?? '';
        if (!token) { setGithubError('Could not load the existing token. Please re-enter your personal access token.'); return; }
      }
      const credentials: GithubCredentials = { token, owner: githubOwner.trim(), repo: githubRepo.trim() };
      const id = await saveCredential('github', `${project.name} — GitHub`, credentials, project.githubIntegrationId);
      await updateProject(project.id, (p) => { p.githubIntegrationId = id; });
      setGithubConnected(true); setGithubToken('');
      setGithubSaveMsg('✓ Saved'); setTimeout(() => setGithubSaveMsg(''), 2000);
    } finally { setGithubSaving(false); }
  }

  async function disconnectGithub() {
    if (!isAdmin) return;
    if (project.githubIntegrationId) await removeCredential(project.githubIntegrationId);
    await updateProject(project.id, (p) => { p.githubIntegrationId = undefined; });
    setGithubConnected(false); setGithubToken(''); setGithubOwner(''); setGithubRepo(''); setGithubTestResult(null);
  }

  async function testGithubConnection() {
    if (!project.githubIntegrationId) { setGithubTestResult({ ok: false, message: 'Save the connection first.' }); return; }
    setGithubTesting(true); setGithubTestResult(null);
    try {
      const creds = await loadCredential<GithubCredentials>(project.githubIntegrationId);
      if (!creds) { setGithubTestResult({ ok: false, message: 'Could not load saved credentials.' }); return; }
      const result = await api.testGithubConnection(creds);
      setGithubTestResult(result);
    } catch (err) {
      setGithubTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection test failed.' });
    } finally { setGithubTesting(false); }
  }

  // ─── Team management ──────────────────────────────────────────────────────
  const canAddMember = members.length === 0 || !!isAdmin;

  async function addMemberWithoutInvite() {
    if (!canAddMember) { setAddError('Select an admin account above to add members.'); return; }
    if (!newName.trim()) { setAddError('Name is required'); return; }
    if (!newEmail.trim() || !newEmail.includes('@')) { setAddError('Valid email is required'); return; }
    const roleValue = newRole === '__custom__' ? newRoleCustom.trim() : newRole;
    if (!roleValue) { setAddError('Role is required — pick from the list or choose Custom'); return; }
    setAddError('');
    setAddingMember(true);
    try {
      const isFirstMember = members.length === 0;
      const newMember: TeamMember = {
        id: crypto.randomUUID(), name: newName.trim(), email: newEmail.trim(),
        role: roleValue, avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
        appRole: isFirstMember ? 'project_owner' : 'editor',
        inviteStatus: 'accepted',
      };
      const template = ROLE_TEMPLATES.find((r) => r.title === roleValue);
      await updateProject(project.id, (p) => {
        p.teamMembers = [...(p.teamMembers ?? []), newMember];
        if (template) {
          template.suggestedAgents.forEach((agentId) => {
            const existing = p.agentAssignments.find((a) => a.agentId === agentId);
            if (existing) { if (!existing.memberIds.includes(newMember.id)) existing.memberIds.push(newMember.id); }
            else p.agentAssignments.push({ agentId, memberIds: [newMember.id] });
          });
        }
      });
      if (isFirstMember) setAdminSessionId(newMember.id);
      setNewName(''); setNewEmail(''); setNewRole(''); setNewRoleCustom('');
    } finally {
      setAddingMember(false);
    }
  }

  // Guards against ever leaving a project with zero Project Owners (which
  // would lock everyone out of Settings, since that's now the sole edit
  // gate). Used by removeMember below and by the role-change guard in
  // handleInviteSubmit.
  function wouldLeaveNoOwner(memberId: string): boolean {
    return members.filter((m) => m.appRole === 'project_owner' && m.id !== memberId).length === 0;
  }

  async function removeMember(memberId: string) {
    if (!isAdmin) return;
    setRemoveError(null);
    const target = members.find((m) => m.id === memberId);
    if (target?.appRole === 'project_owner' && wouldLeaveNoOwner(memberId)) {
      setRemoveError(`Cannot remove ${target.name} — they are the only Project Owner. Make another member Project Owner first.`);
      return;
    }
    await updateProject(project.id, (p) => {
      p.teamMembers = p.teamMembers.filter((m) => m.id !== memberId);
      p.agentAssignments = p.agentAssignments.map((a) => ({ ...a, memberIds: a.memberIds.filter((id) => id !== memberId) }));
      if (p.activeAdminId === memberId) p.activeAdminId = undefined;
    });
    if (adminSessionId === memberId) setAdminSessionId('');
  }

  async function toggleAgentMember(agentId: AgentId, memberId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const existing = p.agentAssignments.find((a) => a.agentId === agentId);
      if (existing) {
        if (existing.memberIds.includes(memberId)) existing.memberIds = existing.memberIds.filter((id) => id !== memberId);
        else existing.memberIds.push(memberId);
      } else {
        p.agentAssignments.push({ agentId, memberIds: [memberId] });
      }
    });
  }

  async function applyRoleTemplate(templateId: string, memberId: string) {
    if (!isAdmin) return;
    const template = ROLE_TEMPLATES.find((r) => r.id === templateId);
    if (!template) return;
    await updateProject(project.id, (p) => {
      template.suggestedAgents.forEach((agentId) => {
        const existing = p.agentAssignments.find((a) => a.agentId === agentId);
        if (existing) { if (!existing.memberIds.includes(memberId)) existing.memberIds.push(memberId); }
        else p.agentAssignments.push({ agentId, memberIds: [memberId] });
      });
    });
  }

  async function clearMemberAssignments(memberId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      p.agentAssignments = p.agentAssignments.map((a) => ({ ...a, memberIds: a.memberIds.filter((id) => id !== memberId) }));
    });
  }

  // ─── Invite status helpers ─────────────────────────────────────────────────
  const statusColors: Record<string, string> = { pending: '#d97706', accepted: '#059669', revoked: '#6b7280' };
  const roleColors:   Record<string, string> = { project_owner: '#4f46e5', editor: '#0891b2', reviewer: '#d97706', viewer: '#6b7280' };

  // ─── Render ────────────────────────────────────────────────────────────────

  function addTechTag() {
    const val = techInput.trim();
    if (!val || techTags.includes(val)) { setTechInput(''); return; }
    setTechTags((prev) => [...prev, val]);
    setTechInput('');
  }

  function removeTechTag(tag: string) {
    setTechTags((prev) => prev.filter((t) => t !== tag));
  }

  async function pullFigmaStylesFromSettings() {
    setFigmaLoading(true);
    setFigmaError(null);
    setFigmaDone(false);
    try {
      const match = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9_-]+)/);
      if (!match) {
        setFigmaError('Could not parse Figma file key. Use a link like https://www.figma.com/file/ABC123/...');
        return;
      }
      const fileKey = match[1];
      const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      const resp = await fetch(`${API}/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ fileKey, token: figmaToken }),
      });
      const data = await resp.json();
      if (!resp.ok) { setFigmaError(data.error ?? 'Figma request failed'); return; }
      const { colors, typography } = data as {
        colors: { name: string; hex: string; opacity: number }[];
        typography: { name: string; fontFamily: string; fontSize: number | null; fontWeight: number | null }[];
      };
      const lines: string[] = ['## Figma Design Tokens (auto-imported)'];
      if (colors.length > 0) {
        lines.push('\n### Color Palette');
        for (const c of colors.slice(0, 20))
          lines.push(`- **${c.name}**: ${c.hex}${c.opacity < 100 ? ` (${c.opacity}% opacity)` : ''}`);
      }
      if (typography.length > 0) {
        lines.push('\n### Typography');
        const seen = new Set<string>();
        for (const t of typography) {
          if (!seen.has(t.fontFamily)) {
            seen.add(t.fontFamily);
            const detail = [t.fontFamily, t.fontSize ? `${t.fontSize}px` : '', t.fontWeight ? `weight ${t.fontWeight}` : ''].filter(Boolean).join(', ');
            lines.push(`- **${t.name}**: ${detail}`);
          }
        }
      }
      setBrandingGuidelines((prev) =>
        prev.trim() ? prev.trim() + '\n\n' + lines.join('\n') : lines.join('\n')
      );
      setBrandingSaved(false);
      setFigmaDone(true);
      setShowFigmaPull(false);
    } catch (e) {
      setFigmaError(`Error: ${String(e)}`);
    } finally {
      setFigmaLoading(false);
    }
  }

  return (
    <>
      {/* ── Invite modal (rendered at root so it overlays everything) ── */}
      {inviteTarget !== null && (
        <InviteModal
          existingMember={inviteTarget !== 'new' ? inviteTarget : undefined}
          prefill={inviteTarget === 'new' ? invitePrefill : undefined}
          assignments={assignments}
          onSubmit={handleInviteSubmit}
          onClose={() => { setInviteTarget(null); setInvitePrefill(undefined); }}
          sending={invSending !== null}
        />
      )}

      <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className={styles.modal}>

          <div className={styles.header}>
            <div>
              <h2>Project Settings</h2>
              <p className={styles.subtitle}>{project.name}</p>
            </div>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close project settings">✕</button>
          </div>

          <div className={styles.adminBar}>
            <span className={styles.adminLabel}>
              {isAdmin ? '🔑 Admin session active' : 'Viewing as:'}
            </span>
            <select value={adminSessionId} onChange={(e) => selectAdminSession(e.target.value)} className={styles.adminSelect}>
              <option value="">— Select your identity —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.role}){m.appRole === 'project_owner' ? ' 🔑' : ''}</option>
              ))}
            </select>
            {!isAdmin && members.length > 0 && (
              <span className={styles.adminHint}>Select an admin account to make changes.</span>
            )}
            {members.length === 0 && (
              <span className={styles.adminHint}>Add the first team member to become admin.</span>
            )}
          </div>

          <div className={styles.tabs}>
            {(['general', 'team', 'assignments', 'knowledge'] as Tab[]).map((t) => (
              <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
                {t === 'general'     ? '⚙ General'
                  : t === 'team'    ? `👥 Team Members${members.length > 0 ? ` (${members.length})` : ''}`
                  : t === 'assignments' ? '🔗 Agent Assignments'
                  : '📚 Domain Knowledge'}
              </button>
            ))}
          </div>

          <div className={styles.body}>

            {/* ── GENERAL TAB ── */}
            {tab === 'general' && (
              <div className={styles.tabContent}>
                <div className={styles.formGroup}>
                  <label>Project Name</label>
                  <input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!isAdmin} />
                </div>
                <div className={styles.formGroup}>
                  <label>Description</label>
                  <textarea value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)} rows={4} disabled={!isAdmin} />
                </div>
                <div className={styles.formGroup}>
                  <label>Domain</label>
                  <select
                    value={projectDomain}
                    onChange={(e) => setProjectDomain(e.target.value as DomainId)}
                    disabled={!isAdmin}
                    className={styles.select}
                  >
                    {Object.values(DOMAINS).map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                  {projectDomain !== project.domain && (
                    <p className={styles.fieldHint} style={{ color: 'var(--warning, #d97706)' }}>
                      ⚠ Changing the domain will restart the pipeline and clear all agent outputs.
                    </p>
                  )}
                </div>
                <div className={styles.formGroup}>
                  <label>Tech Stack</label>
                  <p className={styles.fieldHint} style={{ marginTop: 0, marginBottom: 6 }}>
                    Type a technology and press Enter or click Add. Add as many as you need.
                  </p>
                  {/* Tag chips */}
                  {techTags.length > 0 && (
                    <div className={styles.techTagList}>
                      {techTags.map((tag) => (
                        <span key={tag} className={styles.techTag}>
                          {tag}
                          {isAdmin && (
                            <button
                              className={styles.techTagRemove}
                              onClick={() => removeTechTag(tag)}
                              aria-label={`Remove ${tag}`}
                              type="button"
                            >✕</button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Input row */}
                  {isAdmin && (
                    <div className={styles.techInputRow}>
                      <input
                        value={techInput}
                        onChange={(e) => setTechInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTechTag(); } }}
                        placeholder="e.g. React, Node.js, PostgreSQL, Docker…"
                        className={styles.techInput}
                      />
                      <button
                        type="button"
                        className={styles.techAddBtn}
                        onClick={addTechTag}
                        disabled={!techInput.trim()}
                      >Add</button>
                    </div>
                  )}
                  {!isAdmin && techTags.length === 0 && (
                    <p className={styles.fieldHint}>No tech stack set.</p>
                  )}
                  {(techTagsStr || undefined) !== (project.techStack || undefined) && (
                    <p className={styles.fieldHint} style={{ color: 'var(--warning, #d97706)' }}>
                      ⚠ Changing the tech stack will restart the pipeline and clear all agent outputs.
                    </p>
                  )}
                </div>
                <div className={styles.formGroup}>
                  <label>Mode</label>
                  <div className={styles.modeToggle}>
                    {(['simple', 'expert'] as const).map((m) => (
                      <button key={m} className={`${styles.modeBtn} ${project.mode === m ? styles.modeBtnActive : ''}`}
                        onClick={() => isAdmin && updateProject(project.id, (p) => { p.mode = m; })} disabled={!isAdmin}>
                        {m === 'simple' ? 'Simple' : 'Expert'}
                      </button>
                    ))}
                  </div>
                  <p className={styles.fieldHint}>
                    {project.mode === 'expert'
                      ? 'Expert: editable outputs, prompt sandbox, review gates.'
                      : 'Simple: streamlined view, review gates still apply.'}
                  </p>
                </div>
                {isAdmin && (
                  <button className="btn-primary" onClick={saveGeneral}>
                    {generalSaved ? '✓ Saved' : coreContextChanged ? '⚠ Save & Restart Pipeline' : 'Save Changes'}
                  </button>
                )}

                {/* Restart confirmation dialog */}
                {showRestartConfirm && (
                  <div className={styles.inviteOverlay} onClick={(e) => e.target === e.currentTarget && setShowRestartConfirm(false)}>
                    <div className={styles.inviteModal}>
                      <div className={styles.inviteModalHeader}>
                        <h3>Restart Pipeline?</h3>
                        <button className={styles.closeBtn} onClick={() => setShowRestartConfirm(false)} aria-label="Cancel restart">✕</button>
                      </div>
                      <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                        You changed the <strong>{projectDomain !== project.domain ? 'domain' : 'tech stack'}</strong>. This will:
                      </p>
                      <ul style={{ margin: '0 0 16px 20px', lineHeight: 1.8 }}>
                        <li>Clear all 26 agent outputs</li>
                        <li>Reset all review gates</li>
                        <li>Restart the pipeline from Phase 0 with the new context</li>
                      </ul>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                        This cannot be undone. All generated documents will be lost.
                      </p>
                      <div className={styles.addRow}>
                        <button className="btn-primary" onClick={() => commitGeneralSave(true)}>
                          Yes, restart pipeline
                        </button>
                        <button className={styles.actionBtn} onClick={() => setShowRestartConfirm(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* GitHub Integration */}
                <div className={styles.integrationSection}>
                  <p className={styles.sectionTitle}>GitHub Integration</p>
                  {githubLoadingExisting ? (
                    <p className={styles.fieldHint}>Loading…</p>
                  ) : (
                    <>
                      <div className={styles.integrationStatus}>
                        <span className={`${styles.integrationDot} ${githubConnected ? styles.integrationDotConnected : styles.integrationDotDisconnected}`} />
                        <span>{githubConnected ? `Connected to ${githubOwner}/${githubRepo}` : 'Not connected'}</span>
                      </div>
                      <p className={styles.fieldHint}>
                        Connect a repo to push Sprint Plan and Task Breakdown items as GitHub Issues.
                      </p>
                      <div className={styles.formGroup}>
                        <label>Personal Access Token {githubConnected ? '(leave blank to keep current token)' : '*'}</label>
                        <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)}
                          placeholder={githubConnected ? '••••••••••••••••' : 'ghp_…'} disabled={!isAdmin} />
                      </div>
                      <div className={styles.addRow}>
                        <div className={styles.formGroup}>
                          <label>Owner / Organization *</label>
                          <input value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder="e.g. my-org" disabled={!isAdmin} />
                        </div>
                        <div className={styles.formGroup}>
                          <label>Repository *</label>
                          <input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="e.g. my-repo" disabled={!isAdmin} />
                        </div>
                      </div>
                      {githubError && <p className={styles.error}>{githubError}</p>}
                      {githubTestResult && (
                        <p className={githubTestResult.ok ? styles.roleHint : styles.error}>
                          {githubTestResult.ok ? '✓ ' : '⚠ '}{githubTestResult.message}
                        </p>
                      )}
                      {isAdmin && (
                        <div className={styles.addRow}>
                          <button className="btn-primary" onClick={saveGithubIntegration} disabled={githubSaving}>
                            {githubSaving ? 'Saving...' : githubSaveMsg || (githubConnected ? 'Update Connection' : 'Connect')}
                          </button>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {githubConnected && (
                              <button className="btn-secondary" onClick={testGithubConnection} disabled={githubTesting}>
                                {githubTesting ? 'Testing...' : 'Test Connection'}
                              </button>
                            )}
                            {githubConnected && (
                              <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={disconnectGithub}>
                                Disconnect
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {isAppAdminUser && (
                  <div className={styles.dangerZone}>
                    <p className={styles.sectionTitle}>Danger Zone</p>
                    {project.archived ? (
                      <>
                        <p className={styles.fieldHint}>
                          This project is deleted{project.archivedBy ? ` by ${project.archivedBy}` : ''}
                          {project.archivedAt ? ` on ${new Date(project.archivedAt).toLocaleDateString()}` : ''}.
                          {project.archivedReason ? ` Reason: "${project.archivedReason}"` : ''}
                          {' '}Restore it to make it active and visible again.
                        </p>
                        <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={handleRestoreProject} style={{ alignSelf: 'flex-start' }}>↩ Restore Project</button>
                      </>
                    ) : !showArchiveConfirm ? (
                      <>
                        <p className={styles.fieldHint}>
                          Deleting soft-deletes this project (it's hidden from the dashboard, never permanently removed). An admin can restore it later.
                        </p>
                        <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => setShowArchiveConfirm(true)} style={{ alignSelf: 'flex-start' }}>Delete Project…</button>
                      </>
                    ) : (
                      <>
                        <div className={styles.formGroup}>
                          <label>Reason for deleting this project *</label>
                          <textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={3}
                            placeholder="e.g. Project cancelled, duplicate, scope merged into another project..." />
                        </div>
                        {archiveError && <p className={styles.error}>{archiveError}</p>}
                        <div className={styles.addRow}>
                          <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={handleDeleteProject}>Confirm Delete</button>
                          <button className={styles.actionBtn} onClick={() => { setShowArchiveConfirm(false); setArchiveReason(''); setArchiveError(null); }}>Cancel</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── TEAM TAB ── */}
            {tab === 'team' && (
              <div className={styles.tabContent}>

                {/* Add member section */}
                <div className={styles.addSection}>
                  <p className={styles.sectionTitle}>
                    {members.length === 0
                      ? '👋 Add your first team member — they become admin automatically'
                      : isAdmin ? 'Add Team Member' : 'Team Members'}
                  </p>
                  <div className={styles.addForm}>
                    <div className={styles.addRow}>
                      <label className={styles.addFieldLabel}>
                        <span>Full name *</span>
                        <input placeholder="e.g. Jane Doe" value={newName} onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addMemberWithoutInvite()} disabled={!canAddMember} />
                      </label>
                      <label className={styles.addFieldLabel}>
                        <span>Email *</span>
                        <input placeholder="e.g. jane@company.com" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addMemberWithoutInvite()} disabled={!canAddMember} />
                      </label>
                    </div>
                    <div className={styles.addRow}>
                      <label className={styles.addFieldLabel}>
                        <span>Role *</span>
                        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className={styles.roleSelect} disabled={!canAddMember}>
                          <option value="">Select role *</option>
                          {visibleRoleTemplates.map((r) => (
                            <option key={r.id} value={r.title}>{r.title}</option>
                          ))}
                          <option value="__custom__">Custom role...</option>
                        </select>
                      </label>
                      {newRole === '__custom__' ? (
                        <label className={styles.addFieldLabel}>
                          <span>Custom role *</span>
                          <input placeholder="e.g. QA Lead" value={newRoleCustom} onChange={(e) => setNewRoleCustom(e.target.value)} disabled={!canAddMember} />
                        </label>
                      ) : (
                        <div className={styles.rolePreview}>
                          {newRole
                            ? <span className={styles.roleHint}>✓ Agent mappings for <strong>{newRole}</strong> applied automatically</span>
                            : <span className={styles.roleHintMuted}>Role determines which agents are pre-assigned</span>}
                        </div>
                      )}
                    </div>
                    {/* Two action buttons: Add only, or Add + Send Invite */}
                    <div className={styles.addRow} style={{ gap: 8 }}>
                      <button className="btn-primary" disabled={!canAddMember || addingMember || inviteTarget !== null} onClick={() => {
                        // Validate then open invite modal pre-filled
                        if (!canAddMember) { setAddError('Select an admin account above to add members.'); return; }
                        if (!newName.trim()) { setAddError('Name is required'); return; }
                        if (!newEmail.trim() || !newEmail.includes('@')) { setAddError('Valid email is required'); return; }
                        const rv = newRole === '__custom__' ? newRoleCustom.trim() : newRole;
                        if (!rv) { setAddError('Role is required'); return; }
                        setAddError('');
                        setInvitePrefill({ name: newName.trim(), email: newEmail.trim(), jobRole: rv });
                        setInviteTarget('new');
                      }} style={{ alignSelf: 'flex-start' }}>
                        {inviteTarget !== null ? 'Sending…' : '✉ Add & Send Invite'}
                      </button>
                      <button className={styles.actionBtn} disabled={!canAddMember || addingMember} onClick={addMemberWithoutInvite} style={{ alignSelf: 'flex-start' }}>
                        {addingMember ? 'Adding…' : '+ Add without invite'}
                      </button>
                    </div>
                    {addError && <p className={styles.error}>{addError}</p>}
                    {!canAddMember && members.length > 0 && (
                      <p className={styles.lockedHint}>🔒 Select an admin identity above to add or remove members.</p>
                    )}
                  </div>
                </div>

                {/* Member list */}
                {members.length > 0 && (
                  <div className={styles.memberSection}>
                    <p className={styles.sectionTitle}>Team — {members.length} member{members.length !== 1 ? 's' : ''}</p>
                    {removeError && (
                      <div className={styles.removeError}>
                        ⛔ {removeError}
                        <button className={styles.removeErrorDismiss} onClick={() => setRemoveError(null)} aria-label="Dismiss error">✕</button>
                      </div>
                    )}
                    <div className={styles.memberGrid}>
                      {members.map((m) => {
                        const assignedAgents = assignments
                          .filter((a) => a.memberIds.includes(m.id))
                          .map((a) => ({ id: a.agentId, name: AGENT_DEFINITIONS[a.agentId]?.name ?? a.agentId }));
                        const roleTemplate     = ROLE_TEMPLATES.find((r) => r.title === m.role);
                        const isCurrentSession = adminSessionId === m.id;
                        const hasUnmapped      = assignedAgents.length === 0;
                        const isLastOwner      = m.appRole === 'project_owner' && wouldLeaveNoOwner(m.id);
                        const appRole          = m.appRole ?? 'viewer';
                        const invStatus        = m.inviteStatus;
                        const rc               = roleColors[appRole]   ?? '#6b7280';
                        const sc               = statusColors[invStatus ?? 'pending'] ?? '#6b7280';

                        return (
                          <div key={m.id} className={`${styles.memberCard} ${isCurrentSession ? styles.memberCardActive : ''} ${hasUnmapped ? styles.memberCardWarning : ''}`}>
                            <div className={styles.memberCardTop}>
                              <div className={styles.avatar} style={{ background: m.avatarColor }}>{initials(m.name)}</div>
                              <div className={styles.memberInfo}>
                                <div className={styles.memberNameRow}>
                                  <span className={styles.memberName}>{m.name}</span>
                                  {m.appRole === 'project_owner' && <span className={styles.adminBadge}>Owner</span>}
                                  {isCurrentSession && <span className={styles.youBadge}>You</span>}
                                  {/* Access role badge */}
                                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: rc + '22', color: rc, marginLeft: 2 }}>
                                    {ROLE_PERMISSIONS[appRole].label}
                                  </span>
                                </div>
                                <span className={styles.memberEmail}>{m.email}</span>
                                {/* Invite status line */}
                                {invStatus && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: sc + '22', color: sc }}>
                                      {invStatus === 'pending' ? '✉ Pending' : invStatus === 'accepted' ? '✓ Accepted' : 'Revoked'}
                                    </span>
                                    {m.invitedAt && (
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        {invStatus === 'accepted' && m.acceptedAt
                                          ? `Accepted ${new Date(m.acceptedAt).toLocaleDateString()}`
                                          : `Sent ${new Date(m.invitedAt).toLocaleDateString()}`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className={styles.memberCardRole} style={{ borderLeftColor: roleTemplate?.color ?? '#888' }}>
                              <span className={styles.memberRoleTitle} style={{ color: roleTemplate?.color ?? 'var(--text)' }}>{m.role}</span>
                              {roleTemplate && <span className={styles.memberRoleDesc}>{roleTemplate.description}</span>}
                            </div>

                            <div className={styles.memberAgentList}>
                              {assignedAgents.length === 0 ? (
                                <span className={styles.memberAgentWarning}>⚠ No agents assigned — pipeline cannot run</span>
                              ) : (
                                <>
                                  <span className={styles.memberAgentListLabel}>{assignedAgents.length} agent{assignedAgents.length !== 1 ? 's' : ''}:</span>
                                  <div className={styles.memberAgentPills}>
                                    {assignedAgents.map((a) => (
                                      <span key={a.id} className={styles.memberAgentPill}>{a.name}</span>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            <div className={styles.memberCardFooter}>
                              <div className={styles.memberActions}>
                                {/* Invite / Resend / Revoke */}
                                {isAdmin && invStatus !== 'accepted' && (
                                  <button
                                    className={styles.actionBtn}
                                    onClick={() => setInviteTarget(m)}
                                    disabled={invSending === m.id}
                                    title={invStatus === 'pending' ? 'Resend invite email' : 'Send invite email'}
                                  >
                                    {invSending === m.id ? '…' : invStatus === 'pending' ? '↺ Resend Invite' : '✉ Send Invite'}
                                  </button>
                                )}
                                {isAdmin && m.inviteToken && invStatus === 'pending' && (
                                  <button
                                    className={styles.actionBtn}
                                    style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
                                    onClick={() => revokeInvite(m)}
                                    disabled={invSending === m.id}
                                    title="Revoke this invite link"
                                  >
                                    Revoke
                                  </button>
                                )}
                                {isAdmin && invStatus === 'accepted' && (
                                  <button
                                    className={styles.actionBtn}
                                    onClick={() => resetMemberPassword(m)}
                                    disabled={resetPwSending === m.id}
                                    title="Generate a new password for this member and force them to change it on next sign-in"
                                  >
                                    {resetPwSending === m.id ? '…' : '🔑 Reset Password'}
                                  </button>
                                )}
                                {isAdmin && (
                                  <button
                                    className={`${styles.actionBtn} ${styles.removeBtn}`}
                                    onClick={() => removeMember(m.id)}
                                    title={isLastOwner ? 'Cannot remove — only Project Owner' : 'Remove member'}
                                    disabled={isLastOwner}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>

                              {/* Inline email-delivery-failed message — scoped to this
                                  member, rendered right under their Resend/Send Invite
                                  button rather than as a page-level popup. */}
                              {inviteError?.memberId === m.id && (
                                <p style={{ color: 'var(--error)', fontSize: 12, margin: '6px 0 0' }}>
                                  ⚠ Email delivery failed: {inviteError.message}
                                </p>
                              )}

                              {/* Invite link + generated password for this member —
                                  shown right on their tile as soon as an invite is
                                  created. The password is always shown here since
                                  email delivery isn't reliable in every environment —
                                  it's the primary way an admin learns the actual
                                  generated credential to hand off manually. */}
                              {inviteLink?.memberId === m.id && (
                                <div style={{ marginTop: 6 }}>
                                  <div className={styles.inviteLinkRow}>
                                    <input
                                      readOnly
                                      value={inviteLink.link}
                                      className={styles.inviteLinkInput}
                                      onFocus={(e) => e.currentTarget.select()}
                                    />
                                    <button
                                      className={styles.copyBtn}
                                      onClick={() => navigator.clipboard.writeText(inviteLink.link)}
                                    >
                                      Copy
                                    </button>
                                  </div>
                                  {inviteLink.password && (
                                    <div className={styles.inviteLinkRow} style={{ marginTop: 4 }}>
                                      <input
                                        readOnly
                                        value={inviteLink.password}
                                        className={styles.inviteLinkInput}
                                        style={{ fontFamily: 'monospace' }}
                                        onFocus={(e) => e.currentTarget.select()}
                                        aria-label="Generated password"
                                      />
                                      <button
                                        className={styles.copyBtn}
                                        onClick={() => navigator.clipboard.writeText(inviteLink.password!)}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  )}
                                  {inviteLink.password && !inviteLink.emailSent && (
                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                      Email wasn't sent — share this password with them directly.
                                    </p>
                                  )}
                                  {inviteLink.password && (
                                    <button
                                      className={styles.actionBtn}
                                      style={{ marginTop: 6, fontSize: 12 }}
                                      onClick={() => navigator.clipboard.writeText(
                                        `You're invited to join ${project.name}. Sign in here: ${inviteLink.link}\nTemporary password: ${inviteLink.password}`
                                      )}
                                    >
                                      📋 Copy invite message (link + password)
                                    </button>
                                  )}
                                  <button
                                    className={styles.dismissLink}
                                    onClick={() => { setInviteLink(null); setInviteError(null); }}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}

                              {/* Result of an admin-triggered password reset — same
                                  treatment as the invite-link block above. */}
                              {resetPasswordResult?.memberId === m.id && (
                                <div style={{ marginTop: 6 }}>
                                  <div className={styles.inviteLinkRow}>
                                    <input
                                      readOnly
                                      value={resetPasswordResult.password}
                                      className={styles.inviteLinkInput}
                                      style={{ fontFamily: 'monospace' }}
                                      onFocus={(e) => e.currentTarget.select()}
                                      aria-label="New password"
                                    />
                                    <button
                                      className={styles.copyBtn}
                                      onClick={() => navigator.clipboard.writeText(resetPasswordResult.password)}
                                    >
                                      Copy
                                    </button>
                                  </div>
                                  {!resetPasswordResult.emailSent && (
                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                      Email wasn't sent — share this password with them directly.
                                    </p>
                                  )}
                                  <button
                                    className={styles.dismissLink}
                                    onClick={() => setResetPasswordResult(null)}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isAdmin && members.length > 0 && (
                  <div className={styles.exportAccessSection}>
                    <p className={styles.sectionTitle}>Export &amp; Download Access</p>
                    <p className={styles.fieldHint}>
                      Admins always keep export access. Use the controls below to allow specific app roles or named team members to download and export artifacts for this project.
                    </p>

                    <div className={styles.exportAccessBlock}>
                      <p className={styles.exportAccessLabel}>Allow by role</p>
                      <div className={styles.exportAccessChips}>
                        {(['project_owner', 'editor', 'reviewer', 'viewer'] as AppRole[]).map((role) => {
                          const active = enabledExportRoles.includes(role);
                          return (
                            <button
                              key={role}
                              className={styles.exportAccessChip + (active ? ' ' + styles.exportAccessChipActive : '')}
                              onClick={() => toggleExportRoleAccess(role)}
                              title={active ? 'Remove export access for this role' : 'Grant export access for this role'}
                            >
                              <span>{ROLE_PERMISSIONS[role].label}</span>
                              <span>{active ? '✓' : '＋'}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.exportAccessBlock}>
                      <p className={styles.exportAccessLabel}>Allow specific team members</p>
                      <div className={styles.exportAccessGrid}>
                        {members.map((m) => {
                          const active = enabledExportMembers.includes(m.id);
                          const alwaysAllowed = m.appRole === 'project_owner';
                          return (
                            <button
                              key={m.id}
                              className={styles.exportAccessMember + (active ? ' ' + styles.exportAccessMemberActive : '')}
                              onClick={() => !alwaysAllowed && toggleExportMemberAccess(m.id)}
                              disabled={alwaysAllowed}
                              title={alwaysAllowed ? 'Project Owners already have export access' : (active ? 'Remove this member export access' : 'Grant this member export access')}
                            >
                              <span className={styles.exportAccessMemberMain}>
                                <span className={styles.avatarSmall} style={{ background: m.avatarColor }}>{initials(m.name)}</span>
                                <span>
                                  <strong>{m.name}</strong>
                                  <span className={styles.exportAccessMemberMeta}>
                                    {m.role} · {ROLE_PERMISSIONS[m.appRole ?? 'viewer'].label}
                                  </span>
                                </span>
                              </span>
                              <span className={styles.exportAccessMemberState}>
                                {alwaysAllowed ? 'Admin' : active ? 'Allowed' : 'Blocked'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <details className={styles.roleReference}>
                  <summary className={styles.roleReferenceSummary}>📋 Suggested roles &amp; agent mappings reference</summary>
                  {isAdmin && (
                    <p className={styles.fieldHint}>
                      Toggle a role off to hide it from the "Select role" and "Apply template" pickers for this project.
                    </p>
                  )}
                  <div className={styles.roleCards}>
                    {ROLE_TEMPLATES.map((r) => {
                      const disabled = disabledRoleIds.includes(r.id);
                      return (
                        <div key={r.id} className={styles.roleCard} style={{ borderLeftColor: r.color, opacity: disabled ? 0.5 : 1 }}>
                          <div className={styles.memberNameRow} style={{ justifyContent: 'space-between', width: '100%' }}>
                            <span className={styles.roleCardTitle} style={{ color: r.color }}>{r.title}</span>
                            {isAdmin && (
                              <button className={styles.actionBtn} onClick={() => toggleRoleEnabled(r.id)}
                                title={disabled ? 'Show this role in pickers' : 'Hide this role from pickers'}>
                                {disabled ? 'Hidden — show' : 'Visible — hide'}
                              </button>
                            )}
                          </div>
                          <span className={styles.roleCardDesc}>{r.description}</span>
                          <span className={styles.roleCardAgents}>
                            {r.suggestedAgents.map((a) => AGENT_DEFINITIONS[a]?.name ?? a).join(' · ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}

            {/* ── ASSIGNMENTS TAB ── */}
            {tab === 'assignments' && (
              <div className={styles.tabContent}>
                {members.length === 0 ? (
                  <p className={styles.emptyHint}>Add team members first to configure assignments.</p>
                ) : (
                  <>
                    {isAdmin && (
                      <div className={styles.quickApplySection}>
                        <p className={styles.sectionTitle}>Quick-apply Role Templates</p>
                        <p className={styles.fieldHint}>Pick a member and apply a role template to set their agent assignments in one click.</p>
                        <div className={styles.quickApplyGrid}>
                          {members.map((m) => (
                            <div key={m.id} className={styles.quickApplyRow}>
                              <div className={styles.avatarSmall} style={{ background: m.avatarColor }}>{initials(m.name)}</div>
                              <span className={styles.quickApplyName}>{m.name}</span>
                              <select defaultValue="" onChange={(e) => { if (e.target.value) applyRoleTemplate(e.target.value, m.id); e.target.value = ''; }} className={styles.quickApplySelect}>
                                <option value="">Apply template...</option>
                                {visibleRoleTemplates.map((r) => (
                                  <option key={r.id} value={r.id}>{r.title}</option>
                                ))}
                              </select>
                              <button className={styles.clearBtn} onClick={() => clearMemberAssignments(m.id)} title="Clear all assignments">Clear</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className={styles.filterRow}>
                      <span className={styles.sectionTitle}>Agent → Member Matrix</span>
                      <select value={roleFilterId} onChange={(e) => setRoleFilterId(e.target.value)} className={styles.filterSelect}>
                        <option value="all">All phases</option>
                        {PHASE_ORDER.map((p) => (
                          <option key={p} value={p}>{PHASE_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.matrix}>
                      <div className={styles.matrixHeader}>
                        <div className={styles.matrixAgentCol}>Agent</div>
                        {members.map((m) => (
                          <div key={m.id} className={styles.matrixMemberCol} title={`${m.name} (${m.role})`}>
                            <div className={styles.avatarSmall} style={{ background: m.avatarColor }}>{initials(m.name)}</div>
                            <span className={styles.matrixMemberName}>{m.name.split(' ')[0]}</span>
                          </div>
                        ))}
                      </div>
                      {PHASE_ORDER
                        .filter((ph) => roleFilterId === 'all' || ph === roleFilterId)
                        .map((phase) => (
                          <div key={phase}>
                            <div className={styles.matrixPhaseRow}>{PHASE_LABELS[phase]}</div>
                            {PHASE_AGENTS[phase].map((agentId) => {
                              const def = AGENT_DEFINITIONS[agentId];
                              const assignedIds = getMemberIdsForAgent(agentId);
                              return (
                                <div key={agentId} className={styles.matrixRow}>
                                  <div className={styles.matrixAgentCol}>
                                    <span className={styles.matrixAgentName}>{def?.name ?? agentId}</span>
                                    <span className={styles.matrixSuggestedRoles}>
                                      {visibleRoleTemplates
                                        .filter((r) => r.suggestedAgents.includes(agentId))
                                        .map((r) => (
                                          <span key={r.id} className={styles.rolePill}
                                            style={{ background: r.color + '22', color: r.color, borderColor: r.color + '44' }}>
                                            {r.title}
                                          </span>
                                        ))}
                                    </span>
                                  </div>
                                  {members.map((m) => {
                                    const checked = assignedIds.includes(m.id);
                                    return (
                                      <div key={m.id} className={styles.matrixCell}>
                                        <button
                                          className={`${styles.checkBtn} ${checked ? styles.checkBtnOn : ''}`}
                                          style={checked ? { background: m.avatarColor, borderColor: m.avatarColor } : undefined}
                                          onClick={() => toggleAgentMember(agentId, m.id)}
                                          disabled={!isAdmin}
                                          title={checked ? `Remove ${m.name}` : `Assign ${m.name}`}
                                        >
                                          {checked ? '✓' : ''}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                    </div>
                    <div className={styles.legend}>
                      <span>Unassigned agents will block the pipeline from running.</span>
                      {!isAdmin && <span className={styles.adminHint}>Select an admin identity to edit assignments.</span>}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── KNOWLEDGE TAB ── */}
            {tab === 'knowledge' && (
              <div className={styles.tabContent}>
                <div className={styles.formGroup}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Domain Knowledge Brief</span>
                    <span className={styles.domainChipSmall}
                      style={{ color: getDomain(project.domain).color, background: getDomain(project.domain).bgColor }}>
                      {getDomain(project.domain).label}
                    </span>
                  </label>
                  <p className={styles.knowledgeHint}>
                    This content is prepended to every agent's system prompt as domain context.
                  </p>
                  <textarea className={styles.knowledgeTextarea} value={domainKnowledge}
                    onChange={(e) => { setDomainKnowledge(e.target.value); setKnowledgeSaved(false); }}
                    rows={14} disabled={!isAdmin}
                    placeholder="Describe domain context, regulatory requirements, architecture patterns..." />
                  {knowledgeSaved && <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>✓ Saved.</p>}
                  {knowledgeError && <p style={{ fontSize: 12, color: 'var(--error, #dc2626)', marginTop: 6 }}>{knowledgeError}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn-primary" disabled={!isAdmin}
                    onClick={async () => { await updateProject(project.id, (p) => { p.domainKnowledge = domainKnowledge.trim() || undefined; }); setKnowledgeSaved(true); }}>
                    Save Domain Knowledge
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12 }} disabled={!isAdmin || knowledgeLoading}
                    onClick={async () => {
                      setKnowledgeLoading(true); setKnowledgeError(null); setKnowledgeSaved(false);
                      try {
                        const generated = await api.generateDomainKnowledge({
                          domainLabel: getDomain(project.domain).label,
                          domainTemplate: DOMAIN_KNOWLEDGE_TEMPLATES[project.domain],
                          projectName: project.name, projectDescription: project.description,
                          currentInput: domainKnowledge,
                        });
                        if (generated) setDomainKnowledge(generated);
                        else setKnowledgeError('No content returned. Try again.');
                      } catch (err) {
                        setKnowledgeError(err instanceof Error ? err.message : 'Failed to generate domain knowledge.');
                      } finally { setKnowledgeLoading(false); }
                    }}>
                    {knowledgeLoading ? '🔍 Researching...' : '🔍 Get Domain Knowledge'}
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12 }}
                    onClick={() => { setDomainKnowledge(DOMAIN_KNOWLEDGE_TEMPLATES[project.domain] ?? ''); setKnowledgeSaved(false); }}>
                    ↺ Reset to template
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12 }}
                    onClick={() => {
                      const blob = new Blob([domainKnowledge], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url;
                      a.download = `domain-knowledge-${project.domain}.md`; a.click();
                      URL.revokeObjectURL(url);
                    }}>
                    ↓ Download .md
                  </button>
                </div>
                {!isAdmin && <p className={styles.adminHint}>Select an admin identity to edit domain knowledge.</p>}

                <div className={styles.formGroup} style={{ marginTop: 24 }}>
                  <label>Branding Guidelines</label>
                  <p className={styles.knowledgeHint}>
                    Brand colors, typography, tone of voice, and logo/style references. Used by the UX Mockups agent.
                  </p>
                  <input type="text" className={styles.knowledgeTextarea}
                    style={{ minHeight: 'unset', height: 36, resize: 'none' }}
                    value={brandingUrl}
                    onChange={(e) => setBrandingUrl(e.target.value)}
                    disabled={!isAdmin}
                    placeholder="Optional: https://example.com — the site whose branding to replicate"
                  />
                  <textarea
                    className={styles.knowledgeTextarea}
                    value={brandingGuidelines}
                    onChange={(e) => { setBrandingGuidelines(e.target.value); setBrandingSaved(false); }}
                    rows={6}
                    disabled={!isAdmin}
                    placeholder="e.g. Primary color #1A73E8, secondary #34A853; font: Inter; tone: friendly and approachable; follow our existing web app's visual style..."
                  />
                  {brandingSaved && (
                    <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>✓ Branding guidelines saved and will be used by the UX Mockups agent.</p>
                  )}
                  {brandingSourceNote && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{brandingSourceNote}</p>
                  )}
                  {brandingError && (
                    <p style={{ fontSize: 12, color: 'var(--error, #dc2626)', marginTop: 6 }}>{brandingError}</p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    disabled={!isAdmin}
                    onClick={async () => {
                      await updateProject(project.id, (p) => { p.brandingGuidelines = brandingGuidelines.trim() || undefined; });
                      setBrandingSaved(true);
                    }}
                  >
                    Save Branding Guidelines
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12 }}
                    disabled={!isAdmin || brandingLoading}
                    onClick={async () => {
                      setBrandingLoading(true);
                      setBrandingError(null);
                      setBrandingSaved(false);
                      setBrandingSourceNote(null);
                      try {
                        const { brief, signals } = await api.generateBrandingGuidelines({
                          projectName: project.name,
                          projectDescription: project.description,
                          notes: brandingGuidelines,
                          url: brandingUrl,
                        });
                        if (brief) {
                          setBrandingGuidelines(brief);
                          if (signals) {
                            setBrandingSourceNote(`Based on a live fetch of ${signals.url}.`);
                          }
                        } else {
                          setBrandingError('No content returned. Try again.');
                        }
                      } catch (err) {
                        setBrandingError(err instanceof Error ? err.message : 'Failed to generate branding guidelines.');
                      } finally {
                        setBrandingLoading(false);
                      }
                    }}
                  >
                    {brandingLoading ? '🔍 Researching...' : '🔍 Get Branding Guidelines'}
                  </button>
                </div>
                {!isAdmin && (
                  <p className={styles.adminHint}>Select an admin identity to edit branding guidelines.</p>
                )}
              </div>
            )}

        </div>
      </div>
    </div>
    </>
  );
}
