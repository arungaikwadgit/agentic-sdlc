/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * ProjectDetailsModal
 * Shows the full project details the user entered during project creation.
 */
import { useEffect, useState } from 'react';
import { getProject } from '@/db/projectRepository';
import type { Project } from '@/types/project.types';
import styles from './ProjectDetailsModal.module.css';

interface Props {
  projectId: string;
  onClose: () => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  low: '🟢 Low',
  medium: '🟡 Medium',
  high: '🟠 High',
  critical: '🔴 Critical',
};

const TYPE_LABELS: Record<string, string> = {
  'web-app': 'Web Application',
  'mobile-app': 'Mobile App',
  'api-backend': 'API / Backend',
  'internal-tool': 'Internal Tool',
  'data-ml': 'Data / ML',
  other: 'Other',
};

function Row({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  );
}

export default function ProjectDetailsModal({ projectId, onClose }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProject(projectId)
      .then((p) => setProject(p ?? null))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Project Details</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {loading && <p className={styles.loading}>Loading…</p>}
          {!loading && !project && <p className={styles.loading}>Project not found.</p>}
          {project && (
            <>
              <div className={styles.nameRow}>
                <span className={styles.projectName}>{project.name}</span>
                {project.status && (
                  <span className={`${styles.statusBadge} ${styles['status_' + project.status]}`}>
                    {project.status}
                  </span>
                )}
              </div>

              {project.description && (
                <p className={styles.description}>{project.description}</p>
              )}

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Overview</div>
                <Row label="Project Type" value={project.projectType ? TYPE_LABELS[project.projectType] ?? project.projectType : undefined} />
                <Row label="Priority" value={project.priority ? PRIORITY_LABELS[project.priority] ?? project.priority : undefined} />
                <Row label="Domain" value={project.domain} />
                <Row label="Owner" value={project.owner} />
                <Row label="Team" value={project.team} />
              </div>

              {(project.startDate || project.targetEndDate) && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Timeline</div>
                  <Row label="Start Date" value={project.startDate} />
                  <Row label="Target End Date" value={project.targetEndDate} />
                </div>
              )}

              {(project.techStack || project.targetUsers || project.initialRisks) && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Technical</div>
                  <Row label="Tech Stack" value={project.techStack} />
                  <Row label="Target Users" value={project.targetUsers} />
                  <Row label="Initial Risks" value={project.initialRisks} />
                </div>
              )}

              {project.domainKnowledge && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Domain Knowledge</div>
                  <pre className={styles.pre}>{project.domainKnowledge}</pre>
                </div>
              )}

              {Array.isArray(project.teamMembers) && project.teamMembers.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Team Members ({project.teamMembers.length})</div>
                  <div className={styles.teamList}>
                    {project.teamMembers.map((m) => (
                      <div key={m.id} className={styles.teamRow}>
                        <span
                          className={styles.avatar}
                          style={{ background: m.avatarColor }}
                        >
                          {m.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                        <div className={styles.teamInfo}>
                          <span className={styles.teamName}>{m.name}</span>
                          <span className={styles.teamRole}>{m.role} · {m.appRole?.replace(/_/g, ' ')}</span>
                          <span className={styles.teamEmail}>{m.email}</span>
                        </div>
                        <span className={`${styles.inviteBadge} ${styles['invite_' + m.inviteStatus]}`}>
                          {m.inviteStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Metadata</div>
                <Row label="Created" value={new Date(project.createdAt).toLocaleString()} />
                <Row label="Last Updated" value={new Date(project.updatedAt).toLocaleString()} />
                <Row label="Mode" value={project.mode} />
                {project.ownerId && <Row label="Owner ID" value={project.ownerId} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
