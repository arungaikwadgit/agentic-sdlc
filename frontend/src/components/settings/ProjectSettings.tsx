import { useState, useEffect } from 'react';
import { updateProject } from '@/db/projectRepository';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { ROLE_TEMPLATES } from '@/data/roleTemplates';
import { DOMAINS } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import { api } from '@/services/api';
import { useIntegrations } from '@/hooks/useIntegrations';
import type { Project, TeamMember, AgentAssignment } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import type { GithubCredentials } from '@/types/integration.types';
import styles from './ProjectSettings.module.css';

// ─── helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#4f46e5','#0891b2','#059669','#d97706',
  '#dc2626','#7c3aed','#db2777','#0d9488',
];

export function initials(name: string) {
  return name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

type Tab = 'general' | 'team' | 'assignments' | 'knowledge';

interface Props {
  project: Project;
  onClose: () => void;
}

export default function ProjectSettings({ project, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('team');

  const [adminSessionId, setAdminSessionId] = useState<string>(
    project.activeAdminId ?? project.teamMembers?.find((m) => m.isAdmin)?.id ?? ''
  );

  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];
  const isAdmin = !!adminSessionId && members.find((m) => m.id === adminSessionId)?.isAdmin;

  // ── Team tab state ──
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRoleCustom, setNewRoleCustom] = useState('');
  const [addError, setAddError] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ── Assignments tab state ──
  const [roleFilterId, setRoleFilterId] = useState<string>('all');

  // ── General tab state ──
  const [projectName, setProjectName] = useState(project.name);
  const [projectDesc, setProjectDesc] = useState(project.description);
  const [generalSaved, setGeneralSaved] = useState(false);

  // ── Archive (soft delete) state ──
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

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function getMemberIdsForAgent(agentId: AgentId): string[] {
    return assignments.find((a) => a.agentId === agentId)?.memberIds ?? [];
  }

  function getMembersForAgent(agentId: AgentId): TeamMember[] {
    return getMemberIdsForAgent(agentId)
      .map((id) => members.find((m) => m.id === id))
      .filter(Boolean) as TeamMember[];
  }

  // ─── Role visibility (per-project) ─────────────────────────────────────────
  const disabledRoleIds = project.disabledRoleIds ?? [];
  const visibleRoleTemplates = ROLE_TEMPLATES.filter((r) => !disabledRoleIds.includes(r.id));

  async function toggleRoleEnabled(roleId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const current = p.disabledRoleIds ?? [];
      p.disabledRoleIds = current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId];
    });
  }

  // ─── Admin session ──────────────────────────────────────────────────────────
  async function selectAdminSession(memberId: string) {
    setAdminSessionId(memberId);
    await updateProject(project.id, (p) => { p.activeAdminId = memberId || undefined; });
  }

  // ─── General save ──────────────────────────────────────────────────────────
  async function saveGeneral() {
    if (!projectName.trim()) return;
    await updateProject(project.id, (p) => {
      p.name = projectName.trim();
      p.description = projectDesc.trim();
    });
    setGeneralSaved(true);
    setTimeout(() => setGeneralSaved(false), 2000);
  }

  // ─── Archive (soft delete) ──────────────────────────────────────────────────
  async function archiveProject() {
    if (!isAdmin) return;
    if (!archiveReason.trim()) {
      setArchiveError('A reason is required to delete this project.');
      return;
    }
    setArchiveError(null);
    const archivedByMember = members.find((m) => m.id === adminSessionId);
    await updateProject(project.id, (p) => {
      p.archived = true;
      p.archivedReason = archiveReason.trim();
      p.archivedAt = Date.now();
      p.archivedBy = archivedByMember?.name ?? adminSessionId;
    });
    onClose();
  }

  async function restoreProject() {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      p.archived = false;
      p.archivedReason = undefined;
      p.archivedAt = undefined;
      p.archivedBy = undefined;
    });
  }

  // ─── GitHub integration ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGithubLoadingExisting(true);
      const id = project.githubIntegrationId;
      if (!id) {
        if (!cancelled) setGithubLoadingExisting(false);
        return;
      }
      const creds = await loadCredential<GithubCredentials>(id);
      if (cancelled) return;
      if (creds) {
        setGithubOwner(creds.owner);
        setGithubRepo(creds.repo);
        setGithubConnected(true);
        // Token itself is intentionally not re-displayed for security; leave the field blank.
      }
      setGithubLoadingExisting(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.githubIntegrationId]);

  async function saveGithubIntegration() {
    if (!isAdmin) return;
    setGithubError(null);
    setGithubTestResult(null);
    if (!githubOwner.trim() || !githubRepo.trim()) {
      setGithubError('Owner and repository are required.');
      return;
    }
    if (!githubToken.trim() && !project.githubIntegrationId) {
      setGithubError('A personal access token is required to connect.');
      return;
    }
    setGithubSaving(true);
    try {
      let token = githubToken.trim();
      if (!token && project.githubIntegrationId) {
        // Re-saving owner/repo without changing the token: load the existing token first.
        const existing = await loadCredential<GithubCredentials>(project.githubIntegrationId);
        token = existing?.token ?? '';
        if (!token) {
          setGithubError('Could not load the existing token. Please re-enter your personal access token.');
          return;
        }
      }
      const credentials: GithubCredentials = { token, owner: githubOwner.trim(), repo: githubRepo.trim() };
      // Reuse the existing record id if present (overwrites in place), otherwise create a new one.
      const id = await saveCredential('github', `${project.name} — GitHub`, credentials, project.githubIntegrationId);
      await updateProject(project.id, (p) => { p.githubIntegrationId = id; });
      setGithubConnected(true);
      setGithubToken('');
      setGithubSaveMsg('✓ Saved');
      setTimeout(() => setGithubSaveMsg(''), 2000);
    } finally {
      setGithubSaving(false);
    }
  }

  async function disconnectGithub() {
    if (!isAdmin) return;
    if (project.githubIntegrationId) {
      await removeCredential(project.githubIntegrationId);
    }
    await updateProject(project.id, (p) => { p.githubIntegrationId = undefined; });
    setGithubConnected(false);
    setGithubToken('');
    setGithubOwner('');
    setGithubRepo('');
    setGithubTestResult(null);
  }

  async function testGithubConnection() {
    if (!project.githubIntegrationId) {
      setGithubTestResult({ ok: false, message: 'Save the connection first.' });
      return;
    }
    setGithubTesting(true);
    setGithubTestResult(null);
    try {
      const creds = await loadCredential<GithubCredentials>(project.githubIntegrationId);
      if (!creds) {
        setGithubTestResult({ ok: false, message: 'Could not load saved credentials.' });
        return;
      }
      const result = await api.testGithubConnection(creds);
      setGithubTestResult(result);
    } catch (err) {
      setGithubTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection test failed.' });
    } finally {
      setGithubTesting(false);
    }
  }

  // ─── Team management ─────────────────────────────────────────────────────
  const canAddMember = members.length === 0 || !!isAdmin;

  async function addMember() {
    if (!canAddMember) { setAddError('Select an admin account above to add members.'); return; }
    if (!newName.trim()) { setAddError('Name is required'); return; }
    if (!newEmail.trim() || !newEmail.includes('@')) { setAddError('Valid email is required'); return; }
    const roleValue = newRole === '__custom__' ? newRoleCustom.trim() : newRole;
    if (!roleValue) { setAddError('Role is required — pick from the list or choose Custom'); return; }
    setAddError('');

    const isFirstMember = members.length === 0;
    const newMember: TeamMember = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      email: newEmail.trim(),
      role: roleValue,
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
      isAdmin: isFirstMember,
    };

    const template = ROLE_TEMPLATES.find((r) => r.title === roleValue);

    await updateProject(project.id, (p) => {
      p.teamMembers = [...(p.teamMembers ?? []), newMember];
      if (template) {
        template.suggestedAgents.forEach((agentId) => {
          const existing = p.agentAssignments.find((a) => a.agentId === agentId);
          if (existing) {
            if (!existing.memberIds.includes(newMember.id)) existing.memberIds.push(newMember.id);
          } else {
            p.agentAssignments.push({ agentId, memberIds: [newMember.id] });
          }
        });
      }
    });
    if (isFirstMember) setAdminSessionId(newMember.id);
    setNewName(''); setNewEmail(''); setNewRole(''); setNewRoleCustom('');
  }

  /** Returns true if removing/demoting memberId would leave zero admins. */
  function wouldLeaveNoAdmin(memberId: string): boolean {
    return members.filter((m) => m.isAdmin && m.id !== memberId).length === 0;
  }

  async function removeMember(memberId: string) {
    if (!isAdmin) return;
    setRemoveError(null);
    const target = members.find((m) => m.id === memberId);
    if (target?.isAdmin && wouldLeaveNoAdmin(memberId)) {
      setRemoveError(
        `Cannot remove ${target.name} — they are the only admin. Assign another admin first.`
      );
      return;
    }
    await updateProject(project.id, (p) => {
      p.teamMembers = p.teamMembers.filter((m) => m.id !== memberId);
      p.agentAssignments = p.agentAssignments.map((a) => ({
        ...a,
        memberIds: a.memberIds.filter((id) => id !== memberId),
      }));
      if (p.activeAdminId === memberId) p.activeAdminId = undefined;
    });
    if (adminSessionId === memberId) setAdminSessionId('');
  }

  async function toggleAdmin(memberId: string) {
    if (!isAdmin) return;
    setRemoveError(null);
    const target = members.find((m) => m.id === memberId);
    if (target?.isAdmin && wouldLeaveNoAdmin(memberId)) {
      setRemoveError(
        `Cannot revoke admin from ${target.name} — they are the only admin. Grant admin to another member first.`
      );
      return;
    }
    await updateProject(project.id, (p) => {
      const m = p.teamMembers.find((x) => x.id === memberId);
      if (m) m.isAdmin = !m.isAdmin;
    });
  }

  // ─── Agent assignment ─────────────────────────────────────────────────────
  async function toggleAgentMember(agentId: AgentId, memberId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      const existing = p.agentAssignments.find((a) => a.agentId === agentId);
      if (existing) {
        if (existing.memberIds.includes(memberId)) {
          existing.memberIds = existing.memberIds.filter((id) => id !== memberId);
        } else {
          existing.memberIds.push(memberId);
        }
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
        if (existing) {
          if (!existing.memberIds.includes(memberId)) existing.memberIds.push(memberId);
        } else {
          p.agentAssignments.push({ agentId, memberIds: [memberId] });
        }
      });
    });
  }

  async function clearMemberAssignments(memberId: string) {
    if (!isAdmin) return;
    await updateProject(project.id, (p) => {
      p.agentAssignments = p.agentAssignments.map((a) => ({
        ...a,
        memberIds: a.memberIds.filter((id) => id !== memberId),
      }));
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>

        <div className={styles.header}>
          <div>
            <h2>Project Settings</h2>
            <p className={styles.subtitle}>{project.name}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.adminBar}>
          <span className={styles.adminLabel}>
            {isAdmin ? '🔑 Admin session active' : 'Viewing as:'}
          </span>
          <select value={adminSessionId} onChange={(e) => selectAdminSession(e.target.value)} className={styles.adminSelect}>
            <option value="">— Select your identity —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.role}){m.isAdmin ? ' 🔑' : ''}</option>
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
              {t === 'general' ? '⚙ General' : t === 'team' ? '👥 Team Members' : t === 'assignments' ? '🔗 Agent Assignments' : '📚 Domain Knowledge'}
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
                  {generalSaved ? '✓ Saved' : 'Save Changes'}
                </button>
              )}

              {/* ── GitHub Integration ── */}
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
                      Connect a repo to push Sprint Plan and Task Breakdown items as GitHub Issues. The token is
                      stored encrypted in your browser and is only sent to GitHub via the local backend proxy —
                      it is never exposed to other sites.
                    </p>

                    <div className={styles.formGroup}>
                      <label>Personal Access Token {githubConnected ? '(leave blank to keep current token)' : '*'}</label>
                      <input
                        type="password"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        placeholder={githubConnected ? '••••••••••••••••' : 'ghp_…'}
                        disabled={!isAdmin}
                      />
                      <p className={styles.fieldHint}>
                        Needs the <code>repo</code> scope (or <code>public_repo</code> for public repos only) to create issues.
                      </p>
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

              {isAdmin && (
                <div className={styles.dangerZone}>
                  <p className={styles.sectionTitle}>Danger Zone</p>
                  {project.archived ? (
                    <>
                      <p className={styles.fieldHint}>
                        This project is archived{project.archivedBy ? ` by ${project.archivedBy}` : ''}
                        {project.archivedAt ? ` on ${new Date(project.archivedAt).toLocaleDateString()}` : ''}.
                        {project.archivedReason ? ` Reason: "${project.archivedReason}"` : ''}
                        {' '}It is hidden from the dashboard. Restore it to make it active and visible again.
                      </p>
                      <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={restoreProject} style={{ alignSelf: 'flex-start' }}>↩ Restore Project</button>
                    </>
                  ) : !showArchiveConfirm ? (
                    <>
                      <p className={styles.fieldHint}>
                        Archiving hides this project from the dashboard. It is not permanently deleted — an admin
                        can restore it later from the Archived Projects view.
                      </p>
                      <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => setShowArchiveConfirm(true)} style={{ alignSelf: 'flex-start' }}>Delete Project…</button>
                    </>
                  ) : (
                    <>
                      <div className={styles.formGroup}>
                        <label>Reason for deleting this project *</label>
                        <textarea
                          value={archiveReason}
                          onChange={(e) => setArchiveReason(e.target.value)}
                          rows={3}
                          placeholder="e.g. Project cancelled, duplicate, scope merged into another project..."
                        />
                      </div>
                      {archiveError && <p className={styles.error}>{archiveError}</p>}
                      <div className={styles.addRow}>
                        <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={archiveProject}>Confirm Delete</button>
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
              <div className={styles.addSection}>
                <p className={styles.sectionTitle}>
                  {members.length === 0
                    ? '👋 Add your first team member — they become admin automatically'
                    : isAdmin ? 'Add Team Member' : 'Team Members'}
                </p>
                <div className={styles.addForm}>
                  <div className={styles.addRow}>
                    <input placeholder="Full name *" value={newName} onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addMember()} disabled={!canAddMember} />
                    <input placeholder="Email *" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addMember()} disabled={!canAddMember} />
                  </div>
                  <div className={styles.addRow}>
                    <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className={styles.roleSelect} disabled={!canAddMember}>
                      <option value="">Select role *</option>
                      {visibleRoleTemplates.map((r) => (
                        <option key={r.id} value={r.title}>{r.title}</option>
                      ))}
                      <option value="__custom__">Custom role...</option>
                    </select>
                    {newRole === '__custom__' ? (
                      <input placeholder="Enter custom role *" value={newRoleCustom} onChange={(e) => setNewRoleCustom(e.target.value)} disabled={!canAddMember} />
                    ) : (
                      <div className={styles.rolePreview}>
                        {newRole
                          ? <span className={styles.roleHint}>✓ Agent mappings for <strong>{newRole}</strong> applied automatically</span>
                          : <span className={styles.roleHintMuted}>Role determines which agents are pre-assigned</span>}
                      </div>
                    )}
                  </div>
                  <button className="btn-primary" onClick={addMember} style={{ alignSelf: 'flex-start' }}>+ Add Member</button>
                  {addError && <p className={styles.error}>{addError}</p>}
                  {!canAddMember && members.length > 0 && (
                    <p className={styles.lockedHint}>🔒 Select an admin identity above to add or remove members.</p>
                  )}
                </div>
              </div>

              {members.length > 0 && (
                <div className={styles.memberSection}>
                  <p className={styles.sectionTitle}>Team — {members.length} member{members.length !== 1 ? 's' : ''}</p>
                  {removeError && (
                    <div className={styles.removeError}>
                      ⛔ {removeError}
                      <button className={styles.removeErrorDismiss} onClick={() => setRemoveError(null)}>✕</button>
                    </div>
                  )}
                  <div className={styles.memberGrid}>
                    {members.map((m) => {
                      const assignedAgents = assignments
                        .filter((a) => a.memberIds.includes(m.id))
                        .map((a) => ({ id: a.agentId, name: AGENT_DEFINITIONS[a.agentId]?.name ?? a.agentId }));
                      const roleTemplate = ROLE_TEMPLATES.find((r) => r.title === m.role);
                      const isCurrentSession = adminSessionId === m.id;
                      const hasUnmapped = assignedAgents.length === 0;
                      const isLastAdmin = m.isAdmin && wouldLeaveNoAdmin(m.id);
                      return (
                        <div key={m.id} className={`${styles.memberCard} ${isCurrentSession ? styles.memberCardActive : ''} ${hasUnmapped ? styles.memberCardWarning : ''}`}>
                          <div className={styles.memberCardTop}>
                            <div className={styles.avatar} style={{ background: m.avatarColor }}>{initials(m.name)}</div>
                            <div className={styles.memberInfo}>
                              <div className={styles.memberNameRow}>
                                <span className={styles.memberName}>{m.name}</span>
                                {m.isAdmin && <span className={styles.adminBadge}>Admin</span>}
                                {isCurrentSession && <span className={styles.youBadge}>You</span>}
                              </div>
                              <span className={styles.memberEmail}>{m.email}</span>
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
                            {isAdmin && (
                              <div className={styles.memberActions}>
                                <button
                                  className={styles.actionBtn}
                                  onClick={() => toggleAdmin(m.id)}
                                  title={isLastAdmin ? 'Cannot revoke — only admin' : m.isAdmin ? 'Revoke admin' : 'Grant admin'}
                                  disabled={isLastAdmin && m.isAdmin}
                                >
                                  {m.isAdmin ? '🔑 Admin' : '○ Make admin'}
                                </button>
                                <button
                                  className={`${styles.actionBtn} ${styles.removeBtn}`}
                                  onClick={() => removeMember(m.id)}
                                  title={isLastAdmin ? 'Cannot remove — only admin' : 'Remove member'}
                                  disabled={isLastAdmin}
                                >
                                  Remove
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

              <details className={styles.roleReference}>
                <summary className={styles.roleReferenceSummary}>📋 Suggested roles &amp; agent mappings reference</summary>
                {isAdmin && (
                  <p className={styles.fieldHint}>
                    Toggle a role off to hide it from the "Select role" and "Apply template" pickers for this project.
                    Existing team members keep their assigned role either way.
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
                            <button
                              className={styles.actionBtn}
                              onClick={() => toggleRoleEnabled(r.id)}
                              title={disabled ? 'Show this role in pickers' : 'Hide this role from pickers'}
                            >
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
                  <span
                    className={styles.domainChipSmall}
                    style={{ color: DOMAINS[project.domain].color, background: DOMAINS[project.domain].bgColor }}
                  >
                    {DOMAINS[project.domain].label}
                  </span>
                </label>
                <p className={styles.knowledgeHint}>
                  This content is prepended to every agent's system prompt as domain context. Edit it to reflect your project's specific regulatory environment, architecture patterns, and integration landscape.
                  Add some notes below and click "Get Domain Knowledge" to have AI expand them into a detailed, project-specific brief — it will list any assumptions and open questions at the top so you can review and refine before saving. This replaces the text below.
                </p>
                <textarea
                  className={styles.knowledgeTextarea}
                  value={domainKnowledge}
                  onChange={(e) => { setDomainKnowledge(e.target.value); setKnowledgeSaved(false); }}
                  rows={14}
                  disabled={!isAdmin}
                  placeholder="Describe domain context, regulatory requirements, architecture patterns..."
                />
                {knowledgeSaved && (
                  <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>✓ Domain knowledge saved and will be used in future agent runs.</p>
                )}
                {knowledgeError && (
                  <p style={{ fontSize: 12, color: 'var(--error, #dc2626)', marginTop: 6 }}>{knowledgeError}</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn-primary"
                  disabled={!isAdmin}
                  onClick={async () => {
                    await updateProject(project.id, (p) => { p.domainKnowledge = domainKnowledge.trim() || undefined; });
                    setKnowledgeSaved(true);
                  }}
                >
                  Save Domain Knowledge
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={!isAdmin || knowledgeLoading}
                  onClick={async () => {
                    setKnowledgeLoading(true);
                    setKnowledgeError(null);
                    setKnowledgeSaved(false);
                    try {
                      const generated = await api.generateDomainKnowledge({
                        domainLabel: DOMAINS[project.domain].label,
                        domainTemplate: DOMAIN_KNOWLEDGE_TEMPLATES[project.domain],
                        projectName: project.name,
                        projectDescription: project.description,
                        currentInput: domainKnowledge,
                      });
                      if (generated) setDomainKnowledge(generated);
                      else setKnowledgeError('No content returned. Try again.');
                    } catch (err) {
                      setKnowledgeError(err instanceof Error ? err.message : 'Failed to generate domain knowledge.');
                    } finally {
                      setKnowledgeLoading(false);
                    }
                  }}
                >
                  {knowledgeLoading ? '🔍 Researching...' : '🔍 Get Domain Knowledge'}
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    const template = DOMAIN_KNOWLEDGE_TEMPLATES[project.domain] ?? '';
                    setDomainKnowledge(template);
                    setKnowledgeSaved(false);
                  }}
                >
                  ↺ Reset to template
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    const blob = new Blob([domainKnowledge], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `domain-knowledge-${project.domain}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  ↓ Download .md
                </button>
              </div>
              {!isAdmin && (
                <p className={styles.adminHint}>Select an admin identity to edit domain knowledge.</p>
              )}

              <div className={styles.formGroup} style={{ marginTop: 24 }}>
                <label>Branding Guidelines</label>
                <p className={styles.knowledgeHint}>
                  Brand colors, typography, tone of voice, and logo/style references. Used by the UX Mockups agent
                  (Phase 3 — Design) to tailor its 2 design concepts. Leave blank to fall back to domain/industry
                  standards.
                </p>
                <p className={styles.knowledgeHint}>
                  To replicate an existing site's look and feel, enter its URL below and click "Get Branding
                  Guidelines" — the app will fetch that page and extract real colors, fonts, and styling it can find,
                  then write up a brief from those. Sites that load their styling via JavaScript may yield limited
                  results; the brief will say so explicitly rather than guess. Leave the URL blank to instead expand
                  the notes typed in the text box below into a structured brief.
                </p>
                <input
                  type="text"
                  className={styles.knowledgeTextarea}
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
  );
}
