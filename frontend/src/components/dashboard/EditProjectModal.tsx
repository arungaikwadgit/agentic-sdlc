/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * EditProjectModal
 *
 * Edits core project details: name, description, domain, custom domain, and tech stack.
 *
 * Domain:     predefined category (badge + base context) + free-text custom label
 *             → custom label is synced into "## Domain" in domainKnowledge
 *
 * Tech Stack: tag-chip multi-select — pick from dropdown OR type free-form.
 *             New technologies are persisted to localStorage for future sessions.
 *             All selected tags are synced into "## Technology Stack" in domainKnowledge.
 *
 * Both sections in domainKnowledge are automatically prepended to every agent
 * prompt via pipelineEngine.buildContext() — no extra wiring needed.
 */
import { useEffect, useState, useRef } from 'react';
import { getProject, updateProject } from '@/db/projectRepository';
import { DOMAINS } from '@/agents/domains';
import type { Project } from '@/types/project.types';
import type { DomainId } from '@/types/domain.types';
import styles from './ProjectDetailsModal.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_TECH = [
  'React', 'Next.js', 'Vue 3', 'Angular', 'Svelte',
  'React Native', 'Flutter', 'Swift / SwiftUI', 'Kotlin / Jetpack Compose',
  'Node.js / Express', 'FastAPI', 'Django', 'Spring Boot', '.NET / C#', 'Laravel',
  'GraphQL', 'REST API', 'gRPC', 'WebSockets',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'DynamoDB', 'Supabase', 'Firebase',
  'AWS', 'Azure', 'GCP', 'Vercel', 'Netlify', 'Cloudflare Workers',
  'Docker', 'Kubernetes', 'Terraform',
  'Stripe', 'Twilio', 'SendGrid',
  'Optimizely CMS', 'Contentful', 'Sanity', 'Strapi',
  'Salesforce Commerce Cloud', 'SAP Commerce', 'Shopify', 'WooCommerce',
  'Elasticsearch', 'Algolia', 'Pinecone', 'LangChain', 'OpenAI API',
];

const LS_CUSTOM_TECH_KEY = 'sdlc_custom_tech_tags';

function loadCustomTech(): string[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_TECH_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveCustomTech(tags: string[]) {
  try {
    localStorage.setItem(LS_CUSTOM_TECH_KEY, JSON.stringify(tags));
  } catch {}
}

// ── Domain knowledge section helpers ─────────────────────────────────────────

function syncSection(dk: string | undefined, header: string, value: string): string {
  const base = dk ?? '';
  const h = `## ${header}`;
  const idx = base.indexOf(h);

  if (!value.trim()) {
    if (idx < 0) return base;
    const before = base.slice(0, idx).trimEnd();
    const rest = base.slice(idx + h.length);
    const next = rest.search(/\n##\s/);
    const after = next >= 0 ? rest.slice(next) : '';
    return (before + after).trimStart();
  }

  const section = `${h}\n${value.trim()}`;
  if (idx < 0) return base.trimEnd() + (base.trim() ? '\n\n' : '') + section;

  const before = base.slice(0, idx);
  const rest = base.slice(idx + h.length);
  const next = rest.search(/\n##\s/);
  const after = next >= 0 ? rest.slice(next) : '';
  return before + section + after;
}

// ── Tag chip input component ──────────────────────────────────────────────────

interface TagInputProps {
  tags: string[];
  allOptions: string[];
  onChange: (tags: string[]) => void;
  onNewTag: (tag: string) => void;
}

function TagInput({ tags, allOptions, onChange, onNewTag }: TagInputProps) {
  const [inputVal, setInputVal] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = allOptions
    .filter((o) => !tags.includes(o) && o.toLowerCase().includes(inputVal.toLowerCase()))
    .slice(0, 12);

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
    if (!allOptions.includes(t)) onNewTag(t);
    setInputVal('');
    setShowDropdown(false);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) {
      e.preventDefault();
      addTag(inputVal);
    } else if (e.key === 'Backspace' && !inputVal && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="input"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 8px',
          cursor: 'text', minHeight: 40,
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span key={tag} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--accent)', color: 'white',
            borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>
            {tag}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              style={{ background: 'none', border: 'none', color: 'white', padding: 0, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
              aria-label={`Remove ${tag}`}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          onKeyDown={handleKey}
          placeholder={tags.length ? '' : 'Add technologies…'}
          style={{
            border: 'none', background: 'transparent', outline: 'none',
            fontSize: 13, minWidth: 140, flex: 1, padding: '1px 0',
            color: 'var(--text)',
          }}
        />
      </div>

      {showDropdown && (filtered.length > 0 || inputVal.trim()) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          maxHeight: 200, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={() => addTag(opt)}
              style={{
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {opt}
            </div>
          ))}
          {inputVal.trim() && !allOptions.includes(inputVal.trim()) && !tags.includes(inputVal.trim()) && (
            <div
              onMouseDown={() => addTag(inputVal)}
              style={{
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                color: 'var(--accent)', borderTop: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              + Add &ldquo;{inputVal.trim()}&rdquo; as new technology
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
        Type to search or add new · Press Enter or comma to confirm · New entries are saved for future use
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  onClose: () => void;
  onSaved?: () => void;
  onRestartAndOpen?: () => void;
}

export default function EditProjectModal({ projectId, onClose, onSaved, onRestartAndOpen }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [techTags, setTechTags] = useState<string[]>([]);
  const [allTechOptions, setAllTechOptions] = useState<string[]>([...PRESET_TECH]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasRuns = project
    ? Object.values(project.agentRuns ?? {}).some((r) => r && r.status !== 'idle')
    : false;

  useEffect(() => {
    const custom = loadCustomTech();
    const merged = [...PRESET_TECH, ...custom.filter((c) => !PRESET_TECH.includes(c))];
    setAllTechOptions(merged);

    getProject(projectId).then((p) => {
      if (!p) return;
      setProject(p);
      setName(p.name);
      setDescription(p.description ?? '');
      setDomain(p.domain ?? '');

      // Extract custom domain from domainKnowledge "## Domain" section
      const dk = p.domainKnowledge ?? '';
      const domainIdx = dk.indexOf('## Domain\n');
      if (domainIdx >= 0) {
        const afterHeader = dk.slice(domainIdx + '## Domain\n'.length);
        const nextSection = afterHeader.search(/\n##\s/);
        const val = (nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader).trim();
        setCustomDomain(val);
      }

      // Parse tech stack from project.techStack (comma-separated) or domainKnowledge
      if (p.techStack) {
        const existing = p.techStack.split(',').map((s) => s.trim()).filter(Boolean);
        setTechTags(existing);
        // Add any unknown tags to the options list
        const newOnes = existing.filter((t) => !merged.includes(t));
        if (newOnes.length) setAllTechOptions([...merged, ...newOnes]);
      }
    });
  }, [projectId]);

  function handleNewTag(tag: string) {
    const updated = [...allTechOptions.filter((t) => !PRESET_TECH.includes(t) || PRESET_TECH.includes(t)), tag];
    const customOnly = updated.filter((t) => !PRESET_TECH.includes(t));
    saveCustomTech(customOnly);
    setAllTechOptions([...PRESET_TECH, ...customOnly]);
  }

  async function save(withRestart: boolean) {
    if (!name.trim()) { setError('Project name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const techStackStr = techTags.join(', ');
      await updateProject(projectId, (p) => {
        p.name = name.trim();
        p.description = description.trim();
        p.domain = domain as DomainId;
        p.techStack = techStackStr || undefined;

        // Sync custom domain → ## Domain section in domainKnowledge
        let dk = syncSection(p.domainKnowledge, 'Domain', customDomain.trim());
        // Sync tech stack → ## Technology Stack section in domainKnowledge
        dk = syncSection(dk, 'Technology Stack', techStackStr);
        p.domainKnowledge = dk;

        if (withRestart) {
          p.agentRuns = {} as typeof p.agentRuns;
          p.reviewGates = {} as typeof p.reviewGates;
          p.status = 'draft';
          p.currentPhase = 'phase0';
        }
      });

      if (withRestart) {
        // Signal ProjectWorkspace to auto-start Phase 0 (sdlcOrchestrator) on mount
        sessionStorage.setItem(`sdlc_autostart_${projectId}`, '1');
        onRestartAndOpen?.();
      } else {
        onSaved?.();
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className={styles.overlay} onKeyDown={handleKeyDown}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Edit project"
        style={{ maxWidth: 640 }}>
        <div className={styles.header}>
          <span className={styles.title}>Edit Project Details</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">&#x2715;</button>
        </div>

        {!project ? (
          <div className={styles.body}><p className={styles.loading}>Loading&#8230;</p></div>
        ) : (
          <div className={styles.body}>
            {error && <p style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Project Name */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Project Name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Customer Portal v2"
                  maxLength={120}
                  autoFocus
                />
              </label>

              {/* Description */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Description</span>
                <textarea
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: 70 }}
                />
              </label>

              {/* Domain category + custom */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Domain</span>
                <select
                  className="input"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <option value="">Select a category&#8230;</option>
                  {Object.values(DOMAINS).map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <input
                  className="input"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="Custom domain name (e.g. Dealer Management Platform, Optimizely CMS)"
                />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                  Custom domain name is written into project context and sent to every agent.
                </p>
              </div>

              {/* Tech Stack — tag multi-select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Tech Stack</span>
                <TagInput
                  tags={techTags}
                  allOptions={allTechOptions}
                  onChange={setTechTags}
                  onNewTag={handleNewTag}
                />
              </div>

            </div>

            {hasRuns && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.5 }}>
                This project has existing pipeline runs. Save only to update context, or save and restart so all agents re-run with the new details.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn-secondary" onClick={() => save(false)} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {onRestartAndOpen && (
                <button className="btn-primary" onClick={() => save(true)} disabled={saving}>
                  {saving ? 'Saving…' : 'Save & Restart Pipeline'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
