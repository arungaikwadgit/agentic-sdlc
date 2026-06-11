# Module 6: Dashboard & Project Creation — Test Plan

> Covers `docs/architecture/dashboard-and-project-creation.md`. Test IDs
> continue from TS-169 (the last ID used in
> `document-export-github-test-plan.md`, Module 5).

## Scope

- `frontend/src/components/dashboard/NewProjectModal.tsx`
- `frontend/src/components/dashboard/ProjectCard.tsx` (active/non-archived rendering)
- `frontend/src/components/dashboard/Dashboard.tsx` (export/import handlers only — archived-view filtering is covered by Module 2's `Dashboard-archive.test.tsx`)
- `frontend/src/agents/domainKnowledgeDefaults.ts`

Out of scope (covered elsewhere): archive/restore/permanent-delete flows
(Module 2), agent pipeline execution (Module 1), team/role management
(Module 4).

---

## NewProjectModal — `tests/unit/NewProjectModal.test.tsx`

| ID | Scenario | Expected behavior |
|---|---|---|
| TS-170 | Initial render shows the Details step with empty name/description, domain defaulted to `saas`, mode defaulted to `simple`. | Name and description inputs are empty; domain select shows "SaaS"; Next button is disabled (empty name/description). |
| TS-171 | Clicking a preset (e.g. "FinPay") fills name, description, and domain from `PRESETS`. | Name input shows "FinPay", description textarea is non-empty, domain select shows "FinTech". |
| TS-172 | Next is disabled when name is set but description is empty (and vice versa). | Next button remains `disabled` for either case; becomes enabled once both are non-empty (after trim). |
| TS-173 | Changing the domain on the Details step calls `getEffectiveDomainKnowledgeDefault` for the new domain and replaces `domainKnowledge`, even if the user had typed a custom brief. | Mock `getEffectiveDomainKnowledgeDefault` to return distinct strings per domain; verify the internal `domainKnowledge` state (surfaced via the Domain Knowledge step textarea) reflects the new domain's value, not the prior custom text. |
| TS-174 | Clicking Next (with valid name/description) on a project where `domainKnowledge` is still empty pre-fills the Domain Knowledge textarea via `getEffectiveDomainKnowledgeDefault(domain)`. | Domain Knowledge step textarea value equals the mocked default for the current domain. |
| TS-175 | Clicking Next when `domainKnowledge` is already non-empty (set via a prior domain change) does NOT overwrite it. | Domain Knowledge step textarea retains the previously-set value; `getEffectiveDomainKnowledgeDefault` is not called again on this transition. |
| TS-176 | "Reset to template" on the Domain Knowledge step re-fetches and overwrites the textarea with the effective default for the current domain. | After typing custom text into the textarea and clicking "Reset to template", the textarea value equals the mocked effective default. |
| TS-177 | "Download as .md" triggers a Blob download named `domain-knowledge-{domain}.md` containing the current (possibly edited) textarea content. | Spy on `URL.createObjectURL` / anchor click; assert the downloaded filename matches `domain-knowledge-${domain}.md` and the Blob content matches the textarea's current value (not the original default). |
| TS-178 | "Back" from the Domain Knowledge step returns to Details with all previously entered values intact. | Name/description/domain/mode/branding fields retain their values after Back. |
| TS-179 | Clicking "Create Project" calls `createProject` with `{ name: <trimmed>, description: <trimmed>, domain, status: 'draft', mode, domainKnowledge: <trimmed-or-undefined>, brandingGuidelines: <trimmed-or-undefined> }` and then `onCreated(project.id)`. | `createProject` mock receives the exact object shape, with `domainKnowledge`/`brandingGuidelines` as `undefined` when their fields are empty after trimming; `onCreated` is called once with the mocked returned project's `id`. |
| TS-180 | "Create Project" is disabled while the create call is pending (`loading` state), and re-enabled if `createProject` rejects. | Use a controllable promise: button is `disabled` immediately after click, becomes enabled again after the rejected promise settles (via `finally`). |
| TS-181 | Selecting "Expert" mode shows the expert-mode hint text; selecting "Simple" shows the simple-mode hint text. | Toggling the mode control updates the visible hint copy and the value passed to `createProject` on submission. |
| TS-182 | Cancel/close calls `onClose` without calling `createProject`. | `onClose` invoked once; `createProject` not called. |

## ProjectCard — `tests/unit/ProjectCard.test.tsx`

| ID | Scenario | Expected behavior |
|---|---|---|
| TS-183 | Renders the domain badge with the label/colors from `DOMAINS[project.domain]` for a fintech project. | Badge text is "FinTech"; badge style reflects `DOMAINS.fintech.color`/`bgColor` (via inline style or class, per implementation). |
| TS-184 | Renders the correct status dot color and label for each of `draft`, `running`, `paused`, `complete`, `error`. | For each status, the rendered label matches `STATUS_LABELS[status]` and the dot's color matches `STATUS_COLORS[status]`. |
| TS-185 | Falls back to the default status color (`#64748b`) for an unrecognized status value. | A project with `status: 'unknown' as any` renders the dot using `#64748b` and does not throw. |
| TS-186 | Progress bar shows `Math.round((completedAgents / totalAgents) * 100)`% for non-zero `totalAgents`. | `completedAgents: 3, totalAgents: 8` renders "38%" (rounded from 37.5). |
| TS-187 | Progress bar shows 0% and does not divide by zero when `totalAgents` is 0. | `totalAgents: 0` renders "0%" without throwing or rendering `NaN%`/`Infinity%`. |
| TS-188 | Clicking the card body calls `onOpen`. | Click on the card container (not the delete button) invokes `onOpen` once. |
| TS-189 | Clicking delete (✕) calls `window.confirm`; if confirmed, calls `onDelete` and does not call `onOpen` (stopPropagation). | Mock `window.confirm` to return `true`; assert `onDelete` called once and `onOpen` not called. |
| TS-190 | Clicking delete (✕) and cancelling the confirm dialog does not call `onDelete`. | Mock `window.confirm` to return `false`; assert `onDelete` not called. |
| TS-191 | When `onRestore` is not provided, no "Restore" button or archived-metadata block is rendered (active view). | `screen.queryByText(/restore/i)` and archived-date text are both absent. |

## Dashboard import/export — `tests/unit/Dashboard-import-export.test.tsx`

| ID | Scenario | Expected behavior |
|---|---|---|
| TS-192 | Clicking "Export" calls `exportAllProjects`, wraps the result in a Blob, and triggers a download named `sdlc-backup-{Date.now()}.json`. | Mock `exportAllProjects` to resolve a known JSON string; spy on `URL.createObjectURL`/anchor click; assert the Blob content equals the mocked string and the filename matches the `sdlc-backup-<number>.json` pattern. |
| TS-193 | Clicking "Import" opens a file picker; selecting a `.json` file calls `importProjects` with its text content. | Simulate a file input `change` event with a `File` object; assert `importProjects` is called with the file's text. |
| TS-194 | A successful import shows an alert with the count returned by `importProjects`. | Mock `importProjects` to resolve `3`; assert `window.alert` called with a message containing "3". |
| TS-195 | A failed import (e.g. `importProjects` throws "Invalid backup format") shows an alert with the error message instead of crashing. | Mock `importProjects` to reject with `Error('Invalid backup format')`; assert `window.alert` called with a message containing "Invalid backup format"; component does not throw. |
| TS-196 | No file selected (user cancels the file picker) results in no call to `importProjects`. | Simulate a `change` event with `files` empty/undefined; assert `importProjects` is not called. |

## Domain knowledge defaults — `tests/unit/domainKnowledgeDefaults.test.ts`

| ID | Scenario | Expected behavior |
|---|---|---|
| TS-197 | `getEffectiveDomainKnowledgeDefault` returns the app-level default when one is set for the domain. | `db.settings.get('app:domainKnowledgeDefaults')` mocked to return `{ value: { fintech: 'custom brief' } }`; result for `'fintech'` is `'custom brief'`. |
| TS-198 | `getEffectiveDomainKnowledgeDefault` falls back to `DOMAIN_KNOWLEDGE_TEMPLATES[domainId]` when no app-level default exists for that domain. | `db.settings.get` mocked to return `undefined` (or a row without the domain key); result for `'healthcare'` equals `DOMAIN_KNOWLEDGE_TEMPLATES.healthcare`. |
| TS-199 | `getDomainKnowledgeDefaults` returns `{}` when the settings row is missing or its `value` is not an object. | `db.settings.get` mocked to return `undefined`, then `{ value: 'not-an-object' }`; both cases return `{}`. |
| TS-200 | `saveDomainKnowledgeDefault` then `getEffectiveDomainKnowledgeDefault` round-trips the saved value (mocking `db.settings.put`/`get` consistently). | After `saveDomainKnowledgeDefault('saas', 'new brief')`, a subsequent `getEffectiveDomainKnowledgeDefault('saas')` returns `'new brief'`. |
| TS-201 | `resetDomainKnowledgeDefault` removes the app-level override, causing `getEffectiveDomainKnowledgeDefault` to fall back to the built-in template again. | After reset, `getEffectiveDomainKnowledgeDefault('saas')` returns `DOMAIN_KNOWLEDGE_TEMPLATES.saas`. |

---

## Notes on mocking strategy

- `NewProjectModal.test.tsx` and `domainKnowledgeDefaults.test.ts` must mock
  `@/agents/domainKnowledgeDefaults` (for the modal) and `@/db/database`
  (for the defaults module itself) consistently with the patterns used in
  Module 5's test files (`vi.mock` with inline factory functions returning
  `vi.fn()`s).
- `ProjectCard.test.tsx` does not need to mock `@/agents/domains` —
  `DOMAINS` is a static, side-effect-free export and can be used directly.
- `Dashboard-import-export.test.tsx` should follow the
  `Dashboard-archive.test.tsx` pattern: mock `dexie-react-hooks`'
  `useLiveQuery` to return a fixed `ProjectSummary[]`, mock
  `@/db/projectRepository`'s `exportAllProjects`/`importProjects`, and stub
  out `NewProjectModal`/`AppSettingsModal` (`default: () => null`) since this
  file is not testing the wizard itself.
- All Blob/anchor-download assertions should follow the same
  `URL.createObjectURL` spy pattern — jsdom does not implement real
  downloads, so tests assert on the constructed Blob's content/type and the
  anchor's `download` attribute rather than an actual file being written.
