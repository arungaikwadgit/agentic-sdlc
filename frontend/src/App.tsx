/**
 * Copyright 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * App - root component. Handles client-side routing and global keyboard shortcuts.
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
import { isAdminMode } from './lib/adminMode';
import { isInviteRoute } from './lib/inviteRoute';
import { initializeMasterDataCatalog } from './services/masterDataCatalog';
import { useAuth } from './contexts/AuthContext';

export type View = { page: 'dashboard' } | { page: 'project'; projectId: string } | { page: 'invite' };

/** Apply a default theme to <html data-theme="..."> on startup. */
function useThemeInit() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);
}

function detectInitialView(): View {
  if (isInviteRoute()) {
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
  const { isAppAdmin } = useAuth();
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      await initializeMasterDataCatalog();
      if (active) {
        setCatalogReady(true);
        setCatalogError(null);
      }
    })().catch(() => {
      if (active) {
        setCatalogReady(true);
        setCatalogError('Application catalog could not be loaded from the backend API.');
      }
    });
    return () => { active = false; };
  }, []);

  const [view, setView] = useState<View>(detectInitialView);
  const [adminOpen, setAdminOpen] = useState(
    () => isAdminMode() && window.location.pathname === '/admin'
  );

  // Real production admins are recognized asynchronously (isAppAdmin resolves
  // after sign-in, via GET /api/projects/permissions/me — see
  // services/adminAuth.ts) — the local dev bypass above is synchronous and
  // already covered by the lazy initializer.
  useEffect(() => {
    if (isAppAdmin && window.location.pathname === '/admin') {
      setAdminOpen(true);
    }
  }, [isAppAdmin]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === '`') {
        e.preventDefault();
        if (isAdminMode() || isAppAdmin) {
          setAdminOpen((o) => !o);
        }
      }
      if (e.key === 'Escape') {
        setAdminOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAppAdmin]);

  if (!catalogReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg, #0f1117)' }}>
        <span style={{ color: 'var(--color-text-secondary, #8892a4)', fontSize: '0.9rem' }}>Loading application catalog...</span>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--color-bg, #0f1117)',
        padding: '32px',
      }}>
        <div style={{
          maxWidth: 560,
          background: 'var(--color-surface, #151924)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          borderRadius: 16,
          padding: '28px 24px',
          color: 'var(--color-text, #e2e8f0)',
          textAlign: 'center',
        }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>Agentic SDLC</h1>
          <p style={{ margin: '0 0 10px', color: 'var(--color-text-secondary, #94a3b8)' }}>
            {catalogError}
          </p>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #94a3b8)', fontSize: 14 }}>
            This application is configured to load master data from backend APIs only.
            Please verify the backend deployment and database connectivity, then refresh.
          </p>
        </div>
      </div>
    );
  }

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
          <ChatWidget isAdmin={isAdminMode() || isAppAdmin} />
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
