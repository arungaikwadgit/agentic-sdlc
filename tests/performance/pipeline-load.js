// tests/performance/pipeline-load.js (Appendix K5)
// K6 load test — DoD item: no >10% regression on critical paths
//
// Run: k6 run tests/performance/pipeline-load.js
//      (requires k6 installed: https://k6.io/docs/getting-started/installation/)
//
// Expanded 2026-08-27 (backlog #17) — see docs/architecture/step4-specs-wave4-draft.md
// item 4 for the full spec and open-questions history. Summary of what changed
// and why:
//
//   - Original script only exercised the LLM proxy (/api/agent) at a flat
//     5->10 VU ramp, with no real usage data behind that number. Target scale
//     is now the user's own stated figure for launch: 20-30 concurrent users.
//     That number is a launch estimate, not measured production traffic —
//     Railway's actual request volume on the backend service (checked
//     2026-08-27) is ~33 requests every ~2.8 hours, a flat pattern consistent
//     with automated health-check traffic, not real user sessions. Re-tune
//     these stages once real signup/usage data exists.
//
//   - Split into three separate k6 scenarios instead of one flat default
//     function, because the three critical paths have very different cost
//     and side-effect profiles and shouldn't be forced into the same VU count:
//
//       1. `catalog_and_health` — GET /health + GET /api/master-data/catalog.
//          Both are free, read-only, no auth, no side effects. Runs at the
//          full 20-30 target VU count by default.
//
//       2. `agent_proxy` — POST /api/agent (existing scenario, unchanged
//          payload: a minimal gpt-4o call, max_tokens 50). This makes a REAL,
//          billed LLM call per iteration. Deliberately capped below the full
//          target (5->15->20 VUs, not 30) to bound API cost and avoid
//          tripping OpenAI's own rate limits during a single test run —
//          the DoD threshold (p95<8s, from step8-nfrs-draft.md's "agent/
//          LLM-proxy routes excluded" NFR) is unchanged from the original.
//
//       3. `chat_orchestrator` — POST /api/chat/respond. OFF BY DEFAULT.
//          This path makes TWO real LLM calls per request (planner +
//          synthesis, see backend/src/routes/chatRespond.js) and — unlike
//          the other two paths — WRITES to the real `chat_messages`/history
//          table via `saveChatMessage`, scoped to whatever `projectId` is
//          sent. Running this against a real project's history by accident
//          would pollute that project's actual chat log with load-test noise.
//          To run it: set RUN_CHAT_SCENARIO=true AND TEST_PROJECT_ID=<a
//          disposable/test project's UUID>. Without both set, this scenario
//          is skipped entirely (see the `executor` gating below) rather than
//          silently running against project id null or a real project. Every
//          question this scenario sends is prefixed "[LOAD TEST]" so any
//          rows that do land are trivially identifiable and easy to clean up
//          afterward, e.g.:
//            DELETE FROM chat_messages WHERE text LIKE '[LOAD TEST]%';
//
//   - Kept manual (not wired into CI) per explicit decision 2026-08-27: k6
//     needs a live target URL and real wall-clock time, and scenario 2/3
//     above cost real API money per run — automatic on every PR/push would
//     be both slow and a recurring cost with no one deciding to spend it.
//     Run it deliberately (e.g. before a release, or after a change that
//     touches one of these three paths).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ── Custom metrics ──────────────────────────────────────────────────────────
const catalogDuration = new Trend('catalog_duration', true);
const catalogSuccess = new Rate('catalog_success');

const agentCallDuration = new Trend('agent_call_duration', true);
const agentCallSuccess = new Rate('agent_call_success');

const chatCallDuration = new Trend('chat_call_duration', true);
const chatCallSuccess = new Rate('chat_call_success');

// ── Config ───────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const PROXY_TOKEN = __ENV.PROXY_TOKEN || 'MySDLCAI-Key';
const RUN_CHAT_SCENARIO = (__ENV.RUN_CHAT_SCENARIO || '').toLowerCase() === 'true';
const TEST_PROJECT_ID = __ENV.TEST_PROJECT_ID || '';
const chatScenarioReady = RUN_CHAT_SCENARIO && TEST_PROJECT_ID.length > 0;

if ((__ENV.RUN_CHAT_SCENARIO || '').toLowerCase() === 'true' && !TEST_PROJECT_ID) {
  console.warn(
    'RUN_CHAT_SCENARIO=true but TEST_PROJECT_ID is not set — the chat_orchestrator ' +
    'scenario will be skipped rather than risk writing load-test messages into a ' +
    'real project\'s chat history. Set TEST_PROJECT_ID to a disposable test project UUID to run it.'
  );
}

const headers = {
  'Content-Type': 'application/json',
  'x-proxy-token': PROXY_TOKEN,
};

// Minimal payload — uses a tiny model call to measure proxy latency, not
// actual agent behavior. Unchanged from the original script.
const agentPayload = JSON.stringify({
  model: 'gpt-4o',
  max_tokens: 50,
  messages: [
    { role: 'system', content: 'You are a test agent. Reply with only: OK' },
    { role: 'user', content: 'Confirm you are working.' },
  ],
});

function chatPayload() {
  return JSON.stringify({
    projectId: TEST_PROJECT_ID,
    question: '[LOAD TEST] Confirm you are working. Reply with a single short sentence.',
    history: [],
  });
}

// ── Scenario definitions ────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Scenario 1: free, read-only, no side effects — safe to run at the full
    // launch-scale target.
    catalog_and_health: {
      executor: 'ramping-vus',
      exec: 'catalogAndHealth',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },  // ramp up
        { duration: '15s', target: 20 },  // approaching launch target
        { duration: '30s', target: 30 },  // stretch scenario, per launch estimate
        { duration: '15s', target: 0 },   // ramp down
      ],
    },
    // Scenario 2: real, billed LLM calls — capped below full target to bound
    // API cost and avoid provider rate-limit noise inside one test run.
    agent_proxy: {
      executor: 'ramping-vus',
      exec: 'agentProxy',
      startVUs: 0,
      startTime: '5s', // slight offset so both scenarios' ramps don't spike at the exact same instant
      stages: [
        { duration: '15s', target: 5 },
        { duration: '20s', target: 15 },
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
    // Scenario 3: opt-in only — see the header comment. Uses a `shared-iterations`
    // style low-VU executor so an accidental default run does minimal damage
    // even if someone forces it on without reading the gating.
    ...(chatScenarioReady
      ? {
          chat_orchestrator: {
            executor: 'ramping-vus',
            exec: 'chatOrchestrator',
            startVUs: 0,
            startTime: '10s',
            stages: [
              { duration: '20s', target: 2 },
              { duration: '30s', target: 5 },
              { duration: '10s', target: 0 },
            ],
          },
        }
      : {}),
  },
  thresholds: {
    // Catalog/health: plain DB read, no LLM — same p95<500ms non-agent-route
    // target already recorded in step8-nfrs-draft.md's NFR table.
    catalog_duration: ['p(95)<500'],
    catalog_success: ['rate>0.99'],
    // Agent proxy: unchanged from the original script (GPT-4o can be slow).
    agent_call_duration: ['p(95)<8000'],
    agent_call_success: ['rate>0.99'],
    // Chat orchestrator: two sequential LLM calls (plan + synthesize) plus a
    // DB history read/write, so a materially looser bound is realistic —
    // not yet validated against a real run, treat as a starting point.
    ...(chatScenarioReady
      ? {
          chat_call_duration: ['p(95)<15000'],
          chat_call_success: ['rate>0.95'],
        }
      : {}),
    // Overall HTTP errors < 1% across every scenario.
    http_req_failed: ['rate<0.01'],
  },
};

// ── Scenario functions ──────────────────────────────────────────────────────
export function catalogAndHealth() {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health OK': (r) => r.status === 200 });

  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/master-data/catalog`);
  const duration = Date.now() - start;

  const ok = check(res, {
    'catalog 200': (r) => r.status === 200,
    'catalog has phases/agents': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body === 'object' && body !== null;
      } catch {
        return false;
      }
    },
  });

  catalogDuration.add(duration);
  catalogSuccess.add(ok ? 1 : 0);

  sleep(1);
}

export function agentProxy() {
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/agent`, agentPayload, { headers });
  const duration = Date.now() - start;

  const ok = check(res, {
    'agent call 200': (r) => r.status === 200,
    'has choices': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.choices) && body.choices.length > 0;
      } catch {
        return false;
      }
    },
  });

  agentCallDuration.add(duration);
  agentCallSuccess.add(ok ? 1 : 0);

  sleep(2); // longer think-time — a real chat/agent interaction isn't back-to-back
}

export function chatOrchestrator() {
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/chat/respond`, chatPayload(), { headers });
  const duration = Date.now() - start;

  const ok = check(res, {
    'chat call 200': (r) => r.status === 200,
    'has answer': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.answer === 'string' && body.answer.length > 0;
      } catch {
        return false;
      }
    },
  });

  chatCallDuration.add(duration);
  chatCallSuccess.add(ok ? 1 : 0);

  sleep(3);
}

export function handleSummary(data) {
  const chatLines = chatScenarioReady
    ? `Chat orchestrator p95: ${data.metrics.chat_call_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
Chat success rate:     ${((data.metrics.chat_call_success?.values?.rate ?? 0) * 100).toFixed(1)}%
`
    : `Chat orchestrator: SKIPPED (set RUN_CHAT_SCENARIO=true and TEST_PROJECT_ID=<uuid> to include it)
`;

  return {
    stdout: `
=== Pipeline Load Test Summary ===
Catalog/health p95:    ${data.metrics.catalog_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
Catalog success rate:  ${((data.metrics.catalog_success?.values?.rate ?? 0) * 100).toFixed(1)}%
Agent call p95:        ${data.metrics.agent_call_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
Agent success rate:    ${((data.metrics.agent_call_success?.values?.rate ?? 0) * 100).toFixed(1)}%
${chatLines}HTTP fail rate:        ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%
===================================
`,
  };
}
