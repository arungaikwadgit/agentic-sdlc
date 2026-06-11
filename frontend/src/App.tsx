import { useState, useEffect } from 'react';
import Dashboard from './components/dashboard/Dashboard';
import ProjectWorkspace from './components/pipeline/ProjectWorkspace';
import ResumeModal from './components/common/ResumeModal';
import { db } from './db/database';

export type View = { page: 'dashboard' } | { page: 'project'; projectId: string };

/** Apply a stored theme preference to <html data-theme="..."> on startup. */
function useThemeInit() {
  useEffect(() => {
    db.settings.get('app:theme').then((stored) => {
      const t = (stored?.value as string) ?? 'dark';
      if (t === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', t);
      }
    });
  }, []);
}

export default function App() {
  useThemeInit();
  const [view, setView] = useState<View>({ page: 'dashboard' });

  if (view.page === 'project') {
    return (
      <ProjectWorkspace
        projectId={view.projectId}
        onBack={() => setView({ page: 'dashboard' })}
      />
    );
  }

  return (
    <>
      <Dashboard
        onOpenProject={(id) => setView({ page: 'project', projectId: id })}
      />
      <ResumeModal onResume={(id) => setView({ page: 'project', projectId: id })} />
    </>
  );
}
