// tests/performance/document-agent-load.js
// K6 load test for the Document Agent backend endpoints (backend/src/proxy.js,
// see docs/Document-Agent-Feature-Plan.md). Covers list, download, and upsert
// under concurrent load — these are lightweight DB-backed calls (no LLM round
// trip), so thresholds are far tighter than pipeline-load.js's agent-call test.
// Run: k6 run tests/performance/document-agent-load.js
//      (requires k6 installed: https://k6.io/docs/getting-started/installation/)
//
// Required env vars:
//   BASE_URL       Backend URL (default: http://localhost:3001)
//   PROJECT_ID     An existing project id to read/write documents against
// Optional env vars:
//   AUTH_BEARER    Authorization bearer value — a real Supabase JWT, or the
//                  admin-local-bypass-token (non-production only). If unset,
//                  requests are sent with no Authorization header, which only
//                  works against a backend with no PROXY_TOKEN/SUPABASE_URL
//                  configured (open local-dev mode — see checkToken() Path 2).
//   DOC_ID         A known generated doc id in PROJECT_ID to exercise the
//                  download endpoint. If unset, the download check is skipped.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const listDuration = new Trend('doc_list_duration', true);
const listSuccess = new Rate('doc_list_success');
const downloadDuration = new Trend('doc_download_duration', true);
const downloadSuccess = new Rate('doc_download_success');
const upsertDuration = new Trend('doc_upsert_duration', true);
const upsertSuccess = new Rate('doc_upsert_success');

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // ramp up
    { duration: '30s', target: 15 },  // steady load
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds: {
    // Pure DB reads/writes, no LLM call — should stay well under 1s even
    // under load. Loosen if the shared Postgres instance is under separate load.
    doc_list_duration: ['p(95)<1000'],
    doc_download_duration: ['p(95)<1000'],
    doc_upsert_duration: ['p(95)<1500'],
    doc_list_success: ['rate>0.99'],
    doc_upsert_success: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const PROJECT_ID = __ENV.PROJECT_ID || '';
const DOC_ID = __ENV.DOC_ID || '';
const AUTH_BEARER = __ENV.AUTH_BEARER || '';

if (!PROJECT_ID) {
  throw new Error('PROJECT_ID env var is required — set it to an existing project id.');
}

const headers = {
  'Content-Type': 'application/json',
  ...(AUTH_BEARER ? { Authorization: `Bearer ${AUTH_BEARER}` } : {}),
};

// Small, valid, allowlist-safe payload for the upsert endpoint. docId/category
// use only [A-Za-z0-9_-] per validateDocumentUpsertPayload's path-traversal
// hardening (backend/src/proxy.js) — anything else is now rejected with 400.
function buildUpsertPayload(vuId, iter) {
  const content = Buffer.from(`k6 load test content — vu=${vuId} iter=${iter}`).toString('base64');
  return JSON.stringify({
    docId: `k6_perf_doc_${vuId}`,
    category: 'Load_Test',
    title: `K6 Perf Test Document (vu ${vuId})`,
    format: 'md',
    contentBase64: content,
    sourceAgentIds: ['k6LoadTest'],
    sourceOutputHash: `k6-${vuId}-${iter}`,
    trigger: 'manual',
  });
}

export default function () {
  // 1. List generated documents for the project
  {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/project-documents/${PROJECT_ID}`, { headers });
    const duration = Date.now() - start;
    const ok = check(res, {
      'list 200': (r) => r.status === 200,
      'list is array-shaped': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) || Array.isArray(body.documents);
        } catch {
          return false;
        }
      },
    });
    listDuration.add(duration);
    listSuccess.add(ok ? 1 : 0);
  }

  // 2. Download one known document, if configured
  if (DOC_ID) {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/project-documents/${PROJECT_ID}/${DOC_ID}/download`, { headers });
    const duration = Date.now() - start;
    const ok = check(res, {
      'download 200': (r) => r.status === 200,
      'download has body': (r) => r.body && r.body.length > 0,
    });
    downloadDuration.add(duration);
    downloadSuccess.add(ok ? 1 : 0);
  }

  // 3. Upsert a load-test-owned document (unique docId per VU avoids write
  // contention across VUs on the same row).
  {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/project-documents/${PROJECT_ID}`,
      buildUpsertPayload(__VU, __ITER),
      { headers }
    );
    const duration = Date.now() - start;
    const ok = check(res, {
      'upsert 200': (r) => r.status === 200,
    });
    upsertDuration.add(duration);
    upsertSuccess.add(ok ? 1 : 0);
  }

  sleep(1);
}

export function handleSummary(data) {
  const pct = (rate) => ((rate ?? 0) * 100).toFixed(1);
  return {
    stdout: `
=== Document Agent Load Test Summary ===
List p95:      ${data.metrics.doc_list_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms   success: ${pct(data.metrics.doc_list_success?.values?.rate)}%
Download p95:  ${data.metrics.doc_download_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A (DOC_ID not set)'}ms   success: ${pct(data.metrics.doc_download_success?.values?.rate)}%
Upsert p95:    ${data.metrics.doc_upsert_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms   success: ${pct(data.metrics.doc_upsert_success?.values?.rate)}%
HTTP fail rate: ${pct(data.metrics.http_req_failed?.values?.rate)}%
=========================================
`,
  };
}
