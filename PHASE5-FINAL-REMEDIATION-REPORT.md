# Agentic SDLC — Phase 5 Remediation: Final Report

**Engagement:** 8-batch code remediation (code-assess-and-fix workflow — Product Owner, AI/Cloud Architect, Senior Programmer, and QA/Test Architect review lenses)
**Scope:** `agentic-sdlc` repo — frontend (React/TS), backend (`proxy.js`, Express), test suite (Vitest/Jest)
**Status as of this report:** Batches 1–8 complete. Batches 7 and 8 are now execution-verified (`node -c` clean; all hardening code confirmed present and wired correctly as of 2026-06-22). The final full typecheck/lint/build pass (Task #17) remains outstanding and should be run before the next production deploy.

A note on provenance: batches 1–6 are reported as completed by the engagement session that ran before this report was written. That session's sandbox died mid-run, and the reporting session (resuming from a handoff note) was not able to independently re-verify batches 1–6 by re-running their tests — the summary for those six is carried forward as reported, not re-confirmed. Batches 7–8 were implemented in that session and are now execution-verified in a subsequent session (2026-06-22).

---

## Batch summary

| # | Title | Status | Verified by execution? |
|---|-------|--------|------------------------|
| 1 | Fix Dockerfile.runtime + `install:all` + dead docker-compose | Done | Reported done; not re-run in this session |
| 2 | Add auth middleware to Agent Runtime routes | Done | Reported done; not re-run in this session |
| 3 | Fix backend tsconfig `rootDir` / shared-types import path | Done | Reported done; not re-run in this session |
| 4 | Fix 13 frontend TypeScript errors + ProjectWorkspace.tsx imports | Done | Reported done; not re-run in this session |
| 5 | Set up working ESLint flat config for frontend | Done | Reported done; not re-run in this session |
| 6 | Upgrade backend Jest 25 → 30, fix test script invocation | Done | Reported done; not re-run in this session |
| 7 | Harden plaintext secret writes in `proxy.js` settings endpoint | Done | `node -c` clean; `rejectsEnvInjection` + `chmodSync` confirmed in-place (2026-06-22) |
| 8 | Add invite-specific rate limiting | Done | `node -c` clean; `inviteSendRateLimit` (5 req/15 min) confirmed wired to route (2026-06-22) |
| Final | Full validation suite + this report | **Pending** | `node -c` + structural checks pass; full tsc/lint/test/build pass not yet run (Task #17) |

---

## Batch-by-batch detail

### Batch 1 — Fix Dockerfile.runtime + install:all + dead docker-compose

The runtime Dockerfile and the root `install:all` script were broken or inconsistent with each other, and a `docker-compose` file existed that no longer matched the application's actual services. All three were corrected so the documented install/build path reflects what the app actually needs to run.

### Batch 2 — Add auth middleware to Agent Runtime routes

The Agent Runtime's Express routes had no authentication at all. A `requireApiToken` middleware was added and wired onto those routes, closing an unauthenticated-access gap.

### Batch 3 — Fix backend tsconfig rootDir / shared-types import path

The backend's `tsconfig.json` had a `rootDir` setting that didn't account for the `shared-types` package, which broke the build whenever backend code imported from it. Path resolution was corrected.

### Batch 4 — Fix 13 frontend TypeScript errors + ProjectWorkspace.tsx imports

Cleared 13 real typecheck errors across the frontend, including broken import paths in `ProjectWorkspace.tsx` (`AgentThinkingPanel`, `PrototypeViewer`) and a signature mismatch in `crypto.ts`'s `toBase64`.

### Batch 5 — Set up working ESLint flat config for frontend

There was no functioning lint setup — the legacy config didn't actually run under the installed ESLint version. A proper ESLint 9 flat config (`eslint.config.js`) was built, and everything it flagged was fixed. This surfaced two real, previously-undetected bugs: a latent `\Z` regex issue in `PrototypeViewer.tsx`, and a root-cause `.then()` crash that had been silently breaking 47+ tests in the `ProjectWorkspace` test family.

### Batch 6 — Upgrade backend Jest 25 → 30, fix test script invocation

Backend tests had not actually run in some time: Jest 25 and ts-jest 27 were incompatible, the `test` script invoked Jest incorrectly, and there was no `jest.config.js`. All of this was fixed, and the Batch 2 auth-middleware test ran successfully for the first time as a result.

### Batch 7 — Harden plaintext secret writes in proxy.js settings endpoint

**Finding:** `POST /api/settings` (in `backend/src/proxy.js`) writes request-body values directly into `backend/.env` using string concatenation (`key + '=' + value`), then joins all lines with `\n`. A value containing an embedded newline could inject arbitrary extra `KEY=VALUE` lines into the file — a CRLF/env-injection vector that could plant unrelated environment variables or corrupt existing ones. The file also holds plaintext API keys (OpenAI, Anthropic, Resend) with no permission restriction.

**Fix implemented:**
- A `rejectsEnvInjection(value)` helper rejects (HTTP 400) any field containing `\r` or `\n` before anything is written to disk. This is applied to every string field on the settings payload, including the serialized `agentProviderMap`.
- After a successful write, `fs.chmodSync(envPath, 0o600)` restricts the file to owner read/write. This is wrapped in a try/catch since chmod isn't meaningful on all platforms (e.g. Windows) — a failure there shouldn't block the save.

**Verification status (updated 2026-06-22):** `node -c backend/src/proxy.js` passes. `rejectsEnvInjection` confirmed defined at line 743, applied to all string fields at lines 764 and 768, and `fs.chmodSync(envPath, 0o600)` confirmed at line 816 inside a try/catch. Structural verification complete. Manual injection probe (sending `\n` in a settings field and confirming 400) should be run locally as a smoke test before the next production deploy.

### Batch 8 — Add invite-specific rate limiting

**Finding:** `POST /api/invite/send` shared the general `/api` rate limit (120 requests/minute) with every other route. That's far too loose for an endpoint that sends an outbound email and mints an invite token — it's exploitable for spam or for probing which email addresses are valid project members.

**Fix implemented:** A second, stricter `express-rate-limit` instance (`inviteSendRateLimit`) scoped specifically to that route: 5 requests per 15 minutes, keyed by IP (consistent with the existing general limiter's default behavior), returning a custom 429 message. Defined just above the invite-system route handlers in `proxy.js` and applied as middleware on `app.post('/api/invite/send', checkToken, inviteSendRateLimit, ...)`.

**Verification status (updated 2026-06-22):** `node -c backend/src/proxy.js` passes. `inviteSendRateLimit` confirmed defined at line 847 (5 req / 15-minute window, custom 429 message) and wired at line 950 as `app.post('/api/invite/send', checkToken, inviteSendRateLimit, ...)`. Structural verification complete. Exercising the route 6 times and confirming the 6th returns 429 should be done as a local smoke test.

### Final — Full validation suite + this report

**Status: pending.** `node -c proxy.js` is clean. A full typecheck + lint + test + build pass across both frontend and backend has not yet been run end-to-end. This is tracked as Task #17. Until that pass completes, the batch table cannot be fully closed out — but both security patches (Batches 7–8) are structurally confirmed.

---

## Findings explicitly held out of implementation

These two were identified during the broader assessment but deliberately not auto-fixed — they require a decision the team should make rather than have made for them silently.

**Finding #9 — `xlsx` package vulnerability.** A known vulnerability exists in the `xlsx` dependency, and there is no patched version currently available upstream. This is documented here as an accepted/tracked risk, not fixed in place. Recommend monitoring the upstream advisory and re-assessing when a patch lands, or evaluating a replacement library if this dependency is load-bearing for a security-sensitive workflow.

**Finding #15 — `node_modules` committed to git.** The repository has `node_modules` checked into git history. Two remediation paths exist with different tradeoffs: add `.gitignore` going forward (cheap, but the bloat stays in history) or rewrite history to strip it out (clean, but rewrites every commit hash and requires coordinating with anyone else with a clone). This decision is left to the team rather than actioned automatically.

---

## Sandbox and tooling issues encountered during this engagement

These are environment/infrastructure problems, not application bugs. Listed here so they aren't mistaken for product defects later:

1. **Write/Edit-to-bash propagation bug.** The file-editing tools sometimes silently failed to propagate changes to the bash-visible filesystem (a bindfs mount), while still reporting success. Symptoms: mid-token truncation, trailing null-byte padding, or duplicate-content splices in files that had just been edited. Detected via syntax errors appearing where only logic errors were expected, `wc -l`/`wc -c` mismatches, and `git show HEAD:<path>` diffing.
2. **`npm install` corruption in the frontend sandbox.** Installing directly into `frontend/node_modules` repeatedly hit `ENOTEMPTY`/rename collisions. Workaround established: install into `/tmp/frontend-test-install` instead.
3. **Vite cache permission errors**, encountered during the engagement (specifics not preserved beyond the mention — worth re-confirming if Vite dev/build commands misbehave again).
4. **Total sandbox outage (this report's blocker).** Across the two most recent sessions, the bash sandbox first died mid-session and then, in the following session, failed to boot at all (`VM service not running`). Neither recovered after repeated retries. This is a Cowork-infrastructure issue, not something fixable from within a session — the working assumption going forward should be "start a fresh session and check `echo ok` before relying on shell access for that session."

---

## Recommended next steps

1. ~~Get a working shell and run `node -c backend/src/proxy.js`~~ — **Done (2026-06-22). Syntax clean.**
2. Run a full typecheck + lint + build pass across frontend and backend (Task #17). This is the single remaining gate before the remediation engagement is fully closed.
3. Manually smoke-test the two security controls: send `\n` in a `POST /api/settings` payload and confirm 400; hit `POST /api/invite/send` 6 times from the same IP and confirm the 6th returns 429 with the custom message.
4. Decide on Finding #15 (`.gitignore` going forward vs. history rewrite) and track Finding #9 against the upstream `xlsx` advisory.
5. Once steps 2–4 are complete, the batch table is fully closed.
