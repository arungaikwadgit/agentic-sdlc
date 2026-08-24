#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Production smoke test -- item from docs/architecture/execution-status-2026-08-24.md
 * Section 3's "CI/deploy verification gap." Checks the ACTUAL live Railway
 * URLs against known-good response shapes, not just deploy status.
 *
 * Why this exists: both of 2026-08-24's incidents were infrastructure/config
 * problems (which process Railway actually started), not code bugs. The
 * existing CI (.github/workflows/ci.yml) only runs typecheck + unit tests --
 * it cannot catch "the wrong process is running" because it never touches a
 * live production URL. This script is the thing that actually would have
 * caught both incidents: it repeats, in code, the exact curl checks used to
 * diagnose them by hand that day (agentic-sdlc's shape distinguishes
 * proxy.js from index.ts; agentic-sdlc-runtime's /ready proves the Runtime
 * API is up; a 401 instead of 404 on a token-gated route proves the route
 * exists at all).
 *
 * Each check retries a few times with a delay before failing, since this is
 * meant to run shortly after a push-triggered Railway deploy, which takes
 * 30-90s to build and go live -- a hard sleep in the calling workflow would
 * be more fragile than retrying here.
 *
 * Usage: node scripts/smokeTestProduction.js
 * Exit code 0 = all checks passed. Exit code 1 = at least one failed.
 * URLs are overridable via env vars (defaults are the current known
 * production URLs) so this can point at a staging environment later without
 * editing the script.
 */

const AGENTIC_SDLC_URL = process.env.SMOKE_TEST_AGENTIC_SDLC_URL || 'https://agentic-sdlc-production-d156.up.railway.app';
const AGENTIC_SDLC_RUNTIME_URL = process.env.SMOKE_TEST_AGENTIC_SDLC_RUNTIME_URL || 'https://agentic-sdlc-runtime-production.up.railway.app';
const ARTISTIC_CHARM_URL = process.env.SMOKE_TEST_ARTISTIC_CHARM_URL || 'https://artistic-charm-production-6fa7.up.railway.app';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A check is a function that returns { pass: boolean, detail: string } or
 * throws. runCheck retries on both a failing assertion and a network error,
 * since both can be transient during a deploy in progress.
 */
async function runCheck(name, checkFn) {
  let lastDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await checkFn();
      if (result.pass) {
        console.log(`OK   ${name}${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ''} -- ${result.detail}`);
        return { name, pass: true, detail: result.detail };
      }
      lastDetail = result.detail;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  console.error(`FAIL ${name} -- ${lastDetail} (after ${MAX_ATTEMPTS} attempts)`);
  return { name, pass: false, detail: lastDetail };
}

const CHECKS = [
  {
    name: 'agentic-sdlc (proxy.js) /api/health responds with proxy.js\'s shape',
    run: async () => {
      const res = await fetchWithTimeout(`${AGENTIC_SDLC_URL}/api/health`);
      if (res.status !== 200) return { pass: false, detail: `HTTP ${res.status}, expected 200` };
      const body = await res.json().catch(() => null);
      // proxy.js's /api/health includes a "model" field; index.ts's generic
      // /health does not -- this is exactly how today's incident was
      // diagnosed: the SHAPE proves which process is actually running, a
      // 200 alone does not.
      if (!body || typeof body.model === 'undefined') {
        return { pass: false, detail: `200 but missing "model" field -- wrong process may be running: ${JSON.stringify(body)}` };
      }
      return { pass: true, detail: `200, model=${body.model}` };
    },
  },
  {
    name: 'agentic-sdlc (proxy.js) /api/chat/respond route exists (401, not 404)',
    run: async () => {
      const res = await fetchWithTimeout(`${AGENTIC_SDLC_URL}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.status === 404) return { pass: false, detail: '404 -- proxy.js\'s chat route is unreachable (this is exactly 2026-08-24\'s first incident)' };
      if (res.status !== 401) return { pass: false, detail: `HTTP ${res.status}, expected 401` };
      return { pass: true, detail: '401 (route exists, auth required, as expected)' };
    },
  },
  {
    name: 'agentic-sdlc-runtime (index.ts) /ready confirms DB connectivity',
    run: async () => {
      const res = await fetchWithTimeout(`${AGENTIC_SDLC_RUNTIME_URL}/ready`);
      if (res.status !== 200) return { pass: false, detail: `HTTP ${res.status}, expected 200` };
      const body = await res.json().catch(() => null);
      if (body?.status !== 'ready' || body?.db !== 'connected') {
        return { pass: false, detail: `200 but unexpected body: ${JSON.stringify(body)}` };
      }
      return { pass: true, detail: 'ready, db connected' };
    },
  },
  {
    name: 'agentic-sdlc-runtime (index.ts) /api/v1/agent-runs route exists (401, not 404)',
    run: async () => {
      const res = await fetchWithTimeout(`${AGENTIC_SDLC_RUNTIME_URL}/api/v1/agent-runs`);
      if (res.status === 404) return { pass: false, detail: '404 -- Runtime API routes are unreachable' };
      if (res.status !== 401) return { pass: false, detail: `HTTP ${res.status}, expected 401` };
      return { pass: true, detail: '401 (route exists, auth required, as expected)' };
    },
  },
  {
    name: 'artistic-charm (server/) /health',
    run: async () => {
      const res = await fetchWithTimeout(`${ARTISTIC_CHARM_URL}/health`);
      if (res.status !== 200) return { pass: false, detail: `HTTP ${res.status}, expected 200` };
      return { pass: true, detail: '200' };
    },
  },
];

async function main() {
  console.log(`[smoke-test] Checking ${CHECKS.length} production endpoints (up to ${MAX_ATTEMPTS} attempts each, ${RETRY_DELAY_MS / 1000}s apart)...\n`);
  const results = [];
  for (const check of CHECKS) {
    results.push(await runCheck(check.name, check.run));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n[smoke-test] ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.log('[smoke-test] Failures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[smoke-test] Fatal error running checks:', err);
  process.exitCode = 1;
});
