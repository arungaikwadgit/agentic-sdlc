/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * /api/admin/test-runs — Admin test runner routes
 *
 * Triggers server-side validation jobs and returns streaming results.
 * Protected by PROXY_TOKEN header (not Supabase JWT) since it is called
 * from the admin panel which may be in bypass/local mode.
 *
 * Supported suites:
 *  • unit        — TypeScript type-check (tsc --noEmit) across server
 *  • security    — npm audit on server dependencies
 *  • e2e         — Informational: must run locally via `npm run test:e2e`
 *  • performance — Health-check latency probe against own /health endpoint
 */

import path from 'path';
import { spawn } from 'child_process';
import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ── Proxy token guard ─────────────────────────────────────────────────────────

function requireProxyToken(req: Request, res: Response): boolean {
  const token = req.headers['x-proxy-token'];
  const expected = process.env.PROXY_TOKEN;
  if (!expected) {
    res.status(500).json({ error: 'PROXY_TOKEN not configured on server' });
    return false;
  }
  if (!token || token !== expected) {
    res.status(401).json({ error: 'Invalid or missing x-proxy-token' });
    return false;
  }
  return true;
}

// ── In-memory job store ───────────────────────────────────────────────────────

type Suite = 'unit' | 'e2e' | 'performance' | 'security';
type JobStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

interface TestJob {
  id: string;
  suite: Suite;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  output: string;
}

const jobs = new Map<string, TestJob>();

// Clean up jobs older than 2 hours to avoid memory leaks
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

const SERVER_DIR = path.resolve(__dirname, '../../');

function appendOutput(job: TestJob, text: string) {
  job.output = (job.output + text).slice(-20_000); // cap at 20 KB
}

/**
 * Spawn a child process and stream stdout/stderr into the job's output buffer.
 * Resolves with exit code when the process ends.
 */
function spawnJob(
  job: TestJob,
  cmd: string,
  args: string[],
  cwd: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    child.stdout.on('data', (chunk: Buffer) => appendOutput(job, chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => appendOutput(job, chunk.toString()));

    child.on('error', (err) => {
      appendOutput(job, `\n[spawn error] ${err.message}\n`);
      resolve(null);
    });

    child.on('close', (code) => resolve(code));
  });
}

// ── Suite runners ─────────────────────────────────────────────────────────────

async function runUnit(job: TestJob) {
  appendOutput(job, '=== TypeScript type-check (server) ===\n');
  const code = await spawnJob(job, 'npx', ['tsc', '--noEmit', '--pretty', 'false'], SERVER_DIR);

  if (code === null) {
    job.status = 'error';
    appendOutput(job, '\n[error] Could not spawn tsc. Is TypeScript installed?\n');
    return;
  }

  if (code === 0) {
    job.status = 'passed';
    job.passed = 1;
    job.failed = 0;
    appendOutput(job, '\n✓ TypeScript compile: no errors\n');
  } else {
    job.status = 'failed';
    job.passed = 0;
    job.failed = 1;
    appendOutput(job, `\n✗ TypeScript compile failed (exit ${code})\n`);
  }
}

async function runSecurity(job: TestJob) {
  appendOutput(job, '=== npm audit (server dependencies) ===\n');
  const code = await spawnJob(
    job,
    'npm',
    ['audit', '--json', '--audit-level=moderate'],
    SERVER_DIR,
  );

  // npm audit exits 1 when vulnerabilities are found — parse output to count
  const raw = job.output;
  let passed = 0;
  let failed = 0;

  try {
    // Find the JSON blob in the output (may have non-JSON lines before it)
    const jsonStart = raw.indexOf('{');
    if (jsonStart !== -1) {
      const auditJson = JSON.parse(raw.slice(jsonStart)) as {
        metadata?: { vulnerabilities?: Record<string, number> };
        vulnerabilities?: Record<string, { severity: string }>;
      };

      const vulns = auditJson?.metadata?.vulnerabilities ?? {};
      const critical = Number(vulns['critical'] ?? 0);
      const high = Number(vulns['high'] ?? 0);
      const moderate = Number(vulns['moderate'] ?? 0);
      const low = Number(vulns['low'] ?? 0);
      const total = critical + high + moderate + low;

      // Replace raw JSON with a readable summary
      job.output =
        `=== npm audit (server dependencies) ===\n` +
        `Critical: ${critical}  High: ${high}  Moderate: ${moderate}  Low: ${low}\n` +
        `Total vulnerabilities: ${total}\n\n` +
        JSON.stringify(auditJson?.vulnerabilities ?? {}, null, 2).slice(0, 8000);

      if (critical + high > 0) {
        failed = critical + high;
        job.status = 'failed';
        job.failed = failed;
        job.passed = 0;
        appendOutput(job, `\n✗ ${critical + high} critical/high severity vulnerabilities found\n`);
      } else {
        passed = 1;
        job.status = total === 0 ? 'passed' : 'passed';
        job.passed = 1;
        job.failed = 0;
        appendOutput(
          job,
          total === 0
            ? '\n✓ No vulnerabilities found\n'
            : `\n⚠ ${total} low/moderate issues found (no critical/high)\n`,
        );
      }
    } else {
      // npm audit returned non-JSON (e.g., no lock file)
      job.status = code === 0 ? 'passed' : 'failed';
      passed = job.status === 'passed' ? 1 : 0;
      failed = job.status === 'failed' ? 1 : 0;
      job.passed = passed;
      job.failed = failed;
    }
  } catch {
    job.status = 'error';
    appendOutput(job, '\n[error] Could not parse npm audit output\n');
  }
}

async function runE2E(job: TestJob) {
  // E2E tests require a real browser and a running frontend — not available
  // in the Railway server environment. Return a clear informational result.
  job.status = 'passed';
  job.passed = 0;
  job.failed = 0;
  job.skipped = 1;
  job.output =
    '=== E2E Tests (Playwright) ===\n\n' +
    'ℹ E2E tests cannot run in the Railway server environment.\n' +
    'They require a headless browser and a running Vite dev server.\n\n' +
    'Run locally:\n' +
    '  cd frontend\n' +
    '  npm run test:e2e\n\n' +
    'Or in CI, add a GitHub Actions job with:\n' +
    '  npx playwright install --with-deps\n' +
    '  npm run test:e2e\n\n' +
    '✓ Marked as skipped (not an error — requires local/CI browser environment).\n';
}

async function runPerformance(job: TestJob) {
  appendOutput(job, '=== Performance — API Health Probe ===\n\n');

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT ?? 3001}`;

  const endpoints = [
    { path: '/health', label: 'Health check' },
  ];

  let allPassed = true;

  for (const ep of endpoints) {
    const url = `${baseUrl}${ep.path}`;
    const label = ep.label;

    try {
      const t0 = Date.now();
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const ms = Date.now() - t0;
      const ok = resp.ok && ms < 2000;

      if (!ok) allPassed = false;

      appendOutput(
        job,
        `${ok ? '✓' : '✗'} ${label} — ${ms}ms (HTTP ${resp.status})${ok ? '' : ' ← SLOW or ERROR'}\n`,
      );
    } catch (err) {
      allPassed = false;
      appendOutput(job, `✗ ${label} — request failed: ${String(err)}\n`);
    }
  }

  // Memory usage snapshot
  const mem = process.memoryUsage();
  const toMB = (b: number) => (b / 1024 / 1024).toFixed(1);
  appendOutput(
    job,
    `\n=== Process Memory ===\n` +
      `RSS:       ${toMB(mem.rss)} MB\n` +
      `Heap used: ${toMB(mem.heapUsed)} MB\n` +
      `Heap total:${toMB(mem.heapTotal)} MB\n`,
  );

  job.status = allPassed ? 'passed' : 'failed';
  job.passed = allPassed ? endpoints.length : 0;
  job.failed = allPassed ? 0 : endpoints.length;
  appendOutput(job, allPassed ? '\n✓ All probes within budget\n' : '\n✗ One or more probes failed or exceeded 2s budget\n');
}

// ── Suite dispatch ────────────────────────────────────────────────────────────

async function runSuite(job: TestJob) {
  try {
    switch (job.suite) {
      case 'unit':        await runUnit(job);        break;
      case 'security':    await runSecurity(job);    break;
      case 'e2e':         await runE2E(job);         break;
      case 'performance': await runPerformance(job); break;
      default:
        job.status = 'error';
        job.output = `Unknown suite: ${job.suite as string}`;
    }
  } catch (err) {
    job.status = 'error';
    appendOutput(job, `\n[unhandled error] ${String(err)}\n`);
  } finally {
    job.finishedAt = Date.now();
    job.durationMs = job.finishedAt - job.startedAt;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/test-runs
 * Body: { suite: 'unit' | 'e2e' | 'performance' | 'security' }
 * Returns: { jobId: string }
 */
router.post('/test-runs', (req: Request, res: Response): void => {
  if (!requireProxyToken(req, res)) return;

  const suite = req.body?.suite as Suite | undefined;
  const validSuites: Suite[] = ['unit', 'e2e', 'performance', 'security'];
  if (!suite || !validSuites.includes(suite)) {
    res.status(400).json({ error: `Invalid suite. Must be one of: ${validSuites.join(', ')}` });
    return;
  }

  const jobId = uuidv4();
  const job: TestJob = {
    id: jobId,
    suite,
    status: 'running',
    startedAt: Date.now(),
    output: '',
  };

  jobs.set(jobId, job);

  // Fire-and-forget — the client polls GET /:jobId
  void runSuite(job);

  res.status(202).json({ jobId });
});

/**
 * GET /api/admin/test-runs/:jobId
 * Returns current job state for polling.
 */
router.get('/test-runs/:jobId', (req: Request, res: Response): void => {
  if (!requireProxyToken(req, res)) return;

  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    id:         job.id,
    suite:      job.suite,
    status:     job.status,
    startedAt:  job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    passed:     job.passed,
    failed:     job.failed,
    skipped:    job.skipped,
    output:     job.output,
  });
});

export default router;
