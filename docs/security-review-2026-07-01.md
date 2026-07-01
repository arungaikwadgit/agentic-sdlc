# Security Review - 2026-07-01

Reference prompt: `C:\Projects\SLDC - AI\security-vulnerability-review-prompt.md`

## Executive Summary

- Overall risk rating after remediation: **Low**
- Critical / High findings remaining in the reviewed categories: **0**
- Medium findings remaining in the reviewed categories: **0**
- Primary fixes completed:
  - Removed browser-side fallback auth using `VITE_PROXY_TOKEN`
  - Removed production-facing browser admin credential pattern
  - Restricted sensitive backend settings and app-state routes to server-authorized admins
  - Replaced replayable invite-link bearer access with one-time invite acceptance plus server-tracked invite sessions
  - Reduced invite-session persistence from `localStorage` to `sessionStorage`
  - Added explicit JSON body-size limit to the runtime API

## Findings Table

| ID | Vulnerability Type | Status | Severity | Files | Notes |
|---|---|---|---|---|---|
| F1 | Secret Key Leak / Auth Bypass | Fixed | Critical | `frontend/src/lib/adminMode.ts`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/services/api.ts`, `frontend/.env.example` | Production no longer depends on browser-bundled admin or proxy secrets |
| F2 | Authorization Gap | Fixed | Critical | `backend/src/proxy.js` | `/api/settings` and `/api/app-state/*` now require authenticated admin authorization |
| F3 | Replay Attack | Fixed | High | `backend/src/proxy.js`, `frontend/src/services/inviteSession.ts`, `frontend/src/components/invite/InviteAcceptPage.tsx` | Invite links are one-time accept tokens; accepted access now uses server-side `invite_sessions` with expiry |
| F4 | LPDoS | Fixed | Medium | `backend/src/index.ts` | Runtime API now uses `express.json({ limit: '1mb' })` |
| F5 | Frontend Secret Exposure | Fixed | Medium | `frontend/src/components/admin/TestsTab.tsx`, `frontend/src/components/admin/AdminPanel.tsx`, `frontend/src/services/api.ts` | Removed direct frontend secret/header patterns |

## Category Review

### 1. SSTI

- Reviewed server and frontend rendering paths for template engines, dynamic template compilation, and server-side user-controlled template evaluation.
- Result: **No SSTI issue found**.
- Reasoning: the codebase does not use EJS, Pug, Handlebars, Mustache, Liquid, or similar server-side template engines for untrusted content. Rendering is client-side React plus sanitized HTML/diagram flows.

### 2. ReDoS

- Reviewed regex-heavy validation/sanitization paths and invite/auth parsing flows.
- Result: **No exploitable ReDoS issue found** in the reviewed paths.
- Reasoning: no high-risk catastrophic-backtracking patterns were identified in the authentication, invite, or API hardening paths touched in this remediation.

### 3. LPDoS

- Reviewed body parsing, rate limiting, and large request handling.
- Result: **Fixed** for the runtime API.
- Remaining posture: proxy API already uses explicit JSON limits and rate limiting; runtime now matches that baseline.

### 4. Secret Key Leak

- Reviewed browser-bundled env usage and frontend secret/header fallbacks.
- Result: **Fixed** for the identified frontend exposures.
- Residual note: provider keys still live server-side in backend environment storage. That is an operational secret-management concern, not a browser leak.

### 5. NoSQL / SQL Injection

- Reviewed query construction patterns in the touched backend paths.
- Result: **No injection issue found** in the reviewed flows.
- Reasoning: database access in the touched invite/admin routes continues to use parameterized `pg` queries rather than string-built SQL.

### 6. Clipboard Attack

- Reviewed clipboard-related code paths in the app surface.
- Result: **No high-risk clipboard attack found** in the reviewed paths.
- Reasoning: no silent clipboard overwrite or background clipboard exfiltration pattern was identified in the reviewed scope.

### 7. Replay Attack

- Reviewed invite acceptance and invite-scoped project access.
- Result: **Fixed**.
- Reasoning: the invite link token is no longer reused as the long-lived bearer for project access after acceptance.

## Verification

- Frontend production build: **passed**
  - `C:\Projects\SLDC - AI\agentic-sdlc\frontend`
  - `npm.cmd run build`
- Backend proxy syntax check: **passed**
  - `node -c C:\Projects\SLDC - AI\agentic-sdlc\backend\src\proxy.js`
- Backend runtime full TypeScript build: **blocked by pre-existing workspace issue**
  - missing `@agentic-sdlc/shared-types` resolution in backend runtime files unrelated to this remediation

## Residual Recommendations

1. Move mutable provider/app settings out of `backend/.env` and into a server-only Postgres-backed settings store or external secret manager.
2. Replace the remaining development-only `admin@local / admin` bypass with a dedicated local seed-user flow if you want zero static bypass credentials even in development.
3. Review client-side HTML rendering surfaces separately for XSS hardening. That was outside the requested vulnerability classes for this pass.
