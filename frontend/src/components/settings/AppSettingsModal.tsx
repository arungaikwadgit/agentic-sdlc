/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useEffect } from 'react';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import {
  getPromptDefaults, savePromptDefault, resetPromptDefault,
  getAgentProviderHints, saveAgentProviderHint,
  getAgentModelAssignments, saveAgentModelAssignment,
  type ProviderHint,
} from '@/agents/promptDefaults';
import { DEFAULT_MODEL_CATALOG } from '@/agents/modelCatalog';
import type { ModelCatalogEntry } from '@/types/model.types';
import { DOMAINS, getDomain } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import {
  getDomainKnowledgeDefaults,
  saveDomainKnowledgeDefault,
  resetDomainKnowledgeDefault,
} from '@/agents/domainKnowledgeDefaults';
import {
  listProjects,
  restoreProject,
  deleteProject,
  exportAllProjects,
  subscribeProjectRepositoryChange,
  checkIsAppAdmin,
} from '@/db/projectRepository';
import { api, getAuthHeader, getProxyToken, type ProviderTestResult } from '@/services/api';
import {
  getAppConfigValue,
  setAppConfigValue,
} from '@/services/appStateApi';
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
async function saveBackendSettings(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const authHeader = await getAuthHeader();
  const proxyToken = getProxyToken();
  const res = await fetch(`${API_URL}/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(!authHeader.Authorization && proxyToken ? { 'X-API-Token': proxyToken } : {}),
    },
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

  // Email (Gmail SMTP) tab state
  const [gmailUser, setGmailUser]               = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [appUrl, setAppUrl]                     = useState('');
  const [showGmailPassword, setShowGmailPassword] = useState(false);
  const [emailSaving, setEmailSaving]           = useState(false);
  const [emailMsg, setEmailMsg]                 = useState('');
  const [emailErr, setEmailErr]                 = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showToken, setShowToken]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [saveErr, setSaveErr]     = useState('');

  // Claude (Anthropic) provider state
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [huggingfaceApiKey, setHuggingfaceApiKey] = useState('');
  const [showHfApiKey, setShowHfApiKey] = useState(false);
  const [claudeModel, setClaudeModel]   = useState('claude-sonnet-4-6');
  const [claudeEnabled, setClaudeEnabled] = useState(false);
  const [showClaudeApiKey, setShowClaudeApiKey] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState<'openai' | 'claude'>('openai');
  const [agentProviderHints, setAgentProviderHints] = useState<Partial<Record<AgentId, ProviderHint>>>({});

  // Model catalog (paid + free/open, incl. Hugging Face) + per-agent model
  // assignments — a specific catalog entry an agent is pinned to, which
  // takes priority over the openai/claude hint above (see pipelineEngine.ts).
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>(DEFAULT_MODEL_CATALOG);
  const [agentModelAssignments, setAgentModelAssignments] = useState<Partial<Record<AgentId, string>>>({});
  const [catalogSaveMsg, setCatalogSaveMsg] = useState('');

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

  // Add new domain (Domains tab) state
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomainId, setNewDomainId] = useState('');
  const [newDomainLabel, setNewDomainLabel] = useState('');
  const [newDomainColor, setNewDomainColor] = useState('#2563eb');
  const [newDomainBgColor, setNewDomainBgColor] = useState('#dbeafe');
  const [newDomainContext, setNewDomainContext] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [addDomainErr, setAddDomainErr] = useState('');

  // Projects tab state
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [allProjectSummaries, setAllProjectSummaries] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [isAppAdminUser, setIsAppAdminUser] = useState(false);

  // Derived project counts and views
  const archivedCount = allProjectSummaries.filter((p) => !!p.archived).length;
  const visibleProjects = allProjectSummaries.filter((p) =>
    showArchivedProjects ? !!p.archived : !p.archived
  );

  // Load persisted app config from the backend app-state store on mount
  useEffect(() => {
    (async () => {
      const [storedModel, storedTheme, defaults, domainDefaults, providerHints, storedCatalog, modelAssignments] = await Promise.all([
        getAppConfigValue<string>('app:model', 'gpt-4o'),
        getAppConfigValue<Theme>('app:theme', 'dark'),
        getPromptDefaults(),
        getDomainKnowledgeDefaults(),
        getAgentProviderHints(),
        getAppConfigValue<ModelCatalogEntry[]>('app:modelCatalog', DEFAULT_MODEL_CATALOG),
        getAgentModelAssignments(),
      ]);
      if (storedModel) setModel(storedModel);
      if (storedTheme) setTheme(storedTheme);
      setPromptDefaults(defaults);
      setDomainKnowledgeDefaults(domainDefaults);
      setAgentProviderHints(providerHints);
      setModelCatalog(storedCatalog && storedCatalog.length > 0 ? storedCatalog : DEFAULT_MODEL_CATALOG);
      setAgentModelAssignments(modelAssignments);
    })();

    // Read current Claude/provider + Gmail config from the backend .env
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
          if (cfg.gmailUser) setGmailUser(cfg.gmailUser);
          if (cfg.appUrl)    setAppUrl(cfg.appUrl);
        }
      } catch {
        // Backend unreachable — leave defaults as-is.
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const projects = await listProjects();
        if (active) setAllProjectSummaries(projects);
      } catch {
        if (active) setAllProjectSummaries([]);
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
  }, []);

  // Delete/restore in the Projects tab below are app-admin gated server-side
  // (server/src/middleware/auth.ts requireAppAdmin) — this just controls
  // whether the UI shows the controls at all.
  useEffect(() => {
    checkIsAppAdmin().then(setIsAppAdminUser);
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

  // ── Add a brand-new domain (e.g. "Logistics") to the catalog ───────────────
  // Writes to the backend's master_domains table (admin-only) and, on success,
  // mutates the shared DOMAINS object in place so it shows up everywhere in
  // the app immediately — the same pattern masterDataCatalog.ts's applyCatalog()
  // already uses to hydrate DOMAINS from the backend at app load.
  async function handleAddDomain() {
    setAddDomainErr('');
    const id = newDomainId.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z][a-z0-9_-]{1,49}$/.test(id)) {
      setAddDomainErr('Domain ID must be 2-50 characters, start with a letter, and use only lowercase letters, numbers, "-", or "_".');
      return;
    }
    if (DOMAINS[id as DomainId]) {
      setAddDomainErr(`A domain with ID "${id}" already exists.`);
      return;
    }
    if (!newDomainLabel.trim()) {
      setAddDomainErr('Label is required.');
      return;
    }
    if (!newDomainContext.trim()) {
      setAddDomainErr('Domain context is required — describe the key concerns agents should account for.');
      return;
    }
    setAddingDomain(true);
    try {
      const authHeader = await getAuthHeader();
      const proxyToken = getProxyToken();
      const res = await fetch(`${API_URL}/master-data/domains/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...(!authHeader.Authorization && proxyToken ? { 'X-API-Token': proxyToken } : {}),
        },
        body: JSON.stringify({
          label: newDomainLabel.trim(),
          color: newDomainColor,
          bgColor: newDomainBgColor,
          context: newDomainContext.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      DOMAINS[id as DomainId] = {
        id: id as DomainId,
        label: newDomainLabel.trim(),
        color: newDomainColor,
        bgColor: newDomainBgColor,
        context: newDomainContext.trim(),
      };
      setNewDomainId('');
      setNewDomainLabel('');
      setNewDomainContext('');
      setNewDomainColor('#2563eb');
      setNewDomainBgColor('#dbeafe');
      setShowAddDomain(false);
      setSelectedDomain(id as DomainId);
      setDomainSaveMsg(`✓ Added "${newDomainLabel.trim()}" domain`);
      setTimeout(() => setDomainSaveMsg(''), 2500);
    } catch (err) {
      setAddDomainErr(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingDomain(false);
    }
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
        domainLabel: getDomain(selectedDomain).label,
        domainTemplate: DOMAIN_KNOWLEDGE_TEMPLATES[selectedDomain] ?? '',
        projectName: `${getDomain(selectedDomain).label} (app-level default)`,
        projectDescription: `A general-purpose ${getDomain(selectedDomain).label} project. This brief will be used as the app-wide starting point for all new ${getDomain(selectedDomain).label} projects, so keep it broadly applicable rather than tied to one specific product.`,
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
      if (huggingfaceApiKey.trim()) payload.huggingfaceApiKey = huggingfaceApiKey.trim();

      await setAppConfigValue('app:model', model);

      const result = await saveBackendSettings(payload);
      if (result.ok) {
        setSaveMsg(result.message ?? 'Settings saved.');
        setApiKey('');
        setProxyToken('');
        setClaudeApiKey('');
        setHuggingfaceApiKey('');
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
    setEmailSaving(true);
    setEmailMsg('');
    setEmailErr('');
    try {
      const payload: Record<string, unknown> = {};
      if (gmailUser.trim())        payload.gmailUser        = gmailUser.trim();
      if (gmailAppPassword.trim()) payload.gmailAppPassword = gmailAppPassword.trim();
      if (appUrl.trim())           payload.appUrl           = appUrl.trim();

      const result = await saveBackendSettings(payload);
      if (result.ok) {
        setEmailMsg(result.message ?? 'Email settings saved. Restart the backend to apply.');
        setGmailAppPassword('');
      } else {
        setEmailErr(result.error ?? 'Save failed.');
      }
    } catch {
      setEmailErr('Backend unreachable — is the proxy running?');
    } finally {
      setEmailSaving(false);
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
      // Non-fatal — the frontend hint still takes effect via the
      // `provider` field sent with each /api/agent request.
    }
  }

  // ── Model catalog (paid + free/open, incl. Hugging Face) ──────────────────
  async function pushModelCatalogToBackend(catalog: ModelCatalogEntry[]) {
    // The backend's resolveDispatchTarget() looks up MODEL_CATALOG entries by
    // id (from its own .env-persisted JSON, read once at process start) — so
    // any catalog change here needs to reach it, or an assignment will
    // silently fall back to the default provider server-side until the next
    // manual backend restart anyway. Non-fatal: the catalog is still saved
    // app-side and will sync on the next successful save.
    try {
      await saveBackendSettings({ modelCatalog: catalog });
      setCatalogSaveMsg('Saved. Restart the backend for the change to take effect.');
    } catch {
      setCatalogSaveMsg('Saved locally — backend sync failed (is the proxy running?).');
    }
  }

  async function toggleModelEnabled(id: string) {
    const next = modelCatalog.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
    setModelCatalog(next);
    setCatalogSaveMsg('');
    await setAppConfigValue('app:modelCatalog', next);
    await pushModelCatalogToBackend(next);
  }

  // A per-agent dropdown selection is either a legacy provider hint
  // ('auto'/'openai'/'claude') or a MODEL_CATALOG entry id. Route to the
  // right persistence path and keep the two mutually exclusive per agent —
  // whichever was picked most recently wins, so there's no silent
  // disagreement between an old hint and a new model assignment (or vice
  // versa) the next time this agent runs.
  async function handleAgentModelChange(agentId: AgentId, value: string) {
    const isCatalogId = modelCatalog.some((m) => m.id === value);
    if (isCatalogId) {
      await saveAgentModelAssignment(agentId, value);
      setAgentModelAssignments((prev) => ({ ...prev, [agentId]: value }));
      await saveAgentProviderHint(agentId, 'auto');
      setAgentProviderHints((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } else {
      await saveAgentModelAssignment(agentId, undefined);
      setAgentModelAssignments((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
      await handleAgentProviderHintChange(agentId, value as ProviderHint);
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
    await setAppConfigValue('app:theme', t);
    setThemeSaved(true);
    setTimeout(() => setThemeSaved(false), 2000);
  }

  // ─── Projects tab ────────────────────────────────────────────────────────
  // Delete here is a soft delete (server flips `archived`, keeps the row) —
  // app-admin only and requires remarks, enforced server-side. Restore clears
  // the archive fields. Both call the same repository functions used by the
  // Dashboard and Admin Panel so there is a single delete/restore code path.
  async function handleRestoreProject(projectId: string) {
    await restoreProject(projectId);
  }

  async function handleDeleteProject(projectId: string, name: string) {
    const remarks = window.prompt(`Delete "${name}"? Enter a reason (required). The project can be restored later.`);
    if (!remarks || !remarks.trim()) return;
    await deleteProject(projectId, remarks.trim());
  }

  // Export the backend-backed project data as a JSON backup from the server source of truth.
  async function handleExportLocalData() {
    setExporting(true);
    setExportMsg(null);
    try {
      const payload = await exportAllProjects();
      const blob = new Blob(
        [payload],
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
      setExportMsg(`Exported ${allProjectSummaries.length} project${allProjectSummaries.length !== 1 ? 's' : ''} successfully.`);
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

              <div className={styles.fieldGroup} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <label className={styles.fieldLabel}>Hugging Face API Key</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showHfApiKey ? 'text' : 'password'}
                    value={huggingfaceApiKey}
                    onChange={(e) => setHuggingfaceApiKey(e.target.value)}
                    placeholder="hf_… (leave blank to keep current)"
                    autoComplete="off"
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowHfApiKey((v) => !v)}>
                    {showHfApiKey ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>
                  A fine-grained Hugging Face token with the "Make calls to Inference Providers" permission. Stored in
                  backend/.env as HUGGINGFACE_API_KEY. Required before enabling any Hugging Face model below. Restart the
                  backend after saving.
                </span>
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

              {(apiKey.trim() || proxyToken.trim() || claudeApiKey.trim() || huggingfaceApiKey.trim()) && (
                <div className={styles.restartHint}>
                  ⚠ After saving new API keys, restart the backend server for changes to take effect (<code>npm start</code> in the <code>backend/</code> folder).
                </div>
              )}

              <div className={styles.fieldGroup} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <label className={styles.fieldLabel}>Models (free/open, incl. Hugging Face)</label>
                <span className={styles.fieldHint}>
                  Enable a model here before it can be assigned to an agent below. Free/open models route through Hugging Face
                  Inference Providers (or another OpenAI-compatible gateway) — set the Hugging Face API Key above before
                  enabling any Hugging Face entry.
                </span>
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {modelCatalog.filter((m) => m.providerType !== 'anthropic' && m.providerType !== 'openai').map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{m.label}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.15rem' }}>{m.costTier} · {m.contextWindow.toLocaleString()} ctx · {m.capabilities.join(', ')}</div>
                        {m.reliabilityNote && (
                          <div style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: '0.2rem', maxWidth: 480 }}>{m.reliabilityNote}</div>
                        )}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                        <input type="checkbox" checked={m.enabled} onChange={() => toggleModelEnabled(m.id)} />
                        <span style={{ fontSize: '0.8rem' }}>{m.enabled ? 'Enabled' : 'Disabled'}</span>
                      </label>
                    </div>
                  ))}
                </div>
                {catalogSaveMsg && <div className={styles.fieldHint} style={{ marginTop: '0.5rem' }}>{catalogSaveMsg}</div>}
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <label className={styles.fieldLabel}>Per-Agent Provider Routing</label>
                <span className={styles.fieldHint}>
                  Override which provider (or specific enabled model) handles each agent. "Auto" follows the default provider above.
                  If the run fails on a non-default provider or model, it automatically falls back to the default OpenAI model once.
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
                            value={agentModelAssignments[agentId] ?? agentProviderHints[agentId] ?? 'auto'}
                            onChange={(e) => handleAgentModelChange(agentId, e.target.value)}
                          >
                            {PROVIDER_HINT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value} disabled={opt.value === 'claude' && !claudeEnabled}>
                                {opt.label}{opt.value === 'claude' && !claudeEnabled ? ' (enable Claude above first)' : ''}
                              </option>
                            ))}
                            {modelCatalog.filter((m) => m.enabled && m.providerType === 'openai-compatible').map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
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
                Invite emails are sent via <strong>Gmail SMTP</strong>, using a Gmail address and an App Password
                (not your regular Gmail password). Without a Gmail address + App Password, invite links are still
                generated and logged to the backend console — you can copy-paste them manually.
              </p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Gmail Address</label>
                <input
                  type="email"
                  value={gmailUser}
                  onChange={(e) => setGmailUser(e.target.value)}
                  placeholder="you@gmail.com"
                  autoComplete="off"
                />
                <span className={styles.fieldHint}>
                  The Gmail account invite emails will be sent from. Stored in backend/.env as GMAIL_USER.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Gmail App Password</label>
                <div className={styles.passwordInput}>
                  <input
                    type={showGmailPassword ? 'text' : 'password'}
                    value={gmailAppPassword}
                    onChange={(e) => setGmailAppPassword(e.target.value)}
                    placeholder="16-character app password (leave blank to keep current)"
                    autoComplete="off"
                  />
                  <button className={styles.eyeBtn} onClick={() => setShowGmailPassword((v) => !v)}>
                    {showGmailPassword ? '🙈' : '👁'}
                  </button>
                </div>
                <span className={styles.fieldHint}>
                  Generate one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>myaccount.google.com/apppasswords</a> —
                  requires 2-Step Verification to be enabled on the Gmail account. This is <em>not</em> the account's regular
                  sign-in password. Stored in backend/.env as GMAIL_APP_PASSWORD. Restart the backend after saving.
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
                    <li>Enable <strong>2-Step Verification</strong> on the Gmail account (required for App Passwords)</li>
                    <li>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>myaccount.google.com/apppasswords</a> and create a new App Password</li>
                    <li>Enter the Gmail address above and paste the App Password (not your login password)</li>
                    <li>Set the App URL, then click Save</li>
                    <li>Restart the backend: <code>cd backend && npm start</code></li>
                  </ol>
                  <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                    Note: a regular Gmail account is limited to ~500 sends/day (~2,000/day on Google Workspace).
                  </div>
                </div>
              </div>

              {gmailAppPassword.trim() && (
                <div className={styles.restartHint}>
                  ⚠ After saving a new App Password, restart the backend server for it to take effect.
                </div>
              )}

              <div className={styles.fieldGroup}>
                <button className="btn-primary" onClick={handleSaveEmail} disabled={emailSaving}>
                  {emailSaving ? 'Saving…' : 'Save Email Settings'}
                </button>
                {emailMsg && <p style={{ fontSize: 12, color: 'var(--success)', marginTop: '0.5rem' }}>✓ {emailMsg}</p>}
                {emailErr && <p style={{ fontSize: 12, color: 'var(--error)', marginTop: '0.5rem' }}>✗ {emailErr}</p>}
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

              {isAppAdminUser && (
                <div style={{ marginBottom: 12 }}>
                  {!showAddDomain ? (
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setShowAddDomain(true)}>
                      + Add new domain
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                      <span className={styles.fieldLabel}>New Domain</span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          placeholder="ID (e.g. aerospace)"
                          value={newDomainId}
                          onChange={(e) => setNewDomainId(e.target.value)}
                          style={{ flex: '1 1 160px' }}
                        />
                        <input
                          type="text"
                          placeholder="Label (e.g. Aerospace)"
                          value={newDomainLabel}
                          onChange={(e) => setNewDomainLabel(e.target.value)}
                          style={{ flex: '1 1 160px' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          Color
                          <input type="color" value={newDomainColor} onChange={(e) => setNewDomainColor(e.target.value)} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          Background
                          <input type="color" value={newDomainBgColor} onChange={(e) => setNewDomainBgColor(e.target.value)} />
                        </label>
                      </div>
                      <textarea
                        className={styles.promptTextarea}
                        placeholder="Domain context injected into every agent prompt — key concerns, standards, integrations for this industry..."
                        value={newDomainContext}
                        onChange={(e) => setNewDomainContext(e.target.value)}
                        rows={4}
                      />
                      {addDomainErr && <span className={styles.errorMsg}>⚠ {addDomainErr}</span>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-primary" onClick={handleAddDomain} disabled={addingDomain}>
                          {addingDomain ? 'Adding...' : '💾 Add domain'}
                        </button>
                        <button className="btn-secondary" onClick={() => { setShowAddDomain(false); setAddDomainErr(''); }} disabled={addingDomain}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className={styles.promptsLayout}>
                <div className={styles.promptAgentList}>
                  {allDomainIds.map((domainId) => {
                    const domainDef = getDomain(domainId);
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
                      style={{ color: getDomain(selectedDomain).color, background: getDomain(selectedDomain).bgColor }}
                    >
                      {getDomain(selectedDomain).label}
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
                  title="Download all backend projects as a JSON backup from the server source of truth."
                >
                  {exporting ? 'Exporting…' : '⬇ Export backend data'}
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
                    {isAppAdminUser ? (
                      <div className={styles.projectRowActions}>
                        {p.archived ? (
                          <button
                            className="btn-secondary"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => handleRestoreProject(p.id)}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            className="btn-secondary"
                            style={{ fontSize: 11, padding: '2px 8px', color: 'var(--error)' }}
                            onClick={() => handleDeleteProject(p.id, p.name)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }} title="Only app admins can delete or restore projects">
                        {p.archived ? 'Archived' : ''}
                      </span>
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
