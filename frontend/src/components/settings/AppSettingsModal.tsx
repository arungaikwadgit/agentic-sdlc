import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { getPromptDefaults, savePromptDefault, resetPromptDefault } from '@/agents/promptDefaults';
import { DOMAINS } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import {
  getDomainKnowledgeDefaults,
  saveDomainKnowledgeDefault,
  resetDomainKnowledgeDefault,
} from '@/agents/domainKnowledgeDefaults';
import { listProjects, updateProject, restoreProject, deleteProject } from '@/db/projectRepository';
import * as api from '@/services/api';
import type { AgentId } from '@/types/agent.types';
import type { DomainId } from '@/types/domain.types';
import styles from './AppSettingsModal.module.css';

type Theme = 'dark' | 'light' | 'system';
type SettingsTab = 'api' | 'appearance' | 'prompts' | 'domains' | 'projects';

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

const API_URL  = (import.meta as any).env?.VITE_API_URL ?? '/api';
const PROXY_TOKEN = (import.meta as any).env?.VITE_PROXY_TOKEN ?? '';

async function saveBackendSettings(payload: Record<string, string>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(`${API_URL}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': PROXY_TOKEN },
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
  const [showApiKey, setShowApiKey] = useState(false);
  const [showToken, setShowToken]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [saveErr, setSaveErr]     = useState('');

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
  const allProjectSummaries = useLiveQuery(() => listProjects(), []) ?? [];
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveReasonDraft, setArchiveReasonDraft] = useState('');

  // Load persisted settings from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const [storedModel, storedTheme, defaults, domainDefaults] = await Promise.all([
        db.settings.get('app:model'),
        db.settings.get('app:theme'),
        getPromptDefaults(),
        getDomainKnowledgeDefaults(),
      ]);
      if (storedModel?.value) setModel(storedModel.value as string);
      if (storedTheme?.value) setTheme(storedTheme.value as Theme);
      setPromptDefaults(defaults);
      setDomainKnowledgeDefaults(domainDefaults);
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
      const payload: Record<string, string> = {};
      if (apiKey.trim())     payload.openaiApiKey = apiKey.trim();
      if (proxyToken.trim()) payload.proxyToken   = proxyToken.trim();
      if (model)             payload.openaiModel  = model;

      // Save model to IndexedDB (no restart needed, frontend reads it)
      await db.settings.put({ key: 'app:model', value: model });

      if (Object.keys(payload).length > 0) {
        const result = await saveBackendSettings(payload);
        if (result.ok) {
          setSaveMsg(result.message ?? 'Settings saved.');
          setApiKey('');
          setProxyToken('');
        } else {
          setSaveErr(result.error ?? 'Save failed.');
        }
      } else {
        setSaveMsg('Model preference saved.');
      }
    } catch (e) {
      setSaveErr('Backend unreachable — is the proxy running?');
    } finally {
      setSaving(false);
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

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.modal} ${tab === 'prompts' || tab === 'domains' || tab === 'projects' ? styles.modalWide : ''}`}>
        <div className={styles.header}>
          <h2>⚙ App Settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.tabs}>
          {(['api', 'appearance', 'prompts', 'domains', 'projects'] as SettingsTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'api' ? '🔑 API & Model'
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

              {(apiKey.trim() || proxyToken.trim()) && (
                <div className={styles.restartHint}>
                  ⚠ After saving new API keys, restart the backend server for changes to take effect (<code>npm start</code> in the <code>backend/</code> folder).
                </div>
              )}
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
              {(() => {
                const archivedCount = allProjectSummaries.filter((p) => p.archived).length;
                const visibleProjects = allProjectSummaries.filter((p) => (showArchivedProjects ? !!p.archived : !p.archived));
                return (
                  <>
                    <div className={styles.projectsToolbar}>
                      <span className={styles.fieldHint} style={{ margin: 0 }}>
                        {showArchivedProjects
                          ? 'Archived projects. Restore to make them active again, or delete permanently.'
                          : 'All active projects. Archive (soft delete, reversible) or permanently delete.'}
                      </span>
                      {archivedCount > 0 && (
                        <button className="btn-secondary" onClick={() => setShowArchivedProjects((v) => !v)}>
                          {showArchivedProjects ? '← Active Projects' : `Archived (${archivedCount})`}
                        </button>
                      )}
                    </div>

                    {visibleProjects.length === 0 ? (
                      <div className={styles.empty}>
                        {showArchivedProjects ? 'No archived projects.' : 'No projects yet.'}
                      </div>
                    ) : (
                      <div className={styles.projectList}>
                        {visibleProjects.map((p) => (
                          <div key={p.id} className={styles.projectRow}>
                            <div className={styles.projectInfo}>
                              <div className={styles.projectNameRow}>
                                <span className={styles.projectName}>{p.name}</span>
                                <span
                                  className={styles.domainChip}
                                  style={{ color: DOMAINS[p.domain]?.color, background: DOMAINS[p.domain]?.bgColor }}
                                >
                                  {DOMAINS[p.domain]?.label ?? p.domain}
                                </span>
                                <span className={styles.projectStatus}>
                                  {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                                </span>
                              </div>
                              <span className={styles.projectMeta}>
                                {p.completedAgents}/{p.totalAgents} agents ·{' '}
                                {showArchivedProjects && p.archivedAt
                                  ? `Archived ${new Date(p.archivedAt).toLocaleDateString()}`
                                  : `Updated ${new Date(p.updatedAt).toLocaleDateString()}`}
                              </span>
                              {showArchivedProjects && p.archivedReason && (
                                <span className={styles.projectMeta} style={{ fontStyle: 'italic' }}>
                                  {p.archivedBy ? `${p.archivedBy}: ` : ''}"{p.archivedReason}"
                                </span>
                              )}
                              {archivingId === p.id && (
                                <div className={styles.archiveInline}>
                                  <input
                                    type="text"
                                    placeholder="Reason for archiving (required)"
                                    value={archiveReasonDraft}
                                    onChange={(e) => setArchiveReasonDraft(e.target.value)}
                                    autoFocus
                                  />
                                  <button
                                    className="btn-primary"
                                    onClick={() => confirmArchive(p.id)}
                                    disabled={!archiveReasonDraft.trim()}
                                  >
                                    Confirm
                                  </button>
                                  <button className="btn-secondary" onClick={cancelArchive}>Cancel</button>
                                </div>
                              )}
                            </div>
                            <div className={styles.projectActions}>
                              {showArchivedProjects ? (
                                <button className="btn-secondary" onClick={() => handleRestoreProject(p.id)}>
                                  ↩ Restore
                                </button>
                              ) : (
                                archivingId !== p.id && (
                                  <button className="btn-secondary" onClick={() => startArchive(p.id)}>
                                    🗄 Archive
                                  </button>
                                )
                              )}
                              <button className="btn-danger" onClick={() => handleDeleteProject(p.id, p.name)}>
                                🗑 Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div>
            {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
            {saveErr && <span className={styles.errorMsg}>⚠ {saveErr}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose}>Close</button>
            {tab === 'api' && (
              <button className="btn-primary" onClick={handleSaveApi} disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
