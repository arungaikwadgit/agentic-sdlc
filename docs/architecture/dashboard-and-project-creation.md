# Module 6: Dashboard & Project Creation

> Part of the Agentic SDLC documentation set. This module covers the
> dashboard's active-project list, the project creation wizard, the domain
> registry that drives domain-specific agent context, and the JSON
> import/export backup flow. Archive/restore/permanent-delete behavior is
> covered separately in Module 2 (Project Lifecycle) and is referenced here
> only where shared.

**Source files covered:**

- `frontend/src/components/dashboard/Dashboard.tsx` (active project list, header actions, import/export)
- `frontend/src/components/dashboard/NewProjectModal.tsx` (two-step project creation wizard)
- `frontend/src/components/dashboard/ProjectCard.tsx` (active-project card rendering)
- `frontend/src/agents/domains.ts` (domain registry — `DOMAINS`)
- `frontend/src/agents/domainKnowledgeDefaults.ts` (app-level domain knowledge defaults, stored in `settings`)
- `frontend/src/agents/domainKnowledgeTemplates.ts` (built-in domain knowledge templates)
- `frontend/src/db/projectRepository.ts` (`createProject`, `listProjects`, `exportAllProjects`, `importProjects`)

---

## 1. Requirements

### 1.1 Purpose

The Dashboard is the application's entry point. It lists the user's active
projects, lets them create a new project through a guided wizard, and
provides a JSON-based backup/restore mechanism for the entire project store.
The wizard's second step lets the user pick a domain (fintech, healthcare,
ecommerce, etc.) and customize a "domain knowledge" brief that gets injected
into every agent's prompt for that project — this is the primary mechanism
by which the same agent pipeline produces domain-appropriate output across
very different industries.

### 1.2 Functional requirements

| ID | Requirement |
|----|-------------|
| R1 | The Dashboard displays all non-archived projects as cards, ordered by `updatedAt` descending (via `listProjects()`). |
| R2 | If there are zero non-archived projects, the Dashboard shows an empty state with a "+ New Project" call to action. |
| R3 | Clicking "+ New Project" opens `NewProjectModal`, a two-step wizard: **Details** (name, description, domain, mode, branding guidelines) then **Domain Knowledge** (editable brief, seeded from defaults). |
| R4 | The Details step offers five hardcoded presets (FinPay/fintech, HealthTrack/healthcare, ShopFlow/ecommerce, TeamSync/saas, LearnPath/edtech) that pre-fill name, description, and domain when clicked. |
| R5 | "Next" on the Details step is disabled until both `name` and `description` are non-empty (after trimming). |
| R6 | Changing the domain on the Details step resets `domainKnowledge` to the effective default for the newly selected domain, via `getEffectiveDomainKnowledgeDefault`. |
| R7 | Entering the Domain Knowledge step pre-fills the textarea with the effective default for the current domain **only if** `domainKnowledge` is still empty — it does not overwrite a value the user already edited on Details. |
| R8 | The Domain Knowledge step provides "Reset to template" (re-fetches the effective default) and "Download as .md" (downloads the current brief as `domain-knowledge-{domain}.md`) actions. |
| R9 | "Create Project" calls `createProject` with `{ name, description, domain, status: 'draft', mode, domainKnowledge, brandingGuidelines }` and, on success, opens the new project via `onCreated(project.id)`. |
| R10 | Each `ProjectCard` shows the project's domain badge, name, status dot + label, and a progress bar (`completedAgents / totalAgents`, rounded to a percentage). |
| R11 | The Dashboard header provides "Export" (downloads `sdlc-backup-{timestamp}.json` containing all projects) and "Import" (file picker for a previously exported JSON backup, calls `importProjects` and reports the number of imported projects via `alert`). |
| R12 | Domain knowledge defaults follow a three-level precedence: project-level `domainKnowledge` (set at creation, editable per project) → app-level default stored in Dexie `settings` under key `app:domainKnowledgeDefaults` → hardcoded `DOMAIN_KNOWLEDGE_TEMPLATES[domainId]` → `''` if none exist. |

### 1.3 Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | `listProjects()` is consumed via `useLiveQuery`, so the Dashboard re-renders automatically whenever any project is created, updated, archived, or deleted — no manual refresh logic. |
| NFR2 | Import is non-destructive to existing data: `importProjects` uses `db.projects.bulkPut`, which **upserts** by primary key (`id`). Importing a backup that shares IDs with existing projects overwrites those records; it does not clear the table first. |
| NFR3 | Export/import round-trips the full `Project` record (not the `ProjectSummary` projection), including `agentRuns`, `reviewGates`, `teamMembers`, etc. — anything not in the schema at import time is preserved as extra JSON properties by Dexie. |
| NFR4 | The wizard must not block project creation on domain knowledge — `domainKnowledge` and `brandingGuidelines` are both optional strings and may be empty. |

---

## 2. Design

### 2.1 Dashboard.tsx

```tsx
export default function Dashboard({ onOpenProject }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const allProjects = useLiveQuery(() => listProjects(), []) ?? [];
  const archivedCount = allProjects.filter((p) => p.archived).length;
  const projects = allProjects.filter((p) =>
    showArchived ? !!p.archived : !p.archived
  );
  // ...
}
```

- `allProjects` is the full live-query result; `projects` is filtered
  client-side based on the `showArchived` toggle. Module 6 is concerned with
  the `!p.archived` branch (the default view); the `showArchived` branch and
  its empty-state edge case are documented in Module 2.
- The "Archived" toggle button is only rendered when `archivedCount > 0`.
- Header actions, left to right: archived toggle (conditional), **Import**,
  **Export**, **+ New Project**, settings gear (opens `AppSettingsModal`).

#### 2.1.1 `handleExport`

```tsx
async function handleExport() {
  const json = await exportAllProjects();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sdlc-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Calls `exportAllProjects()` (see §2.4), wraps the returned JSON string in a
`Blob`, and triggers a browser download via a synthetic anchor click. The
filename embeds the export timestamp (epoch milliseconds) so repeated
exports never collide.

#### 2.1.2 `handleImport`

```tsx
async function handleImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const count = await importProjects(text);
      alert(`Imported ${count} project(s).`);
    } catch (e) {
      alert(`Import failed: ${String(e)}`);
    }
  };
  input.click();
}
```

Creates a hidden `<input type="file" accept=".json">`, reads the selected
file as text, and passes it to `importProjects`. Both the success count and
any thrown error (e.g. "Invalid backup format" — see §2.4) are surfaced via
`alert`. Because `useLiveQuery` is reactive, a successful import immediately
updates the project list with no extra wiring.

### 2.2 NewProjectModal.tsx

#### 2.2.1 Presets

```tsx
const PRESETS = [
  { name: 'FinPay', description: '...', domain: 'fintech' },
  { name: 'HealthTrack', description: '...', domain: 'healthcare' },
  { name: 'ShopFlow', description: '...', domain: 'ecommerce' },
  { name: 'TeamSync', description: '...', domain: 'saas' },
  { name: 'LearnPath', description: '...', domain: 'edtech' },
];
```

Five hardcoded sample projects, one per common domain. `applyPreset(preset)`
sets `name`, `description`, and `domain` from the chosen preset; the user
can still edit any field afterward. Presets exist purely to give new users a
fast, realistic starting point — no preset data is persisted beyond what the
user submits.

#### 2.2.2 Two-step wizard state

```tsx
type Step = 'details' | 'domain-knowledge';

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState<DomainId>('saas');
  const [mode, setMode] = useState<'simple' | 'expert'>('simple');
  const [domainKnowledge, setDomainKnowledge] = useState('');
  const [brandingGuidelines, setBrandingGuidelines] = useState('');
  const [loading, setLoading] = useState(false);
  // ...
}
```

Default domain is `'saas'`. `mode` defaults to `'simple'`; the UI shows a
hint explaining the difference (Simple runs the full agent pipeline with
default prompts, Expert exposes per-agent prompt overrides — see Module 4
for how `mode` and `promptOverrides` interact downstream).

#### 2.2.3 `handleDomainChange`

```tsx
async function handleDomainChange(newDomain: DomainId) {
  setDomain(newDomain);
  setDomainKnowledge(await getEffectiveDomainKnowledgeDefault(newDomain));
}
```

Switching domains on the Details step **unconditionally** replaces
`domainKnowledge` with the effective default for the new domain (§2.4).
This is intentional: a domain knowledge brief written for fintech is
unlikely to be appropriate after switching to healthcare, so the wizard
re-seeds it rather than leaving stale text. If the user had already
hand-edited the brief before switching domains, that edit is lost — there is
no undo.

#### 2.2.4 `goToKnowledge`

```tsx
async function goToKnowledge() {
  if (!name.trim() || !description.trim()) return;
  if (!domainKnowledge) {
    setDomainKnowledge(await getEffectiveDomainKnowledgeDefault(domain));
  }
  setStep('domain-knowledge');
}
```

Validates that `name` and `description` are non-empty (trimmed) before
advancing. Unlike `handleDomainChange`, this only fills `domainKnowledge` if
it is currently **empty** — it never overwrites a value the user has already
set, whether from a prior domain change or manual editing.

#### 2.2.5 `handleDownloadTemplate`

```tsx
function handleDownloadTemplate() {
  const blob = new Blob([domainKnowledge], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `domain-knowledge-${domain}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Same Blob-anchor-download pattern as `Dashboard.handleExport` (§2.1.1), but
downloads the **current** (possibly user-edited) `domainKnowledge` text as a
markdown file named after the active domain.

#### 2.2.6 `handleCreate`

```tsx
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
```

New projects always start with `status: 'draft'`. `createProject` (§2.4)
fills in `id`, `version`, `createdAt`/`updatedAt`, and the empty
`agentRuns`/`reviewGates`/`teamMembers`/`agentAssignments`/`promptOverrides`
collections — the wizard only supplies the fields a user can meaningfully
set at creation time. `domainKnowledge` and `brandingGuidelines` are trimmed
and converted to `undefined` if empty, so a project created without
customizing either field stores `undefined` rather than an empty string
(this matters for the precedence chain in §2.5 — an `undefined`
`project.domainKnowledge` falls through to the app/template defaults, while
an empty string would not). The "Create Project" button is disabled while
`loading` is true, preventing duplicate submissions on slow IndexedDB writes.
`handleCreate` re-validates name/description even though the button that
triggers it is only reachable after the Details-step validation already
passed (defense in depth, not a separate user-facing gate).

#### 2.2.7 Step UI summary

- **Details step**: preset chips, name input, description textarea, domain
  `<select>` (driven by `DOMAINS`, see §2.3), mode toggle (Simple/Expert with
  inline explanatory text), branding guidelines textarea, footer with
  Cancel / Next (Next disabled per §2.2.4's validation).
- **Domain Knowledge step**: a banner showing the selected domain's badge
  (color/label from `DOMAINS[domain]`), an 18-row textarea bound to
  `domainKnowledge`, "Reset to template" and "Download as .md" actions,
  footer with Back / Create Project (Create disabled while `loading`).

### 2.3 Domain registry — `agents/domains.ts`

```ts
export const DOMAINS: Record<DomainId, DomainDefinition> = {
  fintech: { id: 'fintech', label: 'FinTech', color: '#1d4ed8', bgColor: '#dbeafe', context: `...` },
  healthcare: { /* ... */ },
  ecommerce: { /* ... */ },
  saas: { /* ... */ },
  edtech: { /* ... */ },
  insurtech: { /* ... */ },
  legaltech: { /* ... */ },
  retail: { /* ... */ },
  manufacturing: { /* ... */ },
  govtech: { /* ... */ },
};
```

Ten domains, each a `DomainDefinition`:

| Field | Purpose |
|---|---|
| `id` | The `DomainId` literal (matches the map key). |
| `label` | Human-readable name shown in the domain `<select>` and on `ProjectCard` badges. |
| `color` / `bgColor` | Badge text/background colors, used by `ProjectCard` and the Domain Knowledge step banner. |
| `context` | A dense paragraph of domain-specific concerns (compliance regimes, integration patterns, NFRs) injected into every agent's system prompt for projects in that domain — e.g. fintech mentions PCI-DSS/AML/KYC/PSD2; healthcare mentions HIPAA/HL7/FHIR. |

`DOMAINS` is a pure, static registry — there is no UI for editing it at
runtime. Adding a new domain requires adding a `DomainId` literal to
`types/domain.types.ts` and a corresponding entry here (and, for the
domain-knowledge wizard step, an entry in `DOMAIN_KNOWLEDGE_TEMPLATES`,
§2.5).

### 2.4 `db/projectRepository.ts` — creation, listing, backup/restore

```ts
export async function createProject(
  data: Omit<Project, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'agentRuns'
    | 'reviewGates' | 'promptOverrides' | 'teamMembers' | 'agentAssignments' | 'activeAdminId'>
): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    ...data,
    id: newId(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    teamMembers: [],
    agentAssignments: [],
  };
  await db.projects.add(project);
  return project;
}
```

The `Omit<...>` type parameter is the contract between `NewProjectModal` and
the repository: the wizard supplies `name`, `description`, `domain`,
`status`, `mode`, `domainKnowledge`, `brandingGuidelines` (and any other
non-omitted `Project` fields), and the repository is responsible for every
field that has a well-defined "empty" starting value. Note `activeAdminId`
is also omitted here — a freshly created project has no team members and
therefore no active admin; that gets set later when the first admin team
member is added (Module 4).

```ts
export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await db.projects.orderBy('updatedAt').reverse().toArray();
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    completedAgents: Object.values(p.agentRuns).filter((r) => r?.status === 'complete').length,
    totalAgents: TOTAL_AGENTS,
    archived: p.archived,
    archivedReason: p.archivedReason,
    archivedAt: p.archivedAt,
    archivedBy: p.archivedBy,
  }));
}
```

`listProjects` projects each full `Project` record down to a
`ProjectSummary` — the shape `Dashboard` and `ProjectCard` consume.
`completedAgents` is computed on every call by counting `agentRuns` entries
with `status === 'complete'`; `totalAgents` is the constant `TOTAL_AGENTS`
(the fixed size of the agent pipeline, shared across all projects/domains).
Sorted by `updatedAt` descending via the Dexie index, then reversed in JS —
i.e. most-recently-updated project first.

```ts
export async function exportAllProjects(): Promise<string> {
  const projects = await db.projects.toArray();
  return JSON.stringify({ version: 1, exportedAt: Date.now(), projects }, null, 2);
}

export async function importProjects(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (!data.projects || !Array.isArray(data.projects)) throw new Error('Invalid backup format');
  await db.projects.bulkPut(data.projects);
  return data.projects.length;
}
```

- `exportAllProjects` serializes **every** project (including archived ones —
  unlike `listProjects`, there is no filtering) plus a `version` field
  (currently always `1`, not yet used for migration logic) and an
  `exportedAt` timestamp, pretty-printed with 2-space indentation.
- `importProjects` does minimal validation: it requires `data.projects` to
  exist and be an array, but does **not** validate the shape of individual
  project records, check `version` compatibility, or de-duplicate. A
  malformed `projects` array element (e.g. missing `id`) would be passed
  through to `db.projects.bulkPut` and fail or behave unpredictably at the
  Dexie layer — this is a known gap, see §3 Development Notes.
- `bulkPut` is an upsert: records with `id`s matching existing projects
  overwrite them; new `id`s are inserted as new projects.

### 2.5 Domain knowledge defaults & templates

```ts
// agents/domainKnowledgeTemplates.ts
export const DOMAIN_KNOWLEDGE_TEMPLATES: Record<DomainId, string> = {
  fintech: `# Domain Knowledge: Financial Technology\n\n## Project-Specific Context\n> _Edit this section..._\n\n## Key Regulatory Requirements\n- **PCI-DSS**: ...\n...`,
  healthcare: `# Domain Knowledge: Healthcare Technology\n...`,
  // ... one template per DomainId, each a multi-section markdown brief
};
```

```ts
// agents/domainKnowledgeDefaults.ts
const SETTINGS_KEY = 'app:domainKnowledgeDefaults';
export type DomainKnowledgeDefaultsMap = Partial<Record<DomainId, string>>;

export async function getDomainKnowledgeDefaults(): Promise<DomainKnowledgeDefaultsMap> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (row?.value && typeof row.value === 'object') return row.value as DomainKnowledgeDefaultsMap;
  return {};
}

export async function getEffectiveDomainKnowledgeDefault(domainId: DomainId): Promise<string> {
  const defaults = await getDomainKnowledgeDefaults();
  return defaults[domainId] ?? DOMAIN_KNOWLEDGE_TEMPLATES[domainId] ?? '';
}

export async function saveDomainKnowledgeDefault(domainId: DomainId, brief: string): Promise<void> { /* ... */ }
export async function resetDomainKnowledgeDefault(domainId: DomainId): Promise<void> { /* ... */ }
```

Three-level precedence for "what domain knowledge brief does a new project
in domain X start with":

1. **Project-level** — once a project exists, its own `domainKnowledge`
   field is authoritative (editable per-project, independent of any
   defaults).
2. **App-level default** — `getDomainKnowledgeDefaults()` reads a single
   settings row keyed `app:domainKnowledgeDefaults`, whose `value` is a
   `Partial<Record<DomainId, string>>`. An app administrator can override the
   built-in template for a given domain (`saveDomainKnowledgeDefault`) or
   revert to the built-in (`resetDomainKnowledgeDefault`) — these are
   exposed via `AppSettingsModal`, not `NewProjectModal`.
3. **Built-in template** — `DOMAIN_KNOWLEDGE_TEMPLATES[domainId]`, a
   hardcoded multi-section markdown brief per domain (regulatory
   requirements, architecture considerations, integration landscape, NFRs).
4. **Empty string** — if somehow neither exists for a `DomainId` (should not
   happen given all 10 domains have templates, but the `??` chain degrades
   gracefully).

`getEffectiveDomainKnowledgeDefault` is the single function `NewProjectModal`
calls (in `handleDomainChange` and `goToKnowledge`) — it is unaware of
whether the result came from an app-level override or the built-in template.

### 2.6 ProjectCard.tsx (active-project rendering)

```tsx
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', running: 'Running', paused: 'Paused', complete: 'Complete', error: 'Error' };
const STATUS_COLORS: Record<string, string> = { draft: '#64748b', running: '#6366f1', paused: '#f59e0b', complete: '#22c55e', error: '#ef4444' };

export default function ProjectCard({ project, onOpen, onDelete, onRestore }: Props) {
  const domain = DOMAINS[project.domain];
  const progress = project.totalAgents > 0
    ? Math.round((project.completedAgents / project.totalAgents) * 100)
    : 0;
  const statusColor = STATUS_COLORS[project.status] ?? '#64748b';
  // ...
}
```

For the active (non-archived) view (`onRestore` prop absent), `ProjectCard`
renders:

- A domain badge using `DOMAINS[project.domain].label/color/bgColor`.
- The project name.
- A status dot (colored via `STATUS_COLORS`) and label (via `STATUS_LABELS`),
  defaulting to `'#64748b'` for any status not in the map.
- A progress bar showing `progress`% (`completedAgents / totalAgents`,
  rounded; guarded against division by zero).
- A footer with the project's date and a delete ("✕") button.

Clicking anywhere on the card calls `onOpen()`; clicking delete calls
`e.stopPropagation()` then, after a `window.confirm` prompt, `onDelete()`.
The `onRestore`-present (archived) rendering path — including archive
metadata display and the "↩ Restore" button — is documented in Module 2.

---

## 3. Development Notes

### 3.1 `importProjects` has no schema validation

`importProjects` checks only that `data.projects` is an array — it does not
verify that each element has the fields a `Project` requires, does not check
the `version` field for forward/backward compatibility, and does not
deduplicate or merge `teamMembers`/`agentAssignments`. A backup file from a
future schema version, or a hand-edited JSON file, could be imported without
error and produce projects that fail to render correctly elsewhere in the
app (e.g. `ProjectCard` reading `DOMAINS[project.domain]` for an unknown
`domain` value would throw, since `DOMAINS` has no fallback entry).

### 3.2 `handleDomainChange` always overwrites domain knowledge, `goToKnowledge` never does

These two code paths have asymmetric behavior by design (§2.2.3, §2.2.4):
switching domains on the Details step is treated as "start over" for the
brief, while advancing to the Domain Knowledge step only fills in a default
if the field is still empty. A user who edits the brief, goes back to
Details, and changes the domain again will silently lose their edit — this
is the one place in the wizard where user input can be discarded without
confirmation.

### 3.3 `exportAllProjects`'s `version: 1` is currently unused

The export envelope includes `version: 1`, presumably to support future
backup-format migrations in `importProjects`, but `importProjects` does not
read or branch on this field today. Any future schema change to the export
format should add a version check here before it becomes a compatibility
problem.

### 3.4 Presets and domain knowledge templates are independently maintained

The five `PRESETS` in `NewProjectModal` and the ten
`DOMAIN_KNOWLEDGE_TEMPLATES` are separate hardcoded structures with no shared
source of truth. A preset's `domain` value determines which template gets
loaded when `applyPreset` is followed by the wizard reaching the Domain
Knowledge step, but there's no preset-specific domain knowledge — e.g.
choosing "FinPay" gets the generic fintech template, not anything tailored
to a payments-specific scenario.

---

## 4. Test Plan Summary

See `docs/test-plans/dashboard-and-project-creation-test-plan.md` for the
full scenario list. Highlights:

| Area | Test file | Coverage |
|---|---|---|
| NewProjectModal wizard | `tests/unit/NewProjectModal.test.tsx` | Presets, validation, two-step navigation, domain-change reset vs. fill-if-empty, template reset/download, create flow |
| ProjectCard (active view) | `tests/unit/ProjectCard.test.tsx` | Domain badge, status label/color (incl. unknown status fallback), progress bar (incl. zero-totalAgents guard), delete confirm/cancel, click-to-open |
| Dashboard import/export | `tests/unit/Dashboard-import-export.test.tsx` | Export downloads a JSON blob via `exportAllProjects`; import reads a file, calls `importProjects`, alerts on success/failure |
| Domain knowledge precedence | `tests/unit/domainKnowledgeDefaults.test.ts` | `getEffectiveDomainKnowledgeDefault` precedence (project → app default → template → `''`), save/reset round-trip |

Existing coverage from Module 2 (`Dashboard-archive.test.tsx`, TS-51–TS-59)
is unaffected and continues to cover the archived-view filtering and
restore/delete confirm flows.

---

## 5. Deployment & Maintenance Notes

- No new environment variables, integrations, or backend routes are
  introduced by this module — everything here is local IndexedDB
  (`db.projects`, `db.settings`) plus client-side Blob downloads.
- The JSON backup format produced by `exportAllProjects` is the closest
  thing this app has to a portable data format; if the `Project` schema
  changes in a way that breaks `bulkPut` compatibility (e.g. renaming a
  required field), old backups will need either a migration step in
  `importProjects` or a documented "backups from before version X are
  incompatible" note.
- `DOMAIN_KNOWLEDGE_TEMPLATES` and `DOMAINS[*].context` are both
  hand-maintained prose. Any future addition of an 11th domain requires
  updating: `types/domain.types.ts` (`DomainId` union), `agents/domains.ts`
  (`DOMAINS` entry), and `agents/domainKnowledgeTemplates.ts`
  (`DOMAIN_KNOWLEDGE_TEMPLATES` entry) — missing any of the three will cause
  a TypeScript error (for the first two) or a silent empty-string default
  (for the third, via the `??` chain in
  `getEffectiveDomainKnowledgeDefault`).
- To check coverage for this module locally:

```
cd frontend && npm install && npm run test:coverage
```
