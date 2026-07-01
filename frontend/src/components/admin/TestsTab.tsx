/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * TestsTab — Admin test runner dashboard.
 * Triggers Railway backend test jobs; keeps transient run history in memory.
 */
import { useState } from 'react';
import type { TestRunResult } from '@/types/adminData.types';
import { getAuthHeader } from '@/services/api';

function nanoid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const SUITE_META: Record<TestRunResult['suite'], { label: string; icon: string; desc: string; color: string }> = {
  unit:        { label: 'Unit Tests',        icon: '🧪', desc: 'Vitest — component, hook, utility, and service tests', color: '#6366f1' },
  e2e:         { label: 'E2E Tests',         icon: '🎭', desc: 'Playwright — full user flows in a headless browser',   color: '#0ea5e9' },
  performance: { label: 'Performance Tests', icon: '⚡', desc: 'Lighthouse CI — Core Web Vitals and load time budgets', color: '#f59e0b' },
  security:    { label: 'Security Scan',     icon: '🔒', desc: 'npm audit + OWASP dependency check',                   color: '#ef4444' },
};

const PROXY_URL = import.meta.env.VITE_PROXY_URL as string | undefined;

async function triggerTestRun(suite: TestRunResult['suite']): Promise<{ jobId?: string; error?: string }> {
  if (!PROXY_URL) return { error: 'VITE_PROXY_URL not set — cannot reach Railway backend.' };
  try {
    const resp = await fetch(`${PROXY_URL}/api/admin/test-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ suite }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => resp.statusText);
      return { error: `Railway returned ${resp.status}: ${txt}` };
    }
    const data = await resp.json();
    return { jobId: data.jobId ?? data.id };
  } catch (e) {
    return { error: String(e) };
  }
}

async function pollTestRun(jobId: string): Promise<Partial<TestRunResult>> {
  if (!PROXY_URL) return { status: 'error', output: 'No backend URL.' };
  try {
    const resp = await fetch(`${PROXY_URL}/api/admin/test-runs/${jobId}`, {
      headers: await getAuthHeader(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { status: 'error', output: `Poll failed: ${resp.status}` };
    return await resp.json();
  } catch (e) {
    return { status: 'error', output: String(e) };
  }
}

function StatusBadge({ status }: { status: TestRunResult['status'] }) {
  const map: Record<TestRunResult['status'], { bg: string; color: string; label: string }> = {
    pending: { bg: '#94a3b822', color: '#94a3b8', label: 'Pending' },
    running: { bg: '#f59e0b22', color: '#f59e0b', label: 'Running…' },
    passed:  { bg: '#10b98122', color: '#10b981', label: 'Passed' },
    failed:  { bg: '#ef444422', color: '#ef4444', label: 'Failed' },
    error:   { bg: '#ef444422', color: '#ef4444', label: 'Error' },
  };
  const m = map[status];
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

export default function TestsTab() {
  const [running, setRunning] = useState<Set<TestRunResult['suite']>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<TestRunResult[]>([]);

  // Group latest run per suite
  const latestBySuite = Object.fromEntries(
    (['unit', 'e2e', 'performance', 'security'] as const).map((suite) => [
      suite,
      runs.find((r) => r.suite === suite),
    ])
  ) as Record<TestRunResult['suite'], TestRunResult | undefined>;

  async function triggerSuite(suite: TestRunResult['suite']) {
    setRunning((prev) => new Set([...prev, suite]));
    setErrors((prev) => { const n = { ...prev }; delete n[suite]; return n; });

    const runId = nanoid();
    const runRecord: TestRunResult = {
      id: runId,
      suite,
      status: 'running',
      startedAt: Date.now(),
      triggeredBy: 'admin',
    };
    setRuns((prev) => [runRecord, ...prev]);

    const { jobId, error } = await triggerTestRun(suite);

    if (error || !jobId) {
      setRuns((prev) => prev.map((run) => run.id === runId
        ? { ...run, status: 'error', output: error ?? 'No job ID returned', finishedAt: Date.now() }
        : run));
      setErrors((prev) => ({ ...prev, [suite]: error ?? 'Unknown error' }));
      setRunning((prev) => { const n = new Set(prev); n.delete(suite); return n; });
      return;
    }

    // Poll until complete (max 5 min)
    const deadline = Date.now() + 5 * 60_000;
    let lastStatus: TestRunResult['status'] = 'running';

    const poll = async () => {
      if (Date.now() > deadline) {
        setRuns((prev) => prev.map((run) => run.id === runId
          ? { ...run, status: 'error', output: 'Timed out waiting for test run results (5 min limit).', finishedAt: Date.now() }
          : run));
        setRunning((prev) => { const n = new Set(prev); n.delete(suite); return n; });
        return;
      }

      const result = await pollTestRun(jobId);
      lastStatus = result.status ?? 'running';

      setRuns((prev) => prev.map((run) => run.id === runId
        ? {
            ...run,
            status: result.status ?? run.status,
            passed: result.passed,
            failed: result.failed,
            skipped: result.skipped,
            output: result.output,
            durationMs: result.durationMs,
            finishedAt: result.finishedAt ?? (lastStatus !== 'running' ? Date.now() : run.finishedAt),
          }
        : run));

      if (lastStatus === 'running' || lastStatus === 'pending') {
        setTimeout(poll, 5000);
      } else {
        setRunning((prev) => { const n = new Set(prev); n.delete(suite); return n; });
      }
    };

    setTimeout(poll, 3000);
  }

  async function clearHistory() {
    if (!confirm('Clear all test run history?')) return;
    setRuns([]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Test Runner</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Triggers Railway backend jobs · Results kept only for this session
          </p>
        </div>
        {runs.length > 0 && (
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={clearHistory}>Clear History</button>
        )}
      </div>

      {/* Suite cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {(Object.entries(SUITE_META) as [TestRunResult['suite'], typeof SUITE_META[keyof typeof SUITE_META]][]).map(([suite, meta]) => {
          const latest = latestBySuite[suite];
          const isRunning = running.has(suite);
          const err = errors[suite];

          return (
            <div key={suite} style={{ background: 'var(--surface)', border: `1px solid var(--border)`, borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{meta.label}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>{meta.desc}</p>
                </div>
              </div>

              {latest && (
                <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <StatusBadge status={latest.status} />
                    {latest.durationMs && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(latest.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                  {(latest.passed !== undefined || latest.failed !== undefined) && (
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, marginTop: 4 }}>
                      {latest.passed !== undefined && <span style={{ color: '#10b981' }}>✓ {latest.passed} passed</span>}
                      {latest.failed !== undefined && latest.failed > 0 && <span style={{ color: '#ef4444' }}>✗ {latest.failed} failed</span>}
                      {latest.skipped !== undefined && latest.skipped > 0 && <span style={{ color: '#94a3b8' }}>– {latest.skipped} skipped</span>}
                    </div>
                  )}
                  <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 10 }}>
                    {new Date(latest.startedAt).toLocaleString()}
                  </p>
                  {latest.output && (
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, padding: '2px 0', marginTop: 2 }}
                      onClick={() => setExpandedId(expandedId === latest.id ? null : latest.id)}
                    >
                      {expandedId === latest.id ? 'Hide output ▲' : 'View output ▼'}
                    </button>
                  )}
                  {expandedId === latest.id && latest.output && (
                    <pre style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.3)', borderRadius: 4, padding: '6px 8px', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {latest.output}
                    </pre>
                  )}
                </div>
              )}

              {err && <p style={{ margin: '0 0 8px', fontSize: 11, color: '#ef4444' }}>⚠ {err}</p>}

              <button
                className="btn-primary"
                style={{ width: '100%', fontSize: 13, opacity: isRunning ? 0.6 : 1 }}
                disabled={isRunning}
                onClick={() => triggerSuite(suite)}
              >
                {isRunning ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Running…
                  </span>
                ) : `Run ${meta.label}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Run history */}
      {runs.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Run History</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {runs.slice(0, 20).map((run) => {
              const meta = SUITE_META[run.suite];
              return (
                <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                  <span>{meta.icon}</span>
                  <span style={{ fontWeight: 600, minWidth: 130 }}>{meta.label}</span>
                  <StatusBadge status={run.status} />
                  {run.passed !== undefined && <span style={{ color: '#10b981' }}>✓{run.passed}</span>}
                  {run.failed !== undefined && run.failed > 0 && <span style={{ color: '#ef4444' }}>✗{run.failed}</span>}
                  {run.durationMs && <span style={{ color: 'var(--text-muted)' }}>{(run.durationMs / 1000).toFixed(1)}s</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>{new Date(run.startedAt).toLocaleString()}</span>
                  {run.output && (
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
                      onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
                    >
                      {expandedId === run.id ? '▲' : '▼'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {runs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          <p style={{ fontSize: 28, margin: '0 0 8px' }}>🧪</p>
          <p style={{ margin: 0 }}>No test runs yet. Click a suite button above to start.</p>
        </div>
      )}
    </div>
  );
}
