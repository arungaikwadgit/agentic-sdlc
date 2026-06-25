/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * B14 — Pipeline Resume on App Load.
 * On mount, checks for any project with status='running' and offers to resume.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { updateProject } from '@/db/projectRepository';
import type { ProjectSummary } from '@/types/project.types';

interface Props {
  onResume: (projectId: string) => void;
}

export default function ResumeModal({ onResume }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const runningProjects = useLiveQuery(
    () => db.projects
      .where('status')
      .equals('running')
      .toArray()
      .then((ps) => ps.map((p): ProjectSummary => ({
        id: p.id,
        name: p.name,
        domain: p.domain,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        completedAgents: Object.values(p.agentRuns).filter((r) => r?.status === 'complete').length,
        totalAgents: 22,
      }))),
    []
  ) ?? [];

  // On load, mark any 'running' project as 'paused' (it can't actually be running)
  useEffect(() => {
    runningProjects.forEach((p) => {
      updateProject(p.id, (proj) => { proj.status = 'paused'; });
    });
  }, [runningProjects.length]);

  if (dismissed || runningProjects.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 300,
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 10, padding: 18, maxWidth: 320,
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        🔄 Interrupted pipeline detected
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {runningProjects.length === 1
          ? `"${runningProjects[0].name}" was running when the app closed.`
          : `${runningProjects.length} pipelines were interrupted.`}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setDismissed(true)}>
          Dismiss
        </button>
        <button
          className="btn-primary"
          style={{ fontSize: 12 }}
          onClick={() => { onResume(runningProjects[0].id); setDismissed(true); }}
        >
          Resume →
        </button>
      </div>
    </div>
  );
}
