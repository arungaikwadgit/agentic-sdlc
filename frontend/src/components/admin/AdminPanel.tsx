/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AdminPanel — secret operations panel for system health, role overrides,
 * agent resets, live backend settings, and session-level app overrides.
 *
 * Access: navigate to /admin or press Ctrl+Shift+` anywhere in the app.
 * Only rendered when isAdminMode() is true.
 *
 * Session override keys (sessionStorage):
 *   sdlc_forceProvider  — "openai" | "anthropic" | "" (use backend default)
 *   sdlc_forceModel     — e.g. "gpt-4o-mini" | "" (use backend default)
 *   sdlc_testMode       — "true" | "" (returns mock LLM responses)
 */
import { useState, useEffect, useCallback } from 'react';
import { isAdminMode } from '@/lib/adminMode';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getAuthHeader } from '@/services/api';
import {
  listProjectRecords,
  updateProject,
  deleteProject,
  getProject,
  exportAllProjects,
  subscribeProjectRepositoryChange,
} from '@/db/projectRepository';
import {
  clearAppConfig,
  listAppConfig,
  listBacklogItems,
  listIntegrations,
} from '@/services/appStateApi';
import type { Project } from '@/types/project.types';
import BacklogTab from './BacklogTab';
import TestsTab from './TestsTab';
import styles from './AdminPanel.module.css';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HealthResult {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'checking';
  detail?: string;
}

interface BackendSettings {
  openaiModel: string;
  anthropicModel: string;
  anthropicEnabled: boolean;
  defaultLlmProvider: string;
  agentProviderMap: Record<string, string>;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
  hasProxyToken: boolean;
  resendFrom: string;
  appUrl: string;
}

type Tab = 'health' | 'projects' | 'agents' | 'settings' | 'backend' | 'tests' | 'backlog';

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('health');

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>🛡</span>
            <div>
              <div className={styles.headerTitle}>Admin Super Panel</div>
              <div className={styles.headerSub}>© 2026 Arun Gaikwad · Proprietary · Confidential</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {(['health', 'projects', 'agents', 'backend', 'tests', 'backlog', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              className={styles.tab + (tab === t ? ' ' + styles.tabActive : '')}
              onClick={() => setTab(t)}
            >
              {t === 'health'   ? '🩺 Health'    :
               t === 'projects' ? '📁 Projects'  :
               t === 'agents'   ? '🤖 Agents'    :
               t === 'backend'  ? '⚡ Backend'   :
               t === 'tests'    ? '🧪 Tests'     :
               t === 'backlog'  ? '📋 Backlog'   : '⚙️ Settings'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className={styles.body}>
          {tab === 'health'   && <HealthTab />}
          {tab === 'projects' && <ProjectsTab />}
          {tab === 'agents'   && <AgentsTab />}
          {tab === 'backend'  && <BackendTab />}
          {tab === 'tests'    && <TestsTab />}
          {tab === 'backlog'  && <BacklogTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const [checks, setChecks] = useState<HealthResult[]>([
    { label: 'API Server (proxy)',      status: 'checking' },
    { label: 'Agent Runtime (port 4000)',status: 'checking' },
    { label: 'Supabase Config',          status: 'checking' },
    { label: 'Admin Mode',               status: 'checking' },
    { label: 'Project Repository',       status: 'checking' },
    { label: 'LLM Connectivity',         status: 'checking' },
    { label: 'VITE_SUPABASE_URL',        status: 'checking' },
    { label: 'VITE_SUPABASE_ANON_KEY',   status: 'checking' },
    { label: 'VITE_API_URL',             status: 'checking' },
  ]);

  const runChecks = useCallback(async () => {
    setChecks(prev => prev.map(c => ({ ...c, status: 'checking' as const })));
    const results: HealthResult[] = [];

    // API server proxy ping
    try {
      const r = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      results.push({ label: 'API Server (proxy)', status: 'ok',
        detail: `${API_URL} · env:${j.env ?? '?'} · uptime:${j.uptime ? Math.round(j.uptime)+"s" : '?'}` });
    } catch {
      results.push({ label: 'API Server (proxy)', status: 'error', detail: `Cannot reach ${API_URL}/health` });
    }

    // Agent Runtime — optional observability service.
    // Only probe it when VITE_RUNTIME_URL is explicitly configured;
    // otherwise skip to avoid ERR_CONNECTION_REFUSED noise.
    const runtimeUrl = import.meta.env.VITE_RUNTIME_URL as string | undefined;
    if (runtimeUrl) {
      try {
        // Route through the Vite /runtime proxy (injects x-api-token server-side)
        const r = await fetch('/runtime/health', { signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        results.push({ label: 'Agent Runtime', status: 'ok',
          detail: `${runtimeUrl} · status:${(j as { status?: string }).status ?? 'ok'}` });
      } catch {
        results.push({ label: 'Agent Runtime', status: 'warn',
          detail: `Configured (${runtimeUrl}) but not reachable` });
      }
    } else {
      results.push({ label: 'Agent Runtime', status: 'ok',
        detail: 'Not configured — VITE_RUNTIME_URL unset (optional observability service)' });
    }

    // Supabase config
    results.push({
      label: 'Supabase Config',
      status: isSupabaseConfigured ? 'ok' : 'warn',
      detail: isSupabaseConfigured ? 'Both env vars present' : 'Not configured — local admin mode',
    });

    // Admin mode
    results.push({
      label: 'Admin Mode',
      status: isAdminMode() ? 'ok' : 'warn',
      detail: isAdminMode() ? 'Active — admin session enabled' : 'Not active — standard authenticated mode',
    });

    // Project repository
    try {
      const projects = await listProjectRecords();
      const runCount = projects.reduce((n, p) => n + Object.keys(p.agentRuns).length, 0);
      results.push({ label: 'Project Repository', status: 'ok',
        detail: `${projects.length} project(s) · ${runCount} agent run(s) loaded from backend` });
    } catch (e) {
      results.push({ label: 'Project Repository', status: 'error', detail: String(e) });
    }

    // LLM connectivity (lightweight ping via /api/settings to verify backend has keys)
    try {
      const headers = await getAuthHeader();
      const r = await fetch(`${API_URL}/settings`, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json() as BackendSettings;
        const provider = j.defaultLlmProvider || 'openai';
        const hasKey = provider === 'anthropic' ? j.hasAnthropicKey : j.hasOpenaiKey;
        results.push({ label: 'LLM Connectivity', status: hasKey ? 'ok' : 'warn',
          detail: `Provider: ${provider} · API key ${hasKey ? 'present' : 'MISSING'}` });
      } else {
        results.push({ label: 'LLM Connectivity', status: 'warn', detail: `Settings fetch: HTTP ${r.status}` });
      }
    } catch {
      results.push({ label: 'LLM Connectivity', status: 'warn', detail: 'Cannot reach backend settings — API key status unknown' });
    }

    // Env vars
    const envVars: [string, string][] = [
      ['VITE_SUPABASE_URL',      import.meta.env.VITE_SUPABASE_URL      as string],
      ['VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY as string],
      ['VITE_API_URL',           import.meta.env.VITE_API_URL           as string],
    ];
    for (const [key, val] of envVars) {
      const set = Boolean(val && !val.includes('placeholder'));
      results.push({
        label: key,
        status: set ? 'ok' : 'warn',
        detail: set ? `Set (${String(val).slice(0, 30)}…)` : 'Not set — using default',
      });
    }

    setChecks(results);
  }, []);

  useEffect(() => { runChecks(); }, [runChecks]);

  return (
    <div>
      <div className={styles.sectionHeader}>
        Application Health
        <button className={styles.smallBtn} onClick={runChecks}>↻ Recheck</button>
      </div>
      {checks.map((c) => (
        <div key={c.label} className={styles.checkRow}>
          <span className={styles.badge + ' ' + (styles as Record<string, string>)['badge_' + c.status]}>
            {c.status === 'checking' ? '…' : c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗'}
          </span>
          <div>
            <div className={styles.checkLabel}>{c.label}</div>
            {c.detail && <div className={styles.checkDetail}>{c.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Projects Tab ──────────────────────────────────────────────────────────────

function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    setProjects(await listProjectRecords());
  }, []);

  useEffect(() => {
    void reload();
    return subscribeProjectRepositoryChange(() => {
      void reload();
    });
  }, [reload]);

  const setStatus = async (id: string, status: Project['status']) => {
    await updateProject(id, (project) => { project.status = status; });
    setMessage(`Status set to "${status}"`);
    await reload();
  };

  const clearAgentRuns = async (id: string) => {
    await updateProject(id, (project) => {
      project.agentRuns = {};
      project.reviewGates = {};
    });
    setMessage('Agent pipeline cleared');
    await reload();
  };

  const unlockGate = async (id: string, gateKey: string) => {
    const proj = await getProject(id);
    if (!proj) return;
    await updateProject(id, (project) => {
      const existing = project.reviewGates[gateKey as keyof typeof project.reviewGates];
      project.reviewGates[gateKey as keyof typeof project.reviewGates] = {
        id: gateKey as any,
        afterPhases: existing?.afterPhases ?? [],
        approved: true,
        approvedAt: Date.now(),
        approvedBy: 'admin-panel',
        notes: existing?.notes,
      } as any;
    });
    setMessage(`Review gate "${gateKey}" unlocked`);
    await reload();
  };

  const lockGate = async (id: string, gateKey: string) => {
    const proj = await getProject(id);
    if (!proj) return;
    await updateProject(id, (project) => {
      const existing = project.reviewGates[gateKey as keyof typeof project.reviewGates];
      project.reviewGates[gateKey as keyof typeof project.reviewGates] = {
        id: gateKey as any,
        afterPhases: existing?.afterPhases ?? [],
        approved: false,
        approvedAt: undefined,
        approvedBy: undefined,
        notes: existing?.notes,
      } as any;
    });
    setMessage(`Review gate "${gateKey}" locked`);
    await reload();
  };

  const unlockAllGates = async (id: string) => {
    const proj = await getProject(id);
    if (!proj) return;
    await updateProject(id, (project) => {
      for (const gateId of Object.keys(project.reviewGates ?? {})) {
        const existing = project.reviewGates[gateId as keyof typeof project.reviewGates];
        project.reviewGates[gateId as keyof typeof project.reviewGates] = {
          id: gateId as any,
          afterPhases: existing?.afterPhases ?? [],
          approved: true,
          approvedAt: Date.now(),
          approvedBy: 'admin-panel',
          notes: existing?.notes,
        } as any;
      }
    });
    setMessage('All review gates unlocked');
    await reload();
  };

  const deleteRemote = async (id: string) => {
    // Soft-delete only (app-admin + remarks enforced server-side in
    // server/src/routes/projects.ts). Use prompt() here since this is an
    // internal debug panel, not the main Dashboard delete flow.
    const remarks = prompt('Reason for deleting this project (required):');
    if (!remarks?.trim()) return;
    await deleteProject(id, remarks.trim());
    setSelected(null);
    setMessage('Project deleted');
    await reload();
  };

  const sel = projects.find(p => p.id === selected);
  const gates = sel ? Object.entries(sel.reviewGates ?? {}) : [];

  return (
    <div className={styles.splitPane}>
      <div className={styles.list}>
        <div className={styles.sectionHeader}>Projects ({projects.length})<button className={styles.smallBtn} onClick={reload}>↻</button></div>
        {projects.length === 0 && <div className={styles.empty}>No projects</div>}
        {projects.map(p => (
          <div
            key={p.id}
            className={styles.listItem + (selected === p.id ? ' ' + styles.listItemActive : '')}
            onClick={() => setSelected(p.id)}
          >
            <div className={styles.listItemName}>{p.name}</div>
            <div className={styles.listItemMeta}>{p.domain} · {p.status}</div>
          </div>
        ))}
      </div>

      <div className={styles.detail}>
        {message && <div className={styles.successMsg}>{message} <button className={styles.linkBtn} onClick={() => setMessage('')}>✕</button></div>}
        {!sel && <div className={styles.empty}>Select a project</div>}
        {sel && (
          <>
            <div className={styles.sectionHeader}>{sel.name}</div>
            <div className={styles.field}><span>ID</span><code>{sel.id}</code></div>
            <div className={styles.field}><span>Status</span>{sel.status}</div>
            <div className={styles.field}><span>Domain</span>{sel.domain || '—'}</div>
            <div className={styles.field}><span>Version</span>{sel.version}</div>
            <div className={styles.field}><span>Agents run</span>{Object.keys(sel.agentRuns).length}</div>

            <div className={styles.actionGroup}>
              <div className={styles.actionLabel}>Override Status</div>
              {(['draft','running','paused','complete','error'] as Project['status'][]).map(s => (
                <button key={s} className={styles.smallBtn} onClick={() => setStatus(sel.id, s)}>{s}</button>
              ))}
            </div>

            {/* Review Gate Controls */}
            {gates.length > 0 && (
              <div className={styles.actionGroup}>
                <div className={styles.actionLabel}>
                  Review Gates
                  <button className={styles.tinyBtn} style={{ marginLeft: '8px' }} onClick={() => unlockAllGates(sel.id)}>Unlock All</button>
                </div>
                {gates.map(([key, passed]) => (
                  <div key={key} className={styles.gateRow}>
                    <span className={styles.badge + ' ' + (passed ? styles.badge_ok : styles.badge_warn)}>
                      {passed ? '✓' : '!'}
                    </span>
                    <span className={styles.gateLabel}>{key}</span>
                    {passed
                      ? <button className={styles.tinyBtn} onClick={() => lockGate(sel.id, key)}>Lock</button>
                      : <button className={styles.tinyBtn} onClick={() => unlockGate(sel.id, key)}>Unlock</button>
                    }
                  </div>
                ))}
              </div>
            )}

            <div className={styles.actionGroup}>
              <div className={styles.actionLabel}>Pipeline</div>
              <button className={styles.dangerBtn} onClick={() => clearAgentRuns(sel.id)}>Reset Agent Pipeline</button>
            </div>

            <div className={styles.actionGroup}>
              <button className={styles.dangerBtn} onClick={() => deleteRemote(sel.id)}>Delete Project</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Agents Tab ────────────────────────────────────────────────────────────────

function AgentsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    setProjects(await listProjectRecords());
  }, []);

  useEffect(() => {
    void reload();
    return subscribeProjectRepositoryChange(() => {
      void reload();
    });
  }, [reload]);

  const sel = projects.find(p => p.id === selected);
  const agentEntries = sel ? Object.entries(sel.agentRuns) : [];

  const setAgentStatus = async (projectId: string, agentId: string, status: string) => {
    const proj = await getProject(projectId);
    if (!proj) return;
    await updateProject(projectId, (project) => {
      project.agentRuns[agentId as keyof typeof project.agentRuns] = {
        ...(project.agentRuns[agentId as keyof typeof project.agentRuns] ?? {}),
        agentId,
        status: status as 'idle' | 'running' | 'complete' | 'error',
        updatedAt: Date.now(),
      } as any;
    });
    setMessage(`Agent ${agentId} → ${status}`);
    await reload();
  };

  const resetAll = async (projectId: string) => {
    await updateProject(projectId, (project) => {
      project.agentRuns = {};
      project.reviewGates = {};
    });
    setMessage('All agents reset');
    await reload();
  };

  return (
    <div className={styles.splitPane}>
      <div className={styles.list}>
        <div className={styles.sectionHeader}>Projects</div>
        {projects.map(p => (
          <div
            key={p.id}
            className={styles.listItem + (selected === p.id ? ' ' + styles.listItemActive : '')}
            onClick={() => setSelected(p.id)}
          >
            <div className={styles.listItemName}>{p.name}</div>
            <div className={styles.listItemMeta}>{Object.keys(p.agentRuns).length} agent(s) run</div>
          </div>
        ))}
      </div>
      <div className={styles.detail}>
        {message && <div className={styles.successMsg}>{message} <button className={styles.linkBtn} onClick={() => setMessage('')}>✕</button></div>}
        {!sel && <div className={styles.empty}>Select a project</div>}
        {sel && (
          <>
            <div className={styles.sectionHeader}>
              Agent Runs — {sel.name}
              <button className={styles.dangerBtn} onClick={() => resetAll(sel.id)}>Reset All</button>
            </div>
            {agentEntries.length === 0 && <div className={styles.empty}>No agent runs yet</div>}
            {agentEntries.map(([agentId, run]) => (
              <div key={agentId} className={styles.agentRow}>
                <div>
                  <div className={styles.agentId}>{agentId}</div>
                  <div className={styles.agentStatus}>{(run as any)?.status ?? 'idle'}</div>
                </div>
                <div className={styles.agentActions}>
                  {(['idle','running','complete','error'] as const).map(s => (
                    <button key={s} className={styles.tinyBtn} onClick={() => setAgentStatus(sel.id, agentId, s)}>{s}</button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Backend Tab ───────────────────────────────────────────────────────────────
// Live read/write of backend .env settings. API keys are write-only (backend
// never returns raw values). Changes persist to backend/.env via POST /api/settings.

function BackendTab() {
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [message, setMessage]     = useState('');
  const [isError, setIsError]     = useState(false);
  const [settings, setSettings]   = useState<BackendSettings | null>(null);

  // Editable fields
  const [provider, setProvider]         = useState('openai');
  const [openaiModel, setOpenaiModel]   = useState('gpt-4o');
  const [anthropicModel, setAnthrModel] = useState('claude-opus-4-5');
  const [anthropicEnabled, setAnthEn]   = useState(false);
  const [mapRaw, setMapRaw]             = useState('{}');
  const [newOpenaiKey, setNewOpenaiKey] = useState('');
  const [newAnthKey, setNewAnthKey]     = useState('');
  const [newProxyToken, setNewProxyToken] = useState('');
  const [appUrl, setAppUrl]             = useState('');
  const [resendFrom, setResendFrom]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const headers = await getAuthHeader();
      const r = await fetch(`${API_URL}/settings`, { headers, signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as BackendSettings;
      setSettings(j);
      setProvider(j.defaultLlmProvider || 'openai');
      setOpenaiModel(j.openaiModel || 'gpt-4o');
      setAnthrModel(j.anthropicModel || 'claude-opus-4-5');
      setAnthEn(j.anthropicEnabled ?? false);
      setMapRaw(JSON.stringify(j.agentProviderMap ?? {}, null, 2));
      setAppUrl(j.appUrl || '');
      setResendFrom(j.resendFrom || '');
    } catch (e) {
      setMessage('Failed to load backend settings: ' + String(e));
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setIsError(false);
    try {
      let parsedMap: Record<string, string> = {};
      try { parsedMap = JSON.parse(mapRaw); } catch {
        setMessage('agentProviderMap is not valid JSON');
        setIsError(true);
        setSaving(false);
        return;
      }
      const headers = await getAuthHeader();
      const body: Record<string, unknown> = {
        defaultLlmProvider: provider,
        openaiModel,
        anthropicModel,
        anthropicEnabled,
        agentProviderMap: parsedMap,
        appUrl,
        resendFrom,
      };
      if (newOpenaiKey.trim())   body.openaiApiKey   = newOpenaiKey.trim();
      if (newAnthKey.trim())     body.anthropicApiKey = newAnthKey.trim();
      if (newProxyToken.trim())  body.proxyToken      = newProxyToken.trim();

      const r = await fetch(`${API_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setMessage('✅ Settings saved to backend .env');
      setNewOpenaiKey('');
      setNewAnthKey('');
      setNewProxyToken('');
      await load();
    } catch (e) {
      setMessage('Save failed: ' + String(e));
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.empty}>Loading backend settings…</div>;

  return (
    <div>
      {message && (
        <div className={isError ? styles.errorMsg : styles.successMsg}>
          {message} <button className={styles.linkBtn} onClick={() => setMessage('')}>✕</button>
        </div>
      )}

      <div className={styles.sectionHeader}>
        LLM Provider
        <button className={styles.smallBtn} onClick={load}>↻ Reload</button>
      </div>

      {settings && (
        <div className={styles.keyStatus}>
          <span>OpenAI key: {settings.hasOpenaiKey ? '✓ present' : '✗ missing'}</span>
          <span>Anthropic key: {settings.hasAnthropicKey ? '✓ present' : '✗ missing'}</span>
          <span>Proxy token: {settings.hasProxyToken ? '✓ present' : '✗ missing'}</span>
        </div>
      )}

      <div className={styles.formRow}>
        <label>Default Provider</label>
        <select value={provider} onChange={e => setProvider(e.target.value)} className={styles.select}>
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
        </select>
      </div>
      <div className={styles.formRow}>
        <label>OpenAI Model</label>
        <input value={openaiModel} onChange={e => setOpenaiModel(e.target.value)} className={styles.input} placeholder="gpt-4o" />
      </div>
      <div className={styles.formRow}>
        <label>Anthropic Model</label>
        <input value={anthropicModel} onChange={e => setAnthrModel(e.target.value)} className={styles.input} placeholder="claude-opus-4-5" />
      </div>
      <div className={styles.formRow}>
        <label>Anthropic Enabled</label>
        <input type="checkbox" checked={anthropicEnabled} onChange={e => setAnthEn(e.target.checked)} />
      </div>

      <div className={styles.sectionHeader} style={{ marginTop: '1.25rem' }}>Agent Provider Map</div>
      <div className={styles.checkDetail} style={{ marginBottom: '6px' }}>JSON object mapping agent ID → "openai" | "anthropic". Empty = all agents use default provider.</div>
      <textarea
        className={styles.textarea}
        value={mapRaw}
        onChange={e => setMapRaw(e.target.value)}
        rows={6}
        spellCheck={false}
      />

      <div className={styles.sectionHeader} style={{ marginTop: '1.25rem' }}>Update API Keys (write-only)</div>
      <div className={styles.checkDetail} style={{ marginBottom: '6px' }}>Leave blank to keep existing key. New value will be saved to backend/.env.</div>
      <div className={styles.formRow}>
        <label>OpenAI API Key</label>
        <input type="password" value={newOpenaiKey} onChange={e => setNewOpenaiKey(e.target.value)} className={styles.input} placeholder="sk-… (leave blank to keep)" />
      </div>
      <div className={styles.formRow}>
        <label>Anthropic API Key</label>
        <input type="password" value={newAnthKey} onChange={e => setNewAnthKey(e.target.value)} className={styles.input} placeholder="sk-ant-… (leave blank to keep)" />
      </div>
      <div className={styles.formRow}>
        <label>Proxy Token</label>
        <input type="password" value={newProxyToken} onChange={e => setNewProxyToken(e.target.value)} className={styles.input} placeholder="PROXY_TOKEN (leave blank to keep)" />
      </div>

      <div className={styles.sectionHeader} style={{ marginTop: '1.25rem' }}>App Config</div>
      <div className={styles.formRow}>
        <label>App URL</label>
        <input value={appUrl} onChange={e => setAppUrl(e.target.value)} className={styles.input} placeholder="https://yourapp.vercel.app" />
      </div>
      <div className={styles.formRow}>
        <label>Resend From</label>
        <input value={resendFrom} onChange={e => setResendFrom(e.target.value)} className={styles.input} placeholder="noreply@yourdomain.com" />
      </div>

      <div className={styles.actionGroup} style={{ marginTop: '1.5rem' }}>
        <button className={styles.saveBtn} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save to Backend .env'}
        </button>
      </div>

      {/* ── SDLC Enhancement Roadmap ─────────────────────────────────────── */}
      <div className={styles.sectionHeader} style={{ marginTop: '2rem' }}>
        🚀 SDLC Enhancement Roadmap
        <span className={styles.checkDetail} style={{ marginLeft: 8, fontWeight: 400 }}>
          Prioritised by business value &amp; 2026 market demand
        </span>
      </div>
      <div className={styles.checkDetail} style={{ marginBottom: '10px' }}>
        Research-backed enhancements for the Agentic SDLC platform, ranked by ROI and adoption velocity.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-alt, #f1f5f9)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 32 }}>#</th>
              <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>Enhancement</th>
              <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 100 }}>Business Value</th>
              <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 90 }}>Demand</th>
              <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>Key Metric / Evidence</th>
            </tr>
          </thead>
          <tbody>
            {SDLC_ENHANCEMENTS.map((e, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, #f8fafc)' }}>
                <td style={{ padding: '6px 10px', fontWeight: 700, color: 'var(--accent)' }}>{i + 1}</td>
                <td style={{ padding: '6px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{e.description}</div>
                </td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: e.value === 'Very High' ? '#dcfce7' : e.value === 'High' ? '#dbeafe' : '#fef9c3',
                    color:      e.value === 'Very High' ? '#15803d' : e.value === 'High' ? '#1d4ed8' : '#854d0e',
                  }}>{e.value}</span>
                </td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    background: e.demand === 'Explosive' ? '#fce7f3' : e.demand === 'Very High' ? '#ede9fe' : '#f1f5f9',
                    color:      e.demand === 'Explosive' ? '#9d174d'  : e.demand === 'Very High' ? '#6d28d9' : '#475569',
                  }}>{e.demand}</span>
                </td>
                <td style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 11 }}>{e.metric}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.checkDetail} style={{ marginTop: 8 }}>
        Sources: Gartner 2026, Stack Overflow Developer Survey, Google Developer Survey, Qodo AI Code Quality Report, PwC Agentic SDLC Report, LTM SDLC AI Radar 2026.
      </div>
    </div>
  );
}

// ── SDLC Enhancement Data ─────────────────────────────────────────────────────

const SDLC_ENHANCEMENTS = [
  {
    name: 'Agentic SDLC Automation',
    description: 'Autonomous agents handle planning, coding, testing, review, and deployment end-to-end.',
    value: 'Very High',
    demand: 'Explosive',
    metric: 'Planning: weeks → hours. Teams ship multiple times/week. PwC 2026 flagship trend.',
  },
  {
    name: 'AI Code Generation & Copilots',
    description: 'Inline AI assistants (Copilot, Cursor, CodeWhisperer) embedded in IDE/terminal.',
    value: 'Very High',
    demand: 'Very High',
    metric: '84% of devs using or planning to use AI. 51% use daily. 30-55% dev time reduction.',
  },
  {
    name: 'AI Code Review & Quality Gates',
    description: 'Automated PR review, defect detection, and code quality scoring before merge.',
    value: 'High',
    demand: 'Very High',
    metric: 'Qodo 2026: AI code review raised quality improvement rate from 55% → 81%.',
  },
  {
    name: 'DevSecOps Integration',
    description: 'Security scanning, SAST/DAST, and compliance checks embedded into every SDLC stage.',
    value: 'High',
    demand: 'Very High',
    metric: 'Market CAGR 28.1%, reaching $24.43B by 2029. Now a compliance baseline.',
  },
  {
    name: 'Observability & AIOps',
    description: 'Distributed tracing, AI-driven anomaly detection, and predictive incident response.',
    value: 'High',
    demand: 'Very High',
    metric: '2.6× average ROI on observability spend. 30-50% downtime reduction via AI triage.',
  },
  {
    name: 'Platform Engineering & Internal Dev Portals',
    description: 'Self-service developer platforms with golden paths, templates, and guardrails.',
    value: 'High',
    demand: 'High',
    metric: '10-20% code velocity increase, 20% fewer critical incidents. Gartner Top 10 trend.',
  },
  {
    name: 'AI-Powered Test Generation',
    description: 'Automated unit, integration, and E2E test authoring from code and requirements.',
    value: 'High',
    demand: 'High',
    metric: 'Eliminates QA bottleneck. 40-60% test coverage increase with no manual effort.',
  },
  {
    name: 'CI/CD Pipeline Intelligence',
    description: 'AI-optimised build routing, flaky test detection, and smart deployment gates.',
    value: 'High',
    demand: 'High',
    metric: 'Multiple daily releases without quality regression. Reduces pipeline wait 35%.',
  },
  {
    name: 'AI Requirements & Documentation',
    description: 'Auto-generate PRDs, specs, and API docs from briefs, code, and user stories.',
    value: 'Medium-High',
    demand: 'High',
    metric: 'Spec generation: days → hours. 50%+ reduction in documentation debt.',
  },
  {
    name: 'Low-Code / No-Code Integration',
    description: 'Citizen developer tools for non-technical teams — workflows, dashboards, automations.',
    value: 'Medium-High',
    demand: 'High',
    metric: 'Market $44.5B by 2026. 80% of users outside IT by 2026 (Gartner).',
  },
] as const;

// ── Settings Tab ───────────────────────────────────────────────────────────────
function SettingsTab() {
  const [message, setMessage] = useState('');

  // Session override state (reads from sessionStorage)
  const [forceProvider, setForceProvider] = useState(() => sessionStorage.getItem('sdlc_forceProvider') ?? '');
  const [forceModel,    setForceModel]    = useState(() => sessionStorage.getItem('sdlc_forceModel')    ?? '');
  const [testMode,      setTestMode]      = useState(() => sessionStorage.getItem('sdlc_testMode') === 'true');

  const applyOverrides = () => {
    if (forceProvider) sessionStorage.setItem('sdlc_forceProvider', forceProvider);
    else               sessionStorage.removeItem('sdlc_forceProvider');
    if (forceModel)    sessionStorage.setItem('sdlc_forceModel', forceModel);
    else               sessionStorage.removeItem('sdlc_forceModel');
    if (testMode)      sessionStorage.setItem('sdlc_testMode', 'true');
    else               sessionStorage.removeItem('sdlc_testMode');
    setMessage('Session overrides applied (take effect on next agent run)');
  };

  const clearOverrides = () => {
    sessionStorage.removeItem('sdlc_forceProvider');
    sessionStorage.removeItem('sdlc_forceModel');
    sessionStorage.removeItem('sdlc_testMode');
    setForceProvider('');
    setForceModel('');
    setTestMode(false);
    setMessage('Session overrides cleared');
  };

  const clearSettings = async () => {
    await clearAppConfig();
    setMessage('Settings cleared — reload to apply defaults');
  };

  const exportData = async () => {
    const projects = JSON.parse(await exportAllProjects()).projects ?? [];
    const [appConfig, integrations, backlogItems] = await Promise.all([
      listAppConfig(),
      listIntegrations(),
      listBacklogItems(),
    ]);
    const blob = new Blob([JSON.stringify({
      version: 2,
      exportedAt: Date.now(),
      projects,
      appConfig,
      integrations,
      backlogItems,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agentic-sdlc-backup-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Export downloaded');
  };

  // Wipes all projects, team members, agent runs/jobs, memory records,
  // action proposals, rollback log, and invite data via
  // POST /api/admin/reset-application-data (backend/src/proxy.js). Master
  // reference data (domains, phases, agent definitions, role templates) is
  // never touched — that endpoint's table list contains no master_* table.
  // Strongly recommend exporting a backup first via the button above, since
  // this has no undo.
  const [resetting, setResetting] = useState(false);
  const resetApplicationData = async () => {
    const typed = window.prompt(
      'This permanently deletes ALL projects, team members, agent runs, and invite data. ' +
      'Master reference data (domains, phases, agent definitions, role templates) is NOT affected. ' +
      'This cannot be undone — export a backup first if you need one.\n\n' +
      'Type RESET to confirm:'
    );
    if (typed !== 'RESET') {
      if (typed !== null) setMessage('Reset cancelled — confirmation text did not match.');
      return;
    }
    setResetting(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API_URL}/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessage('Reset failed: ' + (data.error ?? `HTTP ${res.status}`));
        return;
      }
      setMessage(`Application data reset. Tables cleared: ${(data.tablesReset ?? []).join(', ')}`);
    } catch (err) {
      setMessage('Reset failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setResetting(false);
    }
  };

  const envVars = [
    ['VITE_SUPABASE_URL',      import.meta.env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY],
    ['VITE_API_URL',           import.meta.env.VITE_API_URL],
    ['MODE',                   import.meta.env.MODE],
    ['DEV',                    String(import.meta.env.DEV)],
  ] as [string, string | undefined][];

  const mask = (v: string | undefined) => {
    if (!v) return '(not set)';
    if (v.length > 20) return v.slice(0, 8) + '…' + v.slice(-4);
    return v;
  };

  return (
    <div>
      {message && <div className={styles.successMsg}>{message} <button className={styles.linkBtn} onClick={() => setMessage('')}>✕</button></div>}

      {/* Session-level overrides */}
      <div className={styles.sectionHeader}>Session Overrides</div>
      <div className={styles.checkDetail} style={{ marginBottom: '10px' }}>
        These override backend settings for this browser session only. Cleared on tab close or full reset.
      </div>
      <div className={styles.formRow}>
        <label>Force Provider</label>
        <select value={forceProvider} onChange={e => setForceProvider(e.target.value)} className={styles.select}>
          <option value="">— use backend default —</option>
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
        </select>
      </div>
      <div className={styles.formRow}>
        <label>Force Model</label>
        <input value={forceModel} onChange={e => setForceModel(e.target.value)} className={styles.input} placeholder="e.g. gpt-4o-mini (blank = default)" />
      </div>
      <div className={styles.formRow}>
        <label>Test / Dry-Run Mode</label>
        <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} />
        <span className={styles.checkDetail} style={{ marginLeft: '8px' }}>Returns mock LLM responses, no real API calls</span>
      </div>
      <div className={styles.actionGroup}>
        <button className={styles.smallBtn} onClick={applyOverrides}>✓ Apply Overrides</button>
        <button className={styles.dangerBtn} onClick={clearOverrides}>✕ Clear Overrides</button>
      </div>
      {(forceProvider || forceModel || testMode) && (
        <div className={styles.overrideBanner}>
          ⚡ Active overrides:
          {forceProvider && <span> provider={forceProvider}</span>}
          {forceModel    && <span> model={forceModel}</span>}
          {testMode      && <span> TEST MODE</span>}
        </div>
      )}

      {/* Env vars */}
      <div className={styles.sectionHeader} style={{ marginTop: '1.5rem' }}>Environment (frontend-visible)</div>
      {envVars.map(([key, val]) => (
        <div key={key} className={styles.field}>
          <span>{key}</span>
          <code>{mask(val)}</code>
        </div>
      ))}

      {/* Data management */}
      <div className={styles.sectionHeader} style={{ marginTop: '1.5rem' }}>Data</div>
      <div className={styles.actionGroup}>
        <button className={styles.smallBtn} onClick={exportData}>⬇ Export Backend Project Data</button>
        <button className={styles.dangerBtn} onClick={clearSettings}>🗑 Clear App Settings</button>
      </div>

      {/* Danger zone: full application data reset */}
      <div className={styles.sectionHeader} style={{ marginTop: '1.5rem' }}>Danger Zone</div>
      <div className={styles.checkDetail} style={{ marginBottom: '10px' }}>
        Permanently deletes all projects, team members, agent runs, and invite data.
        Master reference data (domains, phases, agent definitions, role templates) is never touched.
        Export a backup above first — this has no undo.
      </div>
      <div className={styles.actionGroup}>
        <button className={styles.dangerBtn} onClick={resetApplicationData} disabled={resetting}>
          {resetting ? 'Resetting…' : '☠ Reset Application Data'}
        </button>
      </div>

      {/* Session */}
      <div className={styles.sectionHeader} style={{ marginTop: '1.5rem' }}>Session</div>
      <div className={styles.actionGroup}>
        <button
          className={styles.smallBtn}
          onClick={() => { sessionStorage.removeItem('__admin_mode'); location.reload(); }}
        >
          Exit Admin Mode &amp; Reload
        </button>
        <button className={styles.dangerBtn} onClick={() => { localStorage.clear(); sessionStorage.clear(); location.reload(); }}>
          Full Reset (clear all storage)
        </button>
      </div>

      <div className={styles.copyright}>
        Agentic SDLC - 2026 Arun Gaikwad<br/>
        All rights reserved. Proprietary &amp; Confidential.<br/>
        <span style={{ opacity: 0.5 }}>Admin Panel v2.0 - {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
}
