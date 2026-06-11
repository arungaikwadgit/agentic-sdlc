import { useState } from 'react';
import { updateProject } from '@/db/projectRepository';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import type { Project, TeamMember, AgentAssignment } from '@/types/project.types';
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

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

export default function TeamPanel({ project, onClose }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [addError, setAddError] = useState('');

  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];

  function getMemberForAgent(agentId: AgentId): TeamMember | undefined {
    const a = assignments.find((x) => x.agentId === agentId);
    const firstId = a?.memberIds?.[0];
    return firstId ? members.find((m) => m.id === firstId) : undefined;
  }

  async function addMember() {
    if (!name.trim()) { setAddError('Name is required'); return; }
    if (!email.trim() || !email.includes('@')) { setAddError('Valid email is required'); return; }
    setAddError('');
    const newMember: TeamMember = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.trim(),
      role: role.trim() || 'Team Member',
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
      isAdmin: members.length === 0,
    };
    await updateProject(project.id, (p) => {
      p.teamMembers = [...(p.teamMembers ?? []), newMember];
    });
    setName(''); setEmail(''); setRole('');
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
        existing.memberIds = [memberId]; // TeamPanel uses single-select mode
      } else {
        p.agentAssignments.push({ agentId, memberIds: [memberId] });
      }
    });
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2>Team &amp; Agent Assignments</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Add member form */}
        <section className={styles.section}>
          <h3>Add Team Member</h3>
          <div className={styles.addForm}>
            <input
              placeholder="Full name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
            <input
              placeholder="Email *"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
            <input
              placeholder="Role (e.g. Product Manager)"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
            <button className="btn-primary" onClick={addMember}>Add</button>
          </div>
          {addError && <p className={styles.error}>{addError}</p>}
        </section>

        {/* Member list */}
        {members.length > 0 && (
          <section className={styles.section}>
            <h3>Team Members</h3>
            <ul className={styles.memberList}>
              {members.map((m) => (
                <li key={m.id} className={styles.memberRow}>
                  <div
                    className={styles.avatar}
                    style={{ background: m.avatarColor }}
                  >
                    {initials(m.name)}
                  </div>
                  <div className={styles.memberInfo}>
                    <span className={styles.memberName}>{m.name}</span>
                    <span className={styles.memberMeta}>{m.role} · {m.email}</span>
                  </div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeMember(m.id)}
                    title="Remove member"
                  >✕</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Agent assignment table */}
        <section className={styles.section}>
          <h3>Assign Agents to Team Members</h3>
          {members.length === 0 ? (
            <p className={styles.hint}>Add team members above to enable assignments.</p>
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
                            <span
                              className={styles.avatarSmall}
                              style={{ background: assigned.avatarColor }}
                              title={assigned.name}
                            >
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
                          <option value="">— Unassigned —</option>
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
      </div>
    </div>
  );
}
