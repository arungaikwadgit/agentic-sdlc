# Definition of Done (per user story / sprint)

Use this checklist for every PR before merging.

- [ ] Code written and committed with meaningful message.
- [ ] Unit tests pass (100% of new code covered, overall coverage ≥80% lines).
- [ ] Integration tests pass (for affected features).
- [ ] E2E tests pass (if UI changes).
- [ ] Linting (ESLint) and formatting (Prettier) pass with no warnings.
- [ ] TypeScript compilation has no errors (`npm run typecheck`).
- [ ] Accessibility: axe-playwright test passes with zero violations.
- [ ] Documentation updated (code comments, README, relevant `.md` files).
- [ ] Reviewed by at least one other team member (PR approval).
- [ ] No known critical bugs (P0/P1 severity).
- [ ] Performance test (K6) shows no regression >10% on critical paths.
- [ ] Security scan (`npm audit`) passes at high severity threshold.
- [ ] Feature flagged (if experimental) and toggle configured.
- [ ] Deployed to staging environment and verified by QA.

## Automated Checks (CI enforces)

- TypeScript compile (`tsc --noEmit`)
- ESLint
- Vitest coverage thresholds (lines: 80%, functions: 80%, branches: 75%)
- npm audit (high severity)
- Docker build

## Traceability

Before closing a sprint, export the Traceability Matrix CSV from the project workspace and verify:
- All user stories have at least one linked test case
- All functional requirements (FR-xxx) are covered by at least one story
