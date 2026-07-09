// tests/performance/pipeline-load.js (Appendix K5)
// K6 load test -- DoD item: no >10% regression on critical paths
// Run: k6 run tests/performance/pipeline-load.js
//      (requires k6 installed: https://k6.io/docs/getting-started/installation/)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics
const agentCallDuration = new Trend('agent_call_duration', true);
const catalogDuration = new Trend('catalog_duration', true);
const agentCallSuccess = new Rate('agent_call_success');
const catalogSuccess = new Rate('catalog_success');

// Load config: 10 VUs, 30s steady, then ramp down
export const options = {
  stages: [
    { duration: '10s', target: 5 },   // ramp up
    { duration: '30s', target: 10 },  // steady load
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds: {
    // p95 of agent calls must be under 8s (GPT-4o can be slow)
    agent_call_duration: ['p(95)<8000'],
    // Startup catalog should stay fast because the app blocks on it in production
    catalog_duration: ['p(95)<1500'],
    // 99% success rate
    agent_call_success: ['rate>0.99'],
    catalog_success: ['rate>0.99'],
    // Overall HTTP errors < 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const PROXY_TOKEN = __ENV.PROXY_TOKEN || 'MySDLCAI-Key';

// Minimal payload -- uses a tiny model call to measure proxy latency
const agentPayload = JSON.stringify({
  model: 'gpt-4o',
  max_tokens: 50,
  messages: [
    { role: 'system', content: 'You are a test agent. Reply with only: OK' },
    { role: 'user', content: 'Confirm you are working.' },
  ],
});

const headers = {
  'Content-Type': 'application/json',
  'x-proxy-token': PROXY_TOKEN,
};

export default function () {
  // 1. Health check
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    'health OK': (r) => r.status === 200,
  });

  // 2. Master catalog startup path
  const catalogStart = Date.now();
  const catalog = http.get(`${BASE_URL}/api/master-data/catalog`, { headers });
  const catalogMs = Date.now() - catalogStart;
  const catalogOk = check(catalog, {
    'catalog 200': (r) => r.status === 200,
    'catalog has agents': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.agents) && body.agents.length > 0;
      } catch {
        return false;
      }
    },
  });

  catalogDuration.add(catalogMs);
  catalogSuccess.add(catalogOk ? 1 : 0);

  // 3. Agent call via proxy
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

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: `
=== Pipeline Load Test Summary ===
Agent call p95: ${data.metrics.agent_call_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
Catalog p95:    ${data.metrics.catalog_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
Agent success:  ${((data.metrics.agent_call_success?.values?.rate ?? 0) * 100).toFixed(1)}%
Catalog success:${((data.metrics.catalog_success?.values?.rate ?? 0) * 100).toFixed(1)}%
HTTP fail rate: ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%
===================================
`,
  };
}