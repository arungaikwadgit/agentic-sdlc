# Module 2: Project Lifecycle (Archive, Restore, Delete)

> Part of the Agentic SDLC documentation set. This module covers the
> soft-delete (archive/restore) and hard-delete (permanent delete) lifecycle
> for projects, and the three UI surfaces that expose it.

**Source files covered:**

- `frontend/src/types/project.types.ts` (archive fields on `Project` / `ProjectSummary`)
- `frontend/src/db/projectRepository.ts` (`restoreProject`, `deleteProject`, archive-field surfacing in `listProjects`)
- `frontend/src/components/settings/ProjectSettings.tsx` (General tab "Danger Zone")
- `frontend/src/components/settings/AppSettingsModal.tsx` (Projects tab)
- `frontend/src/components/dashboard/Dashboard.tsx`
- `frontend/src/components/dashboard/ProjectCard.tsx`

---

## 1. Requirements

### 1.1 Purpose

Projects accumulate real work (agent outputs, team rosters, integration
links). Deleting that data immediately and irreversibly is risky, so the app
provides a two-step lifecycle:

1. **Archive** (soft delete) — hides a project from the normal dashboard
   view, records who archived it and why, and remains fully recoverable.
2. **Permanent delete** (hard delete) — removes the project record from
   IndexedDB entirely. Not recoverable.

Archive/restore/delete actions are available from three places, aimed at
different users:

- **Project owner, in-context**: `ProjectSettings` → General tab → Danger
  Zone (per-project, requires being signed in as an admin team member).
- **App administrator, bulk view**: `AppSettingsModal` → Projects tab (lists
  every project, active or archived, with inline archive/restore/delete).
- **Dashboard**: the project list itself, with an "Archived" filter toggle
  and per-card restore/delete actions.

### 1.2 Functional requirements

| ID | Requirement |
|----|-------------|
| R1 | Archiving a project requires a non-empty reason and records who archived it and when. |
| R2 | Archived projects are hidden from the default (active) dashboard view but remain in the database. |
| R3 | An archived project can be restored, which clears all archive metadata and makes it active again. |
| R4 | Permanent delete removes the project record from IndexedDB and cannot be undone. |
| R5 | Archive/restore from `ProjectSettings` is gated to admin team members only (`isAdmin`). |
| R6 | The Dashboard and App Settings → Projects tab must both reflect archive state via `listProjects()` (live query), so changes from either surface are immediately visible in the other. |
| R7 | Permanent delete must require explicit user confirmation (`window.confirm`) before calling `deleteProject`. |

### 1.3 Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | Archive/restore must go through `updateProject` (not a direct `db.projects.put`), so `version`/`updatedAt` stay consistent — see Module 1, §2.4. |
| NFR2 | The "reason" field is mandatory in the UI (button disabled / validation error) for both `ProjectSettings` and `AppSettingsModal` archive flows, but **not** enforced at the repository layer — `archivedReason` is an optional string on `Project`. |

---

## 2. Design

### 2.1 Data model

`frontend/src/types/project.types.ts` — four optional fields, present on
both `Project` (full record) and `ProjectSummary` (dashboard projection):

| Field | Type | Set by | Cleared by |
|---|---|---|---|
| `archived` | `boolean?` | archive actions (`true`) | `restoreProject` (`false`) |
| `archivedReason` | `string?` | archive actions (trimmed, required in UI) | `restoreProject` (`undefined`) |
| `archivedAt` | `number?` | archive actions (`Date.now()`) | `restoreProject` (`undefined`) |
| `archivedBy` | `string?` | archive actions (see §2.4 for how this differs by surface) | `restoreProject` (`undefined`) |

**Schema/migration note**: unlike `teamMembers`, `agentAssignments`, and
`domainKnowledge` (each added via a Dexie `.upgrade()` migration — see
Module 1 §2.3, schema versions v2–v4), the four archive fields were **not**
added via a migration. They are simply optional fields on the TypeScript
type. This works correctly because:

- All four fields are optional (`?`), so existing records without them are
  valid `Project` objects — `project.archived` reads as `undefined`
  (falsy), which the UI and `listProjects` treat the same as `false`.
- No code path requires these fields to exist with a default value (compare
  `domainKnowledge`, which v4 explicitly backfills to `null` because some
  code expected the key to be present).

This is **not a bug**, but it is an inconsistency with the pattern
established in Module 1 and is worth a note if a future migration ever
needs to query/index on `archived` (Dexie can't index a field that may not
exist on older records without a backfill migration).

### 2.2 Repository layer (`db/projectRepository.ts`)

| Function | Behavior re: lifecycle |
|---|---|
| `listProjects()` | Maps each `Project` to a `ProjectSummary`, copying `archived`, `archivedReason`, `archivedAt`, `archivedBy` through unchanged. Covered by `tests/unit/projectRepository.test.ts` TS-7. |
| `restoreProject(id)` | `updateProject(id, p => { p.archived = false; p.archivedReason = undefined; p.archivedAt = undefined; p.archivedBy = undefined; })`. Covered by TS-13. |
| `deleteProject(id)` | `db.projects.delete(id)` — direct hard delete, bypasses `updateProject` (no version stamp needed since the record ceases to exist). Covered by TS-12. |

Archiving itself (`archived = true` + setting reason/timestamp/actor) is
**not** a repository function — each UI surface calls `updateProject`
directly with its own updater (see §2.4). There is no shared `archiveProject(id,
reason, actor)` helper in the repository layer.

### 2.3 UI surfaces — overview

```
┌─────────────────────────────────────────────────────────────┐
│ Dashboard.tsx                                                  │
│  - useLiveQuery(listProjects)                                  │
│  - showArchived toggle: filters allProjects by .archived       │
│  - renders <ProjectCard> per project                           │
└───────────────────────────┬───────────────────────────────────┘
                             │ onDelete / onRestore callbacks
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ ProjectCard.tsx                                                │
│  - onDelete: confirm() → deleteProject(id)                     │
│  - onRestore (only passed when showArchived): restoreProject() │
│  - shows archivedReason/archivedBy/archivedAt when archived    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ProjectSettings.tsx (per-project modal, General tab)           │
│  - Danger Zone, isAdmin-gated                                  │
│  - archiveProject(): validates reason, sets archived fields,   │
│    archivedBy = team member name (or session id), onClose()    │
│  - restoreProject(): clears all 4 fields                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ AppSettingsModal.tsx (app-wide modal, Projects tab)             │
│  - useLiveQuery(listProjects), showArchivedProjects toggle     │
│  - confirmArchive(): archivedBy = 'App Settings' (hardcoded)    │
│  - handleRestoreProject() / handleDeleteProject() (with confirm)│
└─────────────────────────────────────────────────────────────┘
```

### 2.4 `ProjectSettings.tsx` — Danger Zone (General tab)

Lines ~526–566. Rendered only inside `{isAdmin && (...)}` — non-admin
viewers see no archive/restore/delete controls at all.

State (lines 60–62): `showArchiveConfirm`, `archiveReason`, `archiveError`.

Three render branches based on `project.archived` / `showArchiveConfirm`:

1. **`project.archived === true`**: shows who archived it, when, and why
   (all conditionally rendered — each of `archivedBy`/`archivedAt`/
   `archivedReason` may be absent), plus a "↩ Restore Project" button
   wired to `restoreProject()`.
2. **Not archived, confirm not shown**: explanatory text + "Delete
   Project…" button that sets `showArchiveConfirm = true`.
3. **Not archived, confirm shown**: required textarea bound to
   `archiveReason`, an `archiveError` message slot, "Confirm Delete" (calls
   `archiveProject()`) and "Cancel" (resets all three pieces of state).

`archiveProject()` (lines 132–147):

```ts
async function archiveProject() {
  if (!isAdmin) return;
  if (!archiveReason.trim()) {
    setArchiveError('A reason is required to delete this project.');
    return;
  }
  setArchiveError(null);
  const archivedByMember = members.find((m) => m.id === adminSessionId);
  await updateProject(project.id, (p) => {
    p.archived = true;
    p.archivedReason = archiveReason.trim();
    p.archivedAt = Date.now();
    p.archivedBy = archivedByMember?.name ?? adminSessionId;
  });
  onClose();
}
```

Notes:

- `archivedBy` resolves to the **team member's name** if the current
  `adminSessionId` matches a member, otherwise falls back to the raw
  `adminSessionId` string. This means `archivedBy` could end up being a
  session id (not a human-readable name) if the admin session doesn't
  correspond to a current team member — an edge case worth testing.
- On success, the modal closes itself via `onClose()`. Restore does **not**
  close the modal — the admin stays on the General tab and sees the
  "archived" branch re-render (since `project` is reactive via
  `useLiveQuery` upstream).

`restoreProject()` (lines 149–157) — local function, distinct from (but
delegating the actual write to the same shape as) the repository's
`restoreProject`:

```ts
async function restoreProject() {
  if (!isAdmin) return;
  await updateProject(project.id, (p) => {
    p.archived = false;
    p.archivedReason = undefined;
    p.archivedAt = undefined;
    p.archivedBy = undefined;
  });
}
```

> **Naming note**: `ProjectSettings.tsx` defines its own local
> `restoreProject()` function (component-scoped, calls `updateProject`
> directly) which happens to have the same name and same effect as
> `db/projectRepository.ts`'s exported `restoreProject(id)`. They are not
> the same function — `ProjectSettings` does not import the repository
> version. `AppSettingsModal.tsx`, by contrast, *does* import and call the
> repository's `restoreProject` (see §2.5). This duplication is harmless
> (both produce the same field changes) but is a candidate for
> consolidation in a future cleanup.

### 2.5 `AppSettingsModal.tsx` — Projects tab

Tab type includes `'projects'` (line 21). State (lines 91–93):
`showArchivedProjects`, `archivingId`, `archiveReasonDraft`. Data source:
`useLiveQuery(() => listProjects(), [])`.

Handlers (lines 263–292):

```ts
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
  await restoreProject(projectId); // imported from db/projectRepository
}
async function handleDeleteProject(projectId: string, name: string) {
  if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
  await deleteProject(projectId); // imported from db/projectRepository
}
```

Render (lines 549–645):

- `archivedCount` / `visibleProjects` computed from `allProjectSummaries`
  filtered by `showArchivedProjects`.
- Toggle button ("Archived (N)" / "← Active Projects") shown only if
  `archivedCount > 0`.
- Empty states: "No archived projects." vs. "No projects yet."
- Per-project row shows name, domain chip, status, and (in archived view)
  the archived date and `"{archivedBy}: {archivedReason}"` line.
- Inline archive form when `archivingId === p.id`: text input (required),
  "Confirm" (disabled if empty), "Cancel".
- Action buttons: "↩ Restore" (archived view) **or** "🗄 Archive" (active
  view, hidden while `archivingId === p.id`), plus an always-present "🗑
  Delete" button.

**Key difference from `ProjectSettings`**: `archivedBy` is the hardcoded
literal `'App Settings'`, not a team member name. So a project archived from
this surface always shows "App Settings: {reason}" rather than a person's
name. There is no admin-gating here — the App Settings modal itself is the
gate (any user who can open App Settings can archive/restore/delete any
project).

### 2.6 `Dashboard.tsx` / `ProjectCard.tsx`

`Dashboard.tsx`:

```ts
const allProjects = useLiveQuery(() => listProjects(), []) ?? [];
const archivedCount = allProjects.filter((p) => p.archived).length;
const projects = allProjects.filter((p) => (showArchived ? !!p.archived : !p.archived));
```

- "Archived (N)" / "← Active Projects" toggle shown only if
  `archivedCount > 0` (same pattern as `AppSettingsModal`).
- Each `<ProjectCard>` receives `onDelete={() => deleteProject(p.id)}` and
  `onRestore={showArchived ? () => restoreProject(p.id) : undefined}` —
  restore is only wired up when viewing the archived list.
- Empty states: "No archived projects." (when `showArchived` and the
  filtered list is empty) vs. the general `<EmptyState>` component.

`ProjectCard.tsx` (props: `project`, `onOpen`, `onDelete`,
`onRestore?`):

- `handleDelete`: `e.stopPropagation()` then
  `confirm('Delete "${project.name}"? This cannot be undone.')`, then
  `onDelete()`.
- `handleRestore`: `e.stopPropagation()` then `onRestore?.()` (no
  confirmation — restore is non-destructive).
- If `onRestore && project.archivedReason`, renders an italic line:
  `{archivedBy ? '${archivedBy}: ' : ''}"${archivedReason}"`.
- Footer date: `onRestore && project.archivedAt` → "Archived {date}",
  else the normal `updatedAt` date.
- Renders "↩ Restore" if `onRestore` is provided, else "✕" (delete).

---

## 3. Development notes

- **Three independent archive code paths**: `ProjectSettings.archiveProject`,
  `AppSettingsModal.confirmArchive`, and (implicitly) nothing on
  `Dashboard`/`ProjectCard` — the dashboard only restores/deletes, it never
  archives directly. The two archive paths differ only in how `archivedBy`
  is computed (team member name vs. literal `'App Settings'`) and in
  surrounding UI (modal-close vs. inline-row-collapse). If a third archive
  surface is ever added, consider extracting a shared
  `archiveProject(projectId, reason, actor)` repository helper to avoid a
  third copy of this logic.
- **Restore has two implementations** (see §2.4 naming note):
  `ProjectSettings`'s local `restoreProject()` vs. the imported
  `db/projectRepository.restoreProject(id)` used by `AppSettingsModal` and
  `Dashboard`. Both produce identical field changes. Low risk, but a
  refactor target.
- **No archive-field migration** (see §2.1): if a future feature needs to
  query/filter/index on `archived` at the Dexie level (e.g. `db.projects.where('archived').equals(...)`),
  a new schema version with a backfill `.upgrade()` would be needed first,
  since `archived` isn't currently in the `projects` index string
  (`'id, domain, status, createdAt, updatedAt'`).
- **`archivedBy` can be a non-name string**: in `ProjectSettings`, if
  `adminSessionId` doesn't match any current `members` entry (e.g. the
  member was later removed from the team), `archivedBy` falls back to the
  raw session id rather than a name.

---

## 4. Test plan summary

See `docs/test-plans/project-lifecycle-test-plan.md` for full scenarios and
cases.

| Area | Test file | Approach |
|---|---|---|
| Repository (`listProjects`, `restoreProject`, `deleteProject`) | `tests/unit/projectRepository.test.ts` (TS-7, TS-12, TS-13) | Already covered by Module 1 — see note below. |
| `ProjectSettings.tsx` Danger Zone | `tests/unit/ProjectSettings-archive.test.tsx` | Real component render (RTL), mocking `db`, `services/api`, `useIntegrations`. |
| `AppSettingsModal.tsx` Projects tab | `tests/unit/AppSettingsModal-projects.test.tsx` | Real component render (RTL), mocking `db/projectRepository` and `services/api`. |
| `Dashboard.tsx` / `ProjectCard.tsx` | `tests/unit/Dashboard-archive.test.tsx` | Real component render (RTL), mocking `db/projectRepository`. |

**Why no new repository tests**: `tests/unit/projectRepository.test.ts`
already includes TS-7 (`listProjects` surfaces all four archive fields),
TS-12 (`deleteProject` is permanent), and TS-13 (`restoreProject` clears all
four fields), written as part of Module 1. Re-reviewed during Module 2
scoping (2026-06-11) and confirmed sufficient — no edge cases were found
that these don't already cover (archive→restore→re-archive is a
straightforward repeat of the same `updateProject` calls already exercised).

---

## 5. Deployment & maintenance notes

- **No backend involvement** — same as Module 1, this is entirely
  client-side IndexedDB state.
- **Coverage thresholds**: `frontend/vite.config.ts` enforces `lines: 80,
  functions: 80, branches: 75, statements: 80` (v8 provider, project-wide).
  Unchanged by this module. `ProjectSettings.tsx` and `AppSettingsModal.tsx`
  are large files with many features beyond the lifecycle; the new component
  tests target the Danger Zone / Projects tab specifically and will move
  these files' coverage up but likely not to 80% on their own — other
  modules' UI tests will need to cover the remaining tabs/features.
- **Recommended fast-follow**: extract a shared `archiveProject(projectId,
  reason, actor)` repository function (see §3) so `ProjectSettings` and
  `AppSettingsModal` share one implementation, and add a backfill migration
  for `archived` if it's ever added to the Dexie index.
