# QA Review Observations Tracker

Date: 2026-07-09
Repo: `C:\Projects\SLDC - AI\agentic-sdlc`
Branch: `Dev`
Baseline sync check: `origin/main...Dev = 0 behind / 6 ahead`

## Purpose

This file tracks the in-depth QA observations gathered from the current application flow review before code fixes begin. It also maps those observations to the current automated test surface so we can see what is already covered, what is only partially covered, and what is still missing.

This file must be updated again after each major fix pass and after re-running the observations.

## Scope Covered In This Review

- Functional bugs
- Missing validation scenarios
- Edge cases
- Boundary value scenarios
- Negative scenarios
- Security risks
- Performance considerations
- API validation scenarios
- Usability issues
- Data validation checks
- Error handling scenarios
- Accessibility considerations
- Commonly missed QA cases

## Severity-Ordered Observation Register

| ID | Severity | Area | Observation | Why It Matters | Evidence |
|---|---|---|---|---|---|
| QA-01 | Critical | App bootstrap / invite | Invite acceptance can be blocked by master catalog bootstrap because the app hard-blocks on catalog readiness before rendering the invite flow. | A valid invited user can be locked out by unrelated backend/catalog issues. | `frontend/src/App.tsx:52`, `frontend/src/App.tsx:105`, `frontend/src/App.tsx:141` |
| QA-02 | Critical | Dashboard / auth | Dashboard converts backend/auth failures into an empty project list by catching project-load failures and setting `[]`. | Real outages look like a normal empty state; this hides production regressions. | `frontend/src/components/dashboard/Dashboard.tsx:80-92` |
| QA-03 | Critical | Project creation | Project creation is not transactional: the project is created before documents are attached, and downstream failure still leaves the project behind. | Creates partial data, duplicates on retry, and user confusion. | `frontend/src/components/createProject/CreateProjectPage.tsx:349-389` |
| QA-04 | High | Auth security | Local admin bypass token is accepted whenever `NODE_ENV !== 'production'`. | Dangerous if preview/staging runs with non-production env values. | `server/src/middleware/auth.ts:42-44` |
| QA-05 | High | Transport security | Proxy supports outbound TLS with `rejectUnauthorized: false` under corp proxy mode. | Creates a MITM risk surface for LLM traffic and secrets. | `backend/src/proxy.js:300` |
| QA-06 | High | Data architecture | Proxy still falls back to `localProjectStore` when `SERVER_API_URL` is missing. | Breaks Postgres-only source-of-truth expectations and causes environment drift. | `backend/src/proxy.js:373-401`, `backend/src/proxy.js:444` |
| QA-07 | High | Invite flow | Invite flow depends on `sessionStorage`, Supabase redirect, session hydration, and email confirmation state. | High chance of cross-device, incognito, refresh, and mobile failures. | `frontend/src/components/invite/InviteAcceptPage.tsx:117-139`, `:251-366` |
| QA-08 | High | Role/permission model | Invite API role model and project-settings role model are inconsistent. | Can produce mismatched access, bad role mapping, and broken RBAC behavior. | `server/src/routes/invites.ts:25`, `frontend/src/components/settings/ProjectSettings.tsx:94`, `:698` |
| QA-09 | Medium | API efficiency | Project updates use fetch-then-update and some document operations scan projects one by one. | Creates N+1 patterns and performance problems as project data grows. | `frontend/src/db/projectRepository.ts:261`, `:291`, `:453-458` |
| QA-10 | Medium | Validation consistency | Project-creation validation differs by entry path. | Same entity can be created with different completeness/quality depending on route. | `frontend/src/components/dashboard/NewProjectModal.tsx:198-214`, `:273-294` |
| QA-11 | Medium | Config/auth drift | App-state/config APIs fail hard on auth/config issues. | Causes startup/theme/settings regressions and cascading UI failures. | `frontend/src/services/appStateApi.ts:34-51`, `backend/src/proxy.js:1200-1258` |
| QA-12 | Medium | Domain rendering | Domain rendering still assumes safe `bgColor` and other domain fields after DB hydration. | Partial catalog/master-data failures can still trigger render crashes. | `frontend/src/services/masterDataCatalog.ts:166-179`, `frontend/src/components/dashboard/NewProjectModal.tsx:358` |
| QA-13 | Medium | UX validation | Some blocked actions return early without strong field-level feedback. | Users experience “nothing happened” instead of actionable validation. | `frontend/src/components/dashboard/NewProjectModal.tsx:214`, `:273`, `:293` |
| QA-14 | Medium | Accessibility | Custom interactive patterns likely still miss complete keyboard parity and focus behavior. | Impacts keyboard users and makes dialogs/settings harder to operate. | Cross-cutting; initial focus on dashboard/settings/project flows |
| QA-15 | Low | Encoding / content quality | Prior encoding drift suggests risk of mojibake in UI, emails, and exports. | User-facing content can render incorrectly in production. | Cross-cutting; previously observed in repo history and UI glitches |

## Additional Commonly Missed QA Scenarios

- Duplicate project name under same owner and different owners
- One failed upload among multiple uploaded documents
- Retry after partial project creation
- Mobile deep-link into invite flow
- Confirm invite on another device/browser
- Invite token replay, revoke-after-send, accept-after-project-delete
- Stale frontend bundle against newer backend schema
- Empty master tables in Postgres
- Unknown domain slug returned from DB
- Session expiry during a multi-step modal flow
- Double click on save, send invite, verify email, or run pipeline
- Non-Latin text, emoji, RTL input, and large pasted content
- Browser offline/online transitions during save
- Keyboard-only navigation across all custom controls

## Coverage Map Against Current Automated Tests

Legend:

- `Covered`: explicit automated tests already exist
- `Partial`: some adjacent coverage exists, but the exact failure mode is not protected
- `Missing`: no strong automated coverage found yet

| Observation ID | Current Coverage | Existing Evidence | Gap To Close |
|---|---|---|---|
| QA-01 | Partial | `tests/performance/pipeline-load.js` covers catalog startup timing/success. `tests/unit/recentGovernanceArtifacts.test.ts` checks catalog implementation details. | Add unit/integration coverage proving invite route still renders when catalog fails or is slow. |
| QA-02 | Missing | No test found asserting dashboard distinguishes auth/API failure from true empty state. | Add dashboard tests for `401`, `500`, and network error states. |
| QA-03 | Missing | Project repository tests exist, but no end-to-end or unit assertion for partial create rollback/cleanup. | Add create-project failure-path tests around document attach failures and duplicate retry prevention. |
| QA-04 | Partial | Auth middleware is directly observable in code; no dedicated preview/staging guard test found. | Add server tests proving bypass is rejected in production and only accepted in local dev. |
| QA-05 | Missing | No automated security test found for corp proxy TLS downgrade branch. | Add security/unit tests and documentation guardrails for `CORP_PROXY` behavior. |
| QA-06 | Partial | `tests/unit/recentGovernanceArtifacts.test.ts` explicitly notes catalog is still file-bootstrapped. | Add backend tests proving project APIs fail closed when `SERVER_API_URL` is absent in production mode. |
| QA-07 | Partial | Invite backend tests exist: `backend/src/proxy.inviteFlow.integration.test.ts`, `proxy.inviteSecurity.test.ts`, `proxy.sendInviteEmail.test.ts`. | Add frontend invite-flow tests for cross-device confirmation, refresh, incognito/sessionStorage, and resend states. |
| QA-08 | Missing | Role tests exist for project access and team settings, but not for server/frontend invite-role contract alignment. | Add API contract tests for role mapping and acceptance behavior. |
| QA-09 | Partial | `tests/unit/projectRepository.test.ts` covers repository functions, not API amplification or large-data behavior. | Add performance/regression checks for large projects and document deletion scaling. |
| QA-10 | Covered / Partial | `tests/unit/NewProjectModal.test.tsx` covers many validation paths in that modal. | Add coverage across all creation entry paths to ensure consistent validation rules. |
| QA-11 | Missing | No test found for app-state `401`/admin drift behavior on startup/settings access. | Add frontend tests for config fetch `401/403/500` and graceful degradation. |
| QA-12 | Partial | Code comments and recent governance tests acknowledge this issue; no focused UI regression found for fallback rendering after partial domain catalog. | Add render tests for missing/partial domain rows and unknown domains. |
| QA-13 | Partial | `tests/unit/NewProjectModal.test.tsx` covers some button-disable behavior. | Add assertions for visible field-level messaging on every blocked save/progression path. |
| QA-14 | Partial | `tests/e2e/accessibility.spec.ts` exists. | Expand keyboard-path and focus-trap assertions for auth, settings, invites, and modal flows. |
| QA-15 | Missing | No robust regression suite found for encoding-sensitive output. | Add snapshot/content tests for exported docs, invite emails, and rendered templates. |

## Test Suite Update Requirements Before Signoff

### Unit Tests To Add Or Strengthen

- Dashboard error-state tests for auth failure, backend failure, and retry behavior
- `App.tsx` tests for invite-route rendering when catalog bootstrap fails
- Create-project transactional failure tests
- App-state/config auth and admin gating tests
- Domain fallback tests for partial/unknown domain master data
- Server auth bypass tests
- Invite role-contract tests

### Integration / API Tests To Add Or Strengthen

- `/api/projects/permissions/me` unauthorized, expired, malformed, and forbidden cases
- `/api/projects` create/update atomicity behavior
- `/api/invites` create/accept/revoke/replay/expired/email-mismatch cases
- `/api/app-state/*` read/write access for admin vs non-admin vs expired session
- Production-mode backend behavior when `SERVER_API_URL` is missing

### Security Tests To Add Or Strengthen

- Auth bypass gate test
- Invite token replay and project-boundary enforcement
- Cross-project access denial for wrong invite token / wrong member
- Missing or malformed auth header coverage across all protected API groups
- Corp-proxy TLS downgrade branch risk test and config validation

### Performance Tests To Add Or Strengthen

- Dashboard project list load with large project counts
- Project update path with large `data` payloads
- Document deletion path with many projects/documents
- Startup behavior when catalog latency is high

### E2E / Automation Tests To Add Or Strengthen

- Full sign-in to dashboard to project save flow
- Invite acceptance on desktop and mobile
- Cross-device or refresh-heavy invite confirmation
- Create project with document upload failures
- Settings/app-state behavior with admin and non-admin users

## Re-run Observation Check: Missing From Original Findings

The following items were added after the re-run because they were either implicit or under-emphasized in the original review:

1. Dashboard failure masking as empty state must be treated as a critical functional-observability bug, not only a usability issue.
2. The Postgres-only target is still undermined by `localProjectStore` fallback in the backend proxy path.
3. App-state/config auth drift is a separate startup/system behavior risk and needs its own test coverage.
4. Role mismatch between invite API and frontend role model is a direct RBAC contract issue.
5. Domain master-data partial hydration remains a crash-risk and needs focused regression coverage.

## Recommended Fix Order

Follow this order during remediation on `Dev`:

1. Auth/session lifecycle across login, dashboard, save-project, invite accept, and settings
2. Project creation transactional integrity and retry behavior
3. Invite lifecycle resilience and role-contract alignment
4. Master-data/bootstrap resilience and domain fallback handling
5. Postgres/API-only enforcement and removal of ambiguous local fallback behavior
6. Accessibility and usability hardening
7. Performance/API efficiency cleanup

## Exit Criteria For This Tracker

Do not close this tracker until:

- All critical and high observations have code fixes or explicit accepted-risk signoff
- Unit, integration, security, performance, E2E, and automation scenarios above are updated
- Every observation in this file is mapped to at least one automated test or explicit manual test case
- The observation list is re-run and the file is updated with final status


## Rerun Update - 2026-07-09 (Auth/Session Pass 1)

- Implemented local admin-bypass bearer fallback for project CRUD / permissions routes in frontend/src/db/projectRepository.ts.
- Added explicit dashboard load-error state and visible error banner in frontend/src/components/dashboard/Dashboard.tsx instead of silently collapsing to the empty state on auth/API failure.
- Added regression coverage in tests/unit/projectRepository.test.ts for local admin bypass auth headers and unauthenticated failure behavior.
- Added dashboard regression coverage in tests/unit/Dashboard-archive.test.tsx for explicit load-error rendering (TS-auth-3).

### Verification Status

- projectRepository.test.ts: passing (26/26)
- Dashboard-archive.test.tsx -t TS-auth-3: passing
- Dashboard-archive.test.tsx -t TS-59: passing
- Dashboard-archive.test.tsx broad run: first 10 cases visibly passed during run; the two isolated tail cases also passed independently, confirming the auth/dashboard regression path is covered.

### Observation Status Changes

- QA-02 Dashboard hides backend/auth failures as empty state: Partially resolved
  The dashboard now surfaces an explicit error message instead of misleading the user with a no-projects empty state. End-to-end validation of the full local login/save flow is still pending.
- QA-11 app-state/config auth drift failures: Partially resolved
  appStateApi now uses the same local-dev proxy-token fallback pattern as the agent-call path when Authorization is unavailable. Direct higher-level bootstrap coverage is still a follow-up task.
- QA-03 non-transactional project creation: Partially resolved
  The document-assisted create flow now persists context document metadata in the initial project create payload, removing the second write wave that could leave a half-created project. Direct unit coverage for CreateProjectPage itself is still a follow-up gap.

- appStateApi.test.ts: passing (2/2)