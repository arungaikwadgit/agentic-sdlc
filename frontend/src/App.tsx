/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * App — root component. Handles client-side routing and global keyboard shortcuts.
 *
 * Admin panel: press Ctrl+Shift+` or navigate to /admin to open.
 */
import { useState, useEffect } from 'react';
import Dashboard from './components/dashboard/Dashboard';
import ProjectWorkspace from './components/pipeline/ProjectWorkspace';
import ResumeModal from './components/common/ResumeModal';
import ChatWidget from './chatbot/ChatWidget';
import InviteAcceptPage from './components/invite/InviteAcceptPage';
import AdminPanel from './components/admin/AdminPanel';
import ErrorBoundary from './components/common/ErrorBoundary';
import { db } from './db/database';
import { isAdminMode } from './lib/adminMode';
import { initializeQualityDefaults } from './agents/promptDefaults';

export type View = { page: 'dashboard' } | { page: 'project'; projectId: string } | { page: 'invite' };

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

function detectInitialView(): View {
  if (window.location.pathname === '/invite' || window.location.search.includes('token=')) {
    return { page: 'invite' };
  }
  const projectId = new URLSearchParams(window.location.search).get('project');
  if (projectId) {
    window.history.replaceState(null, '', '/');
    return { page: 'project', projectId };
  }
  return { page: 'dashboard' };
}

export default function App() {
  useThemeInit();

  // Migrate stale pre-upgrade app-level prompt overrides so quality defaults take effect
  useEffect(() => { initializeQualityDefaults(); }, []);

  const [view, setView] = useState<View>(detectInitialView);
  // H-01 fix: /admin URL only opens panel for admin bypass mode users
  const [adminOpen, setAdminOpen] = useState(
    () => isAdminMode() && window.location.pathname === '/admin'
  );

  // Keyboard shortcut: Ctrl+Shift+` opens/closes the admin panel.
  // H-01 fix: restricted to admin (local bypass) mode only.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === '`') {
        e.preventDefault();
        // Only allow toggling admin panel when running in admin bypass mode
        if (isAdminMode()) {
          setAdminOpen((o) => !o);
        }
      }
      if (e.key === 'Escape') {
        setAdminOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {view.page === 'invite' && <InviteAcceptPage />}

      {view.page === 'project' && (
        <ErrorBoundary>
          <ProjectWorkspace
            projectId={view.projectId}
            onBack={() => setView({ page: 'dashboard' })}
          />
          <ChatWidget isAdmin={isAdminMode()} />
        </ErrorBoundary>
      )}

      {view.page === 'dashboard' && (
        <>
          <Dashboard
            onOpenProject={(id) => setView({ page: 'project', projectId: id })}
          />
        </>
      )}
    </>
  );
}
