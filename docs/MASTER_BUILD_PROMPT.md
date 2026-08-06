# Master Build Prompt — Agentic SDLC Framework

Copy everything below the line into a fresh session with a coding assistant (Claude Code, Cursor, etc.) to regenerate this application from scratch.

---

## Prompt

Build a web application called **"Agentic SDLC Framework"** — a tool that uses 22 specialized AI agents across 9 phases to generate a complete software project's documentation (charter, requirements, architecture, test plans, security review, DevOps, observability, etc.) from a single project description.

### Tech stack

- **Frontend**: React 18 + TypeScript + Vite
- **Storage**: Dexie.js (IndexedDB wrapper) — fully client-side persistence, no backend database
- **Backend**: Express (Node.js) — a thin proxy that forwards agent requests to the OpenAI Chat Completions API. The frontend never holds the OpenAI API key.
- **Styling**: CSS Modules, dark navy theme by default with a light theme variant, both via CSS custom properties
- **Testing**: Vitest (unit + integration), Playwright (E2E + accessibility), target >80% coverage on core logic (pipeline engine, gating, admin guards, sanitization)

### Why a backend proxy

The frontend runs entirely in the browser with no server-side session. The Express proxy exists solely to (a) keep the OpenAI API key out of browser code, (b) support corporate networks that require an HTTP CONNECT tunnel to reach `api.openai.com`, and (c) provide a single auth-gated surface (`PROXY_TOKEN` header) for all OpenAI calls and admin settings writes.

---

## 1. Data model

### Project (`frontend/src/types/project.types.ts`)

```typescript
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  isAdmin: boolean;
}

export interface AgentAssignment {
  agentId: AgentId;
  memberIds: string[]; // many-to-many
}

export type ProjectStatus = 'draft' | 'running' | 'paused' | 'complete' | 'error';
export type ReviewGateId = 'gate1' | 'gate2_3' | 'gate5' | 'gate6';

export interface ReviewGate {
  id: ReviewGateId;
  afterPhases: PhaseId[];
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string; // TeamMember.id
  notes?: string;
}

export interface PromptOverride {
  agentId: AgentId;
  patch: object[];        // legacy RFC 6902 JSON Patch (Expert mode)
  fullPrompt?: string;    // full replacement prompt — takes precedence over patch
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  domain: DomainId;
  status: ProjectStatus;
  version: number;          // optimistic concurrency stamp
  createdAt: number;
  updatedAt: number;
  currentPhase?: PhaseId;
  agentRuns: Partial<Record<AgentId, AgentRun>>;
  reviewGates: Partial<Record<ReviewGateId, ReviewGate>>;
  promptOverrides: PromptOverride[];
  mode: 'simple' | 'expert';
  teamMembers: TeamMember[];
  agentAssignments: AgentAssignment[];
  activeAdminId?: string;       // selected admin session, no password
  domainKnowledge?: string;     // user-edited brief, prepended to all agent prompts
}

export interface ProjectSummary {
  id: string;
  name: string;
  domain: DomainId;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  completedAgents: number;
  totalAgents: number;
}
```

### Agents (`frontend/src/types/agent.types.ts`)

```typescript
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'skipped';

export type PhaseId =
  | 'phase1' | 'phase1b' | 'phase2' | 'phase3' | 'phase4'
  | 'phase5' | 'phase6' | 'phase7' | 'phase8';

export type AgentId =
  | 'manager'
  | 'projectCharter' | 'brd'
  | 'stakeholder' | 'userStory' | 'businessRules' | 'feasibility' | 'dataModel'
  | 'architecture' | 'apiDesign' | 'uxResearch' | 'interaction'
  | 'sprintPlanner' | 'taskBreakdown' | 'techDebt'
  | 'testPlan' | 'testCases'
  | 'securityCompliance'
  | 'devopsEngineer' | 'infraEngineer'
  | 'observabilityEngineer' | 'onCallEngineer';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  phase: PhaseId;
  description: string;
  outputLabel: string;
  systemPrompt: string;
  buildUserPrompt: (ctx: AgentPromptContext) => string;
  dependsOn?: AgentId[];
}

export interface TeamRosterEntry {
  name: string;
  role: string;
  agents: AgentId[];
}

export interface AgentPromptContext {
  projectName: string;
  projectDescription: string;
  domain: string;
  domainContext: string;
  priorOutputs: Partial<Record<AgentId, string>>;
  teamRoster: TeamRosterEntry[];
}

export interface AgentRun {
  agentId: AgentId;
  status: AgentStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
}
```

### Domains (`frontend/src/types/domain.types.ts`, `frontend/src/agents/domains.ts`)

```typescript
export interface DomainDefinition {
  id: DomainId;
  label: string;
  color: string;
  bgColor: string;
  context: string; // built-in domain knowledge paragraph injected into every agent prompt
}
```

Define exactly **10 domains**, each with a `label`, brand `color`/`bgColor`, and a dense `context` paragraph covering the domain's regulatory, architectural, and integration concerns:

1. **fintech** — PCI-DSS, AML/KYC, real-time payments, fraud detection, SOX/GDPR, 99.99% availability, audit trails, PSD2 open banking, core banking integration
2. **healthcare** — HIPAA, HL7/FHIR, EHR/EMR integration, PHI handling, FDA medical device regs, clinical workflows, RBAC for clinicians, telemedicine, ICD-10/CPT billing
3. **ecommerce** — scalability, cart abandonment, payment gateways (Stripe/PayPal), inventory, order fulfillment, search/recommendations, A/B testing, SEO, multi-currency, GDPR consent, returns
4. **saas** — multi-tenancy, subscription billing, tenant isolation, feature flags per tier, SSO/SAML, self-service admin, usage analytics, churn prediction, 99.9% SLA, zero-downtime deploys, per-tenant rate limiting
5. **edtech** — FERPA, LMS integration (Canvas/Moodle/Blackboard), SCORM/xAPI, adaptive learning, WCAG 2.1 AA, gamification, progress tracking, video streaming, plagiarism detection
6. **insurtech** — actuarial modeling, policy lifecycle (quote-bind-issue), claims automation, underwriting rules engines, state insurance compliance, reinsurance data exchange, fraud detection, OCR for claims, ACORD standards
7. **legaltech** — attorney-client privilege, e-discovery, contract lifecycle management, e-signature (DocuSign), matter management, conflict checking, LEDES billing, court filing integration, document version control, ABA ethics, data residency
8. **retail** — omnichannel inventory sync, POS integration, loyalty programs, demand forecasting, supply chain visibility, last-mile delivery tracking, shrinkage prevention, BOPIS
9. **manufacturing** — IoT sensor ingestion, predictive maintenance, MES/ERP (SAP) integration, OEE tracking, ISO 9001, production scheduling, traceability, digital twins, SCADA, OSHA, batch records
10. **govtech** — FedRAMP/StateRAMP, Section 508, FIPS 140-2, ATO process, identity proofing (NIST 800-63), open data mandates, legacy modernization, FAR/DFARS, RPO/RTO, FISMA

---

## 2. The 22-agent / 9-phase / 4-gate pipeline

### Phase order and execution mode (`frontend/src/agents/constants.ts`)

```typescript
export const TOTAL_AGENTS = 22;

export const PHASE_ORDER: PhaseId[] = [
  'phase1', 'phase1b', 'phase2', 'phase3', 'phase4',
  'phase5', 'phase6', 'phase7', 'phase8',
];

// Phases whose agents run in parallel (others run sequentially)
export const PARALLEL_PHASES: Set<PhaseId> = new Set([
  'phase2', 'phase3', 'phase4', 'phase7', 'phase8',
]);

export const PHASE_AGENTS: Record<PhaseId, AgentId[]> = {
  phase1:  ['manager'],
  phase1b: ['projectCharter', 'brd'],
  phase2:  ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'],
  phase3:  ['architecture', 'apiDesign', 'uxResearch', 'interaction'],
  phase4:  ['sprintPlanner', 'taskBreakdown', 'techDebt'],
  phase5:  ['testPlan', 'testCases'],
  phase6:  ['securityCompliance'],
  phase7:  ['devopsEngineer', 'infraEngineer'],
  phase8:  ['observabilityEngineer', 'onCallEngineer'],
};

export const REVIEW_GATES = {
  gate1:   ['phase1', 'phase1b'] as PhaseId[],
  gate2_3: ['phase2', 'phase3'] as PhaseId[],
  gate5:   ['phase5'] as PhaseId[],
  gate6:   ['phase6'] as PhaseId[],
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  phase1:  'Phase 1 — Orchestration',
  phase1b: 'Phase 1B — Foundation',
  phase2:  'Phase 2 — Requirements',
  phase3:  'Phase 3 — Design',
  phase4:  'Phase 4 — Dev Planning',
  phase5:  'Phase 5 — Testing',
  phase6:  'Phase 6 — Security',
  phase7:  'Phase 7 — DevOps',
  phase8:  'Phase 8 — Operations',
};
```

### Each of the 22 agents needs

- A unique `systemPrompt` establishing its persona and output format (markdown documents)
- A `buildUserPrompt(ctx)` function that assembles the user-turn prompt from project name/description, domain context (with domain knowledge prepended), and relevant prior agent outputs (`ctx.priorOutputs`)
- `dependsOn` listing prerequisite `AgentId`s used to gate "ready to run" state
- A `diagramLine(hint)` helper string injected into the system prompts of 6 specific agents — **dataModel, architecture, apiDesign, devopsEngineer, infraEngineer, observabilityEngineer** — instructing them to include a Mermaid diagram in their output (ER diagram, architecture diagram, sequence diagram, pipeline diagram, infra diagram, monitoring topology respectively)
- A `teamLine(ctx)` helper injected into **all 22** agent system prompts, listing the project's team roster (name, role, assigned agents) so agents are aware of who owns what

### Gate locking logic

- `getLockedPhases(project)` — returns the set of phases that cannot run yet because an unapproved review gate blocks them
- `gateForPhase(phase)` — given a phase, returns which `ReviewGateId` (if any) gates it
- A phase only becomes runnable once all phases preceding its gate are complete AND that gate is approved

### Pipeline engine (`frontend/src/services/pipelineEngine.ts`)

Core responsibilities:

1. **`buildContext(project, agentId)`** — assembles `AgentPromptContext`:
   - Prepends `project.domainKnowledge` (if set) to the built-in `domain.context`, separated by `\n\n---\n\n`
   - Collects `priorOutputs` from completed dependency agents
   - Builds `teamRoster` from `project.teamMembers` + `project.agentAssignments`

2. **`runAgent(project, agentId)`**:
   - Resolves the effective `systemPrompt`:
     - If a `PromptOverride` exists for this agent and has `fullPrompt` set, use it verbatim (full replacement — this is the "save as project default" feature)
     - Else if a legacy `patch` array exists and `project.mode === 'expert'`, dynamically import `fast-json-patch` and apply the patch to `{ systemPrompt: def.systemPrompt }`
     - Else use the agent definition's default `systemPrompt`
   - Calls the backend proxy (`POST /api/agent`) with `{ systemPrompt, userPrompt, testMode }`
   - Persists the result to `project.agentRuns[agentId]` (status, output, tokens, timestamps)

3. **Sequential vs parallel execution** — phases in `PARALLEL_PHASES` run all their agents concurrently (Promise.all-style with a small concurrency queue, `frontend/src/utils/queue.ts`); other phases run agents one at a time in array order.

4. **Resume support** — pipeline can resume from any incomplete agent/phase after a page reload, driven off persisted `agentRuns` status.

---

## 3. Domain knowledge system (Feature 2)

### Built-in templates (`frontend/src/agents/domainKnowledgeTemplates.ts`)

`DOMAIN_KNOWLEDGE_TEMPLATES: Record<DomainId, string>` — one detailed markdown brief per domain (10 total), each with these sections:

- **Project-Specific Context** — placeholder prose the user is expected to customize
- **Key Regulatory Requirements / Considerations**
- **Architecture Considerations**
- **Integration Landscape**
- **Non-Functional Requirements**

### New-project wizard (`frontend/src/components/dashboard/NewProjectModal.tsx`)

A 2-step modal:

- **Step 1 — Details**: project name, description, domain selector, mode (`simple`/`expert`)
- **Step 2 — Domain Knowledge**: shows a chip with the selected domain, pre-fills a large editable textarea (`rows={18}`) from `DOMAIN_KNOWLEDGE_TEMPLATES[domain]`. Buttons:
  - **↺ Reset to template** — restores the built-in brief for the current domain
  - **↓ Download as .md** — downloads the current textarea content as `domain-knowledge-${domain}.md`
  - Switching domain on Step 1 (or going back) resets the textarea to that domain's template unless the user already edited it

On create, `domainKnowledge: domainKnowledge.trim() || undefined` is saved on the new `Project`.

### Pipeline injection

`pipelineEngine.buildContext()` prepends `project.domainKnowledge` to `domain.context` whenever it's set, so **every agent automatically receives the user's project-specific domain brief** ahead of the generic domain knowledge — no per-agent configuration needed.

### Later editing — Project Settings "Knowledge" tab

`frontend/src/components/settings/ProjectSettings.tsx` gets a 4th tab, **"📚 Domain Knowledge"**:

- Textarea bound to `project.domainKnowledge`, disabled for non-admins
- Save button → `updateProject(project.id, p => { p.domainKnowledge = domainKnowledge.trim() || undefined; })`
- Reset-to-template and Download-as-.md buttons mirroring the wizard

---

## 4. Prompt override / "save as project default" (Feature 1)

In `ProjectWorkspace.tsx`, the per-agent **re-run panel**:

- `openRerun(agentId)` — checks `project.promptOverrides` for an existing `fullPrompt` override for this agent; if found, pre-fills the editable textarea with it, otherwise with the agent's built-in default `systemPrompt`
- **💾 "Save as project default"** button — calls `savePromptOverride()`:
  ```typescript
  async function savePromptOverride() {
    if (!rerunAgent || !project) return;
    await updateProject(projectId, (p) => {
      const existing = p.promptOverrides.findIndex((o) => o.agentId === rerunAgent);
      const entry = { agentId: rerunAgent, patch: [], fullPrompt: rerunPrompt, updatedAt: Date.now() };
      if (existing >= 0) p.promptOverrides[existing] = entry;
      else p.promptOverrides.push(entry);
    });
    setPromptSaved(true);
  }
  ```
  Button is disabled after a successful save until the text changes again; shows a brief success message.
- **"Reset to built-in default"** link (shown only when an override exists for this agent) — calls `resetPromptOverride(agentId)`, which removes the override from `project.promptOverrides` and, if currently editing that agent, restores the textarea to the built-in default
- A saved override **replaces the default for both the initial pipeline run and any future re-runs** of that agent on this project (handled in `pipelineEngine.runAgent`, see section 2)
- Visual indicators:
  - Sidebar agent list: `✏` badge on agents with a saved override (`promptOverrideMap = new Set(...)`)
  - Document viewer header: `· ✏ custom prompt` badge
  - Re-run panel: a banner stating an override is active, with the reset link

---

## 5. Team management

### Role templates (`frontend/src/data/roleTemplates.ts`)

`ROLE_TEMPLATES: RoleTemplate[]` — 10 suggested roles, each with `id`, `title`, `description`, `color`, and `suggestedAgents: AgentId[]` mapping to relevant agents:

1. **Product Manager** — manager, projectCharter, brd, stakeholder, userStory, businessRules, feasibility
2. **Tech Lead** — architecture, apiDesign, dataModel, techDebt
3. **UX Designer** — uxResearch, interaction
4. **Project Manager** — sprintPlanner, taskBreakdown
5. **QA Engineer** — testPlan, testCases
6. **Security Engineer** — securityCompliance
7. **DevOps Engineer** — devopsEngineer, infraEngineer
8. **SRE / Platform Engineer** — observabilityEngineer, onCallEngineer
9. **Engineering Manager** — sprintPlanner, taskBreakdown, techDebt, manager
10. **Architect** — architecture, apiDesign, dataModel, feasibility, infraEngineer

Export `COVERED_AGENTS = new Set(ROLE_TEMPLATES.flatMap(r => r.suggestedAgents))` for highlighting unassigned agents.

### Team panel (`frontend/src/components/team/TeamPanel.tsx`)

- Add/edit/remove `TeamMember` (name, email, role, avatar color, isAdmin flag)
- Assign role templates to quickly populate `agentAssignments`
- Many-to-many agent ↔ member assignment UI
- **Admin guard**: `wouldLeaveNoAdmin(members, memberId)` — pure function preventing removal/demotion of the last remaining admin
- **`activeAdminId`** — no-password "session" selection of which team member is acting as admin; gates write access to Settings tabs

### Team requirement to start pipeline

`teamReady = members.length > 0` — pipeline can start as soon as at least one team member exists (does not require every agent to be explicitly assigned).

---

## 6. App-level settings (Feature 3)

### Entry point — `Dashboard.tsx`

A gear icon (⚙) button in the top-right of the Home page header, next to Import/Export/+New Project, opens `AppSettingsModal`.

### `AppSettingsModal.tsx` (new component)

Two tabs:

**🔑 API & Model**
- Masked password-style inputs for **OpenAI API Key** and **Proxy Token**, each with a show/hide eye toggle
- Model `<select>` with options: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- On save (`handleSaveApi`):
  - Always persists the selected model to `db.settings` (key `app:model`) in IndexedDB
  - If any of apiKey/proxyToken/model are filled in, also `POST`s to `${API_URL}/settings` with header `X-API-Token: <PROXY_TOKEN>`
  - Shows a restart-required hint, since the backend reads `.env` at startup

**🎨 Appearance**
- 3-button theme grid: **Dark 🌙 / Light ☀️ / System 💻**
- `handleSaveTheme(t)`:
  - Applies immediately via `applyTheme(t)` — sets `data-theme` attribute on `<html>`, resolving `system` through `window.matchMedia('(prefers-color-scheme: dark)')`
  - Persists to `db.settings` (key `app:theme`)
  - Shows a "✓ Theme applied" confirmation for 2 seconds

On mount, both `app:model` and `app:theme` are loaded from `db.settings` to initialize the form.

### Theme application on startup (`App.tsx`)

```typescript
function useThemeInit() {
  useEffect(() => {
    db.settings.get('app:theme').then((stored) => {
      const t = (stored?.value as string) ?? 'dark';
      if (t === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', t);
      }
    });
  }, []);
}
```

Call `useThemeInit()` at the top of `App()`, before rendering `Dashboard` / `ProjectWorkspace`.

### CSS theme tokens (`index.css`)

Define a default (dark navy) palette as CSS custom properties (`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--success`, `--warning`, `--error`), then add a `[data-theme="light"]` block that redefines all of these for a light palette, plus `[data-theme="light"] ::-webkit-scrollbar-thumb`.

### Backend `/api/settings` endpoint (`backend/src/proxy.js`)

```javascript
app.post('/api/settings', checkToken, (req, res) => {
  const { openaiApiKey, proxyToken, openaiModel } = req.body ?? {};
  const fs = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../.env');

  try {
    let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];

    function upsert(arr, key, value) {
      if (!value) return arr;
      const idx = arr.findIndex((l) => l.startsWith(key + '='));
      const line = key + '=' + value;
      if (idx >= 0) arr[idx] = line; else arr.push(line);
      return arr;
    }

    if (openaiApiKey) upsert(lines, 'OPENAI_API_KEY', openaiApiKey);
    if (proxyToken)   upsert(lines, 'PROXY_TOKEN', proxyToken);
    if (openaiModel)  upsert(lines, 'OPENAI_MODEL', openaiModel);

    fs.writeFileSync(envPath, lines.filter((l) => l.trim()).join('\n') + '\n', 'utf8');
    return res.json({ ok: true, message: 'Settings saved. Restart the backend for changes to take effect.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to write settings: ' + err.message });
  }
});
```

- Protected by the same `checkToken` middleware (and `PROXY_TOKEN`) used by `/api/agent` — no separate auth mechanism
- Writes/updates `OPENAI_API_KEY`, `PROXY_TOKEN`, `OPENAI_MODEL` lines in `backend/.env`, preserving any other lines, dropping blanks
- Does not hot-reload — frontend should display a restart hint

---

## 7. Backend proxy (`backend/src/proxy.js`)

Express app with:

- `dotenv` config from `backend/.env` (`OPENAI_API_KEY`, `OPENAI_MODEL` default `gpt-4o`, `PROXY_TOKEN`, `PORT` default 3001)
- CORS enabled for all origins
- `express.json({ limit: '2mb' })`
- Rate limiting on `/api` — 120 requests/minute per IP (`express-rate-limit`)
- `checkToken` middleware — if `PROXY_TOKEN` is set, requires header `X-API-Token` to match; otherwise passes through
- **Corporate proxy support**: detects `HTTPS_PROXY`/`HTTP_PROXY` env vars; if set, `httpsPost()` tunnels to `api.openai.com` via an HTTP `CONNECT` request followed by a raw TLS socket (using Node's `http`, `https`, `tls` built-ins — no extra deps), with `rejectUnauthorized: false` to tolerate corporate SSL-inspection certs. If no corporate proxy, makes a direct `https.request`.
- Routes:
  - `GET /api/health` → `{ status, model, proxy, ts }`
  - `POST /api/agent` (auth) → forwards `{ systemPrompt, userPrompt }` to OpenAI chat completions (`temperature: 0.4`, `max_tokens: 4096`); supports a `testMode: true` flag that short-circuits with a canned `[TEST] ...` response (no OpenAI call, used by tests)
  - `POST /api/settings` (auth) → see section 6
  - 404 catch-all returning `{ error: 'Not found' }`
- Exits with an error at startup if `OPENAI_API_KEY` is missing

---

## 8. Persistence layer (Dexie / IndexedDB)

`frontend/src/db/database.ts` — versioned schema migrations:

- **v1** — base `projects` table
- **v2** — adds `teamMembers` / `agentAssignments` arrays to projects
- **v3** — adds `isAdmin`, `memberIds[]` to team members/assignments
- **v4** — adds `domainKnowledge` field to projects (`upgrade` sets `domainKnowledge = null` on existing rows if undefined)
- An `integrations` table (keyed by `id`/`provider`) and a `settings` table (keyed by `key`, used for `app:model`, `app:theme`)

`frontend/src/db/projectRepository.ts` — CRUD: `listProjects`, `getProject`, `createProject`, `updateProject` (functional updater + `version`/`updatedAt` bump), `deleteProject`, `exportAllProjects` / `importProjects` (JSON backup/restore of all projects).

---

## 9. Key UI components

- **`Dashboard.tsx`** — project grid (`ProjectCard`), header with Import/Export/+New Project/⚙ Settings, empty state
- **`NewProjectModal.tsx`** — 2-step wizard (details → domain knowledge), see section 3
- **`ProjectWorkspace.tsx`** — main pipeline view: phase/agent sidebar with status icons and `✏` override badges, document viewer for agent outputs (with `· ✏ custom prompt` badge), re-run panel with prompt editor + save/reset, review gate banners
- **`ReviewGateModal.tsx`** — approve/reject gate with notes, records `approvedBy`/`approvedAt`
- **`ProjectSettings.tsx`** — tabs: General, Team, Assignments, **Knowledge** (new)
- **`AppSettingsModal.tsx`** — tabs: API & Model, Appearance (new)
- **`TeamPanel.tsx`** — team member CRUD, role template application, agent assignment matrix
- **`ResumeModal.tsx`** — offers to resume an in-progress project on app load
- **`ExportMenu.tsx`** / `documentExporter.ts` / `excelExporter.ts` — export agent outputs as Word/Markdown and a traceability matrix as Excel
- **`traceability.ts`** — builds a requirements-to-test traceability matrix from agent outputs

---

## 10. Testing requirements

- **Unit (Vitest)**: `pipelineEngine.test.ts` (buildContext, runAgent, prompt override resolution incl. `fullPrompt` precedence and domain knowledge prepending), `getLockedPhases.test.ts`, `adminGuard.test.ts` (`wouldLeaveNoAdmin`), `roleTemplates.test.ts`, `agentDefinitions.test.ts` (all 22 agents have valid prompts/buildUserPrompt), `sanitize.test.ts`, `buildContext.test.ts`
- **Integration**: `ReviewGate.test.tsx`
- **E2E (Playwright)**: `create-and-run.spec.ts` (full happy path: create project → wizard → run pipeline → approve gates), `accessibility.spec.ts` (a11y checks)
- Target >80% coverage on `pipelineEngine`, gating logic, admin guards, and sanitization utilities
- `npx tsc --noEmit` must pass cleanly (one pre-existing `tsconfig.json` `--ignoreDeprecations` warning is acceptable and unrelated)

---

## 11. Conventions to follow

- CSS Modules per component (`Component.module.css`), theming entirely via CSS custom properties so `[data-theme="light"]` overrides work without per-component changes
- Dark navy default palette; accent color indigo/purple (`#6366f1`-ish)
- Use emoji icons sparingly for section/tab labels (⚙ 🔑 🎨 📚 ↺ ↓ 💾 ✏ ✓) — consistent with existing UI
- All Dexie writes go through `updateProject(id, updaterFn)` to keep `version`/`updatedAt` bumps centralized
- Admin-gated UI (Settings tabs, prompt overrides, team management) checks `project.activeAdminId` against `teamMembers` with `isAdmin: true`
- Keep the frontend stateless with respect to secrets — API keys and tokens live only in `backend/.env`, written via `/api/settings`

---

*End of prompt.*
