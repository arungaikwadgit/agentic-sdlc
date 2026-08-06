# Module 4 Test Plan: Team & Roles

Covers `ProjectSettings.tsx` (Team tab, Agent Assignments tab, and the
admin-session bar shared with all tabs) and `data/roleTemplates.ts`
(`ROLE_TEMPLATES`, `COVERED_AGENTS`, `buildTeamRoster`).

---

## 1. Scope and approach

`ProjectSettings.tsx` is large (1032 lines, 4 tabs). Module 2
(`project-lifecycle-test-plan.md`) already covers the **General** tab's
Danger Zone (archive/restore, TS-32–TS-39) in
`tests/unit/ProjectSettings-archive.test.tsx`. This module adds two new
files:

- `tests/unit/ProjectSettings-team.test.tsx` (TS-86–TS-100) — Team tab:
  add/remove members, admin toggling, role visibility reference panel,
  admin session selection.
- `tests/unit/ProjectSettings-assignments.test.tsx` (TS-101–TS-108) —
  Agent Assignments tab: matrix toggles, quick-apply role templates, clear
  assignments, role-template seeding on member add.

`roleTemplates.test.ts` already exists but is **stale** (asserts 10
templates, missing `scrum-master`) — TS-109–TS-111 fix and extend it,
including new coverage for `buildTeamRoster`.

`TeamPanel.tsx` is dead code (not imported anywhere — see
`team-and-roles.md` §3.1) and is **out of scope** for new tests. No tests
exist for it today and none are added.

---

## 2. Mocking strategy

Both `ProjectSettings-team.test.tsx` and `ProjectSettings-assignments.test.tsx`
reuse the mocking pattern from `ProjectSettings-archive.test.tsx`:

| Module | Mock |
|---|---|
| `@/db/database` | `db.projects`/`db.settings`/`db.integrations` stubs (transitively required by `projectRepository`, `promptDefaults`, `domainKnowledgeDefaults`) |
| `@/db/projectRepository` | `updateProject` → captures `(id, updater)`, applies `updater` to a `structuredClone` of the current project for assertions |
| `@/services/api` | `api.callAgent`, `api.extractText`, `api.generateDomainKnowledge`, `api.generateBrandingGuidelines`, `api.fetchSiteBranding`, `api.testGithubConnection` — all `vi.fn()`, unused by Team/Assignments tabs but imported at module scope |
| `@/hooks/useIntegrations` | `useIntegrations()` → `{ saveCredential, loadCredential: async () => null, removeCredential }` |

`roleTemplates.test.ts` needs no mocks — it imports pure data/functions.

---

## 3. Test cases — `ProjectSettings-team.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-86 | Empty project, fill in name/email, select a role from `visibleRoleTemplates`, click "+ Add Member" | `updateProject` called; resulting `teamMembers` has one entry with `isAdmin: true`, `avatarColor` = first `AVATAR_COLORS` entry; `agentAssignments` seeded with that member's id for every agent in the matching `ROLE_TEMPLATES.suggestedAgents` |
| TS-87 | Submit add-member form with empty name | Inline error "Name is required"; `updateProject` not called |
| TS-88 | Submit with name filled but invalid email (no `@`) | Inline error "Valid email is required"; `updateProject` not called |
| TS-89 | Submit with name + valid email but no role selected (and not "Custom role...") | Inline error "Role is required — pick from the list or choose Custom"; `updateProject` not called |
| TS-90 | Select "Custom role..." and type a custom role, then add | Member created with `role` = the typed custom string; no `ROLE_TEMPLATES` match, so no `agentAssignments` are seeded |
| TS-91 | Project has 1 member (non-admin session, i.e. no `activeAdminId` selected) and `members.length > 0` | Add-member inputs are `disabled`; "🔒 Select an admin identity above to add or remove members." hint shown |
| TS-92 | Two members, admin session active; admin clicks "Remove" on the non-admin member | `updateProject` called; resulting `teamMembers` excludes that member, and every `agentAssignments[].memberIds` no longer contains their id |
| TS-93 | One member (the only admin); admin session active; "Remove" button | Button is `disabled` (`isLastAdmin`); clicking does not call `updateProject` |
| TS-94 | Two members (one admin, one not), admin session active; click "Remove" on the **admin** member while a second admin exists | Allowed — `updateProject` called, member removed; if `activeAdminId === memberId`, `p.activeAdminId` is cleared |
| TS-95 | Two admins, admin session active; click "○ Make admin" / "🔑 Admin" toggle on the other admin to revoke | `updateProject` called; that member's `isAdmin` flips to `false` |
| TS-96 | One admin only; click "🔑 Admin" (revoke) on them | Button `disabled` (`isLastAdmin && m.isAdmin`); clicking does not call `updateProject`; if forced, inline error "Cannot revoke admin from {name} — they are the only admin..." |
| TS-97 | Member with no `agentAssignments` entry referencing their id | Member card shows "⚠ No agents assigned — pipeline cannot run" instead of agent pills, and the card has the warning style |
| TS-98 | Open "📋 Suggested roles & agent mappings reference" `<details>` | All 11 `ROLE_TEMPLATES` render as cards with title, description, and `suggestedAgents` joined by " · "; cards whose id is in `disabledRoleIds` render at reduced opacity |
| TS-99 | Admin session active; click "Visible — hide" on a role card | `updateProject` called; resulting `disabledRoleIds` includes that role's id; clicking again ("Hidden — show") removes it |
| TS-100 | "Viewing as" `<select>`: choose a member | `selectAdminSession` called; `updateProject` sets `p.activeAdminId` to the chosen member id (or `undefined` if the empty option is chosen); local `adminSessionId` state updates so `isAdmin`-gated controls re-evaluate |

---

## 4. Test cases — `ProjectSettings-assignments.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-101 | Project with zero team members, Assignments tab open | Shows "Add team members first to configure assignments." — no matrix rendered |
| TS-102 | Admin session active, 2 members, Assignments tab; click an unchecked matrix cell for (agentX, memberA) | `toggleAgentMember` → `updateProject`; resulting `agentAssignments` has an entry for `agentX` with `memberA.id` added to `memberIds` (entry created if it didn't exist) |
| TS-103 | Same as TS-102 but the cell is already checked (memberA already in `agentX.memberIds`) | Clicking removes `memberA.id` from `memberIds` (entry remains, possibly with empty `memberIds`) |
| TS-104 | Non-admin session (no `activeAdminId`, or selected member `isAdmin: false`) | Matrix toggle buttons are `disabled`; clicking does not call `updateProject`; legend shows "Select an admin identity to edit assignments." |
| TS-105 | Phase filter `<select>` changed from "All phases" to a specific `PHASE_ORDER` entry | Matrix renders only that phase's agent rows (`PHASE_AGENTS[phase]`) |
| TS-106 | Admin session active; "Quick-apply Role Templates" — pick a template (e.g. "QA Engineer") for memberA via the per-member `<select>` | `applyRoleTemplate` → `updateProject`; for every agent in that template's `suggestedAgents`, `memberIds` includes memberA's id (existing assignments to other members preserved) |
| TS-107 | Admin session active; click "Clear" for a member with existing assignments | `clearMemberAssignments` → `updateProject`; memberA's id removed from every `agentAssignments[].memberIds`, other members' ids untouched |
| TS-108 | Each agent row's role-template pills | For agent X, pills shown match `visibleRoleTemplates.filter(r => r.suggestedAgents.includes(X))`; a role hidden via `disabledRoleIds` does not produce a pill even if it suggests agent X |

---

## 5. Test cases — `roleTemplates.test.ts` (fix + extend)

| ID | Scenario | Expected result |
|---|---|---|
| TS-109 | `ROLE_TEMPLATES` length and id list (**fix existing failing assertions**) | Update "exactly 10 templates" → 11; add `'scrum-master'` to the expected id list alongside the existing 10 |
| TS-110 | New: `scrum-master` template shape | `id: 'scrum-master'`, `title: 'Scrum Master'`, valid hex `color`, non-empty `description`, `suggestedAgents` contains `'sprintPlanner'` and `'taskBreakdown'` |
| TS-111 | New: `buildTeamRoster` — real members only, all agents assigned | Given `teamMembers` = [Alice], `agentAssignments` covers every agent Alice could plausibly own with `memberIds: ['alice-id']` such that `assignedAgents` covers all `COVERED_AGENTS`, roster = `[{ name: 'Alice', role: ..., agents: [...] }]` with **no** `"(role)"` fallback entries |
| TS-112 | New: `buildTeamRoster` — fallback entries for unassigned roles | Given `teamMembers = []`, `agentAssignments = []`, roster contains one `"<Role Title> (role)"` entry per `ROLE_TEMPLATES` whose `suggestedAgents` is non-empty, with `agents` = that template's `suggestedAgents` (deduplicated) |
| TS-113 | New: `buildTeamRoster` — overlapping role templates produce multiple fallback entries (documents Dev Note #3) | Given `teamMembers = []`, `agentAssignments = []`, both `"Project Manager (role)"` and `"Scrum Master (role)"` (and `"Engineering Manager (role)"`) appear in the roster, each listing `sprintPlanner`/`taskBreakdown` — confirms current (possibly-redundant) behavior rather than asserting deduplication, since dedup is an open product question |

---

## 6. Out of scope / not duplicated

- `ProjectSettings.tsx` General tab (project name/description/mode,
  GitHub integration, Danger Zone) — covered by Module 2
  (`project-lifecycle-test-plan.md`, TS-32–TS-39) and out of scope for
  Module 5 (Document Export & GitHub Push).
- `ProjectSettings.tsx` Domain Knowledge tab (domain knowledge brief,
  branding guidelines) — not part of team/roles; no existing test plan
  references it either, flagged as a gap for a future module if one covers
  agent prompting/domain context.
- `TeamPanel.tsx` — dead code, not imported, no tests added (see
  `team-and-roles.md` §3.1).

---

## 7. Coverage note

Per the project-wide coverage thresholds in `frontend/vite.config.ts`
(lines 80%, functions 80%, branches 75%, statements 80% — unchanged), the
new tests in this module exercise the bulk of `ProjectSettings.tsx`'s Team
and Assignments tab logic plus all of `roleTemplates.ts`. Actual coverage
percentages must be measured locally via `cd frontend && npm install && npm
run test:coverage` (the sandbox cannot run the vitest CLI — see Module 1
notes).
