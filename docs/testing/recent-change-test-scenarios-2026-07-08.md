# Recent Change Test Scenarios - 2026-07-08

This matrix documents the updated verification scope for the recent auth, Postgres/API-only, admin, document-agent, invite, project-creation, and agent-orchestration changes.

## Unit and Regression Scenarios

| Area | Scenario | Coverage Location | Expected Result |
|---|---|---|---|
| Agent definitions | Phase ordering, dependency tiering, UX Mockups unique layout requirements, agentic step sequences | `tests/unit/agentDefinitions.test.ts`, `tests/unit/agentDefinitions-uxMockups-architecture.test.ts`, `tests/unit/pipelineEngine-singleAgent.test.ts` | Agent metadata and execution helpers remain consistent after dependency changes. |
| Project creation | Simple project details, mandatory fields, domain-knowledge save path, backend error handling | `tests/unit/NewProjectModal.test.tsx`, `tests/e2e/create-and-run.spec.ts` | Form validates required fields and shows a clear save error if the backend API is unavailable. |
| Workspace controls | Run/stop, gates, preview tabs, diagram tabs, GitHub push visibility, rerun flow | `tests/unit/ProjectWorkspace-*.test.tsx` | Workspace controls render and dispatch correctly across admin/team/error states. |
| Settings and RBAC | Team members, assignments, archive/restore, app settings project controls | `tests/unit/ProjectSettings-*.test.tsx`, `tests/unit/AppSettingsModal-projects.test.tsx` | Admin-only and project-role behaviors remain guarded. |
| Documents and exports | Export menu, generated documentation paths, document/diagram/mockup preview | `tests/unit/ExportMenu.test.tsx`, `tests/unit/DiagramPreview.test.tsx`, `tests/unit/MockupPreview.test.tsx`, `tests/e2e/document-agent.spec.ts` | Export/document UI handles both seeded and no-data states without skipped E2E tests. |
| Governance artifacts | 2026 signature headers, audit/report/action-item alignment | `tests/unit/recentGovernanceArtifacts.test.ts` | Governance artifacts stay aligned with the current 2026 audit baseline. |

## Security Scenarios

| Risk | Scenario | Coverage Location | Expected Result |
|---|---|---|---|
| Unsafe HTML/URL injection | Sanitizer strips unsafe URLs and dangerous tags | `tests/unit/sanitize.test.ts` | `javascript:`, `data:`, and unsafe base tags are removed. |
| API token auth | Runtime middleware accepts only valid API tokens | `backend/src/middleware/requireApiToken.test.ts` | Missing/invalid runtime tokens are rejected. |
| Invite security | Invite token hashing, role restrictions, replay/expiry handling | `backend/src/proxy.inviteSecurity.test.ts` | Invite links remain project-scoped and non-admin. |
| App-state fallback | Local proxy fallback behavior does not inherit production env | `backend/src/proxy.appStateFallback.test.ts` | Local tests clear DB/server env and validate deterministic fallback behavior. |
| Dependency audit | Frontend/backend dependency audit | `npm audit` in `frontend` and `backend` | Backend has zero findings. Frontend has one remaining `xlsx` high advisory with no upstream npm fix; replacement is tracked as residual remediation. |

## E2E and Accessibility Scenarios

| Scenario | Coverage Location | Expected Result |
|---|---|---|
| Dashboard accessible after sign-in/admin-bypass | `tests/e2e/accessibility.spec.ts` | Zero serious/critical axe violations. |
| Simple project form accessibility | `tests/e2e/accessibility.spec.ts` | Required selects/date inputs have accessible names. |
| Simple project flow | `tests/e2e/create-and-run.spec.ts` | User reaches Domain Knowledge step and sees a valid save outcome. |
| Document Agent flows | `tests/e2e/document-agent.spec.ts` | Document-agent UI is verified when data exists; no-data state is asserted, not skipped. |

## Performance and Automation Scenarios

| Area | Scenario | Coverage Location | Expected Result |
|---|---|---|---|
| Backend health | Proxy health endpoint is checked by load script | `tests/performance/pipeline-load.js` | `/api/health` returns 200 within p95 threshold. |
| Master catalog | Master-data catalog endpoint is checked by load script | `tests/performance/pipeline-load.js` | `/api/master-data/catalog` returns 200 and non-empty agents under p95 threshold. |
| LLM proxy smoke | Agent call endpoint is checked under low VU load | `tests/performance/pipeline-load.js` | Success rate remains above threshold when backend/API token are configured. |
| Automation runner | Playwright runner resolves tests outside `frontend/` | `frontend/scripts/run-playwright.mjs` | `npm run test:e2e` works from `frontend` with specs under root `tests/e2e`. |

## Current Execution Notes

- Frontend typecheck: passed.
- Backend typecheck/runtime build: passed.
- Frontend E2E: 7/7 passed with local admin-bypass mode.
- Frontend unit/regression coverage: 627/627 passed; scoped core coverage is above 90%.
- Backend Jest: 53 executed tests passed; 8 DB integration tests are intentionally skipped because no isolated test Postgres URL is configured.
- Performance execution: blocked locally because `k6` is not installed. The script is updated and ready to run once k6 is available.
- Frontend dependency audit: one high advisory remains for `xlsx`; upstream npm has no fixed version. Do not accept untrusted spreadsheet files in high-risk environments until `xlsx` is replaced or isolated server-side.
