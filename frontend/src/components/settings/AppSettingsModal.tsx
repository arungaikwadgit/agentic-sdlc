/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import {
  getPromptDefaults, savePromptDefault, resetPromptDefault,
  getAgentProviderHints, saveAgentProviderHint,
  type ProviderHint,
} from '@/agents/promptDefaults';
import { DOMAINS } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import {
  getDomainKnowledgeDefaults,
  saveDomainKnowledgeDefault,
  resetDomainKnowledgeDefault,
} from '@/agents/domainKnowledgeDefaults';
import { listProjects, updateProject, restoreProject, deleteProject } from '@/db/projectRepository';
import { api, type ProviderTestResult } from '@/services/api';
import type { AgentId } from '@/types/agent.types';
import type { DomainId } from '@/types/domain.types';
import styles from './AppSettingsModal.module.css';

type Theme = 'dark' | 'light' | 'system';
type SettingsTab = 'api' | 'email' | 'appearance' | 'prompts' | 'domains' | 'projects';

const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  complete: 'Complete',
  error: 'Error',
};

const MODELS = [
  { value: 'gpt-4o',        label: 'GPT-4o (recommended)' },
  { value: 'gpt-4o-mini',   label: 'GPT-4o Mini (faster, cheaper)' },
  { value: 'gpt-4-turbo',   label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (budget)' },
];

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-opus-4-8',   label: 'Claude Opus 4.8 (highest quality)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheaper)' },
];

const PROVIDER_HINT_OPTIONS: { value: ProviderHint; label: string }[] = [
  { value: 'auto',   label: 'Auto (use default provider)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' },
];

const API_URL  = (import.meta as any).env?.VITE_API_URL ?? '/api';
// C-NEW-01 fix: getAuthHeader() uses Supabase JWT (no bundled secret)
import { getAuthHeader } from '@/services/api';

async function saveBackendSettings(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_URL}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify(payload),
  });
  return res.json();
}

interface Props {
  onClose: () => void;
}

export default function AppSettingsModal({ onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>('api');

  // API tab state
  const [apiKey, setApiKey]       = useState('');
  const [proxyToken, setProxyToken] = useState('');
  const [model, setModel]         = useState('gpt-4o');

  // Email (Resend) tab state
  const [resendApiKey, setResendApiKey]   = useState('');
  const [resendFrom, setResendFrom]       = useState('');
  const [appUrl, setAppUrl]               = useState('');
  const [showResendKey, setShowResendKey] = useState(false);
  const [resendSaving, setResendSaving]   = useState(false);
  const [resendMsg, setResendMsg]         = useState('');
  const [resendErr, setResendErr]         = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showToken, setShowToken]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [saveErr, setSaveErr]     = useState('');

  // Claude (Anthropic) provider state
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeModel, setClaudeModel]   = useState('claude-sonnet-4-6');
  const [claudeEnabled, setClaudeEnabled] = useState(false);
  const [showClaudeApiKey, setShowClaudeApiKey] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState<'openai' | 'claude'>('openai');
  const [agentProviderHints, setAgentProviderHints] = useState<Partial<Record<AgentId, ProviderHint>>>({});

  // "Test Connection" state, per provider
  const [testingProvider, setTestingProvider] = useState<'openai' | 'claude' | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<'openai' | 'claude', ProviderTestResult>>>({});

  // Appearance tab state
  const [theme, setTheme] = useState<Theme>('dark');
  const [themeSaved, setThemeSaved] = useState(false);

  // Agent Prompts tab state
  const [promptDefaults, setPromptDefaults] = useState<Partial<Record<AgentId, string>>>({});
  const allAgentIds = PHASE_ORDER.flatMap((p) => PHASE_AGENTS[p]);
  const [selectedPromptAgent, setSelectedPromptAgent] = useState<AgentId>(allAgentIds[0]);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaveMsg, setPromptSaveMsg] = useState('');
  const [savingPromptDefault, setSavingPromptDefault] = useState(false);

  // Domain Knowledge tab state
  const allDomainIds = Object.keys(DOMAINS) as DomainId[];
  const [domainKnowledgeDefaults, setDomainKnowledgeDefaults] = useState<Partial<Record<DomainId, string>>>({});
  const [selectedDomain, setSelectedDomain] = useState<DomainId>(allDomainIds[0]);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainSaveMsg, setDomainSaveMsg] = useState('');
  const [savingDomainDefault, setSavingDomainDefault] = useState(false);
  const [researchingDomain, setResearchingDomain] = useState(false);
  const [domainResearchError, setDomainResearchError] = useState<string | null>(null);

  // Projects tab state
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const allProjectSummaries = useLiveQuery(() => listProjects(), []) ?? [];
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveReasonDraft, setArchiveReasonDraft] = useState('');

  // Derived project counts and views
  const archivedCount = allProjectSummaries.filter((p) => !!p.archived).length;
  const visibleProjects = allProjectSummaries.filter((p) =>
    showArchivedProjects ? !!p.archived : !p.archived
  );

  // Load persisted settings from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const [storedModel, storedTheme, defaults, domainDefaults, providerHints] = await Promise.all([
        db.settings.get('app:model'),
        db.settings.get('app:theme'),
        getPromptDefaults(),
        getDomainKnowledgeDefaults(),
        getAgentProviderHints(),
      ]);
      if (storedModel?.value) setModel(storedModel.value as string);
      if (storedTheme?.value) setTheme(storedTheme.value as Theme);
      setPromptDefaults(defaults);
      setDomainKnowledgeDefaults(domainDefaults);
      setAgentProviderHints(providerHints);
    })();

    // Read current Claude/provider + Resend config from the backend .env
    (async () => {
      try {
        const [healthRes, settingsRes] = await Promise.all([
          fetch(`${API_URL}/health`,    { headers: await getAuthHeader() }),
          fetch(`${API_URL}/settings`,  { headers: await getAuthHeader() }),
        ]);
        if (healthRes.ok) {
          const health = await healthRes.json();
          if (typeof health.claudeEnabled === 'boolean') setClaudeEnabled(health.claudeEnabled);
          if (health.claudeModel) setClaudeModel(health.claudeModel);
          if (health.defaultProvider === 'claude' || health.defaultProvider === 'openai') {
            setDefaultProvider(health.defaultProvider);
          }
        }
        if (settingsRes.ok) {
          const cfg = await settingsRes.json();
          if (cfg.resendFrom) setResendFrom(cfg.resendFrom);
          if (cfg.appUrl)     setAppUrl(cfg.appUrl);
        }
      } catch {
        // Backend unreachable — leave defaults as-is.
      }
    })();
  }, []);

  // When switching the selected agent (or loading defaults), refresh the draft
  useEffect(() => {
    setPromptDraft(promptDefaults[selectedPromptAgent] ?? AGENT_DEFINITIONS[selectedPromptAgent]?.systemPrompt ?? '');
    setPromptSaveMsg('');
  }, [selectedPromptAgent, promptDefaults]);

  // When switching the selected domain (or loading defaults), refresh the draft
  useEffect(() => {
    setDomainDraft(domainKnowledgeDefaults[selectedDomain] ?? DOMAIN_KNOWLEDGE_TEMPLATES[selectedDomain] ?? '');
    setDomainSaveMsg('');
    setDomainResearchError(null);
  }, [selectedDomain, domainKnowledgeDefaults]);

  function selectPromptAgent(agentId: AgentId) {
    setSelectedPromptAgent(agentId);
  }

  async function handleSavePromptDefault() {
    setSavingPromptDefault(true);
    try {
      await savePromptDefault(selectedPromptAgent, promptDraft);
      setPromptDefaults((prev) => ({ ...prev, [selectedPromptAgent]: promptDraft }));
      setPromptSaveMsg('✓ Saved as app-wide default');
      setTimeout(() => setPromptSaveMsg(''), 2000);
    } finally {
      setSavingPromptDefault(false);
    }
  }

  async function handleResetPromptDefault() {
    setSavingPromptDefault(true);
    try {
      await resetPromptDefault(selectedPromptAgent);
      setPromptDefaults((prev) => {
        const next = { ...prev };
        delete next[selectedPromptAgent];
        return next;
      });
      setPromptDraft(AGENT_DEFINITIONS[selectedPromptAgent]?.systemPrompt ?? '');
      setPromptSaveMsg('↺ Reverted to built-in default');
      setTimeout(() => setPromptSaveMsg(''), 2000);
    } finally {
      setSavingPromptDefault(false);
    }
  }

  function selectDomain(domainId: DomainId) {
    setSelectedDomain(domainId);
  }

  async function handleSaveDomainDefault() {
    setSavingDomainDefault(true);
    try {
      await saveDomainKnowledgeDefault(selectedDomain, domainDraft);
      setDomainKnowledgeDefaults((prev) => ({ ...prev, [selectedDomain]: domainDraft }));
      setDomainSaveMsg('✓ Saved as app-wide default for new projects');
      setTimeout(() => setDomainSaveMsg(''), 2000);
    } finally {
      setSavingDomainDefault(false);
    }
  }

  async function handleResetDomainDefault() {
    setSavingDomainDefault(true);
    try {
      await resetDomainKnowledgeDefault(selectedDomain);
      setDomainKnowledgeDefaults((prev) => {
        const next = { ...prev };
        delete next[selectedDomain];
        return next;
      });
      setDomainDraft(DOMAIN_KNOWLEDGE_TEMPLATES[selectedDomain] ?? '');
      setDomainSaveMsg('↺ Reverted to built-in template');
      setTimeout(() => setDomainSaveMsg(''), 2000);
    } finally {
      setSavingDomainDefault(false);
    }
  }

  async function handleResearchDomain() {
    setResearchingDomain(true);
    setDomainResearchError(null);
    setDomainSaveMsg('');
    try {
      const generated = await api.generateDomainKnowledge({
        domainLabel: DOMAINS[selectedDomain].label,
        domainTemplate: DOMAIN_KNOWLEDGE_TEMPLATES[selectedDomain],
        projectName: `${DOMAINS[selectedDomain].label} (app-level default)`,
        projectDescription: `A general-purpose ${DOMAINS[selectedDomain].label} project. This brief will be used as the app-wide starting point for all new ${DOMAINS[selectedDomain].label} projects, so keep it broadly applicable rather than tied to one specific product.`,
        currentInput: domainDraft,
      });
      if (generated) setDomainDraft(generated);
      else setDomainResearchError('No content returned. Try again.');
    } catch (err) {
      setDomainResearchError(err instanceof Error ? err.message : 'Failed to research domain knowledge.');
    } finally {
      setResearchingDomain(false);
    }
  }

  // Apply theme to <html> data-theme attribute
  function applyTheme(t: Theme) {
    const root = document.documentElement;
    if (t === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', t);
    }
  }

  async function handleSaveApi() {
    setSaving(true);
    setSaveMsg('');
    setSaveErr('');
    try {
      const payload: Record<string, unknown> = {};
      if (apiKey.trim())     payload.openaiApiKey = apiKey.trim();
      if (proxyToken.trim()) payload.proxyToken   = proxyToken.trim();
      if (model)             payload.openaiModel  = model;

      if (claudeApiKey.trim()) payload.anthropicApiKey = claudeApiKey.trim();
      if (claudeModel)         payload.anthropicModel  = claudeModel;
      payload.anthropicEnabled = claudeEnabled;
      payload.defaultLlmProvider = defaultProvider;

      // Save model to IndexedDB (no restart needed, frontend reads it)
      await db.settings.put({ key: 'app:model', value: model });

      const result = await saveBackendSettings(payload);
      if (result.ok) {
        setSaveMsg(result.message ?? 'Settings saved.');
        setApiKey('');
        setProxyToken('');
        setClaudeApiKey('');
      } else {
        setSaveErr(result.error ?? 'Save failed.');
      }
    } catch (e) {
      setSaveErr('Backend unreachable — is the proxy running?');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEmail() {
    setResendSaving(true);
    setResendMsg('');
    setResendErr('');
    try {
      const payload: Record<string, unknown> = {};
      if (resendApiKey.trim()) payload.resendApiKey = resendApiKey.trim();
      if (resendFrom.trim())   payload.resendFrom   = resendFrom.trim();
      if (appUrl.trim())       payload.appUrl        = appUrl.trim();

      const result = await saveBackendSettings(payload);
      if (result.ok) {
        setResendMsg(result.message ?? 'Email settings saved. Restart the backend to apply.');
        setResendApiKey('');
      } else {
        setResendErr(result.error ?? 'Save failed.');
      }
    } catch {
      setResendErr('Backend unreachable — is the proxy running?');
    } finally {
      setResendSaving(false);
    }
  }

  async function handleAgentProviderHintChange(agentId: AgentId, hint: ProviderHint) {
    await saveAgentProviderHint(agentId, hint);
    setAgentProviderHints((prev) => {
      const next = { ...prev };
      if (hint === 'auto') delete next[agentId];
      else next[agentId] = hint;
      return next;
    });

    // Also push the combined map to the backend so AGENT_PROVIDER_MAP stays
    // in sync for server-side resolution (used if the frontend hint is
    // unavailable, e.g. direct /api/agent calls).
    const updated = { ...agentProviderHints };
    if (hint === 'auto') delete updated[agentId];
    else updated[agentId] = hint;
    try {
      await saveBackendSettings({ agentProviderMap: updated });
    } catch {
      // Non-fatal — the frontend hint (Dexie) still takes effect via the
      // `provider` field sent with each /api/agent request.
    }
  }

  // ── Test Connection: send a minimal real request through the proxy for the
  // given provider and confirm it actually responds (and isn't silently
  // falling back to the other provider).
  async function handleTestProvider(provider: 'openai' | 'claude') {
    setTestingProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider]: undefined }));
    try {
      const result = await api.testProviderConnection(provider);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleSaveTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    await db.settings.put({ key: 'app:theme', value: t });
    setThemeSaved(true);
    setTimeout(() => setThemeSaved(false), 2000);
  }

  // ─── Projects tab ────────────────────────────────────────────────────────
  function startArchive(projectId: string) {
    setArchivingId(projectId);
    setArchiveReasonDraft('');
  }

  function cancelArchive() {
    setArchivingId(null);
    setArchiveReasonDraft('');
  }

  async function confirmArchive(projectId: string) {
    if (!archiveReasonDraft.trim()) return;
    await updateProject(projectId, (p) => {
      p.archived = true;
      p.archivedReason = archiveReasonDraft.trim();
      p.archivedAt = Date.now();
      p.archivedBy = 'App Settings';
    });
    setArchivingId(null);
    setArchiveReasonDraft('');
  }

  async function handleRestoreProject(projectId: string) {
    await restoreProject(projectId);
  }

  async function handleDeleteProject(projectId: string, name: string) {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    await deleteProject(projectId);
  }

  // H-03 fix: export all local Dexie projects to a JSON file so users can
  // migrate them to a Supabase-backed deployment or keep a backup.
  async function handleExportLocalData() {
    setExporting(true);
    setExportMsg(null);
    try {
      const allProjects = await db.projects.toArray();
      const blob = new Blob(
        [JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, projects: allProjects }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agentic-sdlc-export-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMsg(`Exported ${allProjects.length} project${allProjects.length !== 1 ? 's' : ''} successfully.`);
    } catch (e) {
      setExportMsg(`Export failed: ${String(e)}`);
    } finally {
      setExporting(false);
      setTimeout(() => setExportMsg(null), 4000);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>⚙ App Settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.tabs}>
          {(['api', 'email', 'appearance', 'prompts', 'domains', 'projects'] as SettingsTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'api' ? '🔑 API & Model'
                : t === 'email' ? '✉ Email'
                : t === 'appearance' ? '🎨 Appearance'
                : t === 'prompts' ? '📝 Agent Prompts'
                : t === 'domains' ? '📚 Domain Knowledge'
                : '🗂 Projects'}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === 'api' && (
            <div className={styles.section}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>OpenAI API Key</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-proj-… (leave blank to keep current)"
                    autoComplete="off"
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>Stored in backend/.env. Restart the backend after saving.</span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Proxy Token</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={proxyToken}
                    onChange={(e) => setProxyToken(e.target.value)}
                    placeholder="Leave blank to keep current"
                    autoComplete="off"
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowToken((v) => !v)}>
                    {showToken ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>The shared secret between the frontend and backend proxy.</span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>AI Model</label>
                <select
                  className={styles.modelSelect}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <span className={styles.fieldHint}>Saved immediately in browser. Also written to backend/.env.</span>
              </div>

              <div className={styles.fieldGroup}>
                <button
                  className="btn-secondary"
                  onClick={() => handleTestProvider('openai')}
                  disabled={testingProvider === 'openai'}
                >
                  {testingProvider === 'openai' ? <><span className={styles.spinner}>⟳</span>Testing...</> : '◎ Test Connection'}
                </button>
                <span className={styles.fieldHint} style={{ display: 'block', marginTop: '0.5rem' }}>
                  Sends one tiny live request through the proxy (small API cost) to confirm the key and model work.
                </span>
                {testResults.openai && (
                  testResults.openai.ok ? (
                    <p style={{ fontSize: 12, color: 'var(--success)', margin: '0.5rem 0 0' }}>
                      ✓ Connected{testResults.openai.model ? ` — responded via ${testResults.openai.model}` : ''}.
                      {testResults.openai.sample ? ` Sample reply: "${testResults.openai.sample}"` : ''}
                      {testResults.openai.fellBack && (
                        <span style={{ color: 'var(--error)' }}>
                          {' '}⚠ Note: request was for OpenAI but the proxy served {testResults.openai.servedBy} instead.
                        </span>
                      )}
                    </p>
                  ) : (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--error)',
                      margin: '0.5rem 0 0',
                      padding: '10px 12px',
                      background: 'rgba(var(--error-rgb, 220,38,38), 0.08)',
                      borderLeft: '3px solid var(--error)',
                      borderRadius: 4,
                      lineHeight: 1.6,
                    }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>✗ Connection failed</strong>
                      <span style={{ display: 'block', opacity: 0.9 }}>
                        {testResults.openai.error ?? 'Could not reach the proxy server. Make sure it is running.'}
                      </span>
                      <span style={{ display: 'block', marginTop: 6, opacity: 0.65, fontSize: 11 }}>
                        Check Settings → Proxy URL and confirm the backend server is running.
                      </span>
                    </div>
                  )
                )}
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={claudeEnabled}
                    onChange={(e) => setClaudeEnabled(e.target.checked)}
                  />
                  Enable Claude (Anthropic) as a second provider
                </label>
                <span className={styles.fieldHint}>
                  When enabled, the orchestrator can route individual agents to Claude instead of OpenAI.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Claude API Key</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showClaudeApiKey ? 'text' : 'password'}
                    value={claudeApiKey}
                    onChange={(e) => setClaudeApiKey(e.target.value)}
                    placeholder="sk-ant-… (leave blank to keep current)"
                    autoComplete="off"
                    disabled={!claudeEnabled}
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowClaudeApiKey((v) => !v)}>
                    {showClaudeApiKey ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>Stored in backend/.env as ANTHROPIC_API_KEY. Restart the backend after saving.</span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Claude Model</label>
                <select
                  className={styles.modelSelect}
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  disabled={!claudeEnabled}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <button
                  className="btn-secondary"
                  onClick={() => handleTestProvider('claude')}
                  disabled={testingProvider === 'claude' || !claudeEnabled}
                  title={!claudeEnabled ? 'Enable Claude above first' : undefined}
                >
                  {testingProvider === 'claude' ? <><span className={styles.spinner}>⟳</span>Testing...</> : '◎ Test Connection'}
                </button>
                {claudeEnabled ? (
                  <span className={styles.fieldHint} style={{ display: 'block', marginTop: '0.5rem' }}>
                    Sends one tiny live request through the proxy (small API cost) to confirm the key and model work.
                  </span>
                ) : (
                  <span className={styles.fieldHint} style={{ display: 'block', marginTop: '0.5rem' }}>
                    Enable Claude and save your API key first, then test the connection here.
                  </span>
                )}
                {testResults.claude && (
                  testResults.claude.ok ? (
                    <p style={{ fontSize: 12, color: 'var(--success)', margin: '0.5rem 0 0' }}>
                      ✓ Connected{testResults.claude.model ? ` — responded via ${testResults.claude.model}` : ''}.
                      {testResults.claude.sample ? ` Sample reply: "${testResults.claude.sample}"` : ''}
                      {testResults.claude.fellBack && (
                        <span style={{ color: 'var(--error)' }}>
                          {' '}⚠ Note: request was for Claude, but the proxy served {testResults.claude.servedBy} instead.
                          This usually means ANTHROPIC_ENABLED is false on the backend, or the key wasn't saved/restarted yet.
                        </span>
                      )}
                    </p>
                  ) : (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--error)',
                      margin: '0.5rem 0 0',
                      padding: '10px 12px',
                      background: 'rgba(var(--error-rgb, 220,38,38), 0.08)',
                      borderLeft: '3px solid var(--error)',
                      borderRadius: 4,
                      lineHeight: 1.6,
                    }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>✗ Connection failed</strong>
                      <span style={{ display: 'block', opacity: 0.9 }}>
                        {testResults.claude.error ?? 'Could not reach the proxy server. Make sure it is running.'}
                      </span>
                      <span style={{ display: 'block', marginTop: 6, opacity: 0.65, fontSize: 11 }}>
                        Verify your Anthropic API key is saved and the backend has been restarted.
                      </span>
                    </div>
                  )
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Default Provider</label>
                <select
                  className={styles.modelSelect}
                  value={defaultProvider}
                  onChange={(e) => setDefaultProvider(e.target.value as 'openai' | 'claude')}
                  disabled={!claudeEnabled}
                >
                  <option value="openai">OpenAI</option>
                  <option value="claude">Claude</option>
                </select>
                <span className={styles.fieldHint}>
                  Used for any agent without a specific provider assignment below.
                </span>
              </div>

              {(apiKey.trim() || proxyToken.trim() || claudeApiKey.trim()) && (
                <div className={styles.restartHint}>
                  ⚠ After saving new API keys, restart the backend server for changes to take effect (<code>npm start</code> in the <code>backend/</code> folder).
                </div>
              )}

              <div className={styles.fieldGroup} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <label className={styles.fieldLabel}>Per-Agent Provider Routing</label>
                <span className={styles.fieldHint}>
                  Override which provider handles each agent. "Auto" follows the default provider above.
                  {!claudeEnabled && ' Enable Claude above to route agents to it.'}
                </span>
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {PHASE_ORDER.map((phaseId) => (
                    <div key={phaseId}>
                      <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.25rem' }}>{PHASE_LABELS[phaseId]}</div>
                      {PHASE_AGENTS[phaseId].map((agentId) => (
                        <div key={agentId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.35rem 0' }}>
                          <span>{AGENT_DEFINITIONS[agentId]?.name ?? agentId}</span>
                          <select
                            className={styles.modelSelect}
                            style={{ width: 'auto', minWidth: '180px' }}
                            value={agentProviderHints[agentId] ?? 'auto'}
                            onChange={(e) => handleAgentProviderHintChange(agentId, e.target.value as ProviderHint)}
                            disabled={!claudeEnabled}
                          >
                            {PROVIDER_HINT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'email' && (
            <div className={styles.section}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Invite emails are sent via <strong>Resend</strong> (resend.com). Create a free account, verify your
                sending domain, then paste your API key below. Without a key, invite links are still generated and
                logged to the backend console — you can copy-paste them manually.
              </p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Resend API Key</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showResendKey ? 'text' : 'password'}
                    value={resendApiKey}
                    onChange={(e) => setResendApiKey(e.target.value)}
                    placeholder="re_… (leave blank to keep current)"
                    autoComplete="off"
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowResendKey((v) => !v)}>
                    {showResendKey ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>
                  Get your key at <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>resend.com/api-keys</a>.
                  Stored in backend/.env as RESEND_API_KEY. Restart the backend after saving.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>From Address</label>
                <input
                  type="email"
                  value={resendFrom}
                  onChange={(e) => setResendFrom(e.target.value)}
                  placeholder="invites@yourdomain.com"
                  autoComplete="off"
                />
                <span className={styles.fieldHint}>
                  Must be on a domain you have verified in Resend. Example: <code>invites@yourdomain.com</code>.
                  Stored as RESEND_FROM.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>App URL</label>
                <input
                  type="url"
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                  placeholder="https://your-app.railway.app"
                  autoComplete="off"
                />
                <span className={styles.fieldHint}>
                  Public URL of your deployed app. Used to build invite magic links in emails.
                  Stored as APP_URL. Example: <code>https://sdlc.yourcompany.com</code>.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 12, lineHeight: 1.7 }}>
                  <strong>Quick setup checklist:</strong>
                  <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                    <li>Sign up at <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>resend.com</a> (free tier: 3,000 emails/month)</li>
                    <li>Go to <strong>Domains</strong> and add your domain — follow the DNS instructions</li>
                    <li>Go to <strong>API Keys</strong> and create a key with "Sending" permission</li>
                    <li>Paste the key above, set the From address and App URL, then click Save</li>
                    <li>Restart the backend: <code>cd backend && npm start</code></li>
                  </ol>
                </div>
              </div>

              {resendApiKey.trim() && (
                <div className={styles.restartHint}>
                  ⚠ After saving a new Resend key, restart the backend server for it to take effect.
                </div>
              )}

              <div className={styles.fieldGroup}>
                <button className="btn-primary" onClick={handleSaveEmail} disabled={resendSaving}>
                  {resendSaving ? 'Saving…' : 'Save Email Settings'}
                </button>
                {resendMsg && <p style={{ fontSize: 12, color: 'var(--success)', marginTop: '0.5rem' }}>✓ {resendMsg}</p>}
                {resendErr && <p style={{ fontSize: 12, color: 'var(--error)', marginTop: '0.5rem' }}>✗ {resendErr}</p>}
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className={styles.section}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Color Theme</label>
                <div className={styles.themeGrid}>
                  {([
                    { value: 'dark',   label: 'Dark',   icon: '🌙' },
                    { value: 'light',  label: 'Light',  icon: '☀️' },
                    { value: 'system', label: 'System', icon: '💻' },
                  ] as { value: Theme; label: string; icon: string }[]).map(({ value, label, icon }) => (
                    <button
                      key={value}
                      className={`${styles.themeBtn} ${theme === value ? styles.themeBtnActive : ''}`}
                      onClick={() => handleSaveTheme(value)}
                    >
                      <span className={styles.themeIcon}>{icon}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {themeSaved && <span className={styles.saveMsg}>✓ Theme applied</span>}
                <span className={styles.fieldHint}>
                  Theme is applied immediately and persisted in the browser. Light mode requires additional CSS variables — add them to <code>index.css</code> if not already defined.
                </span>
              </div>
            </div>
          )}

          {tab === 'prompts' && (
            <div className={styles.section}>
              <span className={styles.fieldHint}>
                Set the app-wide default system prompt for each agent. These apply to every project unless a project admin
                saves a project-specific override (Review Gate → Prompt Sandbox → "Save for this project"), which always
                takes precedence.
              </span>
              <div className={styles.promptsLayout}>
                <div className={styles.promptAgentList}>
                  {PHASE_ORDER.map((phase) => (
                    <div key={phase}>
                      <div className={styles.promptPhaseLabel}>{PHASE_LABELS[phase]}</div>
                      {PHASE_AGENTS[phase].map((agentId) => {
                        const def = AGENT_DEFINITIONS[agentId];
                        const hasCustom = promptDefaults[agentId] !== undefined;
                        return (
                          <button
                            key={agentId}
                            className={`${styles.promptAgentBtn} ${selectedPromptAgent === agentId ? styles.promptAgentBtnActive : ''}`}
                            onClick={() => selectPromptAgent(agentId)}
                          >
                            <span>{def?.name ?? agentId}</span>
                            {hasCustom && <span className={styles.promptCustomBadge} title="Custom default saved">●</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className={styles.promptEditor}>
                  <span className={styles.promptEditorTitle}>
                    {AGENT_DEFINITIONS[selectedPromptAgent]?.name ?? selectedPromptAgent}
                  </span>
                  <span className={styles.fieldHint}>
                    {AGENT_DEFINITIONS[selectedPromptAgent]?.description}
                  </span>
                  <textarea
                    className={styles.promptTextarea}
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                  />
                  <div className={styles.promptActions}>
                    <button
                      className="btn-primary"
                      onClick={handleSavePromptDefault}
                      disabled={savingPromptDefault || !promptDraft.trim()}
                    >
                      {savingPromptDefault ? 'Saving...' : '💾 Save as default'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleResetPromptDefault}
                      disabled={savingPromptDefault || promptDefaults[selectedPromptAgent] === undefined}
                      title="Revert to the built-in default prompt"
                    >
                      ↺ Reset to built-in
                    </button>
                    {promptSaveMsg && <span className={styles.saveMsg}>{promptSaveMsg}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'domains' && (
            <div className={styles.section}>
              <span className={styles.fieldHint}>
                Maintain one reusable Domain Knowledge brief per industry. When a new project is created, its domain's
                brief here pre-fills the project's Domain Knowledge (project admins can still edit it freely afterward).
                Use "🔍 Research with AI" to have the model draft or refresh a brief based on its trained knowledge of
                the industry — review the "Assumptions & Open Questions" section it produces before saving.
              </span>
              <div className={styles.promptsLayout}>
                <div className={styles.promptAgentList}>
                  {allDomainIds.map((domainId) => {
                    const domainDef = DOMAINS[domainId];
                    const hasCustom = domainKnowledgeDefaults[domainId] !== undefined;
                    return (
                      <button
                        key={domainId}
                        className={`${styles.promptAgentBtn} ${selectedDomain === domainId ? styles.promptAgentBtnActive : ''}`}
                        onClick={() => selectDomain(domainId)}
                      >
                        <span>{domainDef.label}</span>
                        {hasCustom && <span className={styles.promptCustomBadge} title="Custom default saved">●</span>}
                      </button>
                    );
                  })}
                </div>

                <div className={styles.promptEditor}>
                  <div className={styles.knowledgeBanner}>
                    <span
                      className={styles.domainChip}
                      style={{ color: DOMAINS[selectedDomain].color, background: DOMAINS[selectedDomain].bgColor }}
                    >
                      {DOMAINS[selectedDomain].label}
                    </span>
                    <span className={styles.fieldHint}>
                      {domainKnowledgeDefaults[selectedDomain] !== undefined
                        ? 'This domain has a custom app-wide brief, used to pre-fill new projects in this domain.'
                        : 'This domain is currently using the built-in starter template. Save changes here to set a custom app-wide default.'}
                    </span>
                  </div>
                  <textarea
                    className={styles.promptTextarea}
                    value={domainDraft}
                    onChange={(e) => setDomainDraft(e.target.value)}
                  />
                  {domainResearchError && (
                    <span className={styles.errorMsg}>⚠ {domainResearchError}</span>
                  )}
                  <div className={styles.promptActions}>
                    <button
                      className="btn-primary"
                      onClick={handleSaveDomainDefault}
                      disabled={savingDomainDefault || !domainDraft.trim()}
                    >
                      {savingDomainDefault ? 'Saving...' : '💾 Save as default'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleResearchDomain}
                      disabled={researchingDomain || savingDomainDefault}
                      title="Use AI to draft or refresh this domain's brief"
                    >
                      {researchingDomain ? '🔍 Researching...' : '🔍 Research with AI'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleResetDomainDefault}
                      disabled={savingDomainDefault || domainKnowledgeDefaults[selectedDomain] === undefined}
                      title="Revert to the built-in starter template"
                    >
                      ↺ Reset to built-in
                    </button>
                    {domainSaveMsg && <span className={styles.saveMsg}>{domainSaveMsg}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'projects' && (
            <div className={styles.section}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <span className={styles.fieldLabel} style={{ marginBottom: 0 }}>All Projects</span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
                  onClick={handleExportLocalData}
                  disabled={exporting}
                  title="Download all local projects as a JSON backup. Use this to migrate data when switching to Supabase cloud auth."
                >
                  {exporting ? 'Exporting…' : '⬇ Export local data'}
                </button>
                {exportMsg && (
                  <span style={{ fontSize: 11, color: exportMsg.startsWith('Export failed') ? 'var(--error)' : 'var(--success)' }}>
                    {exportMsg}
                  </span>
                )}
                {archivedCount > 0 && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => setShowArchivedProjects((v) => !v)}
                  >
                    {showArchivedProjects ? 'Active Projects' : `Archived (${archivedCount})`}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleProjects.length === 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    {showArchivedProjects ? 'No archived projects.' : 'No projects yet.'}
                  </span>
                )}
                {visibleProjects.map((p) => (
                  <div key={p.id} className={styles.projectRow}>
                    <div className={styles.projectRowMeta}>
                      <span className={styles.projectRowName}>{p.name}</span>
                      {p.archived && p.archivedBy ? (
                        <span className={styles.projectRowStatus} style={{ color: 'var(--text-muted)' }}>
                          {`${p.archivedBy}: "${p.archivedReason}"`}
                        </span>
                      ) : (
                        <span className={styles.projectRowStatus}
                          style={{ color: p.status === 'complete' ? 'var(--success)' : p.status === 'error' ? 'var(--error)' : 'var(--text-muted)' }}>
                          {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      )}
                      {p.archived && p.archivedAt && (
                        <span className={styles.projectRowStatus} style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {p.completedAgents}/{p.totalAgents} agents · Archived {new Date(p.archivedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {archivingId === p.id ? (
                      <div className={styles.archiveConfirm}>
                        <input
                          className={styles.archiveReasonInput}
                          placeholder="Reason for archiving (required)"
                          value={archiveReasonDraft}
                          onChange={(e) => setArchiveReasonDraft(e.target.value)}
                          autoFocus
                        />
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11, padding: '2px 10px' }}
                          onClick={() => confirmArchive(p.id)}
                          disabled={!archiveReasonDraft.trim()}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={cancelArchive}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className={styles.projectRowActions}>
                        {p.archived ? (
                          <>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => handleRestoreProject(p.id)}
                            >
                              Restore
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '2px 8px', color: 'var(--error)' }}
                              onClick={() => handleDeleteProject(p.id, p.name)}
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => startArchive(p.id)}
                            >
                              Archive
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '2px 8px', color: 'var(--error)' }}
                              onClick={() => handleDeleteProject(p.id, p.name)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {tab === 'api' && (
          <div className={styles.footer}>
            <button className="btn-primary" onClick={handleSaveApi} disabled={saving}>
              {saving ? 'Saving…' : 'Save API Settings'}
            </button>
            {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
            {saveErr && <span className={styles.errorMsg}>{saveErr}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
