/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * BacklogTab — Admin-only running enhancement backlog.
 * Seeded with skipped/deferred items from prior assessment sessions.
 * Admin can add, edit, archive, and change status of any item.
 */
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BacklogItem } from '@/db/database';

// ── Seed data: all skipped/deferred enhancements from our sessions ────────────
const SEED_ITEMS: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { title: 'Supabase Realtime subscriptions for live team collaboration', description: 'Use Supabase Realtime to push project/agent-run updates to all connected team members in real time, replacing the current polling approach.', category: 'feature', priority: 'high', status: 'open', source: 'ai-suggested' },
  { title: 'GitHub Actions CD — auto-deploy on push to main', description: 'Add a CD job to .github/workflows/ci.yml that deploys to Railway (backend) and Vercel (frontend) on every push to main after tests pass.', category: 'devops', priority: 'high', status: 'open', source: 'assessment' },
  { title: 'Playwright E2E full test suite', description: 'Complete the e2e test suite: project CRUD, pipeline run, agent re-run, team invite flow, review gate approval, admin panel access. Currently only auth tests exist.', category: 'testing', priority: 'high', status: 'open', source: 'assessment' },
  { title: 'Rate limiting on /api/proxy endpoint', description: 'Add express-rate-limit middleware to the Railway proxy endpoint to prevent abuse. Suggested limit: 60 req/min per IP.', category: 'security', priority: 'high', status: 'open', source: 'assessment' },
  { title: 'CSP headers on Railway backend', description: 'Implement Content-Security-Policy headers on the Express server (helmet.js already installed). Tighten connect-src and script-src directives.', category: 'security', priority: 'medium', status: 'open', source: 'assessment' },
  { title: 'Error tracking via Sentry', description: 'Integrate Sentry SDK in both frontend (Vite plugin) and Railway backend. Wire up to observabilityEngineer output recommendations.', category: 'devops', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Agent output version history', description: 'Store each regeneration of an agent\'s output with a timestamp so users can revert to a previous version. Currently only the latest output is saved.', category: 'feature', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Diagram editor — edit Mermaid source inline', description: 'Allow users to edit the Mermaid source code of a diagram directly in the Diagrams tab and re-render without re-running the agent.', category: 'ux', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Bulk agent re-run for a phase', description: 'Add a "Re-run all agents in this phase" button so users don\'t have to individually re-run each agent after a prompt change.', category: 'ux', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Mobile-responsive layout', description: 'The pipeline workspace layout is not usable on small screens. Needs a responsive sidebar collapse, touch-friendly tap targets, and horizontal scroll prevention.', category: 'ux', priority: 'medium', status: 'open', source: 'assessment' },
  { title: 'Project templates', description: 'Allow starting a new project from a saved template (pre-filled domain, tech stack, team, and prompt overrides). Templates stored in Dexie settings table.', category: 'feature', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Dashboard pagination / virtualised list', description: 'The projects list loads all projects at once. Add pagination or virtual scrolling for accounts with 20+ projects.', category: 'performance', priority: 'medium', status: 'open', source: 'assessment' },
  { title: 'Backend unit test suite (vitest)', description: 'Add unit tests for server/index.ts route handlers (proxy, health, settings, invite). Currently only frontend unit tests exist.', category: 'testing', priority: 'medium', status: 'open', source: 'assessment' },
  { title: 'Test coverage reporting in CI', description: 'Add --coverage flag to the vitest CI job and publish the coverage report as a GitHub Actions artifact. Target: 80% line coverage.', category: 'testing', priority: 'low', status: 'open', source: 'assessment' },
  { title: 'Admin audit log', description: 'Track all admin actions (settings changes, user management, test triggers) in a Dexie/Supabase audit table with timestamp, action, and before/after values.', category: 'security', priority: 'medium', status: 'open', source: 'ai-suggested' },
  { title: 'Export diagram to PDF / PNG', description: 'Add PDF and PNG export options to the Diagrams tab (currently only SVG). Use html2canvas or a server-side Puppeteer render.', category: 'feature', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'Webhook notifications on pipeline completion', description: 'Allow project owners to configure a webhook URL that gets called (POST) when the pipeline finishes, with a JSON payload summarising the results.', category: 'feature', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'Sprint plan export to Jira / Linear', description: 'Add an export button on the sprintPlanner output that pushes tasks to Jira or Linear via their APIs. Credentials stored as integrations.', category: 'feature', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'Lighthouse CI integration', description: 'Add a Lighthouse performance/accessibility audit step in GitHub Actions. Fail the build if performance score drops below 80.', category: 'performance', priority: 'low', status: 'open', source: 'assessment' },
  { title: 'Custom domain setup for Vercel', description: 'Document and automate the custom domain configuration for the Vercel frontend deployment, including DNS records and SSL certificate provisioning.', category: 'devops', priority: 'low', status: 'open', source: 'assessment' },
  { title: 'Email invite rate limiting', description: 'Add rate limiting to the /api/invite endpoint to prevent invite spam (suggested: 10 invites per project per hour).', category: 'security', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'Stale project auto-archive', description: 'Automatically archive projects that haven\'t been updated in 90 days. Show a warning badge on the dashboard before archival.', category: 'feature', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'ChatWidget memory / context persistence', description: 'Remember the user\'s last 3 questions across widget open/close sessions so the assistant has context without re-explaining basics.', category: 'ux', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'RBAC for admin panel tabs', description: 'Currently the admin panel is all-or-nothing. Add granular tab-level permissions so ops staff can see Health/Projects without accessing Backend/Settings.', category: 'security', priority: 'low', status: 'open', source: 'ai-suggested' },
  { title: 'Multi-tenant strict RLS audit', description: 'Audit all Supabase RLS policies to ensure strict tenant isolation. Verify with a cross-tenant penetration test using two test accounts.', category: 'security', priority: 'high', status: 'open', source: 'assessment' },
];

function nanoid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const CATEGORY_COLORS: Record<BacklogItem['category'], string> = {
  security:    '#ef4444',
  performance: '#f59e0b',
  ux:          '#6366f1',
  devops:      '#0ea5e9',
  feature:     '#10b981',
  testing:     '#8b5cf6',
  'tech-debt': '#94a3b8',
};

const PRIORITY_ORDER: Record<BacklogItem['priority'], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const STATUS_LABELS: Record<BacklogItem['status'], string> = {
  open: 'Open', 'in-progress': 'In Progress', done: 'Done', archived: 'Archived',
};

// ── Seeder (runs once when table is empty) ─────────────────────────────────────
async function seedBacklogIfEmpty() {
  const count = await db.backlogItems.count();
  if (count > 0) return;
  const now = Date.now();
  await db.backlogItems.bulkAdd(
    SEED_ITEMS.map((item) => ({ ...item, id: nanoid(), createdAt: now, updatedAt: now }))
  );
}

// ── Item form (add / edit) ─────────────────────────────────────────────────────
interface ItemFormProps {
  initial?: BacklogItem;
  onSave: (data: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

function ItemForm({ initial, onSave, onCancel }: ItemFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<BacklogItem['category']>(initial?.category ?? 'feature');
  const [priority, setPriority] = useState<BacklogItem['priority']>(initial?.priority ?? 'medium');
  const [status, setStatus] = useState<BacklogItem['status']>(initial?.status ?? 'open');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: desc.trim(), category, priority, status, source: initial?.source ?? 'admin-added', notes: notes.trim() || undefined });
  }

  const sel: React.CSSProperties = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%' };
  const inp: React.CSSProperties = { ...sel, display: 'block' };
  const ta: React.CSSProperties  = { ...inp, minHeight: 70, resize: 'vertical' };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input style={inp} placeholder="Title *" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <textarea style={ta} placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <select style={sel} value={category} onChange={(e) => setCategory(e.target.value as BacklogItem['category'])}>
          {(['feature','ux','security','performance','devops','testing','tech-debt'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={sel} value={priority} onChange={(e) => setPriority(e.target.value as BacklogItem['priority'])}>
          {(['critical','high','medium','low'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select style={sel} value={status} onChange={(e) => setStatus(e.target.value as BacklogItem['status'])}>
          {(['open','in-progress','done','archived'] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <textarea style={{ ...ta, minHeight: 50 }} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn-primary" style={{ fontSize: 13 }}>{initial ? 'Save Changes' : 'Add Item'}</button>
        <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Main BacklogTab ────────────────────────────────────────────────────────────
export default function BacklogTab() {
  const [filterStatus, setFilterStatus] = useState<BacklogItem['status'] | 'all'>('open');
  const [filterCategory, setFilterCategory] = useState<BacklogItem['category'] | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<BacklogItem['priority'] | 'all'>('all');
  const [editing, setEditing] = useState<BacklogItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  // Seed on first mount
  useEffect(() => { seedBacklogIfEmpty(); }, []);

  const allItems = useLiveQuery(() => db.backlogItems.orderBy('createdAt').toArray(), []) ?? [];

  const items = allItems
    .filter((i) => filterStatus === 'all' || i.status === filterStatus)
    .filter((i) => filterCategory === 'all' || i.category === filterCategory)
    .filter((i) => filterPriority === 'all' || i.priority === filterPriority)
    .filter((i) => !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  async function handleAdd(data: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>) {
    await db.backlogItems.add({ ...data, id: nanoid(), createdAt: Date.now(), updatedAt: Date.now() });
    setAdding(false);
  }

  async function handleEdit(data: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!editing) return;
    await db.backlogItems.update(editing.id, { ...data, updatedAt: Date.now() });
    setEditing(null);
  }

  async function setStatus(id: string, status: BacklogItem['status']) {
    await db.backlogItems.update(id, { status, updatedAt: Date.now() });
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this backlog item permanently?')) return;
    await db.backlogItems.delete(id);
  }

  const counts = {
    open: allItems.filter((i) => i.status === 'open').length,
    'in-progress': allItems.filter((i) => i.status === 'in-progress').length,
    done: allItems.filter((i) => i.status === 'done').length,
    archived: allItems.filter((i) => i.status === 'archived').length,
  };

  const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 };
  const sel: React.CSSProperties  = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', fontSize: 12 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Enhancement Backlog</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {counts.open} open · {counts['in-progress']} in progress · {counts.done} done · {allItems.length} total
          </p>
        </div>
        <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => { setAdding(true); setEditing(null); }}>+ Add Item</button>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>New Backlog Item</p>
          <ItemForm onSave={handleAdd} onCancel={() => setAdding(false)} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...sel, flex: 1, minWidth: 160 }}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={sel} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as BacklogItem['status'] | 'all')}>
          <option value="all">All statuses</option>
          <option value="open">Open ({counts.open})</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
          <option value="archived">Archived</option>
        </select>
        <select style={sel} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as BacklogItem['category'] | 'all')}>
          <option value="all">All categories</option>
          {(['feature','ux','security','performance','devops','testing','tech-debt'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={sel} value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as BacklogItem['priority'] | 'all')}>
          <option value="all">All priorities</option>
          {(['critical','high','medium','low'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Item list */}
      {items.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>No items match the current filters.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <div key={item.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            {editing?.id === item.id ? (
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>Edit Item</p>
                <ItemForm initial={item} onSave={handleEdit} onCancel={() => setEditing(null)} />
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <span style={{ ...pill, background: CATEGORY_COLORS[item.category] + '22', color: CATEGORY_COLORS[item.category], border: `1px solid ${CATEGORY_COLORS[item.category]}44` }}>
                    {item.category}
                  </span>
                  <span style={{ ...pill, background: item.priority === 'critical' ? '#ef444422' : item.priority === 'high' ? '#f59e0b22' : item.priority === 'medium' ? '#6366f122' : '#94a3b822', color: item.priority === 'critical' ? '#ef4444' : item.priority === 'high' ? '#f59e0b' : item.priority === 'medium' ? '#6366f1' : '#94a3b8', border: '1px solid currentColor' }}>
                    {item.priority}
                  </span>
                  <span style={{ ...pill, background: item.status === 'done' ? '#10b98122' : item.status === 'in-progress' ? '#0ea5e922' : item.status === 'archived' ? '#94a3b822' : '#6366f122', color: item.status === 'done' ? '#10b981' : item.status === 'in-progress' ? '#0ea5e9' : item.status === 'archived' ? '#94a3b8' : '#6366f1', border: '1px solid currentColor' }}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  <span style={{ ...pill, background: 'var(--surface2)', color: 'var(--text-muted)', fontSize: 10 }}>{item.source}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <select
                      style={{ ...sel, fontSize: 11, padding: '2px 6px' }}
                      value={item.status}
                      onChange={(e) => setStatus(item.id, e.target.value as BacklogItem['status'])}
                    >
                      {(['open','in-progress','done','archived'] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }} onClick={() => { setEditing(item); setAdding(false); }}>Edit</button>
                    <button style={{ background: 'none', border: 'none', color: 'var(--error, #ef4444)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }} onClick={() => deleteItem(item.id)}>Delete</button>
                  </div>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600 }}>{item.title}</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.description}</p>
                {item.notes && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--accent)', fontStyle: 'italic' }}>Note: {item.notes}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
