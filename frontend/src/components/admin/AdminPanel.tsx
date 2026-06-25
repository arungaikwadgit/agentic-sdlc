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
import { db } from '@/db/database';
import type { Project } from '@/types/project.types';
import styles from './AdminPanel.module.css';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

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

type Tab = 'health' | 'projects' | 'agents' | 'settings' | 'backend';

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
              <div className={styles.headerSub}>© 2025 Arun Gaikwad · Proprietary · Confidential</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {(['health', 'projects', 'agents', 'backend', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'health'   ? '🩺 Health'    :
               t === 'projects' ? '📁 Projects'  :
               t === 'agents'   ? '🤖 Agents'    :
               t === 'backend'  ? '⚡ Backend'   : '⚙️ Settings'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className={styles.body}>
          {tab === 'health'   && <HealthTab />}
          {tab === 'projects' && <ProjectsTab />}
          {tab === 'agents'   && <AgentsTab />}
          {tab === 'backend'  && <BackendTab />}
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
    { label: 'Local DB (Dexie)',         status: 'checking' },
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

    // Agent Runtime (port 4000)
    const runtimeUrl = API_URL.replace(/:3001$/, ':4000').replace(/:3000$/, ':4000');
    try {
      const r = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      results.push({ label: 'Agent Runtime (port 4000)', status: 'ok',
        detail: `${runtimeUrl} · status:${j.status ?? 'ok'}` });
    } catch {
      results.push({ label: 'Agent Runtime (port 4000)', status: 'warn',
        detail: `Not reachable at ${runtimeUrl} (normal if single-process mode)` });
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
      detail: isAdminMode() ? 'Active — Dexie-only storage' : 'Not active — using API',
    });

    // Local DB
    try {
      const count = await db.projects.count();
      const runCount = (await db.projects.toArray()).reduce((n, p) => n + Object.keys(p.agentRuns).length, 0);
      results.push({ label: 'Local DB (Dexie)', status: 'ok',
        detail: `${count} project(s) · ${runCount} agent run(s) stored locally` });
    } catch (e) {
      results.push({ label: 'Local DB (Dexie)', status: 'error', detail: String(e) });
    }

    // LLM connectivity (lightweight ping via /api/settings to verify backend has keys)
    try {
      const headers = await getAuthHeader();
      const r = await fetch(`${API_URL}/api/settings`, { headers, signal: AbortSignal.timeout(5000) });
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
          <span className={`${styles.badge} ${styles[`badge_${c.status}`]}`}>
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

  useEffect(() => { db.projects.toArray().then(setProjects); }, []);

  const reload = () => db.projects.toArray().then(setProjects);

  const setStatus = async (id: string, status: Project['status']) => {
    await db.projects.where('id').equals(id).modify({ status, updatedAt: Date.now() });
    setMessage(`Status set to "${status}"`);
    reload();
  };

  const clearAgentRuns = async (id: string) => {
    await db.projects.where('id').equals(id).modify({ agentRuns: {}, reviewGates: {}, updatedAt: Date.now() });
    setMessage('Agent pipeline cleared');
    reload();
  };

  const unlockGate = async (id: string, gateKey: string) => {
    const proj = await db.projects.get(id);
    if (!proj) return;
    const gates = { ...(proj.reviewGates ?? {}) } as Record<string, boolean>;
    gates[gateKey] = true;
    await db.projects.update(id, { reviewGates: gates, updatedAt: Date.now() });
    setMessage(`Review gate "${gateKey}" unlocked`);
    reload();
  };

  const lockGate = async (id: string, gateKey: string) => {
    const proj = await db.projects.get(id);
    if (!proj) return;
    const gates = { ...(proj.reviewGates ?? {}) } as Record<string, boolean>;
    gates[gateKey] = false;
    await db.projects.update(id, { reviewGates: gates, updatedAt: Date.now() });
    setMessage(`Review gate "${gateKey}" locked`);
    reload();
  };

  const unlockAllGates = async (id: string) => {
    const proj = await db.projects.get(id);
    if (!proj) return;
    const gates = { ...(proj.reviewGates ?? {}) } as Record<string, boolean>;
    Object.keys(gates).forEach(k => { gates[k] = true; });
    await db.projects.update(id, { reviewGates: gates, updatedAt: Date.now() });
    setMessage('All review gates unlocked');
    reload();
  };

  const deleteLocal = async (id: string) => {
    if (!confirm('Delete this project from local storage?')) return;
    await db.projects.delete(id);
    setSelected(null);
    setMessage('Project deleted');
    reload();
  };

  const sel = projects.find(p => p.id === selected);
  const gates = sel ? Object.entries(sel.reviewGates ?? {}) : [];

  return (
    <div className={styles.splitPane}>
      <div className={styles.list}>
        <div className={styles.sectionHeader}>Projects ({projects.length})<button className={styles.smallBtn} onClick={reload}>↻</button></div>
        {projects.length === 0 && <div className={styles.empty}>No local projects</div>}
        {projects.map(p => (
          <div
            key={p.id}
            className={`${styles.listItem} ${selected === p.id ? styles.listItemActive : ''}`}
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
              {(['draft','active','completed','archived'] as Project['status'][]).map(s => (
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
                    <span className={`${styles.badge} ${passed ? styles.badge_ok : styles.badge_warn}`}>
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
              <button className={styles.dangerBtn} onClick={() => deleteLocal(sel.id)}>Delete Local Copy</button>
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

  useEffect(() => { db.projects.toArray().then(setProjects); }, []);

  const sel = projects.find(p => p.id === selected);
  const agentEntries = sel ? Object.entries(sel.agentRuns) : [];

  const setAgentStatus = async (projectId: string, agentId: string, status: string) => {
    const proj = await db.projects.get(projectId);
    if (!proj) return;
    const runs = { ...proj.agentRuns };
    runs[agentId as keyof typeof runs] = {
      ...(runs[agentId as keyof typeof runs] ?? {}),
      agentId,
      status: status as 'idle' | 'running' | 'complete' | 'failed',
      updatedAt: Date.now(),
    } as any;
    await db.projects.update(projectId, { agentRuns: runs, updatedAt: Date.now() });
    setMessage(`Agent ${agentId} → ${status}`);
    db.projects.toArray().then(setProjects);
  };

  const resetAll = async (projectId: string) => {
    await db.projects.update(projectId, { agentRuns: {}, reviewGates: {}, updatedAt: Date.now() });
    setMessage('All agents reset');
    db.projects.toArray().then(setProjects);
  };

  return (
    <div className={styles.splitPane}>
      <div className={styles.list}>
        <div className={styles.sectionHeader}>Projects</div>
        {projects.map(p => (
          <div
            key={p.id}
            className={`${styles.listItem} ${selected === p.id ? styles.listItemActive : ''}`}
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
                  {(['idle','running','complete','failed'] as const).map(s => (
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
      const r = await fetch(`${API_URL}/api/settings`, { headers, signal: AbortSignal.timeout(6000) });
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

      const r = await fetch(`${API_URL}/api/settings`, {
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
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

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

  const clearLocalProjects = async () => {
    if (!confirm('Delete ALL local projects from Dexie? This cannot be undone.')) return;
    await db.projects.clear();
    setMessage('All local projects cleared');
  };

  const clearSettings = async () => {
    await db.settings.clear();
    setMessage('Settings cleared — reload to apply defaults');
  };

  const exportData = async () => {
    const projects = await db.projects.toArray();
    const settings = await db.settings.toArray();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), projects, settings }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentic-sdlc-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Export downloaded');
  };

  const envVars = [
    ['VITE_SUPABASE_URL',      import.meta.env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY],
    ['VITE_API_URL',           import.meta.env.VITE_API_URL],
    ['VITE_ADMIN_EMAIL',       import.meta.env.VITE_ADMIN_EMAIL],
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
        <button className={styles.smallBtn} onClick={exportData}>⬇ Export All Data</button>
        <button className={styles.dangerBtn} onClick={clearLocalProjects}>🗑 Clear Local Projects</button>
        <button className={styles.dangerBtn} onClick={clearSettings}>🗑 Clear App Settings</button>
      </div>

      {/* Session */}
      <div className={styles.sectionHeader} style={{ marginTop: '1.5rem' }}>Session</div>
      <div className={styles.actionGroup}>
        <button
          className={styles.smallBtn}
          onClick={() => { sessionStorage.removeItem('__admin_mode'); location.reload(); }}
        >
          Exit Admin Mode & Reload
        </button>
        <button className={styles.dangerBtn} onClick={() => { localStorage.clear(); sessionStorage.clear(); location.reload(); }}>
          ☢ Full Reset (clear all storage)
        </button>
      </div>

      <div className={styles.copyright}>
        Agentic SDLC Framework · © 2025 Arun Gaikwad<br/>
        All rights reserved. Proprietary &amp; Confidential.<br/>
        <span style={{ opacity: 0.5 }}>Admin Panel v2.0 · {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
}
