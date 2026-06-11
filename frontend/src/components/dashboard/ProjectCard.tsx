import { DOMAINS } from '@/agents/domains';
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
  onDelete: () => void;
  /** If provided, the card is in "archived" view: shows archive details and a Restore button instead of delete. */
  onRestore?: () => void;
}

export default function ProjectCard({ project, onOpen, onDelete, onRestore }: Props) {
  const domain = DOMAINS[project.domain];
  const progress = project.totalAgents > 0
    ? Math.round((project.completedAgents / project.totalAgents) * 100)
    : 0;
  const statusColor = STATUS_COLORS[project.status] ?? '#64748b';

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
      onDelete();
    }
  }

  function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
    onRestore?.();
  }

  return (
    <div className={styles.card} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={styles.domainBadge} style={{ background: domain.bgColor, color: domain.color }}>
        {domain.label}
      </div>

      <h3 className={styles.name}>{project.name}</h3>

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

      {onRestore && project.archivedReason && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', fontStyle: 'italic' }}>
          {project.archivedBy ? `${project.archivedBy}: ` : ''}"{project.archivedReason}"
        </p>
      )}

      <div className={styles.footer}>
        <span className={styles.date}>
          {onRestore && project.archivedAt
            ? `Archived ${new Date(project.archivedAt).toLocaleDateString()}`
            : new Date(project.updatedAt).toLocaleDateString()}
        </span>
        {onRestore ? (
          <button className="btn-secondary" onClick={handleRestore} aria-label="Restore project" style={{ padding: '4px 10px', fontSize: 12 }}>
            ↩ Restore
          </button>
        ) : (
          <button className={styles.deleteBtn} onClick={handleDelete} aria-label="Delete project">✕</button>
        )}
      </div>
    </div>
  );
}
