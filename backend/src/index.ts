/**
 * Autonomous Agent Runtime — Backend Entry Point
 * Extends the existing proxy with: health endpoints, DB connection pool,
 * and all Phase 1+ API routes.
 *
 * For legacy proxy routes (LLM forwarding, settings), proxy.js is still
 * invoked via the root `npm run dev:backend` script. This file is the
 * new TypeScript application that adds everything the runtime initiative requires.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { agentRunsRouter } from './routes/agentRuns';
import { agentJobsRouter } from './routes/agentJobs';
import { actionProposalsRouter } from './routes/actionProposals';
import { memoryRecordsRouter } from './routes/memoryRecords';
import { rollbackLogsRouter } from './routes/rollbackLogs';
import { requireApiToken } from './middleware/requireApiToken';

dotenv.config();

const app = express();
// Railway typically injects PORT automatically for the exposed service socket.
// Prefer it in production, while still supporting the explicit runtime port
// used by local development and existing env files.
const PORT = parseInt(process.env.PORT ?? process.env.RUNTIME_PORT ?? '4000', 10);

// ── Middleware ──────────────────────────────────────────────────────────────
// C-03 fix: restrict CORS to an explicit allowlist and add rate limiting.
// Set ALLOWED_ORIGINS as a comma-separated list in environment, e.g.:
//   ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? []  // production with no explicit list = deny all (fail secure)
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];

function isTrustedVercelPreview(origin: string): boolean {
  return /^https:\/\/agentic-sdlc(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
}

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || (origin ? isTrustedVercelPreview(origin) : false)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
}));

// Rate limiting — 120 requests per minute per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));
app.use(express.json({ limit: '1mb' }));

// ── DB connection pool ──────────────────────────────────────────────────────
function resolveDbConnectionString(): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.POSTGRES_URL_PRODUCTION || process.env.POSTGRES_URL || '';
  }
  return process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL || '';
}

export const db = new Pool({
  connectionString: resolveDbConnectionString(),
  max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
});

db.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

// ── API v1 routes ───────────────────────────────────────────────────────────
// Gated by requireApiToken (Finding #3) — these routes can create/mutate
// agent run and job state and had no auth at all before this. /health and
// /ready stay public below since load balancers and CI smoke tests hit them
// without a token.
app.use('/api/v1/agent-runs', requireApiToken, agentRunsRouter(db));
app.use('/api/v1/agent-jobs', requireApiToken, agentJobsRouter(db));
// ADR-004/ADR-005 routes (Finding #10 / ADR-006 Option B) — previously the
// repositories existed with no route exposing them at all.
app.use('/api/v1/action-proposals', requireApiToken, actionProposalsRouter(db));
app.use('/api/v1/memory-records', requireApiToken, memoryRecordsRouter(db));
app.use('/api/v1/rollback-logs', requireApiToken, rollbackLogsRouter(db));

// ── Health endpoints ────────────────────────────────────────────────────────

/**
 * GET /health
 * Always returns 200 {status: 'ok'} if the process is alive.
 * Used by load balancers and CI smoke tests.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/**
 * GET /ready
 * Returns 200 {status: 'ready'} only when the DB connection pool can reach Postgres.
 * Returns 503 if the DB is unreachable.
 * Used by deployment verification checklist (P9-6).
 */
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(503).json({ status: 'not_ready', db: 'unreachable', error: message });
  }
});

// ── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ───────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[runtime] Agent Runtime API  http://localhost:${PORT}`);
    console.log(`[runtime] POSTGRES_URL: ${process.env.POSTGRES_URL ? 'set' : 'NOT SET'}`);
  });
}

export default app;
