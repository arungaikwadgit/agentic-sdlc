# Module 4: Team & Roles

Covers team membership, admin sessions, agent-to-member assignments, and
per-project role visibility — implemented in `ProjectSettings.tsx` (Team
and Agent Assignments tabs), `data/roleTemplates.ts`, and the
`TeamMember` / `AgentAssignment` / `disabledRoleIds` fields in
`types/project.types.ts`.

> **Note on `TeamPanel.tsx`**: `frontend/src/components/team/TeamPanel.tsx`
> implements an earlier, simpler version of member management and agent
> assignment (single-select assignment via a `<select>` per agent). It is
> **not imported anywhere** in the app — `ProjectWorkspace.tsx` renders
> `ProjectSettings` (Team / Agent Assignments tabs) instead, which is the
> live implementation documented below. `TeamPanel.tsx` and its CSS module
> appear to be dead code from an earlier iteration. See §3 Development
> Notes for follow-up options.

---

## 1. Requirements

### 1.1 Purpose

Pipeline agents need to be attributed to real people: review gates show
who's assigned to which agent, generated documents credit a project's
roster (`buildTeamRoster`), and only an "admin" team member can change
project settings, manage the team, or archive the project. This module
covers adding/removing team members, picking an admin session, assigning
agents to members (individually or via role templates), and controlling
which role templates are offered for a given project.

### 1.2 Functional Requirements

| # | Requirement |
|---|---|
| R1 | A project's team is `project.teamMembers: TeamMember[]` (`id`, `name`, `email`, `role`, `avatarColor`, `isAdmin`). The first member added to a project is automatically `isAdmin: true`. |
| R2 | Adding a member requires a non-empty name, a valid email (must contain `@`), and a role — either selected from `visibleRoleTemplates` (role templates not hidden by `disabledRoleIds`) or a custom free-text role via the "Custom role..." option. |
| R3 | If the selected role matches a `ROLE_TEMPLATES` title, adding the member also seeds `agentAssignments` for every agent in that template's `suggestedAgents`, appending the new member's id to `memberIds` (creating the assignment entry if it doesn't exist yet). |
| R4 | `activeAdminId` (persisted on the project) picks which `TeamMember` the UI is acting as for project-scoped actions. `isAdmin` is true only if `activeAdminId` resolves to a team member whose `isAdmin` flag is `true`. In production, privileged backend routes still require an authenticated admin email allowlisted on the server, so the selector is a UX control rather than the sole authorization boundary. |
| R5 | The first member added to an empty project automatically becomes the active admin session (`setAdminSessionId` is called immediately after `addMember`). |
| R6 | Removing a team member (admin only) deletes them from `teamMembers` and strips their id from every `agentAssignments[].memberIds`. If they were `activeAdminId`, that field is cleared. Removal is blocked — with an inline error — if the target is the **only** admin (`wouldLeaveNoAdmin`). |
| R7 | `toggleAdmin(memberId)` flips a member's `isAdmin` flag (admin only). It is blocked with an inline error if the target is the only admin and currently `isAdmin: true` — there must always be at least one admin once any member exists. |
| R8 | `agentAssignments: AgentAssignment[]` is many-to-many: each entry is `{ agentId, memberIds: string[] }`. The Assignments tab matrix shows one row per agent (grouped by phase) and one column per member, with a toggle button per cell (`toggleAgentMember`) that adds/removes that member's id from the agent's `memberIds`. |
| R9 | "Quick-apply Role Templates" (Assignments tab, admin only): picking a role template for a member appends that member's id to `memberIds` for every agent in the template's `suggestedAgents` (without removing other members already assigned to those agents). "Clear" removes the member's id from every assignment. |
| R10 | Each member card on the Team tab shows their assigned agents as pills, or a "⚠ No agents assigned — pipeline cannot run" warning if `agentAssignments` has no entry with that member's id in `memberIds`. |
| R11 | `ROLE_TEMPLATES` (`data/roleTemplates.ts`) defines 11 suggested roles, each with `id`, `title`, `description`, `color`, and `suggestedAgents: AgentId[]`. A project can hide any subset of these from its pickers via `project.disabledRoleIds: string[]` — `toggleRoleEnabled(roleId)` (admin only) adds/removes a role id from that array. Hidden roles remain valid for any member already assigned that role title; they're only excluded from the "Select role" dropdown (Team tab) and "Apply template" dropdown (Assignments tab). |
| R12 | A "📋 Suggested roles & agent mappings reference" `<details>` panel (Team tab) lists every `ROLE_TEMPLATES` entry — including hidden ones, shown at reduced opacity — with a per-role "Visible — hide" / "Hidden — show" toggle for admins. |
| R13 | `buildTeamRoster(project)` (`data/roleTemplates.ts`) builds the roster passed into agent prompts: real team members with their assigned agents, plus a synthetic `"<Role Title> (role)"` entry for any role template whose `suggestedAgents` aren't fully covered by a real assignment — grouped by role, deduplicated. This runs regardless of `disabledRoleIds` (a hidden role can still produce a fallback roster entry if one of its agents is unassigned). |

### 1.3 Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR1 | All team/role mutations go through `updateProject` (`db/projectRepository.ts`) and backend APIs backed by Postgres. `teamMembers`, `agentAssignments`, `activeAdminId`, and `disabledRoleIds` persist on the authoritative project record rather than browser-only storage. |
| NFR2 | `disabledRoleIds`, `activeAdminId`, and `agentAssignments`/`teamMembers` for pre-existing projects default to `[]` / `undefined` via `?? []` / `?? undefined` fallbacks — no migration required for projects created before these fields existed. |
| NFR3 | The "Viewing as" selector is a project-level UX aid, not the sole security control. Production authentication is handled through Supabase and backend authorization. The local admin bypass exists only in development and is not part of the production trust model. |

---

## 2. Design

### 2.1 Data model

`types/project.types.ts`:

```ts
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  isAdmin: boolean;
}

/** Many-to-many: one agent can have multiple assigned members */
export interface AgentAssignment {
  agentId: AgentId;
  memberIds: string[];  // TeamMember.id[]
}

export interface Project {
  // ...
  teamMembers: TeamMember[];
  agentAssignments: AgentAssignment[];
  /** ID of the active admin session (TeamMember.id) — no password, just selection */
  activeAdminId?: string;
  /** Role template IDs (RoleTemplate.id) hidden from pickers for this project */
  disabledRoleIds?: string[];
  // ...
}
```

`data/roleTemplates.ts`:

```ts
export interface RoleTemplate {
  id: string;
  title: string;
  description: string;
  color: string;
  /** Agents this role typically owns or reviews */
  suggestedAgents: AgentId[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [ /* 11 entries */ ];

/** All agents covered by at least one role template */
export const COVERED_AGENTS = new Set(ROLE_TEMPLATES.flatMap((r) => r.suggestedAgents));
```

### 2.2 `ROLE_TEMPLATES` reference

| id | title | suggestedAgents |
|---|---|---|
| `product-manager` | Product Manager | manager, projectCharter, brd, stakeholder, userStory, businessRules, feasibility |
| `tech-lead` | Tech Lead | architecture, apiDesign, dataModel, techDebt |
| `ux-designer` | UX Designer | uxResearch, interaction |
| `project-manager` | Project Manager | sprintPlanner, taskBreakdown |
| `scrum-master` | Scrum Master | sprintPlanner, taskBreakdown |
| `qa-engineer` | QA Engineer | testPlan, testCases |
| `security-engineer` | Security Engineer | securityCompliance |
| `devops-engineer` | DevOps Engineer | devopsEngineer, infraEngineer |
| `sre` | SRE / Platform Engineer | observabilityEngineer, onCallEngineer |
| `engineering-manager` | Engineering Manager | sprintPlanner, taskBreakdown, techDebt, manager |
| `architect` | Architect | architecture, apiDesign, dataModel, feasibility, infraEngineer |

Note: `project-manager`, `scrum-master`, and `engineering-manager` all
suggest `sprintPlanner`/`taskBreakdown` — these roles overlap by design,
since different teams may title the same responsibility differently.
`buildTeamRoster`'s fallback grouping (§2.4) treats each role template
independently, so an unassigned `sprintPlanner` could in principle surface
as a fallback entry for more than one role title if multiple overlapping
roles are unassigned — see §3 Development Notes.

### 2.3 `ProjectSettings.tsx` — structure

`ProjectSettings` renders a modal with four tabs: **General**, **Team
Members**, **Agent Assignments**, **Domain Knowledge**. This module covers
the team/role-relevant pieces; General's project name/description/mode and
Domain Knowledge tab are part of other modules' scope (project lifecycle /
agent prompting), but the **admin session selector** and **archive/restore
("Danger Zone")** in the General tab are admin-gated by the same
`isAdmin` logic documented here.

#### 2.3.1 Admin session bar (always visible, all tabs)

A bar above the tabs shows either "Admin session active" (if
`isAdmin`) or "Viewing as:" with a `<select>` listing every team member
(showing 🔑 next to admins). Selecting a member calls `selectAdminSession`,
which sets local state `adminSessionId` and persists
`project.activeAdminId = memberId || undefined`. If `teamMembers` is
empty, a hint prompts "Add the first team member to become admin."

`isAdmin` is computed as:

```ts
const isAdmin = !!adminSessionId && members.find((m) => m.id === adminSessionId)?.isAdmin;
```

#### 2.3.2 Team tab

- **Add Team Member** form: Full name, Email, Role (`<select>` of
  `visibleRoleTemplates` titles + "Custom role..."), with a live hint
  ("✓ Agent mappings for **{role}** applied automatically" vs. "Role
  determines which agents are pre-assigned"). Disabled (`canAddMember =
  members.length === 0 || !!isAdmin`) once a team exists and no admin
  session is selected — the "🔒 Select an admin identity above..." hint
  explains why.
- **Team — N members** grid: one card per member showing avatar
  (initials on `avatarColor`), name, "Admin"/"You" badges, email, role
  (colored by the matching `ROLE_TEMPLATES` entry, with its description),
  and a pill list of assigned agents (or the "⚠ No agents assigned"
  warning). Admins see "🔑 Admin / ○ Make admin" and "Remove" buttons per
  card, both disabled if removing/demoting would leave zero admins
  (`isLastAdmin`).
- **Suggested roles & agent mappings reference** (`<details>`,
  collapsed by default): lists all 11 `ROLE_TEMPLATES` as cards (title,
  description, suggested agent names joined by " · "). Hidden roles
  (`disabledRoleIds`) render at `opacity: 0.5`. Admins get a
  "Visible — hide" / "Hidden — show" button per card calling
  `toggleRoleEnabled`.

#### 2.3.3 Agent Assignments tab

- If no team members exist, shows "Add team members first to configure
  assignments."
- **Quick-apply Role Templates** (admin only): one row per member with a
  "Apply template..." `<select>` (options = `visibleRoleTemplates`) and a
  "Clear" button (`clearMemberAssignments`).
- **Agent → Member Matrix**: a phase filter (`<select>`, "All phases" or
  one `PHASE_ORDER` entry), then a grid with one column per member
  (avatar + first name) and one row per agent (grouped under phase
  headers). Each agent row also shows role-template pills
  (`visibleRoleTemplates` filtered to those whose `suggestedAgents`
  include this agent) for context. Each cell is a toggle button
  (`toggleAgentMember`, disabled for non-admins) showing "✓" when that
  member is in the agent's `memberIds`.
- A legend notes "Unassigned agents will block the pipeline from running."

### 2.4 `buildTeamRoster(project)`

```ts
export function buildTeamRoster(project: {
  teamMembers?: TeamMember[];
  agentAssignments?: AgentAssignment[];
}): TeamRosterEntry[] {
  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];

  // 1. One roster entry per real team member, listing the agents
  //    assigned to them via agentAssignments[].memberIds.
  const roster: TeamRosterEntry[] = members.map((m) => ({
    name: m.name,
    role: m.role,
    agents: assignments.filter((a) => a.memberIds.includes(m.id)).map((a) => a.agentId),
  }));

  // 2. Determine which agents already have >=1 real assignee.
  const assignedAgents = new Set<AgentId>();
  for (const a of assignments) {
    if (a.memberIds.length > 0) assignedAgents.add(a.agentId);
  }

  // 3. For every ROLE_TEMPLATES entry, group any of its suggestedAgents
  //    that are NOT in assignedAgents, by role.
  // 4. Push one fallback entry per role with >=1 grouped agent, named
  //    "<Role Title> (role)".
  return roster; // real members first, then fallback "(role)" entries
}
```

This runs **independently of `disabledRoleIds`** — hiding a role from the
pickers doesn't remove it from `ROLE_TEMPLATES`, so its `suggestedAgents`
can still produce a `"<Role Title> (role)"` fallback entry if unassigned.
Used wherever agent prompts need a roster (review-gate dry-runs, normal
pipeline runs) so every agent has *someone* — real or placeholder — to
attribute the work to.

---

## 3. Development Notes

1. **`TeamPanel.tsx` is dead code.** It implements a single-select
   assignment model (`memberIds = [memberId]`, one member per agent) that
   predates the many-to-many model in `ProjectSettings.tsx`'s Assignments
   tab. It is not imported by any other file. Recommendation: either
   delete it (and `TeamPanel.module.css`) or leave it as reference and add
   a top-of-file comment noting it's unused, to avoid confusion for future
   contributors who might assume it's the live UI.

2. **`roleTemplates.test.ts` is stale.** It asserts `ROLE_TEMPLATES` has
   "exactly 10 templates" and lists 10 ids, but the source has 11 (the
   `scrum-master` template, added per task #27, is missing from both the
   count and the id list). This test currently fails. Fixing it is in
   scope for this module (§4, TS-41).

3. **Overlapping role templates and `buildTeamRoster` fallback naming.**
   `project-manager`, `scrum-master`, and `engineering-manager` all list
   `sprintPlanner`/`taskBreakdown` in `suggestedAgents`. If none of those
   agents have a real assignment, `buildTeamRoster`'s fallback loop visits
   `ROLE_TEMPLATES` in array order and will produce **up to three separate
   `"(role)" ` entries** (one per role template), each claiming the same
   agents — e.g. both "Project Manager (role)" and "Scrum Master (role)"
   listing `sprintPlanner`. This isn't a crash, but it could read oddly in
   a generated document's roster section (the same agent attributed to
   multiple placeholder roles). Not fixed in this module — flagged as a
   product/UX question (should overlapping templates be deduplicated, or
   is showing both intentional since they represent different possible
   real-world titles for the same work?).

4. **`archivedBy` fallback is effectively dead code** (carried over from
   Module 2's `project-lifecycle.md` / `ProjectSettings-archive.test.tsx`):
   `p.archivedBy = archivedByMember?.name ?? adminSessionId` can only be
   reached via the Danger Zone, which is gated on `isAdmin`, which itself
   requires `members.find(m => m.id === adminSessionId)` to resolve to an
   admin — the same lookup `archivedByMember` uses. So `archivedByMember`
   is always defined when this line runs, and the `?? adminSessionId`
   fallback never triggers. Documented for completeness; not a team/roles
   bug, but it's the same `adminSessionId` mechanism documented in §2.3.1.

5. **No schema changes were needed for these fields.** `disabledRoleIds`,
   `activeAdminId`, `teamMembers`, and `agentAssignments` remain plain
   fields on the `Project` record now served through backend APIs and
   Postgres. Existing projects without these fields still work via
   `?? []` / `?? undefined` defaults — confirmed by reading
   `ProjectSettings.tsx` (lines 39-40, 101, 115-117).

---

## 4. Test Plan Summary

See `docs/test-plans/team-and-roles-test-plan.md` for the full scenario
list. Highlights:

| Area | Coverage |
|---|---|
| Adding members | First member becomes admin + active session; role-template seeding of `agentAssignments`; validation (name/email/role required) |
| Removing members | Cleans up `agentAssignments`, clears `activeAdminId` if removed; blocked if only admin |
| Admin toggling | `toggleAdmin` flips flag; blocked if it would leave zero admins |
| Agent assignment matrix | Toggle add/remove member from `memberIds`; admin-gated |
| Role templates | Quick-apply adds member to all `suggestedAgents`; Clear removes member from all assignments |
| Role visibility | `toggleRoleEnabled` updates `disabledRoleIds`; visible/hidden filtering in Team + Assignments pickers; reference panel shows all roles incl. hidden |
| `buildTeamRoster` | Real members + fallback "(role)" entries; `ROLE_TEMPLATES` data integrity (11 templates, incl. `scrum-master`) |

---

## 5. Deployment & Maintenance Notes

- No module-specific build steps. The relevant operational dependency is
  the backend project API, because these project fields now persist through
  backend APIs and Postgres rather than Dexie-only browser storage.
- If `TeamPanel.tsx` is deleted (see §3.1), confirm no dynamic imports or
  test files reference it first (`grep -rn "TeamPanel"`).
- Any future change to `ROLE_TEMPLATES` (add/remove/rename a role) should
  be cross-checked against `roleTemplates.test.ts` (id list + count) and
  `COVERED_AGENTS` consumers.
