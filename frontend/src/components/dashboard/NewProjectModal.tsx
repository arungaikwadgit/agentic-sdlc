/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState } from 'react';
import { createProject } from '@/db/projectRepository';
import { api } from '@/services/api';
import { DOMAINS } from '@/agents/domains';
import { getEffectiveDomainKnowledgeDefault } from '@/agents/domainKnowledgeDefaults';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import type { DomainId } from '@/types/domain.types';
import type { ProjectPriority, ProjectType } from '@/types/project.types';
import styles from './NewProjectModal.module.css';

const PROJECT_TYPES: { value: ProjectType; label: string }[] = [
  { value: 'web-app', label: 'Web App' },
  { value: 'mobile-app', label: 'Mobile App' },
  { value: 'api-backend', label: 'API / Backend' },
  { value: 'internal-tool', label: 'Internal Tool' },
  { value: 'data-ml', label: 'Data / ML Pipeline' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES: { value: ProjectPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// Suggestions shown while typing in the Tech Stack field (native <datalist>).
// Purely advisory — the field accepts any free-text value, listed or not.
const TECH_STACK_SUGGESTIONS = [
  'React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'TypeScript', 'JavaScript',
  'Node.js', 'Express', 'NestJS', 'Python', 'Django', 'FastAPI', 'Flask',
  'Java', 'Spring Boot', 'Go', 'Ruby on Rails', '.NET / C#', 'PHP / Laravel',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Supabase', 'Firebase',
  'GraphQL', 'REST API', 'gRPC', 'Docker', 'Kubernetes', 'AWS', 'Azure',
  'Google Cloud Platform', 'Vercel', 'Railway', 'Terraform', 'Kafka',
  'RabbitMQ', 'Elasticsearch', 'Tailwind CSS', 'React Native', 'Flutter',
  'Swift / SwiftUI', 'Kotlin', 'GitHub Actions', 'Stripe',
];

const PRESETS = [
  {
    name: 'FinPay — Payment Processing Platform',
    description: 'A B2B payment processing platform supporting multi-currency transactions, real-time fraud detection, and PCI-DSS compliant data handling for SME merchants.',
    domain: 'fintech' as DomainId,
  },
  {
    name: 'HealthTrack — Patient Portal',
    description: 'A HIPAA-compliant patient portal enabling appointment scheduling, EHR access, telemedicine consultations, and prescription management for a regional hospital network.',
    domain: 'healthcare' as DomainId,
  },
  {
    name: 'ShopFlow — E-Commerce Platform',
    description: 'A scalable multi-vendor e-commerce platform with AI-powered product recommendations, real-time inventory sync, and omnichannel order management.',
    domain: 'ecommerce' as DomainId,
  },
  {
    name: 'TeamSync — Project Management SaaS',
    description: 'A multi-tenant SaaS project management tool with Kanban boards, sprint planning, time tracking, and Slack/Jira integrations for remote software teams.',
    domain: 'saas' as DomainId,
  },
  {
    name: 'LearnPath — Adaptive LMS',
    description: 'An adaptive learning management system with SCORM compliance, AI-driven learning paths, gamification, and analytics for K-12 school districts.',
    domain: 'edtech' as DomainId,
  },
];

type Step = 'details' | 'domain-knowledge';

interface Props {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState<DomainId>('saas');
  const [mode, setMode] = useState<'simple' | 'expert'>('simple');
  const [domainKnowledge, setDomainKnowledge] = useState('');
  const [brandingGuidelines, setBrandingGuidelines] = useState('');
  const [loading, setLoading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  // Figma pull state
  const [showFigmaPull, setShowFigmaPull] = useState(false);
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [figmaLoading, setFigmaLoading] = useState(false);
  const [figmaError, setFigmaError] = useState<string | null>(null);
  const [figmaDone, setFigmaDone] = useState(false);

  // New project metadata fields
  const [owner, setOwner] = useState('');
  const [team, setTeam] = useState('');
  const [projectType, setProjectType] = useState<ProjectType | ''>('');
  const [priority, setPriority] = useState<ProjectPriority>('medium');
  const [startDate, setStartDate] = useState('');

  async function pullFigmaStyles() {
    setFigmaLoading(true);
    setFigmaError(null);
    setFigmaDone(false);
    try {
      // Extract file key from Figma URL — supports both /file/ and /design/ paths
      const match = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9_-]+)/);
      if (!match) {
        setFigmaError('Could not parse Figma file key from URL. Use a link like https://www.figma.com/file/ABC123/...');
        return;
      }
      const fileKey = match[1];
      const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
      const { getAuthHeader } = await import('@/services/api');
      const resp = await fetch(`${API}/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ fileKey, token: figmaToken }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setFigmaError(data.error ?? 'Figma request failed');
        return;
      }
      const { colors, typography } = data as {
        colors: { name: string; hex: string; opacity: number }[];
        typography: { name: string; fontFamily: string; fontSize: number | null; fontWeight: number | null }[];
      };
      // Format extracted tokens into the branding guidelines textarea
      const lines: string[] = ['## Figma Design Tokens (auto-imported)'];
      if (colors.length > 0) {
        lines.push('\n### Color Palette');
        for (const c of colors.slice(0, 20)) {
          lines.push(`- **${c.name}**: ${c.hex}${c.opacity < 100 ? ` (${c.opacity}% opacity)` : ''}`);
        }
      }
      if (typography.length > 0) {
        lines.push('\n### Typography');
        const seen = new Set<string>();
        for (const t of typography) {
          const key = t.fontFamily;
          if (!seen.has(key)) {
            seen.add(key);
            const detail = [t.fontFamily, t.fontSize ? `${t.fontSize}px` : '', t.fontWeight ? `weight ${t.fontWeight}` : ''].filter(Boolean).join(', ');
            lines.push(`- **${t.name}**: ${detail}`);
          }
        }
      }
      setBrandingGuidelines((prev) =>
        prev.trim() ? prev.trim() + '\n\n' + lines.join('\n') : lines.join('\n')
      );
      setFigmaDone(true);
      setShowFigmaPull(false);
    } catch (e) {
      setFigmaError(`Error: ${String(e)}`);
    } finally {
      setFigmaLoading(false);
    }
  }
  const [targetEndDate, setTargetEndDate] = useState('');
  const [techTags, setTechTags]   = useState<string[]>([]);
  const [techInput, setTechInput] = useState('');
  const [targetUsers, setTargetUsers] = useState('');
  const [initialRisks, setInitialRisks] = useState('');
  const [dateError, setDateError] = useState('');

  function applyPreset(preset: typeof PRESETS[0]) {
    setName(preset.name);
    setDescription(preset.description);
    setDomain(preset.domain);
  }

  // Fetches the app-level domain knowledge default; falls back to the hardcoded
  // template on any failure (network, auth, backend unreachable, etc.) so a
  // config-fetch error never blocks project creation.
  async function safeGetDomainKnowledgeDefault(domainId: DomainId): Promise<string> {
    try {
      return await getEffectiveDomainKnowledgeDefault(domainId);
    } catch (err) {
      console.warn('Failed to load app-level domain knowledge default, using built-in template.', err);
      return DOMAIN_KNOWLEDGE_TEMPLATES[domainId] ?? '';
    }
  }

  async function handleDomainChange(newDomain: DomainId) {
    setDomain(newDomain);
    // Reset domain knowledge to the app-level default for the new domain (falls back to built-in template)
    setDomainKnowledge(await safeGetDomainKnowledgeDefault(newDomain));
  }

  // All Step 1 fields are mandatory except Branding Guidelines (explicitly
  // optional — it can be pulled from Figma or added later in Project Settings).
  function detailsValid(): boolean {
    return !!(
      name.trim() &&
      owner.trim() &&
      team.trim() &&
      description.trim() &&
      projectType &&
      startDate &&
      targetEndDate &&
      !dateError &&
      techTags.length > 0 &&
      targetUsers.trim() &&
      initialRisks.trim()
    );
  }

  async function goToKnowledge() {
    if (!detailsValid()) return;
    // Pre-fill from the app-level default (or built-in template) if not yet customized
    if (!domainKnowledge) setDomainKnowledge(await safeGetDomainKnowledgeDefault(domain));
    setStep('domain-knowledge');
  }

  function handleDownloadTemplate() {
    const blob = new Blob([domainKnowledge], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `domain-knowledge-${domain}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleTargetEndDateChange(value: string) {
    setTargetEndDate(value);
    if (startDate && value && value < startDate) {
      setDateError('Target end date must be on or after the start date.');
    } else {
      setDateError('');
    }
  }

  // Shared payload builder so "Save for the project" and "Enhance the prompt
  // and Run" can't drift apart on which fields get sent to createProject().
  function buildProjectPayload(finalDomainKnowledge: string) {
    return {
      name: name.trim(),
      description: description.trim(),
      domain,
      status: 'draft' as const,
      mode,
      domainKnowledge: finalDomainKnowledge.trim() || undefined,
      brandingGuidelines: brandingGuidelines.trim() || undefined,
      owner: owner.trim(),
      team: team.trim() || undefined,
      projectType: projectType || undefined,
      priority,
      startDate: startDate || undefined,
      targetEndDate: targetEndDate || undefined,
      techStack: techTags.join(', ') || undefined,
      targetUsers: targetUsers.trim() || undefined,
      initialRisks: initialRisks.trim() || undefined,
    };
  }

  /** "Save for the project" — creates the project as-is: no AI enhancement,
   *  no auto-run. Same behavior in both Simple and Expert mode. */
  async function handleCreate() {
    if (!detailsValid()) return;
    setLoading(true);
    try {
      const project = await createProject(buildProjectPayload(domainKnowledge));
      onCreated(project.id);
    } finally {
      setLoading(false);
    }
  }

  /** "Enhance the prompt and Run" (Simple mode only) — asks the AI to improve
   *  the domain knowledge brief using the same generator ProjectSettings uses,
   *  saves the improved version into the new project, then flags it to
   *  auto-start the full pipeline on first load (same sessionStorage signal
   *  EditProjectModal's "Save & Restart Pipeline" uses) so Simple-mode users
   *  land directly in a running pipeline instead of an idle draft. */
  async function handleEnhanceAndRun() {
    if (!detailsValid()) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      let finalKnowledge = domainKnowledge;
      try {
        const generated = await api.generateDomainKnowledge({
          domainLabel: DOMAINS[domain].label,
          domainTemplate: DOMAIN_KNOWLEDGE_TEMPLATES[domain],
          projectName: name,
          projectDescription: description,
          currentInput: domainKnowledge,
        });
        if (generated) {
          finalKnowledge = generated;
          setDomainKnowledge(generated);
        }
      } catch (err) {
        // Enhancement failing shouldn't block project creation — fall back to
        // the brief as the user wrote it and surface a non-blocking notice.
        setEnhanceError(
          `Couldn't enhance the brief (${err instanceof Error ? err.message : 'unknown error'}) — creating with your text as written.`
        );
      }
      setLoading(true);
      const project = await createProject(buildProjectPayload(finalKnowledge));
      sessionStorage.setItem(`sdlc_autostart_${project.id}`, '1');
      onCreated(project.id);
    } finally {
      setEnhancing(false);
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {step === 'domain-knowledge' && (
              <button className={styles.close} onClick={() => setStep('details')} aria-label="Back" style={{ fontSize: 14 }}>←</button>
            )}
            <div>
              <h2>{step === 'details' ? 'New Project' : 'Domain Knowledge'}</h2>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Step {step === 'details' ? '1' : '2'} of 2
              </p>
            </div>
          </div>
          <button onClick={onClose} className={styles.close} aria-label="Close">✕</button>
        </div>

        {step === 'details' ? (
          <>
            <div className={styles.body}>
              <section>
                <label className={styles.label}>Sample Projects</label>
                <div className={styles.presets}>
                  {PRESETS.map((p) => (
                    <button key={p.name} className={styles.preset} onClick={() => applyPreset(p)}>
                      <span className={styles.presetDomain}
                        style={{ color: DOMAINS[p.domain].color, background: DOMAINS[p.domain].bgColor }}>
                        {DOMAINS[p.domain].label}
                      </span>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              <label className={styles.label}>Project Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Payment Processing Platform"
                maxLength={100}
              />

              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Owner *</label>
                  <input
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className={styles.label}>Team *</label>
                  <input
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="e.g. Platform Squad"
                    maxLength={100}
                  />
                </div>
              </div>

              <label className={styles.label}>Problem Statement *</label>
              <textarea
                className={styles.formTextarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project goals, target users, and key capabilities... (at least a few sentences)"
                rows={10}
                style={{ resize: 'vertical', minHeight: 160, height: 160 }}
              />

              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Project Type *</label>
                  <select value={projectType} onChange={(e) => setProjectType(e.target.value as ProjectType | '')}>
                    <option value="">Select a project type…</option>
                    {PROJECT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.label}>Priority *</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as ProjectPriority)}>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Start Date *</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className={styles.label}>Target End Date *</label>
                  <input
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => handleTargetEndDateChange(e.target.value)}
                  />
                  {dateError && <p className={styles.fieldError}>{dateError}</p>}
                </div>
              </div>

              <label className={styles.label}>Domain *</label>
              <select value={domain} onChange={(e) => handleDomainChange(e.target.value as DomainId)}>
                {Object.values(DOMAINS).map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <p className={styles.hint}>
                <strong>{DOMAINS[domain].label}</strong> — confirm domain-specific obligations during discovery.
              </p>

              <label className={styles.label}>Tech Stack *</label>
              {techTags.length > 0 && (
                <div className={styles.techTagList}>
                  {techTags.map((tag) => (
                    <span key={tag} className={styles.techTag}>
                      {tag}
                      <button
                        className={styles.techTagRemove}
                        type="button"
                        onClick={() => setTechTags((prev) => prev.filter((t) => t !== tag))}
                        aria-label={`Remove ${tag}`}
                      >✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.techInputRow}>
                <input
                  className={styles.techInput}
                  value={techInput}
                  list="tech-stack-suggestions"
                  onChange={(e) => setTechInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = techInput.trim();
                      if (val && !techTags.includes(val)) setTechTags((prev) => [...prev, val]);
                      setTechInput('');
                    }
                  }}
                  placeholder="e.g. React, Node.js, PostgreSQL, Docker… (Enter to add)"
                />
                <datalist id="tech-stack-suggestions">
                  {TECH_STACK_SUGGESTIONS.filter((t) => !techTags.includes(t)).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className={styles.techAddBtn}
                  disabled={!techInput.trim()}
                  onClick={() => {
                    const val = techInput.trim();
                    if (val && !techTags.includes(val)) setTechTags((prev) => [...prev, val]);
                    setTechInput('');
                  }}
                >Add</button>
              </div>

              <label className={styles.label}>Target Users *</label>
              <textarea
                className={styles.formTextarea}
                value={targetUsers}
                onChange={(e) => setTargetUsers(e.target.value)}
                placeholder="Who will use this product day-to-day?"
                rows={3}
              />

              <label className={styles.label}>Initial Risks *</label>
              <textarea
                className={styles.formTextarea}
                value={initialRisks}
                onChange={(e) => setInitialRisks(e.target.value)}
                placeholder="Known risks, dependencies, or open questions"
                rows={3}
              />

              <label className={styles.label}>Mode</label>
              <div className={styles.modeToggle}>
                <button
                  className={mode === 'simple' ? styles.modeActive : styles.modeInactive}
                  onClick={() => setMode('simple')}
                >
                  Simple
                </button>
                <button
                  className={mode === 'expert' ? styles.modeActive : styles.modeInactive}
                  onClick={() => setMode('expert')}
                >
                  Expert
                </button>
              </div>
              <p className={styles.hint}>
                {mode === 'expert'
                  ? 'Expert mode enables review gates, role mapping, and prompt editing.'
                  : 'Simple mode runs the full pipeline automatically with review gates hidden.'}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className={styles.label} style={{ margin: 0 }}>Branding Guidelines (optional)</label>
                <button
                  type="button"
                  style={{
                    fontSize: 11, background: 'none', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '2px 8px', cursor: 'pointer',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                  onClick={() => { setShowFigmaPull((v) => !v); setFigmaError(null); }}
                >
                  🎨 Pull from Figma
                </button>
              </div>
              {showFigmaPull && (
                <div style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 8,
                }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    Paste your Figma file URL and a personal access token to import color styles and typography automatically.
                    <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noreferrer"
                      style={{ color: 'var(--accent)', marginLeft: 4 }}>How to get a token ↗</a>
                  </p>
                  <input
                    style={{ width: '100%', marginBottom: 6, padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12 }}
                    placeholder="https://www.figma.com/file/ABC123/My-Design-File"
                    value={figmaUrl}
                    onChange={(e) => setFigmaUrl(e.target.value)}
                  />
                  <input
                    type="password"
                    style={{ width: '100%', marginBottom: 8, padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12 }}
                    placeholder="Personal Access Token (figd_...)"
                    value={figmaToken}
                    onChange={(e) => setFigmaToken(e.target.value)}
                  />
                  {figmaError && <p style={{ fontSize: 11, color: 'var(--error)', margin: '0 0 6px' }}>⚠ {figmaError}</p>}
                  {figmaDone && <p style={{ fontSize: 11, color: 'var(--success)', margin: '0 0 6px' }}>✓ Tokens imported into Branding Guidelines.</p>}
                  <button
                    className="btn-primary"
                    style={{ fontSize: 12 }}
                    onClick={pullFigmaStyles}
                    disabled={figmaLoading || !figmaUrl.trim() || !figmaToken.trim()}
                  >
                    {figmaLoading ? '⟳ Importing…' : '⇩ Import tokens'}
                  </button>
                </div>
              )}
              <textarea
                className={styles.formTextarea}
                value={brandingGuidelines}
                onChange={(e) => setBrandingGuidelines(e.target.value)}
                placeholder="Brand colors, typography, tone of voice, logo/style references... Used by the UX Mockups agent to tailor design concepts. Leave blank to use domain/industry defaults."
                rows={4}
              />
              <p className={styles.hint}>
                You can add or edit this later in the project's Settings tab.
              </p>
            </div>

            <div className={styles.footer}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary"
                onClick={goToKnowledge}
                disabled={!detailsValid()}
                title={!detailsValid() ? 'Fill in all required fields (marked *) to continue.' : undefined}
              >
                Next: Domain Knowledge →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.body}>
              <div className={styles.knowledgeBanner}>
                <div>
                  <span
                    className={styles.domainChip}
                    style={{ color: DOMAINS[domain].color, background: DOMAINS[domain].bgColor }}
                  >
                    {DOMAINS[domain].label}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  This brief is pre-populated from the <strong>{DOMAINS[domain].label}</strong> template. Edit it to add your project-specific context — it will be prepended to every agent's system prompt automatically.
                </p>
              </div>

              <label className={styles.label}>Domain Knowledge Brief</label>
              <textarea
                className={styles.knowledgeTextarea}
                value={domainKnowledge}
                onChange={(e) => setDomainKnowledge(e.target.value)}
                rows={18}
                placeholder="Describe the domain context, regulatory requirements, architecture patterns, and integration landscape relevant to this project..."
                style={{ resize: 'vertical' }}
              />

              <div className={styles.knowledgeActions}>
                <button
                  onClick={async () => setDomainKnowledge(await safeGetDomainKnowledgeDefault(domain))}
                  style={{ fontSize: 12 }}
                >
                  ↺ Reset to template
                </button>
                <button
                  className="btn-secondary"
                  onClick={handleDownloadTemplate}
                  style={{ fontSize: 12 }}
                >
                  ↓ Download as .md
                </button>
              </div>

              <p className={styles.hint}>
                You can edit the domain knowledge later in the project's Settings tab.
              </p>
              {enhanceError && (
                <p className={styles.fieldError} style={{ marginTop: -4 }}>{enhanceError}</p>
              )}
            </div>

            <div className={styles.footer}>
              <button className="btn-secondary" onClick={() => setStep('details')}>← Back</button>
              {mode === 'simple' ? (
                <>
                  <button
                    className="btn-secondary"
                    onClick={handleCreate}
                    disabled={loading || enhancing}
                  >
                    {loading && !enhancing ? 'Saving...' : '💾 Save for the project'}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleEnhanceAndRun}
                    disabled={loading || enhancing}
                  >
                    {enhancing ? '✨ Enhancing…' : loading ? 'Starting…' : '✨ Enhance the prompt and Run'}
                  </button>
                </>
              ) : (
                <button
                  className="btn-primary"
                  onClick={handleCreate}
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create Project'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
