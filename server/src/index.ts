/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Agentic SDLC — Express API Server
 *
 * Architecture features:
 *  - Request correlation IDs (X-Request-ID) on every response
 *  - Structured request logging with latency
 *  - Startup environment validation — fails fast on missing required vars
 *  - Enhanced /health endpoint — checks Supabase reachability
 *  - gzip compression for all API responses
 *  - Graceful shutdown on SIGTERM / SIGINT (Railway, Kubernetes, Docker)
 */
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

import projectsRouter from './routes/projects';
import agentsRouter  from './routes/agents';
import invitesRouter from './routes/invites';
import { supabaseAdmin } from './lib/supabase';

/**
 * SECURITY NOTE (H-08): Supabase Row Level Security (RLS)
 * --------------------------------------------------------
 * This server uses the Supabase SERVICE ROLE key (supabaseAdmin), which bypasses
 * all RLS policies. This means the database itself provides NO access control —
 * every authorization decision is enforced exclusively by the Express middleware
 * in this process (see auth/requireAuth.ts and RBAC checks in each route).
 *
 * Implications:
 *  • Any bug in Express middleware = direct database access with no safety net.
 *  • Recommendation: enable RLS policies in Supabase Dashboard for all tables
 *    as a defence-in-depth layer, even when using the service role key server-side.
 *    Use the ANON key + RLS for client-facing queries where possible.
 *  • Until RLS is enabled on all tables, treat this server as the single
 *    trust boundary — keep it behind Railway private networking and never
 *    expose it directly to the public internet without auth middleware.
 */


// ── Startup env validation ────────────────────────────────────────────────────

const REQUIRED_ENV: string[] = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  console.error('  Set them in your .env file or Railway/Vercel environment settings.');
  process.exit(1);
}

// ── App setup ─────────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT ?? 3001);

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression());

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// M-04 fix: structured request logging — includes method, path, status,
// duration, and correlation ID so Railway logs are queryable.
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = req.headers['x-request-id'] as string | undefined
    ?? Math.random().toString(36).slice(2, 10);
  res.setHeader('x-request-id', reqId);
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level,
      ts: new Date().toISOString(),
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    }));
  });
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / Postman / server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Request correlation ID ────────────────────────────────────────────────────
// Every request gets a unique ID. Clients can pass X-Request-ID to use their own.
// The same ID is echoed back in the response header for tracing.
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? uuidv4();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, path } = req;
  const requestId = (req as Request & { requestId?: string }).requestId ?? '-';

  res.on('finish', () => {
    const ms   = Date.now() - start;
    const code = res.statusCode;
    const level = code >= 500 ? 'ERROR' : code >= 400 ? 'WARN' : 'INFO';
    console.log(JSON.stringify({ level, method, path, statusCode: code, durationMs: ms, requestId }));
  });

  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

app.use('/api/agents/', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Agent call rate limit exceeded' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/projects', projectsRouter);
app.use('/api/agents',  agentsRouter);
app.use('/api/invites', invitesRouter);

// ── Health check (enhanced) ───────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  // Check Supabase reachability by making a cheap authenticated call
  try {
    const { error } = await supabaseAdmin.from('projects').select('id').limit(1);
    checks.supabase = error ? 'error' : 'ok';
  } catch {
    checks.supabase = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status:    allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV ?? 'development',
    uptime:    Math.round(process.uptime()),
    checks,
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as Request & { requestId?: string }).requestId ?? '-';
  console.error(JSON.stringify({ level: 'ERROR', message: err.message, stack: err.stack, requestId }));
  res.status(500).json({ error: 'Internal server error', requestId });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'API server started',
    port:   PORT,
    env:    process.env.NODE_ENV ?? 'development',
    origins: ALLOWED_ORIGINS,
  }));
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Handles SIGTERM (Railway, Kubernetes) and SIGINT (Ctrl-C / Docker stop)
function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'INFO', message: `${signal} received — shutting down gracefully` }));
  server.close(() => {
    console.log(JSON.stringify({ level: 'INFO', message: 'HTTP server closed — process exiting' }));
    process.exit(0);
  });

  // Force-exit after 10 s if connections don't drain
  setTimeout(() => {
    console.error(JSON.stringify({ level: 'ERROR', message: 'Forced exit after timeout' }));
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
