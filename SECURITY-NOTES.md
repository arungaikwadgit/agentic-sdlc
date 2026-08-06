# Security Notes

## Known Debt

### M-NEW-06 — CSP uses `unsafe-inline` and `unsafe-eval`
**File:** `vercel.json` Content-Security-Policy header  
**Risk:** Medium — weakens XSS protection by allowing inline scripts and eval()  
**Why it's there:** Vite's dev/preview server requires both. `unsafe-eval` is needed by some Mermaid diagram rendering paths.  
**Upgrade path:**
1. Audit which scripts actually trigger `unsafe-eval` violations (use `report-only` mode first).
2. Replace `unsafe-inline` with `nonce-{nonce}` via a Vercel Edge Middleware that injects a per-request nonce.
3. Replace `unsafe-eval` with a Trusted Types policy or replace the eval-dependent library path.  
**Priority:** First post-launch hardening sprint.

### H-NEW-04 — RLS migration requires manual application
**File:** `backend/migrations/003_rls_policies.sql`  
**Action required:** Run `npm run migrate:up` in the Railway backend terminal after deploying.  
The service role key bypasses RLS, so these policies only protect against direct Supabase Data API access (anon key). Express middleware remains the primary access control layer.
