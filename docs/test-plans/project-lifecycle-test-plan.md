# Module 2 Test Plan: Project Lifecycle (Archive, Restore, Delete)

Companion to `docs/architecture/project-lifecycle.md`. Covers the
archive/restore/delete UI in `ProjectSettings.tsx` (General tab),
`AppSettingsModal.tsx` (Projects tab), and `Dashboard.tsx` /
`ProjectCard.tsx`.

---

## 1. Scope and approach

| File | Test file | Approach | Rationale |
|---|---|---|---|
| `db/projectRepository.ts` | `tests/unit/projectRepository.test.ts` (existing, Module 1) | Already covers TS-7, TS-12, TS-13 — see §1.1. | No new repo-layer tests needed; re-reviewed 2026-06-11 and confirmed sufficient. |
| `components/settings/ProjectSettings.tsx` (General tab, Danger Zone) | `tests/unit/ProjectSettings-archive.test.tsx` | Real component render via React Testing Library. Mock `db/database` (in-memory `projects`/`settings`/`integrations` tables, same pattern as `projectRepository.test.ts`), `services/api`, `hooks/useIntegrations`. | First real-component test in this codebase (existing `ReviewGate.test.tsx` uses a stub). Full component render is needed because the Danger Zone reads `isAdmin`/`members` derived from component state, not just props. |
| `components/settings/AppSettingsModal.tsx` (Projects tab) | `tests/unit/AppSettingsModal-projects.test.tsx` | Real component render via RTL. Mock `db/database`, `db/projectRepository` re-exports are used directly so mocking `db/database` is sufficient; mock `services/api` (namespace import) and `agents/promptDefaults`/`agents/domainKnowledgeDefaults` indirectly via the same `db/database` mock. | Projects tab is reached by clicking the "Projects" nav button; default tab is `'api'`. |
| `components/dashboard/Dashboard.tsx` + `ProjectCard.tsx` | `tests/unit/Dashboard-archive.test.tsx` | Real component render via RTL. Mock `db/projectRepository` directly (Dashboard imports `listProjects`, `deleteProject`, `restoreProject`, `exportAllProjects`, `importProjects` — only the first three matter for this module) and `dexie-react-hooks`'s `useLiveQuery` (or let it run against the mocked `db` — see Test Notes). | Exercises the `showArchived` toggle, `ProjectCard`'s restore/delete buttons, and conditional rendering of archive metadata. |

### 1.1 Why no new repository tests

Reviewed `tests/unit/projectRepository.test.ts` (274 lines) on 2026-06-11.
Existing coverage:

- **TS-7** (`listProjects`): creates a project, sets all four archive fields
  via `updateProject`, asserts `listProjects()` surfaces `archived`,
  `archivedReason`, `archivedAt`, `archivedBy` on the summary.
- **TS-12** (`deleteProject`): creates and deletes a project, asserts
  `getProject` returns `undefined` afterward.
- **TS-13** (`restoreProject`): sets all four archive fields, calls
  `restoreProject`, asserts all four are cleared (`archived: false`, the
  rest `undefined`).

An archive→restore→re-archive round trip would just be TS-7 followed by
TS-13 followed by TS-7 again with the same mocked `updateProject` — no new
code path. Decided not to add a redundant test.

---

## 2. Test scenarios

### 2.1 `ProjectSettings.tsx` — Danger Zone (General tab)

| # | Scenario | Type |
|---|---|---|
| TS-32 | Non-admin session: Danger Zone is not rendered at all | Access control |
| TS-33 | Admin session, project not archived: "Delete Project…" button shown; clicking it reveals a required reason textarea | Happy path |
| TS-34 | Admin clicks "Confirm Delete" with an empty reason: validation error shown ("A reason is required to delete this project."), `updateProject` is **not** called | Validation |
| TS-35 | Admin enters a reason and clicks "Confirm Delete": `updateProject` is called setting `archived: true`, `archivedReason` (trimmed), `archivedAt`, and `archivedBy` to the admin's team-member name; `onClose` is called | Happy path |
| TS-36 | Admin session whose `adminSessionId` does not match any current `teamMembers` entry archives a project: `archivedBy` falls back to the raw `adminSessionId` string | Edge case |
| TS-37 | Project already archived, admin session: info text shows archived-by/at/reason (each conditionally), and "↩ Restore Project" button is shown | Happy path |
| TS-38 | Admin clicks "↩ Restore Project": `updateProject` is called clearing `archived`, `archivedReason`, `archivedAt`, `archivedBy`; modal does **not** close | Happy path |
| TS-39 | Admin clicks "Delete Project…" then "Cancel": reason textarea is hidden again, no `updateProject` call | Happy path |

### 2.2 `AppSettingsModal.tsx` — Projects tab

| # | Scenario | Type |
|---|---|---|
| TS-40 | Open Projects tab with only active projects: archived-toggle button is **not** shown (`archivedCount === 0`); active projects listed | Happy path |
| TS-41 | Open Projects tab with at least one archived project: "Archived (N)" toggle shown; clicking it filters to archived projects and relabels to "← Active Projects" | Happy path |
| TS-42 | Active view, empty project list: "No projects yet." shown | Edge case |
| TS-43 | Archived view, no archived projects (toggle not normally reachable, but tests the branch directly): "No archived projects." shown | Edge case |
| TS-44 | Click "🗄 Archive" on an active project: inline form appears (text input + Confirm + Cancel); Confirm is disabled while the input is empty | Happy path |
| TS-45 | Type a reason and click "Confirm": `updateProject` called with `archived: true`, `archivedReason` (trimmed), `archivedAt`, `archivedBy: 'App Settings'`; inline form closes | Happy path |
| TS-46 | Click "Cancel" on the inline archive form: form closes, no `updateProject` call | Happy path |
| TS-47 | Archived view, click "↩ Restore": `restoreProject(id)` (from `db/projectRepository`) is called | Happy path |
| TS-48 | Click "🗑 Delete", confirm dialog accepted (`window.confirm` returns `true`): `deleteProject(id)` is called | Happy path |
| TS-49 | Click "🗑 Delete", confirm dialog declined (`window.confirm` returns `false`): `deleteProject` is **not** called | Edge case |
| TS-50 | Archived view shows `"{archivedBy}: {archivedReason}"` and the archived date for a project archived via `ProjectSettings` (i.e. `archivedBy` is a person's name, not `'App Settings'`) | Happy path |

### 2.3 `Dashboard.tsx` / `ProjectCard.tsx`

| # | Scenario | Type |
|---|---|---|
| TS-51 | All projects active: "Archived (N)" toggle not shown; all projects rendered with "✕" delete buttons (no restore) | Happy path |
| TS-52 | At least one archived project: toggle shown as "Archived (N)"; default view still shows only active projects | Happy path |
| TS-53 | Click "Archived (N)" toggle: view switches to archived projects only, toggle relabels "← Active Projects", each card shows "↩ Restore" instead of "✕" | Happy path |
| TS-54 | Archived view, no archived projects somehow (filtered to empty): "No archived projects." shown | Edge case |
| TS-55 | `ProjectCard` in archived view with `archivedReason` set: italic `"{archivedBy}: {archivedReason}"` line rendered; footer shows "Archived {date}" from `archivedAt` | Happy path |
| TS-56 | Click "↩ Restore" on an archived card: `restoreProject(id)` called, no confirmation dialog | Happy path |
| TS-57 | Click "✕" on an active card, confirm accepted: `deleteProject(id)` called | Happy path |
| TS-58 | Click "✕" on an active card, confirm declined: `deleteProject` **not** called | Edge case |
| TS-59 | Click "✕"/"↩ Restore": `e.stopPropagation()` prevents the card's `onOpen` from firing | Edge case |

---

## 3. Test cases (selected — full detail in test files)

### TC-7 (covers TS-34, TS-35) — `ProjectSettings` archive validation + success

```
Given an admin session is active and project.archived is falsy
When the user switches to the General tab, clicks "Delete Project…",
  and clicks "Confirm Delete" with an empty textarea
Then "A reason is required to delete this project." is shown
  and updateProject is not called

When the user types "Scope merged into Project X" and clicks "Confirm Delete"
Then updateProject(project.id, updater) is called where updater produces:
  { archived: true, archivedReason: "Scope merged into Project X",
    archivedAt: <number>, archivedBy: <admin member's name> }
  and onClose() is called
```

### TC-8 (covers TS-36) — `archivedBy` fallback

```
Given adminSessionId = "session-xyz" and no teamMembers entry has id "session-xyz"
  (simulated by setting activeAdminId to an id not present in teamMembers,
  or by removing the member after session selection)
When the admin archives the project with a valid reason
Then archivedBy is set to "session-xyz" (the raw session id), not a name
```

### TC-9 (covers TS-44, TS-45, TS-46) — `AppSettingsModal` inline archive form

```
Given the Projects tab is open showing one active project "Demo Project"
When the user clicks "🗄 Archive"
Then an inline text input and "Confirm"/"Cancel" buttons appear,
  and "Confirm" is disabled (empty input)

When the user types "Duplicate of another project" and clicks "Confirm"
Then updateProject(projectId, updater) is called producing:
  { archived: true, archivedReason: "Duplicate of another project",
    archivedAt: <number>, archivedBy: "App Settings" }
  and the inline form closes

---

Given the inline form is open with some text typed
When the user clicks "Cancel"
Then the form closes and updateProject is not called
```

### TC-10 (covers TS-48, TS-49) — `AppSettingsModal` permanent delete confirmation

```
Given window.confirm is mocked
When the user clicks "🗑 Delete" for project "Demo Project"
  and window.confirm returns true
Then deleteProject(projectId) is called

When window.confirm returns false
Then deleteProject is not called
```

### TC-11 (covers TS-53, TS-56) — Dashboard archived toggle + restore

```
Given listProjects() resolves to one active and one archived project
When Dashboard renders
Then the "Archived (1)" button is shown and only the active project's
  card is visible

When the user clicks "Archived (1)"
Then the button relabels to "← Active Projects" and the archived
  project's card is shown with an "↩ Restore" button (no "✕")

When the user clicks "↩ Restore"
Then restoreProject(archivedProjectId) is called
```

### TC-12 (covers TS-57, TS-58, TS-59) — ProjectCard delete confirmation + stopPropagation

```
Given onOpen, onDelete are mock functions and window.confirm is mocked
When the user clicks "✕" and window.confirm returns true
Then onDelete() is called and onOpen() is NOT called (stopPropagation)

When window.confirm returns false
Then neither onDelete() nor onOpen() is called
```

---

## 4. E2E considerations

No new Playwright E2E tests are added for Module 2. Archive/restore/delete
are reachable via three different UI surfaces with non-trivial setup
(team member admin sessions, app settings modal navigation); the new RTL
component tests give faster, more isolated feedback for each surface's
logic. If end-to-end coverage of the lifecycle is later prioritized, a
candidate scenario would be: create project → archive via Dashboard
ProjectCard's surface → verify it disappears from the active list and
appears in the archived list → restore → verify it reappears active.

---

## 5. Coverage expectations

`frontend/vite.config.ts` thresholds (unchanged): `lines: 80, functions: 80,
branches: 75, statements: 80`, v8 provider, scope `src/**/*.{ts,tsx}`.

As with Module 1, this sandbox cannot run `npm run test:coverage`
(`vitest` binary missing from `node_modules/.bin`). To get actual numbers:

```bash
cd frontend
npm install
npm run test:coverage
```

Expected outcome of adding this module's three test files:

- `components/dashboard/Dashboard.tsx` and `ProjectCard.tsx` — both small,
  fully exercised by the new tests; should reach high coverage (likely
  >80% lines each).
- `components/settings/ProjectSettings.tsx` (1033 lines) — the new tests
  only exercise the General tab's Danger Zone (~40 lines of render logic +
  the two archive/restore handlers). The file's overall coverage will move
  up but almost certainly remain well below 80% on its own, since Team,
  Assignments, and Knowledge tabs (GitHub integration, domain knowledge,
  branding guidelines, role management) are out of scope for this module
  and untested. **This is expected** — those tabs belong to other features
  (Modules covering team management, GitHub integration, etc.) and should
  get their own test files.
- `components/settings/AppSettingsModal.tsx` (666 lines) — same situation:
  new tests cover only the Projects tab (~100 lines); API/Appearance/Prompts/
  Domains tabs remain untested by this module.

**Project-wide impact**: these three new test files add coverage for
previously-untested UI components (`Dashboard`, `ProjectCard`, and slices
of `ProjectSettings`/`AppSettingsModal`), which were very likely the largest
gaps relative to the 80% threshold given Module 1 already covered the
fully-tested-or-not `db`/`services` layer. Actual percentage must be
confirmed by running `test:coverage` locally as above.
