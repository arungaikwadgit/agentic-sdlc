import { useState } from 'react';
import { createProject } from '@/db/projectRepository';
import { DOMAINS } from '@/agents/domains';
import { getEffectiveDomainKnowledgeDefault } from '@/agents/domainKnowledgeDefaults';
import type { DomainId } from '@/types/domain.types';
import styles from './NewProjectModal.module.css';

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

  function applyPreset(preset: typeof PRESETS[0]) {
    setName(preset.name);
    setDescription(preset.description);
    setDomain(preset.domain);
  }

  async function handleDomainChange(newDomain: DomainId) {
    setDomain(newDomain);
    // Reset domain knowledge to the app-level default for the new domain (falls back to built-in template)
    setDomainKnowledge(await getEffectiveDomainKnowledgeDefault(newDomain));
  }

  async function goToKnowledge() {
    if (!name.trim() || !description.trim()) return;
    // Pre-fill from the app-level default (or built-in template) if not yet customized
    if (!domainKnowledge) setDomainKnowledge(await getEffectiveDomainKnowledgeDefault(domain));
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

  async function handleCreate() {
    if (!name.trim() || !description.trim()) return;
    setLoading(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        domain,
        status: 'draft',
        mode,
        domainKnowledge: domainKnowledge.trim() || undefined,
        brandingGuidelines: brandingGuidelines.trim() || undefined,
      });
      onCreated(project.id);
    } finally {
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

              <label className={styles.label}>Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project goals, target users, and key capabilities..."
                rows={5}
                style={{ resize: 'vertical' }}
              />

              <label className={styles.label}>Domain</label>
              <select value={domain} onChange={(e) => handleDomainChange(e.target.value as DomainId)}>
                {Object.values(DOMAINS).map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>

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

              <label className={styles.label}>Branding Guidelines (optional)</label>
              <textarea
                value={brandingGuidelines}
                onChange={(e) => setBrandingGuidelines(e.target.value)}
                placeholder="Brand colors, typography, tone of voice, logo/style references... Used by the UX Mockups agent to tailor design concepts. Leave blank to use domain/industry defaults."
                rows={4}
                style={{ resize: 'vertical' }}
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
                disabled={!name.trim() || !description.trim()}
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
                  className="btn-secondary"
                  onClick={async () => setDomainKnowledge(await getEffectiveDomainKnowledgeDefault(domain))}
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
            </div>

            <div className={styles.footer}>
              <button className="btn-secondary" onClick={() => setStep('details')}>← Back</button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
