import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listProjects, deleteProject, restoreProject, exportAllProjects, importProjects } from '@/db/projectRepository';
import NewProjectModal from './NewProjectModal';
import ProjectCard from './ProjectCard';
import AppSettingsModal from '../settings/AppSettingsModal';
import type { ProjectSummary } from '@/types/project.types';
import styles from './Dashboard.module.css';

interface Props {
  onOpenProject: (id: string) => void;
}

export default function Dashboard({ onOpenProject }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const allProjects = useLiveQuery(() => listProjects(), []) ?? [];
  const archivedCount = allProjects.filter((p) => p.archived).length;
  const projects = allProjects.filter((p) => (showArchived ? !!p.archived : !p.archived));

  async function handleExport() {
    const json = await exportAllProjects();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sdlc-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
        alert(`Imported ${count} project(s).`);
      } catch (e) {
        alert(`Import failed: ${String(e)}`);
      }
    };
    input.click();
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>⚙</span>
          <h1>Agentic SDLC</h1>
        </div>
        <div className={styles.actions}>
          {archivedCount > 0 && (
            <button className="btn-secondary" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? '← Active Projects' : `Archived (${archivedCount})`}
            </button>
          )}
          <button className="btn-secondary" onClick={handleImport}>Import</button>
          <button className="btn-secondary" onClick={handleExport}>Export</button>
          <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Project</button>
          <button
            className={styles.gearBtn}
            onClick={() => setShowSettings(true)}
            title="App Settings"
            aria-label="App Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {showArchived && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
            <p>No archived projects.</p>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : (
          <div className={styles.grid}>
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => onOpenProject(p.id)}
                onDelete={() => deleteProject(p.id)}
                onRestore={showArchived ? () => restoreProject(p.id) : undefined}
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

      {showSettings && (
        <AppSettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>No projects yet</h2>
      <p style={{ marginBottom: 24 }}>Create your first project to generate SDLC documentation with AI agents.</p>
      <button className="btn-primary" onClick={onNew} style={{ fontSize: 15, padding: '10px 24px' }}>
        + New Project
      </button>
    </div>
  );
}
