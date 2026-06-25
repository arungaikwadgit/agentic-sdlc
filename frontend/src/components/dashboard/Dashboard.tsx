/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  listVisibleProjects,
  deleteProject,
  restoreProject,
  exportAllProjects,
  importProjects,
} from '@/db/projectRepository';
import { getCurrentUser, clearCurrentUser } from '@/services/userIdentity';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import NewProjectModal from './NewProjectModal';
import CreateProjectPage from '../createProject/CreateProjectPage';
import ProjectCard from './ProjectCard';
import AppSettingsModal from '../settings/AppSettingsModal';
import ProjectDetailsModal from './ProjectDetailsModal';
import EditProjectModal from './EditProjectModal';
import ConfirmDialog from '../common/ConfirmDialog';
import styles from './Dashboard.module.css';

interface Props {
  onOpenProject: (id: string) => void;
}

export default function Dashboard({ onOpenProject }: Props) {
  const { toast } = useToast();
  const { user, signOut } = useAuth();

  async function handleSignOut() {
    try {
      await signOut();
    } catch {
      toast('Sign out failed. Please try again.', 'error');
    }
  }
  const [showNew, setShowNew] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmSwitchUser, setConfirmSwitchUser] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setUserEmail(u?.email ?? null)).catch(() => {});
  }, []);

  // useLiveQuery returns undefined while the DB query is initialising
  const allProjects = useLiveQuery(() => listVisibleProjects(), []);
  const isLoading = allProjects === undefined;
  const safeProjects = allProjects ?? [];
  const archivedCount = safeProjects.filter((p) => p.archived).length;
  const projects = safeProjects.filter((p) => (showArchived ? !!p.archived : !p.archived));

  async function handleExport() {
    try {
      const json = await exportAllProjects();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sdlc-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Projects exported successfully', 'success');
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error');
    }
  }

  async function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const count = await importProjects(text);
        toast(`Imported ${count} project(s)`, 'success');
      } catch (e) {
        toast(`Import failed: ${String(e)}`, 'error');
      }
    };
    input.click();
  }

  async function handleSwitchUserConfirmed() {
    setConfirmSwitchUser(false);
    await clearCurrentUser();
    setUserEmail(null);
    toast('Switched to owner mode', 'info');
  }

  async function handleDeleteConfirmed(id: string) {
    setConfirmDelete(null);
    try {
      await deleteProject(id);
      toast('Project deleted', 'success');
    } catch (e) {
      toast(`Delete failed: ${String(e)}`, 'error');
    }
  }

  async function handleRestore(id: string) {
    try {
      await restoreProject(id);
      toast('Project restored', 'success');
    } catch (e) {
      toast(`Restore failed: ${String(e)}`, 'error');
    }
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>&#9881;</span>
          <h1>Agentic SDLC</h1>
        </div>
        <div className={styles.actions}>
          {userEmail && (
            <span
              className={styles.userBadge}
              title={`Viewing as ${userEmail} — click to switch`}
              onClick={() => setConfirmSwitchUser(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setConfirmSwitchUser(true)}
            >
              &#128100; {userEmail}
            </span>
          )}
          {archivedCount > 0 && (
            <button className="btn-secondary" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Active Projects' : `Archived (${archivedCount})`}
            </button>
          )}
          <button className="btn-secondary" onClick={handleImport}>Import</button>
          <button className="btn-secondary" onClick={handleExport}>Export</button>
          <button className="btn-secondary" onClick={() => setShowNew(true)}>+ Simple</button>
          <button className="btn-primary" onClick={() => setShowWizard(true)}>+ New Project</button>
          <button
            className={styles.gearBtn}
            onClick={() => setShowSettings(true)}
            title="App Settings"
            aria-label="App Settings"
          >
            &#9881;
          </button>
          {user && (
            <button
              className="btn-secondary"
              onClick={handleSignOut}
              title={`Signed in as ${user.email}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              &#128275; Sign out
            </button>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {isLoading ? (
          <LoadingSkeleton />
        ) : showArchived && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
            <p>No archived projects.</p>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onNew={() => setShowWizard(true)} />
        ) : (
          <div className={styles.grid}>
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => onOpenProject(p.id)}
                onDelete={() => setConfirmDelete(p.id)}
                onDetails={() => setDetailsProjectId(p.id)}
                onEdit={() => setEditProjectId(p.id)}
                onRestore={showArchived ? () => handleRestore(p.id) : undefined}
              />
            ))}
          </div>
        )}
      </main>

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); onOpenProject(id); }}
        />
      )}

      {showWizard && (
        <CreateProjectPage
          onClose={() => setShowWizard(false)}
          onCreated={(id) => { setShowWizard(false); onOpenProject(id); }}
        />
      )}

      {showSettings && (
        <AppSettingsModal onClose={() => setShowSettings(false)} />
      )}

      {detailsProjectId && (
        <ProjectDetailsModal
          projectId={detailsProjectId}
          onClose={() => setDetailsProjectId(null)}
        />
      )}

      {editProjectId && (
        <EditProjectModal
          projectId={editProjectId}
          onClose={() => setEditProjectId(null)}
          onRestartAndOpen={() => { const id = editProjectId; setEditProjectId(null); onOpenProject(id); }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete project?"
          message="This project will be archived and can be restored later. Are you sure you want to delete it?"
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDeleteConfirmed(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmSwitchUser && (
        <ConfirmDialog
          title="Switch to owner mode?"
          message="This will clear your local identity. You will see all projects on this device."
          confirmLabel="Switch"
          onConfirm={handleSwitchUserConfirmed}
          onCancel={() => setConfirmSwitchUser(false)}
        />
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 160,
              borderRadius: 10,
              background: 'var(--surface2, rgba(255,255,255,0.04))',
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              animation: 'pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>&#128640;</div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>No projects yet</h2>
      <p style={{ marginBottom: 24 }}>Create your first project to generate SDLC documentation with AI agents.</p>
      <button className="btn-primary" onClick={onNew} style={{ fontSize: 15, padding: '10px 24px' }}>
        + New Project
      </button>
    </div>
  );
}
