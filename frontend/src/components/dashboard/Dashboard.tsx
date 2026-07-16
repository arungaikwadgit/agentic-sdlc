/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useEffect } from 'react';
import {
  listVisibleProjects,
  deleteProject,
  restoreProject,
  checkIsAppAdmin,
  subscribeProjectRepositoryChange,
} from '@/db/projectRepository';
import type { ProjectSummary } from '@/types/project.types';
import { getInviteSession, clearInviteSession } from '@/services/inviteSession';
import { importLegacyProjectsIfNeeded } from '@/services/legacyProjectImport';
import {
  getDashboardViewPreference,
  setDashboardViewPreference,
  type DashboardView,
} from '@/services/userPreferencesApi';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import NewProjectModal from './NewProjectModal';
import CreateProjectPage from '../createProject/CreateProjectPage';
import ProjectCard from './ProjectCard';
import AppSettingsModal from '../settings/AppSettingsModal';
import ProjectDetailsModal from './ProjectDetailsModal';
import EditProjectModal from './EditProjectModal';
import ConfirmDialog from '../common/ConfirmDialog';
import AppLogo from '../common/AppLogo';
import styles from './Dashboard.module.css';

interface Props {
  onOpenProject: (id: string) => void;
}

export default function Dashboard({ onOpenProject }: Props) {
  const { toast } = useToast();
  const { user, loading: authLoading, signOut } = useAuth();

  // Accounts created purely from an invite (see is_invited_user in
  // backend/src/proxy.js's provisionInviteeAccount) are scoped to just the
  // project(s) they're a member of -- no creating separate projects of their
  // own. GET /api/projects already only returns owned + member projects, so
  // this only needs to hide the creation entry points; server/src/routes/
  // projects.ts's POST / enforces the same restriction if bypassed.
  const isInvitedOnly = user?.user_metadata?.is_invited_user === true;

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
  const [isAppAdmin, setIsAppAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<DashboardView>('tiles');

  useEffect(() => {
    const inviteSession = getInviteSession();
    setUserEmail(user?.email ?? inviteSession?.email ?? null);
  }, [user?.email]);

  useEffect(() => {
    const inviteSession = getInviteSession();
    if (authLoading || (!user && !inviteSession)) {
      setIsAppAdmin(false);
      return;
    }
    let active = true;
    checkIsAppAdmin().then((result) => { if (active) setIsAppAdmin(result); });
    return () => { active = false; };
  }, [authLoading, user]);

  useEffect(() => {
    const inviteSession = getInviteSession();
    if (authLoading || (!user && !inviteSession)) {
      setViewMode('tiles');
      return;
    }
    let active = true;
    getDashboardViewPreference()
      .then((savedView) => { if (active) setViewMode(savedView); })
      .catch(() => { if (active) setViewMode('tiles'); });
    return () => { active = false; };
  }, [authLoading, user?.email, user?.id]);

  const [allProjects, setAllProjects] = useState<ProjectSummary[] | undefined>(undefined);

  useEffect(() => {
    const inviteSession = getInviteSession();
    if (authLoading || (!user && !inviteSession)) {
      setAllProjects(undefined);
      return;
    }

    let active = true;
    async function loadProjects() {
      try {
        let projects = await listVisibleProjects();
        if (projects.length === 0 && user) {
          const migrated = await importLegacyProjectsIfNeeded(projects.length);
          if (migrated > 0) {
            toast(`Imported ${migrated} legacy project${migrated === 1 ? '' : 's'} into Supabase.`, 'success');
            projects = await listVisibleProjects();
          }
        }
        if (active) setAllProjects(projects);
      } catch {
        if (active) setAllProjects([]);
      }
    }
    loadProjects();
    const unsubscribe = subscribeProjectRepositoryChange(() => {
      void loadProjects();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [authLoading, toast, user]);

  const isLoading = allProjects === undefined;
  const safeProjects = allProjects ?? [];
  const archivedCount = safeProjects.filter((p) => p.archived).length;
  const projects = safeProjects.filter((p) => (showArchived ? !!p.archived : !p.archived));

  async function handleSwitchUserConfirmed() {
    setConfirmSwitchUser(false);
    clearInviteSession();
    setUserEmail(user?.email ?? null);
    toast('Switched to owner mode', 'info');
  }

  async function handleDeleteConfirmed(id: string, remarks: string) {
    setConfirmDelete(null);
    try {
      await deleteProject(id, remarks);
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

  async function handleViewModeChange(nextView: DashboardView) {
    if (nextView === viewMode) return;
    const previousView = viewMode;
    setViewMode(nextView);
    try {
      await setDashboardViewPreference(nextView);
    } catch {
      setViewMode(previousView);
      toast('Could not save the dashboard view preference.', 'error');
    }
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <AppLogo className={styles.brandMark} wordmarkClassName={styles.brandText} />
        </div>
        <div className={styles.actions}>
          <div className={styles.viewToggle} role="group" aria-label="Project view">
            <button
              className={styles.viewToggleBtn + (viewMode === 'tiles' ? ' ' + styles.viewToggleActive : '')}
              aria-label="Tiles view"
              aria-pressed={viewMode === 'tiles'}
              onClick={() => void handleViewModeChange('tiles')}
            >
              Tiles
            </button>
            <button
              className={styles.viewToggleBtn + (viewMode === 'table' ? ' ' + styles.viewToggleActive : '')}
              aria-label="Table view"
              aria-pressed={viewMode === 'table'}
              onClick={() => void handleViewModeChange('table')}
            >
              Table
            </button>
          </div>
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
          {!isInvitedOnly && (
            <>
              <button className="btn-secondary" onClick={() => setShowNew(true)}>+ Simple</button>
              <button className="btn-primary" onClick={() => setShowWizard(true)}>+ New Project</button>
            </>
          )}
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
          <EmptyState onNew={() => setShowWizard(true)} canCreate={!isInvitedOnly} />
        ) : viewMode === 'table' ? (
          <ProjectTable
            projects={projects}
            isAppAdmin={isAppAdmin}
            showArchived={showArchived}
            onOpenProject={onOpenProject}
            onDetails={setDetailsProjectId}
            onEdit={setEditProjectId}
            onDelete={setConfirmDelete}
            onRestore={(id) => void handleRestore(id)}
          />
        ) : (
          <div className={styles.grid}>
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => onOpenProject(p.id)}
                onDelete={isAppAdmin ? () => setConfirmDelete(p.id) : undefined}
                onDetails={() => setDetailsProjectId(p.id)}
                onEdit={() => setEditProjectId(p.id)}
                onRestore={showArchived && isAppAdmin ? () => handleRestore(p.id) : undefined}
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
          message="This project will be soft-deleted (archived) and can be restored by an admin later. Are you sure you want to delete it?"
          confirmLabel="Delete"
          danger
          requireInput
          inputLabel="Reason for deleting this project (required)"
          inputPlaceholder="e.g. Duplicate project, client cancelled, superseded by..."
          onConfirm={(remarks) => handleDeleteConfirmed(confirmDelete, remarks ?? '')}
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


interface ProjectTableProps {
  projects: ProjectSummary[];
  isAppAdmin: boolean;
  showArchived: boolean;
  onOpenProject: (id: string) => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
}

function ProjectTable({ projects, isAppAdmin, showArchived, onOpenProject, onDetails, onEdit, onDelete, onRestore }: ProjectTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.projectTable} aria-label="Projects">
        <thead>
          <tr><th>Project</th><th>Created by</th><th>Domain</th><th>Status</th><th>Progress</th><th>Updated</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const progress = project.totalAgents > 0
              ? Math.round((project.completedAgents / project.totalAgents) * 100)
              : 0;
            return (
              <tr key={project.id}>
                <td><button className={styles.projectLink} onClick={() => onOpenProject(project.id)}>{project.name}</button></td>
                <td>
                  <strong className={styles.creatorName}>{project.creatorName ?? 'Unknown creator'}</strong>
                  {project.creatorRole && <span className={styles.creatorRole}>{project.creatorRole}</span>}
                </td>
                <td>{String(project.domain)}</td>
                <td><span className={styles.statusText}>{project.status}</span></td>
                <td>
                  <div className={styles.tableProgress} aria-label={progress + '% complete'}><span style={{ width: progress + '%' }} /></div>
                  <span className={styles.progressText}>{project.completedAgents}/{project.totalAgents} agents</span>
                </td>
                <td>{new Date(project.updatedAt).toLocaleDateString()}</td>
                <td>
                  <div className={styles.tableActions}>
                    <button className="btn-secondary" onClick={() => onDetails(project.id)}>Details</button>
                    {!project.archived && <button className="btn-secondary" onClick={() => onEdit(project.id)}>Edit</button>}
                    {showArchived && project.archived && isAppAdmin ? (
                      <button className="btn-secondary" onClick={() => onRestore(project.id)}>Restore</button>
                    ) : !project.archived && isAppAdmin ? (
                      <button className={styles.dangerBtn} onClick={() => onDelete(project.id)}>Delete</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

function EmptyState({ onNew, canCreate = true }: { onNew: () => void; canCreate?: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>&#128640;</div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>No projects yet</h2>
      <p style={{ marginBottom: 24 }}>
        {canCreate
          ? 'Create your first project to generate SDLC documentation with AI agents.'
          : "You haven't been added to a project yet. Ask whoever invited you to add you as a team member."}
      </p>
      {canCreate && (
        <button className="btn-primary" onClick={onNew} style={{ fontSize: 15, padding: '10px 24px' }}>
          + New Project
        </button>
      )}
    </div>
  );
}
