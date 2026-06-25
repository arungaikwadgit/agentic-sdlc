/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useCallback } from 'react';
import { updateProject } from '@/db/projectRepository';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import type { Project, TeamMember, AgentAssignment, AppRole } from '@/types/project.types';
import { ROLE_PERMISSIONS } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import styles from './TeamPanel.module.css';

interface Props {
  project: Project;
  onClose: () => void;
}

const AVATAR_COLORS = [
  '#4f46e5', '#0891b2', '#059669', '#d97706',
  '#dc2626', '#7c3aed', '#db2777', '#0d9488',
];

const ROLES: AppRole[] = ['project_owner', 'editor', 'reviewer', 'viewer'];

function initials(name: string) {
  return name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

function RoleBadge({ role }: { role: AppRole }) {
  const colors: Record<AppRole, string> = {
    project_owner: '#4f46e5',
    editor: '#0891b2',
    reviewer: '#d97706',
    viewer: '#6b7280',
  };
  return (
    <span className={styles.roleBadge} style={{ background: colors[role] + '22', color: colors[role] }}>
      {ROLE_PERMISSIONS[role].label}
    </span>
  );
}

function StatusBadge({ status }: { status: TeamMember['inviteStatus'] }) {
  const map = { pending: { label: 'Pending', color: '#d97706' }, accepted: { label: 'Accepted', color: '#059669' }, revoked: { label: 'Revoked', color: '#6b7280' } };
  const { label, color } = map[status] ?? map.pending;
  return <span className={styles.statusBadge} style={{ background: color + '22', color }}>{label}</span>;
}

export default function TeamPanel({ project, onClose }: Props) {
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [jobRole, setJobRole]     = useState('');
  const [appRole, setAppRole]     = useState<AppRole>('viewer');
  const [addError, setAddError]   = useState('');
  const [sending, setSending]     = useState<string | null>(null); // member id being actioned
  const [inviteLink, setInviteLink] = useState<{ memberId: string; link: string; emailSent?: boolean } | null>(null);
  const [tab, setTab]             = useState<'members' | 'assign'>('members');

  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];

  function getMemberForAgent(agentId: AgentId): TeamMember | undefined {
    const a = assignments.find((x) => x.agentId === agentId);
    const firstId = a?.memberIds?.[0];
    return firstId ? members.find((m) => m.id === firstId) : undefined;
  }

  const sendInvite = useCallback(async (member: TeamMember) => {
    setSending(member.id);
    setInviteLink(null);
    try {
      const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      const res = await fetch(`${API}/invite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          projectId: project.id,
          projectName: project.name,
          name: member.name,
          email: member.email,
          appRole: member.appRole,
          invitedBy: members.find((m) => m.isAdmin)?.name ?? 'Project Owner',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // Always surface the invite link so admin can copy it regardless of email status
        setInviteLink({ memberId: member.id, link: data.inviteLink, emailSent: !data.dev });
        // Update member invite token in local project
        await updateProject(project.id, (p) => {
          const m = p.teamMembers.find((x) => x.id === member.id);
          if (m) {
            m.inviteToken = data.token;
            m.invitedAt = Date.now();
            m.inviteStatus = 'pending';
          }
        });
      } else {
        alert('Invite failed: ' + (data.error ?? 'Unknown error'));
      }
    } catch (e) {
      alert('Invite failed: ' + String(e));
    } finally {
      setSending(null);
    }
  }, [project.id, project.name, members]);

  const revokeInvite = useCallback(async (member: TeamMember) => {
    if (!member.inviteToken) return;
    setSending(member.id);
    try {
      const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
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
      setSending(null);
    }
  }, [project.id]);

  async function addMember() {
    if (!name.trim()) { setAddError('Name is required'); return; }
    if (!email.trim() || !email.includes('@')) { setAddError('Valid email is required'); return; }
    setAddError('');

    const newMember: TeamMember = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: jobRole.trim() || 'Team Member',
      appRole,
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
      isAdmin: members.length === 0,
      inviteStatus: 'pending',
      invitedAt: Date.now(),
    };

    await updateProject(project.id, (p) => {
      p.teamMembers = [...(p.teamMembers ?? []), newMember];
    });

    setName(''); setEmail(''); setJobRole(''); setAppRole('viewer');

    // Auto-send invite
    await sendInvite(newMember);
  }

  async function changeRole(memberId: string, newRole: AppRole) {
    await updateProject(project.id, (p) => {
      const m = p.teamMembers.find((x) => x.id === memberId);
      if (m) m.appRole = newRole;
    });
  }

  async function removeMember(memberId: string) {
    await updateProject(project.id, (p) => {
      p.teamMembers = p.teamMembers.filter((m) => m.id !== memberId);
      p.agentAssignments = p.agentAssignments.map((a) => ({
        ...a,
        memberIds: (a.memberIds ?? []).filter((id) => id !== memberId),
      }));
    });
  }

  async function assignAgent(agentId: AgentId, memberId: string) {
    await updateProject(project.id, (p) => {
      const existing = p.agentAssignments.find((a) => a.agentId === agentId);
      if (memberId === '') {
        p.agentAssignments = p.agentAssignments.filter((a) => a.agentId !== agentId);
      } else if (existing) {
        existing.memberIds = [memberId];
      } else {
        p.agentAssignments.push({ agentId, memberIds: [memberId] });
      }
    });
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <h2>Team &amp; Invites</h2>
          <button className={styles.closeBtn} onClick={onClose}>&#x2715;</button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`} onClick={() => setTab('members')}>
            Team Members {members.length > 0 && <span className={styles.tabCount}>{members.length}</span>}
          </button>
          <button className={`${styles.tab} ${tab === 'assign' ? styles.tabActive : ''}`} onClick={() => setTab('assign')}>
            Agent Assignments
          </button>
        </div>

        {tab === 'members' && (
          <>
            {/* Invite link banner (dev mode) */}
            {inviteLink && (
              <div className={styles.inviteLinkBanner}>
                {inviteLink.emailSent
                  ? <p>✅ <strong>Invite email sent.</strong> You can also copy the link to share directly:</p>
                  : <p>⚠ <strong>Email not configured</strong> — copy this link and share it manually:</p>
                }
                <div className={styles.linkRow}>
                  <input readOnly value={inviteLink.link} className={styles.linkInput} />
                  <button className={styles.copyBtn} onClick={() => { navigator.clipboard.writeText(inviteLink.link); }}>Copy</button>
                </div>
                <button className={styles.dismissLink} onClick={() => setInviteLink(null)}>Dismiss</button>
              </div>
            )}

            {/* Add + invite form */}
            <section className={styles.section}>
              <h3>Invite a Team Member</h3>
              <div className={styles.addForm}>
                <div className={styles.formRow}>
                  <input placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
                  <input placeholder="Email address *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
                </div>
                <div className={styles.formRow}>
                  <input placeholder="Job title (e.g. Product Manager)" value={jobRole} onChange={(e) => setJobRole(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
                  <select value={appRole} onChange={(e) => setAppRole(e.target.value as AppRole)} className={styles.roleSelect}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>
                    ))}
                  </select>
                </div>
                {appRole && (
                  <p className={styles.roleHint}>{ROLE_PERMISSIONS[appRole].description}</p>
                )}
                {addError && <p className={styles.error}>{addError}</p>}
                <button className="btn-primary" onClick={addMember}>
                  Send Invite
                </button>
              </div>
            </section>

            {/* Role permissions legend */}
            <section className={styles.section}>
              <h3>Role Permissions</h3>
              <div className={styles.permTable}>
                <div className={styles.permHeader}>
                  <span>Permission</span>
                  {ROLES.map((r) => <span key={r}>{ROLE_PERMISSIONS[r].label}</span>)}
                </div>
                {[
                  ['Run Agents', 'canRunAgents'],
                  ['Edit Settings', 'canEditSettings'],
                  ['Invite Members', 'canInvite'],
                  ['Remove Members', 'canRemoveMembers'],
                  ['Approve Gates', 'canCommentApprove'],
                  ['View Outputs', 'canViewOutputs'],
                ].map(([label, key]) => (
                  <div key={key} className={styles.permRow}>
                    <span>{label}</span>
                    {ROLES.map((r) => (
                      <span key={r}>{ROLE_PERMISSIONS[r][key as keyof typeof ROLE_PERMISSIONS[typeof r]] ? '&#x2713;' : '&#x2013;'}</span>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            {/* Member list */}
            {members.length > 0 && (
              <section className={styles.section}>
                <h3>Team Members ({members.length})</h3>
                <ul className={styles.memberList}>
                  {members.map((m) => (
                    <li key={m.id} className={styles.memberRow}>
                      <div className={styles.avatar} style={{ background: m.avatarColor }}>
                        {initials(m.name)}
                      </div>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberNameRow}>
                          <span className={styles.memberName}>{m.name}</span>
                          <RoleBadge role={m.appRole ?? 'viewer'} />
                          <StatusBadge status={m.inviteStatus ?? 'pending'} />
                        </div>
                        <span className={styles.memberMeta}>{m.role} &middot; {m.email}</span>
                        {m.invitedAt && (
                          <span className={styles.memberMeta}>
                            Invited {new Date(m.invitedAt).toLocaleDateString()}
                            {m.acceptedAt && ` · Accepted ${new Date(m.acceptedAt).toLocaleDateString()}`}
                          </span>
                        )}
                      </div>
                      <div className={styles.memberActions}>
                        <select
                          value={m.appRole ?? 'viewer'}
                          onChange={(e) => changeRole(m.id, e.target.value as AppRole)}
                          className={styles.roleSelectSmall}
                          disabled={m.isAdmin}
                          title={m.isAdmin ? 'Project creator cannot be changed' : 'Change role'}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>)}
                        </select>
                        {m.inviteStatus !== 'accepted' && (
                          <button
                            className={styles.actionBtn}
                            onClick={() => sendInvite(m)}
                            disabled={sending === m.id}
                            title={m.inviteStatus === 'revoked' ? 'Resend invite' : 'Resend invite'}
                          >
                            {sending === m.id ? '...' : 'Resend'}
                          </button>
                        )}
                        {m.inviteToken && m.inviteStatus === 'pending' && (
                          <button
                            className={`${styles.actionBtn} ${styles.revokeBtn}`}
                            onClick={() => revokeInvite(m)}
                            disabled={sending === m.id}
                            title="Revoke invite"
                          >
                            Revoke
                          </button>
                        )}
                        {!m.isAdmin && (
                          <button
                            className={styles.removeBtn}
                            onClick={() => removeMember(m.id)}
                            title="Remove from project"
                          >&#x2715;</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === 'assign' && (
          <section className={styles.section}>
            <h3>Assign Agents to Team Members</h3>
            {members.length === 0 ? (
              <p className={styles.hint}>Add team members on the Team Members tab first.</p>
            ) : (
              <div className={styles.assignTable}>
                {PHASE_ORDER.map((phase) => (
                  <div key={phase} className={styles.phaseBlock}>
                    <div className={styles.phaseHeader}>{PHASE_LABELS[phase]}</div>
                    {PHASE_AGENTS[phase].map((agentId) => {
                      const def = AGENT_DEFINITIONS[agentId];
                      const assigned = getMemberForAgent(agentId);
                      return (
                        <div key={agentId} className={styles.assignRow}>
                          <div className={styles.agentLabel}>
                            {assigned && (
                              <span className={styles.avatarSmall} style={{ background: assigned.avatarColor }} title={assigned.name}>
                                {initials(assigned.name)}
                              </span>
                            )}
                            <span>{def?.name ?? agentId}</span>
                          </div>
                          <select
                            value={assigned?.id ?? ''}
                            onChange={(e) => assignAgent(agentId, e.target.value)}
                            className={styles.assignSelect}
                          >
                            <option value="">&#x2014; Unassigned &#x2014;</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
