/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { getDomain } from '@/agents/domains';
import type { ProjectSummary } from '@/types/project.types';
import styles from './ProjectCard.module.css';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  complete: 'Complete',
  error: 'Error',
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#64748b',
  running: '#6366f1',
  paused: '#f59e0b',
  complete: '#22c55e',
  error: '#ef4444',
};

interface Props {
  project: ProjectSummary;
  onOpen: () => void;
  /** Only passed when the current user is an app admin — see Dashboard.tsx. */
  onDelete?: () => void;
  onDetails: () => void;
  onEdit?: () => void;
  /** Only passed when the current user is an app admin and the project is archived. */
  onRestore?: () => void;
}

export default function ProjectCard({ project, onOpen, onDelete, onDetails, onEdit, onRestore }: Props) {
  const domain = getDomain(project.domain);
  const progress = project.totalAgents > 0
    ? Math.round((project.completedAgents / project.totalAgents) * 100)
    : 0;
  const statusColor = STATUS_COLORS[project.status] ?? '#64748b';

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    // Confirmation + required remarks are handled by the caller (Dashboard's
    // ConfirmDialog) before onDelete is ever invoked — no confirm() here.
    onDelete?.();
  }

  function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
    onRestore?.();
  }

  function handleDetails(e: React.MouseEvent) {
    e.stopPropagation();
    onDetails();
  }

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit?.();
  }

  return (
    <div className={styles.card} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={styles.domainBadge} style={{ background: domain.bgColor, color: domain.color }}>
        {domain.label}
      </div>

      <h3 className={styles.name}>{project.name}</h3>

      {project.creatorName && (
        <div className={styles.creator}>
          <span>Created by</span>
          <strong>{project.creatorName}</strong>
          {project.creatorRole && <span className={styles.creatorRole}>{project.creatorRole}</span>}
        </div>
      )}

      <div className={styles.status}>
        <span className={styles.dot} style={{ background: statusColor }} />
        <span style={{ color: statusColor }}>{STATUS_LABELS[project.status] ?? project.status}</span>
      </div>

      <div className={styles.progress}>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.progressLabel}>{project.completedAgents}/{project.totalAgents} agents</span>
      </div>

      {project.archived && project.archivedReason && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', fontStyle: 'italic' }}>
          {project.archivedBy ? `${project.archivedBy}: ` : ''}"{project.archivedReason}"
        </p>
      )}

      <div className={styles.footer}>
        <span className={styles.date}>
          {project.archived && project.archivedAt
            ? `Deleted ${new Date(project.archivedAt).toLocaleDateString()}`
            : new Date(project.updatedAt).toLocaleDateString()}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={styles.infoBtn} onClick={handleDetails} aria-label="View project details" title="Project details">ℹ</button>
          {onEdit && !project.archived && (
            <button className={styles.infoBtn} onClick={handleEdit} aria-label="Edit project" title="Edit project">✏</button>
          )}
          {project.archived ? (
            onRestore && (
              <button className="btn-secondary" onClick={handleRestore} aria-label="Restore project" style={{ padding: '4px 10px', fontSize: 12 }}>
                ↩ Restore
              </button>
            )
          ) : (
            onDelete && (
              <button className={styles.deleteBtn} onClick={handleDelete} aria-label="Delete project">✕</button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
