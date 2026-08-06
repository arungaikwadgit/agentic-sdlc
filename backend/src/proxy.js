/**
 * Express proxy — forwards agent requests to OpenAI.
 * Auto-detects corporate HTTP proxy via HTTPS_PROXY / HTTP_PROXY env vars.
 * POST /api/agent  →  OpenAI chat completions
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const https   = require('https');
const http    = require('http');
const tls     = require('tls');
const rateLimit = require('express-rate-limit');
const { createLocalProjectStore } = require('./localProjectStore');
const {
  DEFAULT_PROMPT_OPTIMIZATION_SKILL,
  optimizePromptPair,
} = require('./promptOptimizationSkill');

const app   = express();
// Railway sits the app behind a reverse proxy that sets X-Forwarded-For.
// Without this, express-rate-limit can't safely trust that header to key
// rate limits per real client IP (it throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// instead, as seen in production logs). `1` trusts exactly one hop — the
// Railway edge proxy — which matches this deployment's actual topology.
app.set('trust proxy', 1);
const PORT  = process.env.PORT ?? 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL ?? 'gpt-4o';
const PROXY_TOKEN    = process.env.PROXY_TOKEN ?? '';
const SERVER_API_URL = (process.env.SERVER_API_URL ?? '').replace(/\/$/, '');
const RUNTIME_API_URL = (process.env.RUNTIME_API_URL ?? '').replace(/\/$/, '');
const RUNTIME_API_TOKEN = process.env.RUNTIME_API_TOKEN ?? '';
const ADMIN_BYPASS_BEARER = 'admin-local-bypass-token';

function getProductionAuthConfigurationErrors(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const hasSupabaseAuth = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  const hasSharedToken = Boolean(env.PROXY_TOKEN);
  const errors = [];
  if (!hasSupabaseAuth && !hasSharedToken) {
    errors.push('Configure SUPABASE_URL + SUPABASE_ANON_KEY or PROXY_TOKEN.');
  }
  if (env.SUPABASE_URL && !env.SUPABASE_ANON_KEY) {
    errors.push('SUPABASE_ANON_KEY is required when SUPABASE_URL is configured.');
  }
  if (env.SUPABASE_ANON_KEY && !env.SUPABASE_URL) {
    errors.push('SUPABASE_URL is required when SUPABASE_ANON_KEY is configured.');
  }
  if (String(env.ALLOW_INSECURE_LOCAL_AUTH ?? '').toLowerCase() === 'true') {
    errors.push('ALLOW_INSECURE_LOCAL_AUTH cannot be enabled in production.');
  }
  return errors;
}

function assertProductionAuthConfiguration(env = process.env) {
  const errors = getProductionAuthConfigurationErrors(env);
  if (errors.length) {
    throw new Error(`Invalid production authentication configuration: ${errors.join(' ')}`);
  }
}

async function enqueueRuntimeLifecycleEvent(payload) {
  if (!RUNTIME_API_URL || !RUNTIME_API_TOKEN) return false;
  const response = await fetch(RUNTIME_API_URL + '/api/v1/lifecycle-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': RUNTIME_API_TOKEN },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Runtime lifecycle enqueue returned ' + response.status);
  return true;
}

async function fanOutRuntimeLifecycleEvent(eventType, sourceKey, agentKey) {
  if (!dbPool || !RUNTIME_API_URL || !RUNTIME_API_TOKEN) return;
  const { rows } = await dbPool.query('SELECT id FROM projects');
  await Promise.allSettled(rows.map((row) => enqueueRuntimeLifecycleEvent({
    project_id: row.id,
    event_type: eventType,
    agent_key: agentKey,
    idempotency_key: eventType + ':' + sourceKey + ':' + row.id + ':' + Date.now(),
  })));
}

// lifecycleTypeForConfigKey moved to backend/src/routes/appState.js
// (architecture upgrade Phase 3g, 2026-07-20) -- it was only ever called
// from the two app-state config routes now living there.
const ADMIN_EMAIL_ALLOWLIST = Array.from(new Set(
  [
    process.env.ADMIN_EMAIL_ALLOWLIST ?? '',
    process.env.ADMIN_EMAIL ?? '',
    process.env.VITE_ADMIN_EMAIL ?? '',
  ]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
));

// H-05 fix: Supabase JWT verification as the primary auth mechanism.
// The frontend sends its Supabase session JWT as Authorization: Bearer <jwt>.
// This means VITE_PROXY_TOKEN no longer needs to be bundled in the frontend.
// PROXY_TOKEN remains as a fallback for admin-mode / server-to-server callers.
const SUPABASE_URL     = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
let _supabaseClient = null;
function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  } catch (err) {
    // Diagnostic logging (temporary): this catch was previously silent
    // (`catch { return null; }`), which is exactly why checkToken()'s 401s
    // were untraceable — createClient() was throwing but nothing logged why.
    // Logs the error message/name only, never SUPABASE_URL/SUPABASE_ANON_KEY
    // themselves. Safe to remove once the investigation is closed.
    console.error(
      `getSupabase(): createClient() threw during initialization — ` +
      `name=${err?.name ?? 'Unknown'} message=${err?.message ?? String(err)}`
    );
    return null;
  }
}

async function fetchSupabaseTable(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase service-role access is not configured.');
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase REST ${response.status}: ${detail || response.statusText}`);
  }
  return await response.json();
}

// ── Default-password account provisioning (invite send + admin reset) ──────
// Extracted 2026-07-19 (architecture upgrade Phase 1a) to
// backend/src/routes/inviteRoutes.js — see docs/architecture/
// architecture-upgrade-execution-plan.md. Function bodies are verbatim in
// the new file; this is just the require + destructure that reconstructs
// the exact same bindings (getSupabaseAdmin,
// findSupabaseUserByEmail, provisionInviteeAccount) so every call site below
// (and every test that does require('./proxy').provisionInviteeAccount
// etc.) keeps working unchanged. SUPABASE_URL/SUPABASE_SERVICE_KEY are
// passed in because they're proxy.js's own module-scope constants (defined
// above, read-only after load).
const { createInviteAccountProvisioning } = require('./routes/inviteRoutes');
const { getSupabaseAdmin, findSupabaseUserByEmail, provisionInviteeAccount } =
  createInviteAccountProvisioning({ SUPABASE_URL, SUPABASE_SERVICE_KEY });

// Anthropic (Claude) — optional second provider
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const ANTHROPIC_ENABLED = String(process.env.ANTHROPIC_ENABLED ?? '').toLowerCase() === 'true' && !!ANTHROPIC_API_KEY;
const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER ?? 'openai').toLowerCase() === 'claude' ? 'claude' : 'openai';

// Hugging Face Inference Providers — one specific 'openai-compatible' gateway,
// first-class (dedicated env var, like OPENAI_API_KEY/ANTHROPIC_API_KEY above)
// rather than making the admin type an arbitrary env var name in the UI.
// Base URL and auth verified against https://huggingface.co/docs/inference-providers
// (Oct 2026): Bearer token with the "Make calls to Inference Providers" scope,
// genuinely OpenAI-compatible /chat/completions shape. Provider routing for a
// given model uses a "<org>/<model>:<provider>" suffix in the model string —
// see MODEL_CATALOG entries' own `id`, which is expected to already be in that
// form when relevant (falls back to HF's own auto-routing if no suffix given).
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY ?? '';
const HUGGINGFACE_BASE_URL = 'https://router.huggingface.co/v1';

// Admin-configured catalog of additional models an agent can be routed to
// beyond the built-in OpenAI/Claude providers (see frontend/src/agents/
// modelCatalog.ts for the matching frontend type/seed data). Persisted the
// same way AGENT_PROVIDER_MAP is below — see /api/settings POST handler.
// AGENT_PROVIDER_MAP[agentId] can hold either a legacy 'openai'/'claude'
// string (today's only case) or one of these entries' `id` — see
// resolveDispatchTarget() below, which is the single place that distinction
// is resolved.
let MODEL_CATALOG = [];
try {
  MODEL_CATALOG = JSON.parse(process.env.MODEL_CATALOG ?? '[]');
} catch (_) {
  MODEL_CATALOG = [];
}

const localProjectStore = createLocalProjectStore();

// Per-agent provider routing hints (agentId -> 'openai' | 'claude').
// Falls back to DEFAULT_LLM_PROVIDER for any agent not listed here.
// Example default: UX-related agents route to Claude when Claude is enabled.
let AGENT_PROVIDER_MAP = {};
try {
  AGENT_PROVIDER_MAP = JSON.parse(process.env.AGENT_PROVIDER_MAP ?? '{}');
} catch {
  AGENT_PROVIDER_MAP = {};
}

// Corporate proxy — read from env or backend/.env
const CORP_PROXY =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY  ||
  process.env.http_proxy  ||
  '';

// Skip the fail-fast exit under test: proxy.sendInviteEmail.test.ts (and any other
// suite that require()s this module) runs with NODE_ENV=test and no real API keys
// configured, jest sets NODE_ENV=test by default and CI's ci.yml sets it explicitly
// for the backend job. Without this exception, simply require()-ing proxy.js from a
// test file calls process.exit(1) and kills the entire jest process, which is what
// was failing "Backend (tsc + jest)" in CI, unrelated to the recent package.json move.
if (!OPENAI_API_KEY && process.env.NODE_ENV !== 'test') {
  console.error('ERROR: OPENAI_API_KEY is not set in backend/.env');
  process.exit(1);
}

if (CORP_PROXY) console.log('Corporate proxy detected:', CORP_PROXY);

// ── Middleware ────────────────────────────────────────────────────────────────
// C-02 fix: restrict CORS to an explicit allowlist instead of wildcard '*'.
// Set ALLOWED_ORIGINS as a comma-separated list in your environment, e.g.:
//   ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
// In development (no ALLOWED_ORIGINS set), localhost origins are permitted automatically.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? []  // production with no explicit list = deny all (fail secure)
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];

function isTrustedVercelPreview(origin) {
  return /^https:\/\/agentic-sdlc(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server calls (no Origin header) and configured origins
    if (!origin || ALLOWED_ORIGINS.includes(origin) || isTrustedVercelPreview(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
}));

const API_ALIAS_RULES = [
  { from: '/health', to: '/api/health' },
  { from: '/agent', to: '/api/agent' },
  { from: '/agents/call', to: '/api/agents/call' },
  { from: '/master-data/catalog', to: '/api/master-data/catalog' },
  { from: '/app-state/', to: '/api/app-state/' },
  { from: '/fetch-site', to: '/api/fetch-site' },
  { from: '/figma/styles', to: '/api/figma/styles' },
  { from: '/github/test', to: '/api/github/test' },
  { from: '/github/issues', to: '/api/github/issues' },
  { from: '/settings', to: '/api/settings' },
  { from: '/invite/send', to: '/api/invite/send' },
  { from: '/invite/accept', to: '/api/invite/accept' },
  { from: '/invite/validate', to: '/api/invite/validate' },
  { from: '/invite/revoke', to: '/api/invite/revoke' },
  { from: '/invite/team/', to: '/api/invite/team/' },
];

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) return next();

  const match = API_ALIAS_RULES.find((rule) =>
    rule.from.endsWith('/') ? req.path.startsWith(rule.from) : req.path === rule.from,
  );

  if (match) {
    const suffix = match.from.endsWith('/') ? req.path.slice(match.from.length) : '';
    req.url = match.to + suffix + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  }

  next();
});

app.use(express.json({ limit: '10mb' }));
const isLocalDev = process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT_NAME;
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: isLocalDev ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please retry shortly.' },
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkToken(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';
  // Diagnostic logging (temporary): traces every auth decision branch for
  // every request, to debug a persistent 401 pattern where the browser is
  // logged in but backend calls are rejected. Never logs the JWT/token
  // value itself, only presence and Supabase's own (safe) error messages.
  // Safe to remove once the investigation is closed.
  const authTag = `[auth ${req.method} ${req.originalUrl}]`;

  // Admin-bypass bearer token — used by the frontend's local admin mode when
  // Supabase auth is intentionally bypassed. This mirrors the existing
  // admin-local session model and avoids requiring a public VITE_PROXY_TOKEN
  // in production for that one flow.
  if (process.env.NODE_ENV !== 'production' && authHeader === `Bearer ${ADMIN_BYPASS_BEARER}`) {
    console.log(`${authTag} admin-bypass token accepted (non-production only)`);
    req.authUser = { email: null, adminBypass: true };
    return next();
  }

  // Path 1: Supabase JWT (preferred — frontend sends session token, not a bundled secret)
  if (authHeader.startsWith('Bearer ')) {
    console.log(`${authTag} Bearer token present — attempting Supabase JWT validation`);
    const jwt = authHeader.slice(7);
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.auth.getUser(jwt);
      if (!error && data?.user) {
        console.log(`${authTag} Supabase JWT valid — user=${data.user.email?.toLowerCase?.() ?? '(no email)'}`);
        req.authUser = { email: data.user.email?.toLowerCase?.() ?? null, user: data.user };
        return next();
      }
      // JWT present but invalid — reject immediately, don't fall through
      console.log(`${authTag} Supabase JWT validation FAILED: ${error?.message ?? 'no user returned in response'}`);
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }
    console.log(`${authTag} getSupabase() returned null (SUPABASE_URL/SUPABASE_ANON_KEY missing or client init failed) — falling through to Path 2`);
    // Supabase not configured — treat as admin-mode JWT-less call, fall through
  } else {
    console.log(`${authTag} no Bearer Authorization header (raw value: ${authHeader ? 'non-empty, non-Bearer' : 'empty'})`);
  }

  // Path 2: Shared secret used by explicitly trusted server-to-server calls.
  if (!PROXY_TOKEN && !SUPABASE_URL) {
    const insecureLocalAuth = process.env.NODE_ENV !== 'production'
      && String(process.env.ALLOW_INSECURE_LOCAL_AUTH ?? '').toLowerCase() === 'true';
    if (insecureLocalAuth) {
      console.warn(`${authTag} ALLOW_INSECURE_LOCAL_AUTH enabled — allowing local unauthenticated request`);
      return next();
    }
    console.error(`${authTag} no authentication verifier is configured — rejecting`);
    return res.status(503).json({ error: 'Authentication service is not configured.' });
  }
  if (PROXY_TOKEN && req.headers['x-api-token'] === PROXY_TOKEN) {
    console.log(`${authTag} valid X-API-Token header — allowing trusted service account`);
    req.authUser = { email: null, serviceAccount: true };
    return next();
  }
  // If we have Supabase configured but no valid JWT arrived, reject
  if (SUPABASE_URL && !req.headers['authorization']) {
    console.log(`${authTag} SUPABASE_URL configured but no Authorization header at all — rejecting (Authentication required)`);
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  // PROXY_TOKEN set but header missing or wrong
  if (PROXY_TOKEN) {
    console.log(`${authTag} reached final PROXY_TOKEN check with no valid JWT and no/mismatched X-API-Token — rejecting (bare Unauthorized)`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.error(`${authTag} configured authentication verifier is unavailable - rejecting`);
  return res.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
}

function isConfiguredAdminEmail(email) {
  return !!email && ADMIN_EMAIL_ALLOWLIST.includes(String(email).trim().toLowerCase());
}

function requireAdmin(req, res, next) {
  if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
    return next();
  }

  const email = req.authUser?.email ?? null;
  if (isConfiguredAdminEmail(email)) {
    return next();
  }

  return res.status(403).json({ error: 'Admin access required.' });
}

// ── Health ────────────────────────────────────────────────────────────────────
// Extracted 2026-07-20 (architecture upgrade Phase 3) to
// backend/src/routes/health.js -- verbatim, just the mount point here.
const { createHealthRouter } = require('./routes/health');
app.use('/api/health', createHealthRouter({
  openaiModel: OPENAI_MODEL,
  anthropicEnabled: ANTHROPIC_ENABLED,
  anthropicModel: ANTHROPIC_MODEL,
  defaultLlmProvider: DEFAULT_LLM_PROVIDER,
  corpProxy: CORP_PROXY,
}));

// Forward selected API surfaces to the separate `server/` backend service.
// This keeps the frontend pointed at a single proxy URL in production while
// still allowing project/invite/admin routes to live on their dedicated API.
async function forwardToServer(req, res) {
  if (!SERVER_API_URL) {
    if (req.path === '/' && req.method === 'POST') {
      const created = localProjectStore.create(req.body ?? {}, req.authUser?.email || 'local-dev-user');
      return res.status(201).json(created);
    }
    if (req.path === '/' && req.method === 'GET') {
      return res.json(localProjectStore.list());
    }
    if (req.path === '/permissions/me' && req.method === 'GET') {
      return res.json({ isAppAdmin: isConfiguredAdminEmail(req.authUser?.email ?? null) });
    }
    if (req.path.match(/^\/[^/]+$/) && req.method === 'GET') {
      const project = localProjectStore.get(req.path.slice(1));
      return project ? res.json(project) : res.status(404).json({ error: 'Project not found' });
    }
    if (req.path.match(/^\/[^/]+$/) && req.method === 'PATCH') {
      const project = localProjectStore.update(req.path.slice(1), req.body ?? {});
      return project ? res.json(project) : res.status(404).json({ error: 'Project not found' });
    }
    if (req.path.match(/^\/[^/]+$/) && req.method === 'DELETE') {
      const project = localProjectStore.remove(req.path.slice(1));
      return project ? res.status(200).json(project) : res.status(404).json({ error: 'Project not found' });
    }
    if (req.path.match(/^\/[^/]+\/restore$/) && req.method === 'POST') {
      const project = localProjectStore.restore(req.path.split('/')[1]);
      return project ? res.status(200).json(project) : res.status(404).json({ error: 'Project not found' });
    }
    return res.status(503).json({ error: 'SERVER_API_URL is not configured' });
  }

  const targetUrl = SERVER_API_URL + req.originalUrl;
  const headers = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'connection') continue;
    headers[key] = value;
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = JSON.stringify(req.body ?? {});
    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const text = await upstream.text();

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error('Server forward error:', err.message);
    return res.status(502).json({ error: 'Upstream server unavailable', detail: err.message });
  }
}

// Forwarded app APIs enforce auth in the dedicated `server/` service.
// Do not gate them again here with PROXY_TOKEN-only fallback auth, otherwise
// valid Supabase JWT sessions can be rejected before reaching the real API.
//
// 2026-07-20: these three mounts used to live here, BEFORE every extracted
// router below (including two that share these exact same prefixes --
// createAdminResetRouter at /api/admin and createChatHistoryRouter at
// /api/projects). forwardToServer is a terminal handler (every code path
// either responds directly or forwards+responds; it never calls next()),
// so with these mounted first, EVERY request under /api/projects/* and
// /api/admin/* was being fully consumed here -- confirmed via live boot +
// curl that both createAdminResetRouter's reset-application-data route and
// createChatHistoryRouter's chat/messages route were unreachable dead code,
// always getting a 503 "SERVER_API_URL is not configured" (or, when
// SERVER_API_URL IS configured in production, a blind forward to a path the
// separate server/ service doesn't implement) instead of ever reaching
// their real handler. Confirmed pre-existing back to commit ebb6660d, not
// introduced by today's extraction work.
//
// Fix: moved to the END of route registration (just above the final 404
// handler) instead of touching forwardToServer itself or reordering any
// extracted router. Express tries mounts in registration order and an
// Express Router silently falls through (calls next() internally) for any
// sub-path it has no matching route for -- so every specific route below
// now gets first chance to match, and anything under /api/projects/*,
// /api/invites/*, or /api/admin/* that ISN'T one of those specific routes
// still falls through to forwardToServer exactly as before. Nothing the
// separate server/ service currently handles loses its forwarding; the fix
// only stops swallowing the two paths that were never actually implemented
// there in the first place.

// ══════════════════════════════════════════════════════════════════════════════
// resolveDispatchTarget/dispatchAgentCall/clampMaxTokens (plus the private
// helpers only they use: httpsPost, callOpenAi, callClaude,
// callOpenAiCompatible, fromOpenAiResponse, fromAnthropicResponse, withRetry)
// were extracted 2026-07-19 (architecture upgrade Phase 2) to
// backend/src/dispatch/agentDispatch.js -- see docs/architecture/
// architecture-upgrade-execution-plan.md. Function bodies are verbatim in
// the new file; every dependency below is a proxy.js module-scope value
// that is set once at load and never reassigned afterward (verified via
// grep before extracting -- see the new file's own doc comment for the
// full reasoning), so passing by value here is safe.
// ══════════════════════════════════════════════════════════════════════════════
const { createAgentDispatch } = require('./dispatch/agentDispatch');
const { resolveDispatchTarget, dispatchAgentCall, clampMaxTokens } = createAgentDispatch({
  OPENAI_API_KEY,
  OPENAI_MODEL,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  ANTHROPIC_ENABLED,
  HUGGINGFACE_API_KEY,
  DEFAULT_LLM_PROVIDER,
  AGENT_PROVIDER_MAP,
  MODEL_CATALOG,
  CORP_PROXY,
  loadPromptOptimizationSkill,
});

const TOKEN_OPTIMIZATION_SKILL_KEY = 'app:tokenOptimizationSkill';
const PROMPT_OPTIMIZATION_SKILL_CACHE_MS = 60_000;
let promptOptimizationSkillCache = { value: DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 };

async function loadPromptOptimizationSkill() {
  if (Date.now() < promptOptimizationSkillCache.expiresAt) {
    return promptOptimizationSkillCache.value;
  }
  let value = DEFAULT_PROMPT_OPTIMIZATION_SKILL;
  try {
    await ensureAppStateTables();
    const values = await dbGetAppConfigMap([TOKEN_OPTIMIZATION_SKILL_KEY]);
    if (values[TOKEN_OPTIMIZATION_SKILL_KEY]) value = values[TOKEN_OPTIMIZATION_SKILL_KEY];
  } catch (error) {
    console.warn('[token-optimizer] application skill load failed; using built-in skill:', error.message);
  }
  promptOptimizationSkillCache = {
    value,
    expiresAt: Date.now() + PROMPT_OPTIMIZATION_SKILL_CACHE_MS,
  };
  return value;
}

// ── Agent ─────────────────────────────────────────────────────────────────────
// Extracted 2026-07-20 (architecture upgrade Phase 3) to
// backend/src/routes/agentDispatchRoutes.js -- verbatim, just the mount
// point here. authorizeAgentRun is a proxy.js function declaration
// (hoisted, never reassigned); resolveDispatchTarget/dispatchAgentCall are
// consts already assigned earlier in this file's load order than these
// routes were registered -- no getter needed for any of these, unlike
// adminReset.js's ensureInviteSessionTable.
const { createAgentDispatchRouter } = require('./routes/agentDispatchRoutes');
app.use('/api', createAgentDispatchRouter({
  checkToken,
  authorizeAgentRun,
  resolveDispatchTarget,
  dispatchAgentCall,
  anthropicModel: ANTHROPIC_MODEL,
  openaiModel: OPENAI_MODEL,
}));

// Browser-to-runtime lifecycle-events forwarding route extracted 2026-07-19
// (architecture upgrade Phase 3) to backend/src/routes/lifecycleForwarding.js
// -- see that file's own doc comment for why it's named differently from
// the unrelated backend/src/routes/lifecycleEvents.ts, and why
// enqueueRuntimeLifecycleEvent()/fanOutRuntimeLifecycleEvent() near the top
// of this file were deliberately NOT moved with it.
const { createLifecycleForwardingRouter } = require('./routes/lifecycleForwarding');
app.use('/api/lifecycle-events', createLifecycleForwardingRouter({ RUNTIME_API_URL, RUNTIME_API_TOKEN, checkToken }));

// Extracted 2026-07-20 (architecture upgrade Phase 3 -- the last remaining
// inline route in this file) to backend/src/routes/chatRespond.js, along
// with its private helpers (CHAT_PLANNER_SYSTEM_PROMPT,
// CHAT_SYNTHESIS_SYSTEM_PROMPT, extractChatModelText) and the
// shared-context/private-view chat history wiring added earlier today (see
// chat/chatHistoryStore.js and migrations/012_chat_messages.sql). getDb is
// a getter so the extracted route still reads dbPool fresh per-request,
// matching the original inline closure's behavior.
const { createChatRespondRouter } = require('./routes/chatRespond');
app.use('/api/chat', createChatRespondRouter({
  checkToken,
  getDb: () => dbPool,
  isAppAdmin: isConfiguredAdminEmail,
  resolveDispatchTarget,
  dispatchAgentCall,
}));

// Private-view chat history hydration (2026-07-20) -- GET
// /api/projects/:projectId/chat/messages, returning only the caller's OWN
// persisted turns. See backend/src/routes/chatHistory.js's doc comment for
// why this is a separate, narrower endpoint from the shared-context read
// wired directly into /api/chat/respond above. getDb is passed as a getter
// (not a snapshot), matching the invite/app-state router convention, since
// dbPool can be reassigned to null asynchronously after startup.
const { createChatHistoryRouter } = require('./routes/chatHistory');
app.use('/api/projects', createChatHistoryRouter({ getDb: () => dbPool, checkToken, isAppAdmin: isConfiguredAdminEmail }));

// Branding/site-fetch route group extracted 2026-07-19 (architecture
// upgrade Phase 3) to backend/src/routes/brandingFetch.js -- see that
// file's own doc comment. Genuinely contiguous source region (comment +
// httpsGet + extractBrandingSignals + the route handler), no interleaved
// shared code, unlike the rest of this phase.
const { createBrandingFetchRouter } = require('./routes/brandingFetch');
app.use('/api/fetch-site', createBrandingFetchRouter({ checkToken }));

// Figma integration route group extracted 2026-07-19 (architecture upgrade
// Phase 3) to backend/src/routes/figmaIntegration.js.
const { createFigmaIntegrationRouter } = require('./routes/figmaIntegration');
app.use('/api/figma', createFigmaIntegrationRouter({ checkToken }));

// GitHub integration route group extracted 2026-07-19 (architecture
// upgrade Phase 3) to backend/src/routes/githubIntegration.js.
const { createGithubIntegrationRouter } = require('./routes/githubIntegration');
app.use('/api/github', createGithubIntegrationRouter({ checkToken }));

// Settings (read/write backend/.env) route group extracted 2026-07-19
// (architecture upgrade Phase 3) to backend/src/routes/envSettings.js --
// note the new file resolves envPath as '../../.env' (not '../.env'),
// since it lives one directory deeper (backend/src/routes/) than proxy.js
// (backend/src/) -- same target file (backend/.env), adjusted relative
// path, not a behavior change.
const { createEnvSettingsRouter } = require('./routes/envSettings');
app.use('/api/settings', createEnvSettingsRouter({ checkToken, requireAdmin }));

// Prompt governance (versioned prompt draft/submit/approve/activate/rollback
// workflow, plus global-prompt seed and audit-log read) route group
// extracted 2026-07-19 (architecture upgrade Phase 3) to
// backend/src/routes/promptGovernance.js -- reconciliation grep confirmed
// every helper name used in this block (promptChecksum, promptActor,
// authorizePromptOwnerAction, dbAuditPrompt, nextPromptVersion,
// getActivePromptVersion, insertPromptVersion, activatePromptVersion,
// reviewPromptVersion, assertPromptTransition, canActivatePrompt,
// canRollbackPrompt) had zero callers outside this block -- clean
// extraction, no orphaned external usage found (unlike Phase 1b).
const { createPromptGovernanceRouter } = require('./routes/promptGovernance');
app.use('/api/prompt-governance', createPromptGovernanceRouter({
  getDb: () => dbPool,
  checkToken,
  requireAdmin,
  requireAppStateDb,
  dbGetAppConfigMap,
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
  enqueueRuntimeLifecycleEvent,
  fanOutRuntimeLifecycleEvent,
}));

// AI Governance MVP-0 (2026-07-21) -- see
// docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md.
// governance.js persists the aiGovernance agent's structured decision,
// findings, and human overrides, and auto-creates backlog items;
// agentControls.js is the admin-only global/per-project agent kill
// switch. resolveAgentKillSwitch is required here (rather than only
// inside agentControls.js's own router factory) because authorizeAgentRun
// below -- defined much further down this file, but only ever CALLED at
// request time, long after this module finishes loading top to bottom --
// needs to call it directly, not through an HTTP round-trip to this
// router.
const { createGovernanceRouter } = require('./routes/governance');
app.use('/api/governance', createGovernanceRouter({
  getDb: () => dbPool,
  checkToken,
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
}));

const { createAgentControlsRouter, resolveAgentKillSwitch } = require('./routes/agentControls');
const { resolveAgentGateAuthorization } = require('./agentGatePolicy');
app.use('/api/agent-controls', createAgentControlsRouter({
  getDb: () => dbPool,
  checkToken,
  requireAdmin,
}));


// App State (config / integrations / backlog-items) route group extracted
// 2026-07-20 (architecture upgrade Phase 3g) to
// backend/src/routes/appState.js -- reconciliation grep confirmed every
// private helper it uses (lifecycleTypeForConfigKey, normalizeConfigKey,
// dbSetAppConfigValue, dbDeleteAllAppConfig, dbListIntegrations,
// dbGetIntegration, dbSaveIntegration, dbDeleteIntegration,
// dbListBacklogItems, dbCreateBacklogItem, dbUpdateBacklogItem,
// dbDeleteBacklogItem) had zero callers outside this block, even though
// they weren't physically contiguous with these routes in the original
// file. requireAppStateDb and dbGetAppConfigMap stay here (shared with
// prompt-governance, user-preferences, and loadPromptOptimizationSkill) and
// are passed in, same as Phase 3f.
const { createAppStateRouter } = require('./routes/appState');
app.use('/api/app-state', createAppStateRouter({
  getDb: () => dbPool,
  checkToken,
  requireAdmin,
  requireAppStateDb,
  dbGetAppConfigMap,
  fanOutRuntimeLifecycleEvent,
  tokenOptimizationSkillKey: TOKEN_OPTIMIZATION_SKILL_KEY,
  setPromptOptimizationSkillCache: (next) => { promptOptimizationSkillCache = next; },
}));

// Extracted 2026-07-20 (architecture upgrade Phase 3) to
// backend/src/routes/adminReset.js -- verbatim, just the mount point here.
// getEnsureInviteSessionTable is a getter (not a direct reference) because
// ensureInviteSessionTable is destructured from inviteRouterExports further
// down this file (it's a `const`, so referencing it directly here would hit
// its temporal dead zone at module-load time); wrapping it in a closure
// defers that read to actual request time, same as the original inline
// code's behavior, just across a module boundary now.
const { createAdminResetRouter } = require('./routes/adminReset');
app.use('/api/admin', createAdminResetRouter({
  getDb: () => dbPool,
  checkToken,
  requireAdmin,
  getEnsureInviteSessionTable: () => ensureInviteSessionTable,
}));

// Extracted 2026-07-20 (architecture upgrade Phase 3) to
// backend/src/routes/masterData.js -- verbatim, just the mount point here.
// dbGetMasterCatalog/dbUpsertDomain are proxy.js function declarations
// (hoisted, never reassigned) so they're passed by direct reference.
const { createMasterDataRouter } = require('./routes/masterData');
app.use('/api/master-data', createMasterDataRouter({
  checkToken,
  requireAdmin,
  dbGetMasterCatalog,
  dbUpsertDomain,
}));


// ══════════════════════════════════════════════════════════════════════════════
// INVITE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
// In-memory store for invites (persistent via Postgres when DB is available).
// Falls back to in-memory map when POSTGRES_URL is not set — suitable for
// Railway/Render free-tier deployments where the DB is optional at first.

const { Pool } = require('pg');
const { randomUUID, createHash } = require('crypto');


function resolveDbConnectionString() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.POSTGRES_URL_PRODUCTION || process.env.POSTGRES_URL || null;
  }
  return process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL || null;
}

const dbConnectionString = resolveDbConnectionString();

// Local docker-compose Postgres has no SSL listener at all and rejects an SSL
// negotiation attempt outright; Supabase (and most managed Postgres) requires
// it. Same detection pattern as scripts/seedMasterData.js and
// scripts/seedSampleData.js -- without this, pointing POSTGRES_URL_LOCAL at
// Supabase's pooler (as opposed to a local docker Postgres) hangs/fails to
// connect, and dbPool silently falls back to the in-memory invite store.
const dbTargetHost = (dbConnectionString ?? '').replace(/^[a-z]+:\/\/[^@]*@/, '').split(/[:/]/)[0];
const dbIsLocalHost = /^(localhost|127\.0\.0\.1|db)$/i.test(dbTargetHost);
const dbSslOption = dbIsLocalHost ? false : { rejectUnauthorized: false };

// M-NEW-03 fix: warn loudly at startup if invite tokens will not be persisted.
// A Railway restart (deploy, OOM, health-check failure) will silently drop all
// pending invites when running without a database.
if (!dbConnectionString) {
  console.error(
    '[ERROR] No Postgres connection string is configured. Database-backed routes will return 503.\n' +
    '        Set POSTGRES_URL_LOCAL for local development and POSTGRES_URL_PRODUCTION for production.'
  );
} // token -> { projectId, projectName, email, name, appRole, invitedBy, invitedAt, acceptedAt }


// ── DB helpers (no-op if no Postgres connection string is set) ─────────────
let dbPool = null;
let appStateReady = null;
if (dbConnectionString) {
  try {
    dbPool = new Pool({ connectionString: dbConnectionString, ssl: dbSslOption });
    dbPool.query('SELECT 1').then(async () => {
      console.log('Invite system: DB connected');
      await ensureAppStateTables().catch((err) => {
        console.error('App state schema init failed:', err.message);
      });
    }).catch((err) => {
      // Temporary diagnostic logging (2026-07-11) -- this used to swallow the
      // real error entirely, which made a bad connection string, wrong
      // credentials, SSL mismatch, and network/firewall blocks all look
      // identical ("DB connection failed, using in-memory store"). Logging
      // err.message/err.code here so the actual cause is visible instead of
      // guessed at.
      console.error(`Database connection failed (${err.code ?? 'no code'}: ${err.message}); database-backed routes are disabled.`);
      dbPool = null;
    });
  } catch { dbPool = null; }
}

async function ensureAppStateTables() {
  if (!dbPool) return;
  if (!appStateReady) {
    appStateReady = (async () => {
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL DEFAULT 'null'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await dbPool.query(`
        INSERT INTO app_config (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
      `, [TOKEN_OPTIMIZATION_SKILL_KEY, JSON.stringify(DEFAULT_PROMPT_OPTIMIZATION_SKILL)]);
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_key TEXT PRIMARY KEY,
          preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT user_preferences_object CHECK (jsonb_typeof(preferences) = 'object')
        )
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
        ON user_preferences(updated_at DESC)
      `);
      await dbPool.query('ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY');
      await dbPool.query('REVOKE ALL ON TABLE user_preferences FROM anon, authenticated');
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS app_integrations (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          encrypted_data TEXT NOT NULL,
          iv TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_app_integrations_provider
        ON app_integrations(provider)
      `);
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS admin_backlog_items (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL,
          priority TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          notes TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_backlog_items_status_priority
        ON admin_backlog_items(status, priority, created_at)
      `);
          await ensurePromptGovernanceTables();
    })().catch((err) => {
      appStateReady = null;
      throw err;
    });
  }
  await appStateReady;
}

async function ensurePromptGovernanceTables() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS agent_prompt_versions (
      id UUID PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      parent_global_prompt_id UUID REFERENCES agent_prompt_versions(id),
      version INTEGER NOT NULL CHECK (version > 0),
      content TEXT NOT NULL,
      resolved_effective_prompt TEXT,
      content_checksum TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('draft', 'submitted', 'approved', 'rejected', 'changes_requested', 'activated', 'superseded', 'rolled_back')
      ),
      active BOOLEAN NOT NULL DEFAULT FALSE,
      approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (
        approval_status IN ('draft', 'submitted', 'approved', 'rejected', 'changes_requested', 'activated', 'superseded', 'rolled_back')
      ),
      project_owner_email TEXT,
      approval_comments TEXT,
      submitted_by TEXT,
      submitted_at TIMESTAMPTZ,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by TEXT,
      rejected_at TIMESTAMPTZ,
      activated_by TEXT,
      activated_at TIMESTAMPTZ,
      created_by TEXT,
      updated_by TEXT,
      change_summary TEXT,
      change_reason TEXT,
      business_reason TEXT,
      technical_reason TEXT,
      risk_assessment TEXT,
      impact_assessment TEXT,
      previous_version_id UUID REFERENCES agent_prompt_versions(id),
      rollback_reference_id UUID REFERENCES agent_prompt_versions(id),
      immutable_history JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT agent_prompt_project_scope CHECK (
        (scope = 'global' AND project_id IS NULL) OR
        (scope = 'project' AND project_id IS NOT NULL)
      )
    )
  `);
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent
    ON agent_prompt_versions(agent_id, scope, project_id, version DESC)
  `);
  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_global_active
    ON agent_prompt_versions(agent_id)
    WHERE scope = 'global' AND active = TRUE
  `);
  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_project_active
    ON agent_prompt_versions(project_id, agent_id)
    WHERE scope = 'project' AND active = TRUE
  `);
  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_global_version
    ON agent_prompt_versions(agent_id, version)
    WHERE scope = 'global'
  `);
  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_project_version
    ON agent_prompt_versions(project_id, agent_id, version)
    WHERE scope = 'project'
  `);
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS agent_prompt_audit_log (
      id UUID PRIMARY KEY,
      prompt_version_id UUID REFERENCES agent_prompt_versions(id) ON DELETE SET NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_email TEXT,
      actor_user_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_prompt_audit_agent
    ON agent_prompt_audit_log(agent_id, project_id, created_at DESC)
  `);
}

async function requireAppStateDb(res) {
  if (!dbPool) {
    res.status(503).json({ error: 'Postgres is unavailable.' });
    return false;
  }
  try {
    await ensureAppStateTables();
    return true;
  } catch (err) {
    console.error('App state DB error:', err.message);
    res.status(500).json({ error: 'App state database is unavailable.' });
    return false;
  }
}

// normalizeConfigKey moved to backend/src/routes/appState.js (Phase 3g).

async function dbGetAppConfigMap(keys = null) {
  if (!dbPool) throw new Error('Postgres is unavailable.');
  const query = keys?.length
    ? {
        text: `SELECT key, value FROM app_config WHERE key = ANY($1::text[])`,
        values: [keys],
      }
    : {
        text: `SELECT key, value FROM app_config`,
        values: [],
      };
  const { rows } = await dbPool.query(query);
  const values = {};
  for (const row of rows) values[row.key] = row.value;
  return values;
}

// dbSetAppConfigValue, dbDeleteAllAppConfig, dbListIntegrations,
// dbGetIntegration, dbSaveIntegration, dbDeleteIntegration,
// dbListBacklogItems, dbCreateBacklogItem, dbUpdateBacklogItem, and
// dbDeleteBacklogItem all moved to backend/src/routes/appState.js
// (Phase 3g) -- each was only ever called from the app-state routes now
// living there.

const MASTER_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let masterCatalogCache = {
  value: null,
  expiresAt: 0,
};

async function dbGetMasterCatalog() {
  if (masterCatalogCache.value && Date.now() < masterCatalogCache.expiresAt) {
    return masterCatalogCache.value;
  }

  if (!dbPool) {
    const [
      phases,
      reviewGates,
      agents,
      phaseAgents,
      domains,
      roleTemplates,
      roleTemplateAgents,
    ] = await Promise.all([
      fetchSupabaseTable('master_phases?select=id,order_index,label,sdlc_stage,is_parallel&order=order_index.asc'),
      fetchSupabaseTable('master_review_gates?select=gate_id,phase_id,phase_order&order=gate_id.asc,phase_order.asc'),
      fetchSupabaseTable('master_agents?select=id,name,phase_id,description,output_label,depends_on,max_iterations&is_enabled=eq.true&order=phase_id.asc,id.asc'),
      fetchSupabaseTable('master_phase_agents?select=phase_id,agent_id,agent_order&order=phase_id.asc,agent_order.asc'),
      fetchSupabaseTable('master_domains?select=id,label,color,bg_color,context,template&order=label.asc'),
      fetchSupabaseTable('master_role_templates?select=id,title,description,color,sort_order&order=sort_order.asc,title.asc'),
      fetchSupabaseTable('master_role_template_agents?select=role_template_id,agent_id,sort_order&order=role_template_id.asc,sort_order.asc'),
    ]);

    const catalog = { phases, reviewGates, agents, phaseAgents, domains, roleTemplates, roleTemplateAgents };
    masterCatalogCache = {
      value: catalog,
      expiresAt: Date.now() + MASTER_CATALOG_CACHE_TTL_MS,
    };
    return catalog;
  }

  const [
    phasesRes,
    gatesRes,
    agentsRes,
    phaseAgentsRes,
    domainsRes,
    roleTemplatesRes,
    roleTemplateAgentsRes,
  ] = await Promise.all([
    dbPool.query(`
      SELECT id, order_index, label, sdlc_stage, is_parallel
      FROM master_phases
      ORDER BY order_index ASC
    `),
    dbPool.query(`
      SELECT gate_id, phase_id, phase_order
      FROM master_review_gates
      ORDER BY gate_id ASC, phase_order ASC
    `),
    dbPool.query(`
      SELECT id, name, phase_id, description, output_label, depends_on, max_iterations
      FROM master_agents
      WHERE is_enabled = TRUE
      ORDER BY phase_id ASC, id ASC
    `),
    dbPool.query(`
      SELECT phase_id, agent_id, agent_order
      FROM master_phase_agents
      ORDER BY phase_id ASC, agent_order ASC
    `),
    dbPool.query(`
      SELECT id, label, color, bg_color, context, template
      FROM master_domains
      ORDER BY label ASC
    `),
    dbPool.query(`
      SELECT id, title, description, color, sort_order
      FROM master_role_templates
      ORDER BY sort_order ASC, title ASC
    `),
    dbPool.query(`
      SELECT role_template_id, agent_id, sort_order
      FROM master_role_template_agents
      ORDER BY role_template_id ASC, sort_order ASC
    `),
  ]);

  const catalog = {
    phases: phasesRes.rows,
    reviewGates: gatesRes.rows,
    agents: agentsRes.rows,
    phaseAgents: phaseAgentsRes.rows,
    domains: domainsRes.rows,
    roleTemplates: roleTemplatesRes.rows,
    roleTemplateAgents: roleTemplateAgentsRes.rows,
  };
  masterCatalogCache = {
    value: catalog,
    expiresAt: Date.now() + MASTER_CATALOG_CACHE_TTL_MS,
  };
  return catalog;
}

// Create or update a single row in master_domains (admin "Add domain" UI).
// Requires a direct Postgres connection. The Supabase-REST-only fallback used
// by dbGetMasterCatalog's read path (fetchSupabaseTable) is GET-only in this
// file — no write helper exists for it yet — so this mirrors the existing
// dbUpsertMember precedent of returning null when dbPool isn't configured,
// and the route handler below turns that into a clear 501 for the admin.
async function dbUpsertDomain({ id, label, color, bgColor, context, template }) {
  if (!dbPool) return null;
  const { rows } = await dbPool.query(`
    INSERT INTO master_domains (id, label, color, bg_color, context, template)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE
      SET label = EXCLUDED.label,
          color = EXCLUDED.color,
          bg_color = EXCLUDED.bg_color,
          context = EXCLUDED.context,
          template = EXCLUDED.template,
          updated_at = NOW()
    RETURNING id, label, color, bg_color, context, template
  `, [id, label, color, bgColor, context, template]);
  // Invalidate the 5-minute catalog cache so the new/updated domain is
  // visible on the next GET /api/master-data/catalog instead of waiting
  // out the TTL.
  masterCatalogCache = { value: null, expiresAt: 0 };
  return rows[0] ?? null;
}

// ── Authorization: who can create/revoke/view invites for a project ─────────
// Two independent signals are checked because this app currently represents
// project membership in two places kept in sync by application code rather
// than a single source of truth:
//   1. team_members (relational) — the row invitees get once their invite is
//      accepted; RLS policies (003_rls_policies.sql) already treat this as
//      the authority for project_owner-gated actions.
//   2. projects.data.teamMembers (JSONB, seeded by server/src/routes/projects.ts
//      at project-creation time) — this is where the ORIGINAL creator/owner
//      is recorded; they never go through the accept-invite flow themselves,
//      so they have no team_members row until/unless one is created some
//      other way. Without checking this too, a project's own creator would
//      be wrongly denied permission to invite anyone to their own project.
async function getCallerAppRoleForProject(projectId, email) {
  if (!dbPool || !email) return null;
  const normalizedEmail = String(email).trim().toLowerCase();

  const relational = await dbPool.query(`
    SELECT app_role FROM team_members
    WHERE project_id = $1 AND lower(email) = $2 AND invite_status = 'accepted'
    LIMIT 1
  `, [projectId, normalizedEmail]).catch(() => ({ rows: [] }));
  if (relational.rows[0]) return relational.rows[0].app_role;

  const jsonb = await dbPool.query(`
    SELECT member->>'appRole' AS app_role
    FROM projects, jsonb_array_elements(COALESCE(data->'teamMembers', '[]'::jsonb)) AS member
    WHERE id = $1 AND lower(member->>'email') = $2
    LIMIT 1
  `, [projectId, normalizedEmail]).catch(() => ({ rows: [] }));
  if (jsonb.rows[0]) return jsonb.rows[0].app_role;

  return null;
}

// Per-agent access scoping (mandatory-agent-assignment invites, 2026-07-11).
// agentAssignments has no relational-table equivalent -- it only ever lived
// in projects.data JSONB (same place the frontend's ProjectSettings.tsx /
// ProjectWorkspace.tsx read/write it), so this reads that JSONB directly
// rather than mirroring getCallerAppRoleForProject()'s dual relational+JSONB
// lookup above.
async function getCallerAgentAccess(projectId, email) {
  if (!dbPool || !email || !projectId) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await dbPool.query(`
    SELECT
      member->>'id' AS member_id,
      member->>'appRole' AS app_role,
      COALESCE((member->>'agentAccessScoped')::boolean, false) AS agent_access_scoped,
      COALESCE(p.data->'agentAssignments', '[]'::jsonb) AS agent_assignments
    FROM projects p, jsonb_array_elements(COALESCE(p.data->'teamMembers', '[]'::jsonb)) AS member
    WHERE p.id = $1 AND lower(member->>'email') = $2
    LIMIT 1
  `, [projectId, normalizedEmail]);
  return result.rows[0] ?? null;
}

/**
 * Enforces the per-agent access-scoping feature: a scoped, non-owner member
 * (TeamMember.agentAccessScoped === true, set only by the mandatory-
 * agent-assignment invite flow -- see InviteModal in ProjectSettings.tsx) may
 * only run agents present in their own project.agentAssignments entry. This
 * is the server-side half of that feature; ProjectWorkspace.tsx's UI gating
 * is the other half and must not be relied on alone, since /api/agent and
 * /api/agents/call were previously reachable directly with any agentId once
 * past checkToken()'s identity check -- there was no project- or
 * agent-scoped authorization here at all before this function existed.
 *
 * Writes the 403 response itself and returns { ok: false } on denial; caller
 * must `return` immediately when ok is false. Returns { ok: true, skipped:
 * true } (not just `ok: true`) in every case where the check intentionally
 * did not run, so tests/logs can distinguish "explicitly allowed" from
 * "not evaluated" -- see the reasons in each branch below.
 */
async function authorizeAgentRun(req, res, { projectId, agentId }) {
  // No project/agent context -- meta or utility calls (e.g. app-level "Test
  // Connection", the Risk Register suggestion helper, chat-widget prompts)
  // are out of scope for this feature and unaffected.
  if (!projectId || !agentId) return { ok: true, skipped: true };

  if (!dbPool) {
    console.error(`[authorizeAgentRun] authorization database unavailable (project=${projectId}, agent=${agentId})`);
    res.status(503).json({ error: 'Agent authorization is temporarily unavailable.' });
    return { ok: false };
  }

  let killSwitch;
  try {
    killSwitch = await resolveAgentKillSwitch({ getDb: () => dbPool, projectId, agentId });
  } catch (err) {
    console.error(`[authorizeAgentRun] kill-switch resolution failed (project=${projectId}, agent=${agentId}): ${err?.message ?? err}`);
    res.status(503).json({ error: 'Agent governance controls are temporarily unavailable.' });
    return { ok: false };
  }
  if (killSwitch.disabled) {
    res.status(403).json({
      error: `This agent has been disabled${killSwitch.source === 'project' ? ' for this project' : ''} by an admin and cannot be run right now.`,
    });
    return { ok: false };
  }

  // Human review gates are authoritative at the same trusted boundary as
  // membership, assignment, and kill-switch checks. Admins and service
  // accounts do not bypass this policy; they may approve a gate through the
  // governed project flow, but cannot silently execute past it.
  let gateAuthorization;
  try {
    gateAuthorization = await resolveAgentGateAuthorization({
      db: dbPool,
      projectId,
      agentId,
    });
  } catch (err) {
    console.error(`[authorizeAgentRun] review-gate resolution failed (project=${projectId}, agent=${agentId}): ${err?.message ?? err}`);
    res.status(503).json({ error: 'Review-gate authorization is temporarily unavailable.' });
    return { ok: false };
  }
  if (!gateAuthorization.allowed) {
    res.status(gateAuthorization.status ?? 403).json({
      error: gateAuthorization.error ?? 'A required review gate has not been approved.',
      blockingGate: gateAuthorization.blockingGate,
    });
    return { ok: false };
  }

  if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
    return { ok: true, skipped: true };
  }
  const callerEmail = req.authUser?.email ?? null;
  if (callerEmail && isConfiguredAdminEmail(callerEmail)) {
    return { ok: true, skipped: true };
  }
  if (req.authUser?.serviceAccount) {
    return { ok: true, skipped: true };
  }
  if (!callerEmail) {
    res.status(401).json({ error: 'A verified user identity is required to run a project agent.' });
    return { ok: false };
  }

  let access;
  try {
    access = await getCallerAgentAccess(projectId, callerEmail);
  } catch (err) {
    console.error(`[authorizeAgentRun] access lookup failed (project=${projectId}, agent=${agentId}): ${err?.message ?? err}`);
    res.status(503).json({ error: 'Agent authorization is temporarily unavailable.' });
    return { ok: false };
  }
  if (!access) {
    res.status(403).json({ error: 'You are not a member of this project.' });
    return { ok: false };
  }
  if (access.app_role === 'project_owner') return { ok: true };
  if (!access.agent_access_scoped) return { ok: true }; // legacy/grandfathered member — full access, as before this feature

  const assignments = Array.isArray(access.agent_assignments) ? access.agent_assignments : [];
  const assignment = assignments.find((a) => a && a.agentId === agentId);
  const memberIds = Array.isArray(assignment?.memberIds) ? assignment.memberIds : [];
  if (memberIds.includes(access.member_id)) return { ok: true };

  res.status(403).json({
    error: 'You are not assigned to run this agent for this project. Ask your Project Owner to assign it to you in Settings → Team Members.',
  });
  return { ok: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// The rest of the invite subsystem (helpers + all 10 routes) was extracted
// 2026-07-19 (architecture upgrade Phase 1b) to
// backend/src/routes/inviteRoutes.js -- see docs/architecture/
// architecture-upgrade-execution-plan.md. Function bodies are verbatim in
// the new file; this is just the mount point. dbPool is passed as a getter
// (not a snapshot) since it can be reassigned to null asynchronously after
// startup if the initial DB connection check fails -- same pattern used by
// every route module mounted in this file.
// ══════════════════════════════════════════════════════════════════════════════
const { createInviteRouter } = require('./routes/inviteRoutes');
const inviteRouterExports = createInviteRouter({
  getDb: () => dbPool,
  checkToken,
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
  getSupabase,
  provisionInviteeAccount,
});
const { hashInviteToken, isInviteExpired, appRoleRank, sendInviteEmail, getGmailTransporter, ensureInviteSessionTable } = inviteRouterExports;
app.use('/api/invite', inviteRouterExports.router);

// Extracted 2026-07-20 (architecture upgrade Phase 3) to
// backend/src/routes/userPreferenceRoutes.js -- verbatim, just the mount
// point here. The handler logic already lived in ./userPreferences; only
// the route registration itself was still inline.
const { createUserPreferenceRouter } = require('./routes/userPreferenceRoutes');
app.use('/api/user-preferences', createUserPreferenceRouter({ getDb: () => dbPool, checkToken, requireAppStateDb }));

// Forwarded app APIs enforce auth in the dedicated `server/` service.
// Do not gate them again here with PROXY_TOKEN-only fallback auth, otherwise
// valid Supabase JWT sessions can be rejected before reaching the real API.
//
// Relocated here 2026-07-20 (see the long comment where this used to live,
// right after `httpsGet`/before "── Provider resolution ──") -- moved to
// the end of route registration, after every extracted router, so
// forwardToServer only catches whatever none of them matched. Previously
// mounted first, it fully shadowed createAdminResetRouter (/api/admin) and
// createChatHistoryRouter (/api/projects) since it's a terminal handler
// that never calls next(). Unchanged: forwardToServer itself, and every
// other path it forwards that isn't one of those two newly-local routes.
app.use('/api/projects', forwardToServer);
app.use('/api/invites', forwardToServer);
app.use('/api/admin', forwardToServer);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Only bind a real port when this file is run directly (`node src/proxy.js`),
// not when it's `require()`d — e.g. from a test file that wants to exercise
// individual functions without starting a live server.
if (require.main === module) {
  assertProductionAuthConfiguration();
  app.listen(PORT, () => {
    console.log(`Agentic SDLC proxy  http://localhost:${PORT}  model=${OPENAI_MODEL}`);
    console.log(CORP_PROXY ? `Corporate proxy: ${CORP_PROXY}` : 'Direct connection (no proxy configured)');
    // Diagnostic only — never logs the actual key/secret values, just whether
    // checkToken() will be able to validate Supabase JWTs on this process.
    // Added to debug a persistent 401 where the Railway dashboard showed
    // SUPABASE_URL/SUPABASE_ANON_KEY as present but checkToken() kept falling
    // through as if Supabase were unconfigured. Safe to remove once resolved.
    const supabaseClientOk = !!getSupabase();
    console.log(
      `Supabase auth check: SUPABASE_URL=${SUPABASE_URL ? 'set' : 'MISSING'} ` +
      `SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY ? 'set' : 'MISSING'} ` +
      `client=${supabaseClientOk ? 'OK' : 'FAILED TO INITIALIZE'} ` +
      `PROXY_TOKEN=${PROXY_TOKEN ? 'set' : 'not set'}`
    );
  });
}

module.exports = {
  app,
  sendInviteEmail,
  getGmailTransporter,
  // Exported for unit testing only (invite-link security hardening):
  hashInviteToken,
  appRoleRank,
  isInviteExpired,
  isConfiguredAdminEmail,
  // Exported for unit testing only (one-time-link invite provisioning):
  provisionInviteeAccount,
  findSupabaseUserByEmail,
  getSupabaseAdmin,
  getProductionAuthConfigurationErrors,
  assertProductionAuthConfiguration,
  checkToken,
  // Exported for unit testing only (per-agent access scoping, 2026-07-11):
  authorizeAgentRun,
  getCallerAgentAccess,
};
