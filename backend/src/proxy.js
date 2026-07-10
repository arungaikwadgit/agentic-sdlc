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
const nodemailer = require('nodemailer');
const { createLocalProjectStore } = require('./localProjectStore');
const { createInMemoryAppStateStore } = require('./appStateStore');

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
const ADMIN_BYPASS_BEARER = 'admin-local-bypass-token';
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
// A team member's Supabase Auth account is created directly here (Admin API)
// rather than via the client-side signUp()+email-confirmation flow, so the
// invitee can sign in immediately with a generated password instead of
// waiting on a confirmation email. must_change_password in user_metadata
// forces a password change on first sign-in (enforced in the frontend's
// AuthGuard) — chosen over a new DB column so this needs no migration and
// no dependency on a redeploy before it takes effect.
let _supabaseAdminClient = null;
function getSupabaseAdmin() {
  if (_supabaseAdminClient) return _supabaseAdminClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return _supabaseAdminClient;
  } catch (err) {
    console.error(`getSupabaseAdmin(): createClient() threw — name=${err?.name ?? 'Unknown'} message=${err?.message ?? String(err)}`);
    return null;
  }
}

// Ambiguity-free alphabet — excludes 0/O/1/l/i so a spoken or handwritten
// password can't be misread.
const PASSWORD_SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomPasswordSuffix(length = 3) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_SUFFIX_ALPHABET[Math.floor(Math.random() * PASSWORD_SUFFIX_ALPHABET.length)];
  }
  return out;
}

// Format: firstname_ddmmyy + a 3-char random suffix, e.g. "jane_090726a4c".
function generateDefaultPassword(name, date = new Date()) {
  const firstName = String(name ?? 'user').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${firstName}_${dd}${mm}${yy}${randomPasswordSuffix()}`;
}

// supabase-js@^2.45.0 (pinned in backend/package.json) has no getUserByEmail()
// — paginate listUsers() instead. Capped at 25 pages (5,000 users at 200/page).
async function findSupabaseUserByEmail(admin, email) {
  const target = String(email).trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

// Creates (or, if the email is already registered, updates) a Supabase Auth
// user with a fresh generated password and must_change_password: true.
// Used by both invite/send (new accounts) and invite/reset-password
// (existing accounts getting a new default password).
async function provisionInviteeAccount({ email, name, actionDate }) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw Object.assign(new Error('Account provisioning is not configured on this server (missing SUPABASE_URL/SUPABASE_SERVICE_KEY).'), { code: 'ADMIN_CLIENT_UNAVAILABLE' });
  }
  const password = generateDefaultPassword(name, actionDate);
  const metadata = { must_change_password: true, name: name ?? undefined };

  const { data: createData, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: metadata,
  });
  if (!createError) {
    return { password, userId: createData?.user?.id ?? null, created: true };
  }
  const alreadyExists = createError.status === 422 || /already.?(registered|exists)/i.test(createError.message ?? '');
  if (!alreadyExists) throw createError;

  const existingUser = await findSupabaseUserByEmail(admin, email);
  if (!existingUser) throw createError;

  const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
    password, email_confirm: true, user_metadata: { ...(existingUser.user_metadata ?? {}), ...metadata },
  });
  if (updateError) throw updateError;
  return { password, userId: existingUser.id, created: false };
}

// Anthropic (Claude) — optional second provider
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const ANTHROPIC_ENABLED = String(process.env.ANTHROPIC_ENABLED ?? '').toLowerCase() === 'true' && !!ANTHROPIC_API_KEY;
const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER ?? 'openai').toLowerCase() === 'claude' ? 'claude' : 'openai';
const localProjectStore = createLocalProjectStore();
const appStateStore = createInMemoryAppStateStore();

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

  // Path 2: Shared secret (PROXY_TOKEN) — used by admin-mode and server-to-server calls.
  // If neither SUPABASE_URL nor PROXY_TOKEN is set, allow (local dev with no auth configured).
  if (!PROXY_TOKEN && !SUPABASE_URL) {
    console.log(`${authTag} no PROXY_TOKEN and no SUPABASE_URL configured — allowing (open/local mode)`);
    return next();
  }
  if (PROXY_TOKEN && req.headers['x-api-token'] === PROXY_TOKEN) {
    console.log(`${authTag} valid X-API-Token header — allowing`);
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
  console.log(`${authTag} no auth mechanism matched but none required — allowing`);
  next();
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

// ── HTTPS POST with optional corporate proxy tunnel ───────────────────────────
function httpsPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const payload = Buffer.from(body, 'utf8');

    if (CORP_PROXY) {
      // Tunnel through corporate proxy via HTTP CONNECT
      const proxy = new URL(CORP_PROXY);
      const connectReq = http.request({
        host:   proxy.hostname,
        port:   Number(proxy.port) || 80,
        method: 'CONNECT',
        path:   `${url.hostname}:443`,
      });

      connectReq.on('connect', (_res, socket) => {
        const tlsSocket = tls.connect({
          host:               url.hostname,
          socket,
          servername:         url.hostname,
          rejectUnauthorized: false,  // allow corp SSL-inspection certs
        });

        tlsSocket.on('secureConnect', () => {
          const reqLines = [
            `POST ${url.pathname}${url.search} HTTP/1.1`,
            `Host: ${url.hostname}`,
            ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
            `Content-Length: ${payload.length}`,
            'Connection: close',
            '',
            '',
          ].join('\r\n');

          tlsSocket.write(reqLines);
          tlsSocket.write(payload);

          let raw = '';
          tlsSocket.on('data', d => { raw += d.toString(); });
          tlsSocket.on('end', () => {
            const sep   = raw.indexOf('\r\n\r\n');
            const head  = sep >= 0 ? raw.slice(0, sep) : raw;
            const rbody = sep >= 0 ? raw.slice(sep + 4) : '';
            const status = parseInt(head.split('\r\n')[0].split(' ')[1], 10);
            resolve({ status, body: rbody });
          });
          tlsSocket.on('error', reject);
        });
        tlsSocket.on('error', reject);
      });

      connectReq.on('error', reject);
      connectReq.end();

    } else {
      // Direct HTTPS
      const req = https.request(
        {
          hostname: url.hostname,
          port:     443,
          path:     url.pathname + url.search,
          method:   'POST',
          headers:  { ...headers, 'Content-Length': payload.length },
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    }
  });
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: OPENAI_MODEL,
    claudeEnabled: ANTHROPIC_ENABLED,
    claudeModel: ANTHROPIC_ENABLED ? ANTHROPIC_MODEL : null,
    defaultProvider: DEFAULT_LLM_PROVIDER,
    proxy: CORP_PROXY || null,
    ts: Date.now(),
  });
});

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
app.use('/api/projects', forwardToServer);
app.use('/api/invites', forwardToServer);
app.use('/api/admin', forwardToServer);

// ── Provider resolution ──────────────────────────────────────────────────────
// Resolution order: explicit request `provider` -> per-agent routing hint
// (AGENT_PROVIDER_MAP) -> DEFAULT_LLM_PROVIDER. Falls back to 'openai' if
// Claude is requested/hinted but not enabled (missing key or disabled flag).
function resolveProvider(requestedProvider, agentId) {
  let provider = DEFAULT_LLM_PROVIDER;

  if (agentId && AGENT_PROVIDER_MAP[agentId]) {
    provider = AGENT_PROVIDER_MAP[agentId];
  }

  if (requestedProvider === 'openai' || requestedProvider === 'claude') {
    provider = requestedProvider;
  }

  if (provider === 'claude' && !ANTHROPIC_ENABLED) {
    provider = 'openai';
  }

  return provider;
}

// Normalize an OpenAI-shaped response into our common shape.
function fromOpenAiResponse(data) {
  return {
    choices: data.choices,
    usage: data.usage,
  };
}

// Normalize an Anthropic Messages API response into the OpenAI-shaped
// `{ choices: [...], usage: {...} }` contract the frontend already expects.
function fromAnthropicResponse(data) {
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const promptTokens     = data.usage?.input_tokens ?? 0;
  const completionTokens = data.usage?.output_tokens ?? 0;

  return {
    choices: [
      {
        message: { role: 'assistant', content: text },
        finish_reason: data.stop_reason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

async function callOpenAi(systemPrompt, userPrompt) {
  const requestBody = JSON.stringify({
    model:    OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens:  8192,
  });

  const { status, body } = await httpsPost(
    'https://api.openai.com/v1/chat/completions',
    {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    requestBody,
  );

  if (status < 200 || status >= 300) {
    console.error(`OpenAI ${status}:`, body.slice(0, 300));
    throw Object.assign(new Error(`OpenAI error ${status}: ${body.slice(0, 200)}`), { status });
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Invalid JSON from OpenAI'), { status: 502, raw: body.slice(0, 200) });
  }

  return fromOpenAiResponse(data);
}

async function callClaude(systemPrompt, userPrompt) {
  const requestBody = JSON.stringify({
    model:      ANTHROPIC_MODEL,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
    max_tokens: 8192,
    temperature: 0.4,
  });

  const { status, body } = await httpsPost(
    'https://api.anthropic.com/v1/messages',
    {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    requestBody,
  );

  if (status < 200 || status >= 300) {
    console.error(`Anthropic ${status}:`, body.slice(0, 300));
    throw Object.assign(new Error(`Anthropic error ${status}: ${body.slice(0, 200)}`), { status });
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Invalid JSON from Anthropic'), { status: 502, raw: body.slice(0, 200) });
  }

  return fromAnthropicResponse(data);
}

// ── Rate-limit retry helper ───────────────────────────────────────────────────
// Retries the given async fn up to maxAttempts on 429, with exponential backoff.
// Parses "Please try again in Xs" from the OpenAI error body when available.
async function withRetry(fn, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || String(err.message).includes('429');
      if (!is429 || attempt === maxAttempts) throw err;
      // Parse suggested wait from OpenAI error body, e.g. "Please try again in 2.5s"
      const match = String(err.message).match(/try again in (\d+(?:\.\d+)?)(s| second)/i);
      const waitMs = match
        ? Math.ceil(parseFloat(match[1])) * 1000 + 500
        : Math.min(2000 * 2 ** (attempt - 1), 30_000); // 2s, 4s, 8s
      console.warn(`429 rate limit — waiting ${waitMs}ms before retry ${attempt}/${maxAttempts - 1}`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ── Agent ─────────────────────────────────────────────────────────────────────
app.post('/api/agent', checkToken, async (req, res) => {
  const { systemPrompt, userPrompt, testMode, agentId, provider: requestedProvider } = req.body ?? {};

  if (!systemPrompt || !userPrompt)
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });

  // M-05 fix: server-side prompt injection detection — client-side check is bypassable
  const INJECTION_PATTERNS = [
    /ignore previous/i, /ignore rules/i, /ignore (all )?instructions/i,
    /forget your instructions/i, /disregard (all )?previous/i,
    /you are now/i, /override (your )?system/i, /bypass (the )?filter/i,
  ];
  const combinedPrompt = `${systemPrompt} ${userPrompt}`;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(combinedPrompt)) {
      return res.status(400).json({ error: 'Request rejected: potential prompt injection detected.' });
    }
  }

  const provider = resolveProvider(requestedProvider, agentId);
  const model = provider === 'claude' ? ANTHROPIC_MODEL : OPENAI_MODEL;

  // Test mode — no external call
  if (testMode) {
    return res.json({
      choices: [{ message: { role: 'assistant', content: '[TEST] ' + systemPrompt.slice(0, 80) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider,
      model,
    });
  }

  try {
    const result = await withRetry(() =>
      provider === 'claude'
        ? callClaude(systemPrompt, userPrompt)
        : callOpenAi(systemPrompt, userPrompt)
    );

    return res.json({ ...result, provider, model });

  } catch (err) {
    console.error('Proxy error:', err.message);
    const status = err.status ?? 502;
    return res.status(status).json({ error: err.message, raw: err.raw });
  }
});

// Alias — newer frontend builds call /api/agents/call; route to the same handler
app.post('/api/agents/call', checkToken, async (req, res) => {
  // Delegate to /api/agent handler by reusing the same logic inline
  const { systemPrompt, userPrompt, testMode, agentId, provider: requestedProvider } = req.body ?? {};

  // Diagnostic logging (temporary) — see checkToken() above. Traces the full
  // Test Connection / agent-call lifecycle on the backend, from authenticated
  // user through provider resolution to the actual LLM call result.
  const callTag = `[agents/call]`;
  console.log(
    `${callTag} authenticated as user=${req.authUser?.email ?? (req.authUser?.adminBypass ? '(admin-bypass)' : '(unknown)')} ` +
    `agentId=${agentId ?? '(none)'} requestedProvider=${requestedProvider ?? '(default)'} testMode=${!!testMode}`
  );

  if (!systemPrompt || !userPrompt)
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });

  const INJECTION_PATTERNS = [
    /ignore previous/i, /ignore rules/i, /ignore (all )?instructions/i,
    /forget your instructions/i, /disregard (all )?previous/i,
    /you are now/i, /override (your )?system/i, /bypass (the )?filter/i,
  ];
  const combinedPrompt = `${systemPrompt} ${userPrompt}`;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(combinedPrompt)) {
      return res.status(400).json({ error: 'Request rejected: potential prompt injection detected.' });
    }
  }

  const provider = resolveProvider(requestedProvider, agentId);
  const model = provider === 'claude' ? ANTHROPIC_MODEL : OPENAI_MODEL;
  console.log(`${callTag} resolved provider=${provider} model=${model}`);

  if (testMode) {
    console.log(`${callTag} testMode=true — returning stub response without calling the LLM`);
    return res.json({
      choices: [{ message: { role: 'assistant', content: '[TEST] ' + systemPrompt.slice(0, 80) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider,
      model,
    });
  }

  try {
    console.log(`${callTag} calling ${provider} API...`);
    const started = Date.now();
    const result = await withRetry(() =>
      provider === 'claude'
        ? callClaude(systemPrompt, userPrompt)
        : callOpenAi(systemPrompt, userPrompt)
    );
    console.log(`${callTag} ${provider} call succeeded in ${Date.now() - started}ms`);
    return res.json({ ...result, provider, model });
  } catch (err) {
    console.error(`${callTag} ${provider} call FAILED — status=${err.status ?? 502} message=${err.message}`);
    const status = err.status ?? 502;
    return res.status(status).json({ error: err.message, raw: err.raw });
  }
});

// ── Fetch site (for Branding Guidelines "replicate this site") ───────────────
// Fetches a URL's HTML and extracts a compact summary of branding signals:
// title, meta description, theme-color, og:* tags, inline <style> blocks,
// CSS custom properties, Google Fonts links, and hex colors found in markup.
// Does NOT execute JS or fetch linked stylesheets/images — lightweight static
// HTML scan only, with a single redirect hop and a ~1.5MB response cap.
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return reject(new Error('Only http/https URLs are supported'));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'GET',
        headers:  {
          'User-Agent': 'Mozilla/5.0 (compatible; AgenticSDLC/1.0; +branding-fetch)',
          'Accept':     'text/html,application/xhtml+xml',
        },
        timeout: 10_000,
      },
      (res) => {
        // Follow a single redirect hop
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return httpsGet(next).then(resolve, reject);
        }
        let data = '';
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1_500_000) { req.destroy(); return; } // cap ~1.5MB
          data += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data, finalUrl: url.toString() }));
      },
    );
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function extractBrandingSignals(html, pageUrl) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };
  const title = pick(/<title[^>]*>([^<]*)<\/title>/i);
  const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const themeColor = pick(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']*)["']/i);

  // og:* tags
  const ogTags = {};
  const ogRe = /<meta[^>]+property=["']og:([a-z:]+)["'][^>]+content=["']([^"']*)["']/gi;
  let m;
  while ((m = ogRe.exec(html)) && Object.keys(ogTags).length < 8) {
    ogTags[m[1]] = m[2];
  }

  // <style> blocks (cap total size)
  const styleBlocks = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let total = 0;
  while ((m = styleRe.exec(html))) {
    const chunk = m[1].trim();
    if (!chunk) continue;
    if (total + chunk.length > 20_000) {
      styleBlocks.push(chunk.slice(0, Math.max(0, 20_000 - total)));
      total = 20_000;
      break;
    }
    styleBlocks.push(chunk);
    total += chunk.length;
  }

  // CSS custom properties (--brand-color: #fff;) anywhere in the doc
  const cssVars = new Set();
  const varRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  while ((m = varRe.exec(html)) && cssVars.size < 60) {
    cssVars.add(`${m[1]}: ${m[2].trim()}`);
  }

  // Linked Google Fonts
  const fonts = new Set();
  const fontRe = /fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi;
  while ((m = fontRe.exec(html)) && fonts.size < 10) {
    fonts.add(decodeURIComponent(m[1]).replace(/\+/g, ' '));
  }

  // Hex colors found anywhere in inline styles/style blocks (rough signal)
  const colors = new Set();
  const colorSource = styleBlocks.join('\n') + '\n' + html;
  const colorRe = /#[0-9a-fA-F]{3,8}\b/g;
  while ((m = colorRe.exec(colorSource)) && colors.size < 40) {
    colors.add(m[0]);
  }

  return {
    url: pageUrl,
    title,
    description,
    themeColor,
    ogTags,
    cssVars: [...cssVars],
    googleFonts: [...fonts],
    colorsFound: [...colors],
    styleSampleChars: styleBlocks.join('\n').slice(0, 8000),
  };
}

app.post('/api/fetch-site', checkToken, async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'url is required' });

  let target;
  try {
    target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const { status, body, finalUrl } = await httpsGet(target.toString());
    if (status < 200 || status >= 300) {
      return res.status(502).json({ error: `Site responded with HTTP ${status}` });
    }
    const signals = extractBrandingSignals(body, finalUrl);
    return res.json(signals);
  } catch (err) {
    console.error('fetch-site error:', err.message);
    return res.status(502).json({ error: `Failed to fetch site: ${err.message}` });
  }
});


// ── Figma integration ─────────────────────────────────────────────────────────
// Server-side because Figma REST API does not allow Authorization headers from
// browser origins (CORS restriction). We proxy the request here.
function figmaRequest(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.figma.com',
        port: 443,
        path,
        method: 'GET',
        headers: {
          'X-Figma-Token': token,
          'User-Agent': 'AgenticSDLC/1.0',
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = null; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Figma request timed out')));
    req.on('error', reject);
    req.end();
  });
}

// POST /api/figma/styles — fetch color + text styles from a Figma file
// Body: { fileKey: string, token: string }
// Returns: { colors: [{name, hex}], typography: [{name, fontFamily, fontSize, fontWeight}] }
app.post('/api/figma/styles', checkToken, async (req, res) => {
  const { fileKey, token } = req.body ?? {};
  if (!fileKey || !token)
    return res.status(400).json({ error: 'fileKey and token are required' });

  try {
    const { status, body } = await figmaRequest(`/v1/files/${fileKey}/styles`, token);
    if (status === 403) return res.status(403).json({ error: 'Invalid Figma token or insufficient permissions' });
    if (status === 404) return res.status(404).json({ error: 'Figma file not found — check the file key' });
    if (status < 200 || status >= 300) return res.status(502).json({ error: `Figma API responded with ${status}` });

    const styles = body?.meta?.styles ?? [];

    // Collect node IDs for FILL (color) and TEXT styles
    const colorNodeIds = styles.filter(s => s.style_type === 'FILL').map(s => s.node_id);
    const textNodeIds  = styles.filter(s => s.style_type === 'TEXT').map(s => s.node_id);
    const allNodeIds   = [...colorNodeIds, ...textNodeIds].slice(0, 100); // cap at 100

    if (allNodeIds.length === 0) {
      return res.json({ colors: [], typography: [], rawStyleCount: styles.length });
    }

    // Fetch the actual node data to get fill colors and font properties
    const nodeParam = allNodeIds.join(',');
    const { status: ns, body: nb } = await figmaRequest(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeParam)}`,
      token,
    );
    if (ns < 200 || ns >= 300) return res.status(502).json({ error: `Figma nodes API responded with ${ns}` });

    const nodes = nb?.nodes ?? {};

    const colors = [];
    const typography = [];

    for (const style of styles) {
      const node = nodes[style.node_id]?.document;
      if (!node) continue;

      if (style.style_type === 'FILL') {
        const fill = node.fills?.[0];
        if (fill?.type === 'SOLID' && fill.color) {
          const { r, g, b, a = 1 } = fill.color;
          const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
          const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          colors.push({ name: style.name, hex, opacity: Math.round(a * 100) });
        }
      } else if (style.style_type === 'TEXT') {
        const ts = node.style ?? {};
        typography.push({
          name: style.name,
          fontFamily: ts.fontFamily ?? '',
          fontSize: ts.fontSize ?? null,
          fontWeight: ts.fontWeight ?? null,
          lineHeight: ts.lineHeightPx ?? null,
          letterSpacing: ts.letterSpacing ?? null,
        });
      }
    }

    return res.json({ colors, typography, rawStyleCount: styles.length });
  } catch (err) {
    console.error('figma/styles error:', err.message);
    return res.status(502).json({ error: `Figma request failed: ${err.message}` });
  }
});

// ── GitHub integration ─────────────────────────────────────────────────────────
// Server-side because the GitHub REST API does not send CORS headers that allow
// browser-based requests with an Authorization header from arbitrary origins.
function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {
      'User-Agent': 'AgenticSDLC/1.0',
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (payload) headers['Content-Type'] = 'application/json';

    const req = https.request(
      {
        hostname: 'api.github.com',
        port: 443,
        path,
        method,
        headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = null; }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// POST /api/github/test — verify a PAT can read the given repo
app.post('/api/github/test', checkToken, async (req, res) => {
  const { token, owner, repo } = req.body ?? {};
  if (!token || !owner || !repo)
    return res.status(400).json({ error: 'token, owner, and repo are required' });

  try {
    const { status, body } = await githubRequest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
    if (status === 200) {
      return res.json({ ok: true, message: `Connected to ${body.full_name}${body.private ? ' (private)' : ''}.` });
    }
    if (status === 404) {
      return res.json({ ok: false, message: `Repository ${owner}/${repo} not found, or the token doesn't have access to it.` });
    }
    if (status === 401) {
      return res.json({ ok: false, message: 'Invalid or expired token.' });
    }
    return res.json({ ok: false, message: `GitHub responded with HTTP ${status}.` });
  } catch (err) {
    console.error('github/test error:', err.message);
    return res.status(502).json({ error: `Failed to reach GitHub: ${err.message}` });
  }
});

// POST /api/github/issues — create one or more issues in a repo
app.post('/api/github/issues', checkToken, async (req, res) => {
  const { token, owner, repo, issues } = req.body ?? {};
  if (!token || !owner || !repo || !Array.isArray(issues) || issues.length === 0)
    return res.status(400).json({ error: 'token, owner, repo, and a non-empty issues array are required' });
  if (issues.length > 50)
    return res.status(400).json({ error: 'Cannot create more than 50 issues in one request.' });

  const results = [];
  for (const issue of issues) {
    const { title, body, labels } = issue ?? {};
    if (!title || typeof title !== 'string') {
      results.push({ title: title ?? '(missing)', ok: false, error: 'Missing title' });
      continue;
    }
    try {
      const payload = { title, body: body ?? '' };
      if (Array.isArray(labels) && labels.length) payload.labels = labels;
      const { status, body: respBody } = await githubRequest(
        'POST',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        token,
        payload,
      );
      if (status === 201) {
        results.push({ title, ok: true, number: respBody.number, url: respBody.html_url });
      } else {
        results.push({ title, ok: false, error: respBody?.message ?? `HTTP ${status}` });
      }
    } catch (err) {
      results.push({ title, ok: false, error: err.message });
    }
  }

  const created = results.filter((r) => r.ok).length;
  return res.json({ created, total: issues.length, results });
});

// ── Settings (read backend .env) ─────────────────────────────────────────────
app.get('/api/settings', checkToken, requireAdmin, (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../.env');

  try {
    const lines = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, 'utf8').split('\n')
      : [];

    function readKey(key) {
      const line = lines.find((l) => l.startsWith(key + '='));
      return line ? line.slice(key.length + 1).trim() : '';
    }

    const openaiApiKey     = readKey('OPENAI_API_KEY');
    const openaiModel      = readKey('OPENAI_MODEL');
    const proxyToken       = readKey('PROXY_TOKEN');
    const anthropicApiKey  = readKey('ANTHROPIC_API_KEY');
    const anthropicModel   = readKey('ANTHROPIC_MODEL');
    const anthropicEnabled = readKey('ANTHROPIC_ENABLED');
    const defaultLlmProvider = readKey('DEFAULT_LLM_PROVIDER');
    const agentProviderMapRaw = readKey('AGENT_PROVIDER_MAP');
    const gmailUser        = readKey('GMAIL_USER');
    const gmailAppPassword = readKey('GMAIL_APP_PASSWORD');
    const appUrl           = readKey('APP_URL');

    let agentProviderMap = {};
    try { agentProviderMap = agentProviderMapRaw ? JSON.parse(agentProviderMapRaw) : {}; } catch (_) {}

    return res.json({
      openaiApiKey:      openaiApiKey  ? '***' : '',          // never expose raw keys
      anthropicApiKey:   anthropicApiKey ? '***' : '',
      proxyToken:        proxyToken    ? '***' : '',
      openaiModel:       openaiModel   || 'gpt-4o',
      anthropicModel:    anthropicModel || 'claude-opus-4-5',
      anthropicEnabled:  anthropicEnabled === 'true',
      defaultLlmProvider: defaultLlmProvider || 'openai',
      agentProviderMap,
      hasOpenaiKey:      !!openaiApiKey,
      hasAnthropicKey:   !!anthropicApiKey,
      hasProxyToken:     !!proxyToken,
      hasGmailAppPassword: !!gmailAppPassword,               // never expose raw app password
      gmailUser,
      appUrl,
    });
  } catch (err) {
    console.error('Settings read error:', err.message);
    return res.status(500).json({ error: 'Failed to read settings: ' + err.message });
  }
});

// ── Settings (write backend .env) ─────────────────────────────────────────────
// Values are written verbatim into a `KEY=value` line in backend/.env. Without
// validation, a value containing a newline lets the caller inject arbitrary
// extra lines into the file (e.g. a second KEY=VALUE pair, or content that
// comments out an existing line) — a CRLF/env-injection vector. Reject any
// field containing \r or \n before writing anything, and lock down the file's
// permissions afterward since it holds plaintext API keys.
function rejectsEnvInjection(value) {
  return typeof value === 'string' && /[\r\n]/.test(value);
}

app.post('/api/settings', checkToken, requireAdmin, (req, res) => {
  const {
    openaiApiKey, proxyToken, openaiModel,
    anthropicApiKey, anthropicModel, anthropicEnabled,
    defaultLlmProvider, agentProviderMap,
    gmailUser, gmailAppPassword, appUrl,
  } = req.body ?? {};
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../.env');

  const stringFields = {
    openaiApiKey, proxyToken, openaiModel,
    anthropicApiKey, anthropicModel,
    defaultLlmProvider, gmailUser, gmailAppPassword, appUrl,
  };
  for (const [field, value] of Object.entries(stringFields)) {
    if (rejectsEnvInjection(value)) {
      return res.status(400).json({ error: `${field} cannot contain newline characters` });
    }
  }
  if (agentProviderMap !== undefined && rejectsEnvInjection(JSON.stringify(agentProviderMap))) {
    return res.status(400).json({ error: 'agentProviderMap cannot contain newline characters' });
  }

  try {
    let lines = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, 'utf8').split('\n');
    }

    function upsert(arr, key, value) {
      if (value === undefined || value === null || value === '') return arr;
      const idx = arr.findIndex((l) => l.startsWith(key + '='));
      const line = key + '=' + value;
      if (idx >= 0) arr[idx] = line;
      else arr.push(line);
      return arr;
    }

    // upsertFlag writes even when value is false/empty string — used for
    // booleans and fields that need an explicit "off"/cleared state.
    function upsertFlag(arr, key, value) {
      const idx = arr.findIndex((l) => l.startsWith(key + '='));
      const line = key + '=' + value;
      if (idx >= 0) arr[idx] = line;
      else arr.push(line);
      return arr;
    }

    if (openaiApiKey) upsert(lines, 'OPENAI_API_KEY', openaiApiKey);
    if (proxyToken)   upsert(lines, 'PROXY_TOKEN', proxyToken);
    if (openaiModel)  upsert(lines, 'OPENAI_MODEL', openaiModel);

    if (anthropicApiKey)            upsert(lines, 'ANTHROPIC_API_KEY', anthropicApiKey);
    if (anthropicModel)             upsert(lines, 'ANTHROPIC_MODEL', anthropicModel);
    if (anthropicEnabled !== undefined) upsertFlag(lines, 'ANTHROPIC_ENABLED', anthropicEnabled ? 'true' : 'false');
    if (defaultLlmProvider)         upsert(lines, 'DEFAULT_LLM_PROVIDER', defaultLlmProvider);
    if (agentProviderMap)           upsertFlag(lines, 'AGENT_PROVIDER_MAP', JSON.stringify(agentProviderMap));

    // Email / invite settings
    // Google's UI displays the app password as space-separated groups; strip
    // whitespace on save so a direct copy-paste of that format still works
    // (SMTP auth fails on the literal spaces otherwise — 535-5.7.8 BadCredentials).
    if (gmailUser)         upsert(lines, 'GMAIL_USER', gmailUser.trim());
    if (gmailAppPassword)  upsert(lines, 'GMAIL_APP_PASSWORD', gmailAppPassword.replace(/\s+/g, ''));
    if (appUrl)            upsert(lines, 'APP_URL', appUrl);

    fs.writeFileSync(envPath, lines.filter((l) => l.trim()).join('\n') + '\n', 'utf8');
    // Lock the file to owner read/write only — it holds plaintext API keys.
    // Best-effort: chmod isn't meaningful on all platforms (e.g. Windows),
    // so failures here shouldn't block the save.
    try { fs.chmodSync(envPath, 0o600); } catch { /* not supported on this platform/fs */ }
    return res.json({ ok: true, message: 'Settings saved. Restart the backend for changes to take effect.' });
  } catch (err) {
    console.error('Settings write error:', err.message);
    return res.status(500).json({ error: 'Failed to write settings: ' + err.message });
  }
});

// NOTE: reads are intentionally admin-agnostic (checkToken only, no requireAdmin).
// App-level config here includes values meant to be read by any authenticated user
// during normal flows (e.g. app:domainKnowledgeDefaults, read by every user in
// NewProjectModal when creating a project) — only *writing* config is an admin
// action (see PUT/POST /batch/DELETE below, which still require requireAdmin).
app.get('/api/app-state/config', checkToken, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const keys = typeof req.query.keys === 'string'
    ? req.query.keys.split(',').map((key) => normalizeConfigKey(key)).filter(Boolean)
    : null;
  const values = await dbGetAppConfigMap(keys);
  return res.json({ values });
});

app.get('/api/app-state/config/:key', checkToken, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const key = normalizeConfigKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'key is required' });
  const values = await dbGetAppConfigMap([key]);
  return res.json({ key, value: values[key] ?? null });
});

app.put('/api/app-state/config/:key', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const key = normalizeConfigKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'key is required' });
  await dbSetAppConfigValue(key, req.body?.value ?? null);
  return res.json({ ok: true });
});

app.post('/api/app-state/config/batch', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ error: 'values must be an object' });
  }
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = normalizeConfigKey(key);
    if (!normalizedKey) continue;
    await dbSetAppConfigValue(normalizedKey, value);
  }
  return res.json({ ok: true });
});

app.delete('/api/app-state/config', checkToken, requireAdmin, async (_req, res) => {
  if (!await requireAppStateDb(res)) return;
  await dbDeleteAllAppConfig();
  return res.json({ ok: true });
});

app.get('/api/app-state/integrations', checkToken, requireAdmin, async (_req, res) => {
  if (!await requireAppStateDb(res)) return;
  const items = await dbListIntegrations();
  return res.json({ items });
});

app.get('/api/app-state/integrations/:id', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const item = await dbGetIntegration(req.params.id);
  if (!item) return res.status(404).json({ error: 'Integration not found.' });
  return res.json(item);
});

app.put('/api/app-state/integrations/:id', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const payload = req.body ?? {};
  const record = {
    id: req.params.id,
    provider: payload.provider,
    label: payload.label,
    encryptedData: payload.encryptedData,
    iv: payload.iv,
    createdAt: payload.createdAt ?? Date.now(),
  };
  if (!record.id || !record.provider || !record.label || !record.encryptedData || !record.iv) {
    return res.status(400).json({ error: 'id, provider, label, encryptedData, and iv are required.' });
  }
  await dbSaveIntegration(record);
  return res.json({ ok: true, id: record.id });
});

app.delete('/api/app-state/integrations/:id', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  await dbDeleteIntegration(req.params.id);
  return res.json({ ok: true });
});

app.get('/api/app-state/backlog-items', checkToken, requireAdmin, async (_req, res) => {
  if (!await requireAppStateDb(res)) return;
  const items = await dbListBacklogItems();
  return res.json({ items });
});

app.post('/api/app-state/backlog-items', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const item = req.body ?? {};
  if (!item.id || !item.title || !item.category || !item.priority || !item.status || !item.source) {
    return res.status(400).json({ error: 'id, title, category, priority, status, and source are required.' });
  }
  await dbCreateBacklogItem(item);
  return res.json({ ok: true, id: item.id });
});

app.patch('/api/app-state/backlog-items/:id', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  const item = await dbUpdateBacklogItem(req.params.id, req.body ?? {});
  if (!item) return res.status(404).json({ error: 'Backlog item not found.' });
  return res.json({ ok: true, item });
});

app.delete('/api/app-state/backlog-items/:id', checkToken, requireAdmin, async (req, res) => {
  if (!await requireAppStateDb(res)) return;
  await dbDeleteBacklogItem(req.params.id);
  return res.json({ ok: true });
});

// ── POST /api/admin/reset-application-data ────────────────────────────────
// Wipes ALL application/user data back to a clean slate — every project,
// team member, agent run/job, memory record, action proposal, rollback
// entry, and invite record. Used by the admin panel's "Reset Application
// Data" button to reset a demo/test environment without a fresh DB.
//
// Master reference data (master_phases, master_agents, master_domains,
// master_role_templates, etc. -- anything seeded by
// scripts/seedMasterData.js) is NEVER touched by this endpoint. None of
// the tables listed below are master_* tables, and master_* tables are
// only ever REFERENCED BY these tables, never the reverse -- so
// TRUNCATE ... CASCADE here cannot cascade backward into master data even
// if a future migration adds more application tables that reference these.
//
// Admin-only (requireAdmin), AND requires an explicit confirmation string
// in the body — not just admin auth — since this is a fully destructive,
// irreversible action with no soft-delete/undo path.
const APPLICATION_DATA_TABLES = [
  'agent_runs',
  'agent_jobs',
  'memory_records',
  'action_proposals',
  'rollback_log',
  'invite_log',
  'invite_sessions',
  'team_members',
  'projects',
];

app.post('/api/admin/reset-application-data', checkToken, requireAdmin, async (req, res) => {
  if (!dbPool) return res.status(503).json({ error: 'Database is unavailable.' });

  const { confirm } = req.body ?? {};
  if (confirm !== 'RESET') {
    return res.status(400).json({
      error:
        'Confirmation required. Send { "confirm": "RESET" } to proceed. This permanently deletes ' +
        'all projects, team members, agent runs/jobs, and invite data. Master reference data ' +
        '(domains, phases, agents, role templates) is not affected.',
    });
  }

  try {
    // Make sure invite_sessions exists before truncating it -- it's created
    // lazily on first invite-accept, so a fresh/unused environment may not
    // have it yet.
    await ensureInviteSessionTable().catch(() => {});
    await dbPool.query(`TRUNCATE TABLE ${APPLICATION_DATA_TABLES.join(', ')} CASCADE`);
    const performedBy = req.authUser?.email ?? '(admin-bypass)';
    console.log(`[admin/reset-application-data] reset by ${performedBy} — tables: ${APPLICATION_DATA_TABLES.join(', ')}`);
    return res.json({ ok: true, tablesReset: APPLICATION_DATA_TABLES });
  } catch (err) {
    console.error('[admin/reset-application-data] failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Reset failed: ' + (err?.message ?? String(err)) });
  }
});

// Public, read-only bootstrap endpoint.
// The frontend needs this before any sign-in flow completes so it can render
// the app shell, labels, domains, phases, and role templates.
app.get('/api/master-data/catalog', async (_req, res) => {
  try {
    const catalog = await dbGetMasterCatalog();
    return res.json(catalog ?? {});
  } catch (err) {
    console.error('Master catalog query failed:', err.message);
    return res.status(500).json({ error: 'Master data catalog is unavailable.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INVITE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
// In-memory store for invites (persistent via Postgres when DB is available).
// Falls back to in-memory map when POSTGRES_URL is not set — suitable for
// Railway/Render free-tier deployments where the DB is optional at first.

const { Pool } = require('pg');
const { randomUUID, createHash } = require('crypto');

// Gmail SMTP client (optional — set GMAIL_USER + GMAIL_APP_PASSWORD to enable real emails)
// GMAIL_APP_PASSWORD is a 16-character Google App Password, not the account password —
// generate one at https://myaccount.google.com/apppasswords (requires 2-Step Verification).
// Google displays it as 4 space-separated groups (e.g. "abcd efgh ijkl mnop") for
// readability, but the actual credential is those 16 characters with no spaces —
// stripping whitespace here means a copy-paste of the on-screen format still works.
const GMAIL_USER         = (process.env.GMAIL_USER ?? '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '');

let _gmailTransporter = null;
function getGmailTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!_gmailTransporter) {
    _gmailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return _gmailTransporter;
}
const APP_URL          = process.env.APP_URL ?? 'http://localhost:5173';
const INVITABLE_APP_ROLES = ['editor', 'reviewer', 'viewer'];
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Rank used to enforce "a Project Owner cannot assign a role higher than
// their own permission" — project_owner is already excluded from
// INVITABLE_APP_ROLES entirely, but this is kept as an explicit,
// spec-literal guard (and future-proofs the check if that ever changes).
const APP_ROLE_RANK = { viewer: 0, reviewer: 1, editor: 2, project_owner: 3 };
function appRoleRank(role) {
  return Object.prototype.hasOwnProperty.call(APP_ROLE_RANK, role) ? APP_ROLE_RANK[role] : -1;
}

// Invite tokens are never stored in plaintext. The raw token is generated,
// returned to the caller exactly once (API response / share link), and only
// its SHA-256 hash is persisted (team_members.invite_token_hash, and the
// in-memory fallback store's key). Lookups on accept/validate/revoke hash
// the client-supplied token and compare against the stored hash — the raw
// token itself is never round-tripped through the database.
function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// A pending invite is expired once its TTL has elapsed, derived from
// invited_at rather than a separate stored expiry column (one less field to
// keep in sync). Centralised here so every accept/validate/list call site
// uses the exact same rule.
function isInviteExpired(invitedAtMsOrDate) {
  if (!invitedAtMsOrDate) return true;
  const invitedAtMs = invitedAtMsOrDate instanceof Date ? invitedAtMsOrDate.getTime() : new Date(invitedAtMsOrDate).getTime();
  if (Number.isNaN(invitedAtMs)) return true;
  return Date.now() - invitedAtMs > INVITE_TOKEN_TTL_MS;
}

// In-memory fallback when Postgres is unavailable
const inviteStore = new Map();

function resolveDbConnectionString() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.POSTGRES_URL_PRODUCTION || process.env.POSTGRES_URL || null;
  }
  return process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL || null;
}

const dbConnectionString = resolveDbConnectionString();

// M-NEW-03 fix: warn loudly at startup if invite tokens will not be persisted.
// A Railway restart (deploy, OOM, health-check failure) will silently drop all
// pending invites when running without a database.
if (!dbConnectionString) {
  console.warn(
    '[WARN] No Postgres connection string is configured — invite tokens are stored in-memory only.\n' +
    '       All pending invites will be lost if the backend process restarts.\n' +
    '       Set POSTGRES_URL_LOCAL for local development and POSTGRES_URL_PRODUCTION for production.'
  );
} // token -> { projectId, projectName, email, name, appRole, invitedBy, invitedAt, acceptedAt }

// Stricter rate limit for invite sends specifically — the general /api 120/min
// limiter is far too loose for an action that triggers an outbound email and
// could otherwise be used to spam arbitrary addresses or enumerate emails.
// 5 invites per 15 minutes per IP.
//
// NODE_ENV=test gets a much higher ceiling: the integration test suite
// (proxy.inviteFlow.integration.test.ts) runs many /api/invite/send calls
// against a single long-lived server instance in one Jest file, all from the
// same loopback IP, so the production limit of 5 was being hit partway
// through the suite and made unrelated later tests fail with a rate-limit
// response instead of a real invite -- not a bug in those tests, just this
// limiter not accounting for the test environment.
const inviteSendRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite requests from this IP. Please try again in a few minutes.' },
});

// ── DB helpers (no-op if no Postgres connection string is set) ─────────────
let dbPool = null;
let appStateReady = null;
let inviteSessionReady = null;
if (dbConnectionString) {
  try {
    dbPool = new Pool({ connectionString: dbConnectionString });
    dbPool.query('SELECT 1').then(async () => {
      console.log('Invite system: DB connected');
      await ensureAppStateTables().catch((err) => {
        console.error('App state schema init failed:', err.message);
      });
    }).catch(() => {
      console.warn('Invite system: DB connection failed, using in-memory store');
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
    })().catch((err) => {
      appStateReady = null;
      throw err;
    });
  }
  await appStateReady;
}

async function ensureInviteSessionTable() {
  if (!dbPool) return;
  if (!inviteSessionReady) {
    inviteSessionReady = (async () => {
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS invite_sessions (
          token TEXT PRIMARY KEY,
          member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          app_role app_role NOT NULL,
          name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ
        )
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_invite_sessions_member_id
        ON invite_sessions(member_id)
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_invite_sessions_project_id
        ON invite_sessions(project_id)
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_invite_sessions_expires_at
        ON invite_sessions(expires_at)
      `);
    })().catch((err) => {
      inviteSessionReady = null;
      throw err;
    });
  }
  await inviteSessionReady;
}

async function requireAppStateDb(res) {
  if (!dbPool) {
    return true;
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

function normalizeConfigKey(key) {
  return typeof key === 'string' ? key.trim() : '';
}

async function dbGetAppConfigMap(keys = null) {
  if (!dbPool) {
    return await appStateStore.getAppConfigMap(keys);
  }
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

async function dbSetAppConfigValue(key, value) {
  if (!dbPool) {
    await appStateStore.setAppConfigValue(key, value);
    return;
  }
  await dbPool.query(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
  `, [key, JSON.stringify(value)]);
}

async function dbDeleteAllAppConfig() {
  if (!dbPool) {
    await appStateStore.deleteAllAppConfig();
    return;
  }
  await dbPool.query(`DELETE FROM app_config`);
}

async function dbListIntegrations() {
  if (!dbPool) return await appStateStore.listIntegrations();
  const { rows } = await dbPool.query(`
    SELECT id, provider, label, encrypted_data, iv, created_at
    FROM app_integrations
    ORDER BY created_at ASC
  `);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    encryptedData: row.encrypted_data,
    iv: row.iv,
    createdAt: Number(row.created_at),
  }));
}

async function dbGetIntegration(id) {
  if (!dbPool) return await appStateStore.getIntegration(id);
  const { rows } = await dbPool.query(`
    SELECT id, provider, label, encrypted_data, iv, created_at
    FROM app_integrations
    WHERE id = $1
    LIMIT 1
  `, [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    encryptedData: row.encrypted_data,
    iv: row.iv,
    createdAt: Number(row.created_at),
  };
}

async function dbSaveIntegration(record) {
  if (!dbPool) {
    await appStateStore.saveIntegration(record);
    return;
  }
  await dbPool.query(`
    INSERT INTO app_integrations (id, provider, label, encrypted_data, iv, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE
      SET provider = EXCLUDED.provider,
          label = EXCLUDED.label,
          encrypted_data = EXCLUDED.encrypted_data,
          iv = EXCLUDED.iv,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
  `, [
    record.id,
    record.provider,
    record.label,
    record.encryptedData,
    record.iv,
    Number(record.createdAt ?? Date.now()),
    Date.now(),
  ]);
}

async function dbDeleteIntegration(id) {
  if (!dbPool) {
    await appStateStore.deleteIntegration(id);
    return;
  }
  await dbPool.query(`DELETE FROM app_integrations WHERE id = $1`, [id]);
}

async function dbListBacklogItems() {
  if (!dbPool) return await appStateStore.listBacklogItems();
  const { rows } = await dbPool.query(`
    SELECT id, title, description, category, priority, status, source, notes, created_at, updated_at
    FROM admin_backlog_items
    ORDER BY created_at ASC
  `);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    source: row.source,
    notes: row.notes ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

async function dbCreateBacklogItem(item) {
  if (!dbPool) {
    await appStateStore.createBacklogItem(item);
    return;
  }
  await dbPool.query(`
    INSERT INTO admin_backlog_items (
      id, title, description, category, priority, status, source, notes, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    item.id,
    item.title,
    item.description ?? '',
    item.category,
    item.priority,
    item.status,
    item.source,
    item.notes ?? null,
    Number(item.createdAt ?? Date.now()),
    Number(item.updatedAt ?? Date.now()),
  ]);
}

async function dbUpdateBacklogItem(id, patch) {
  if (!dbPool) return await appStateStore.updateBacklogItem(id, patch);
  const current = await dbPool.query(`
    SELECT id, title, description, category, priority, status, source, notes, created_at, updated_at
    FROM admin_backlog_items
    WHERE id = $1
    LIMIT 1
  `, [id]);
  if (!current.rows[0]) return null;
  const row = current.rows[0];
  const next = {
    title: patch.title ?? row.title,
    description: patch.description ?? row.description,
    category: patch.category ?? row.category,
    priority: patch.priority ?? row.priority,
    status: patch.status ?? row.status,
    source: patch.source ?? row.source,
    notes: patch.notes === undefined ? row.notes : patch.notes,
    createdAt: Number(row.created_at),
    updatedAt: Number(patch.updatedAt ?? Date.now()),
  };
  await dbPool.query(`
    UPDATE admin_backlog_items
    SET title = $2,
        description = $3,
        category = $4,
        priority = $5,
        status = $6,
        source = $7,
        notes = $8,
        updated_at = $9
    WHERE id = $1
  `, [
    id,
    next.title,
    next.description,
    next.category,
    next.priority,
    next.status,
    next.source,
    next.notes ?? null,
    next.updatedAt,
  ]);
  return { id, ...next };
}

async function dbDeleteBacklogItem(id) {
  if (!dbPool) {
    await appStateStore.deleteBacklogItem(id);
    return;
  }
  await dbPool.query(`DELETE FROM admin_backlog_items WHERE id = $1`, [id]);
}

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

// Returns { ok: true, callerEmail, callerRole } when the caller may
// create/revoke/view invites for projectId, or writes the appropriate
// 401/403 response and returns { ok: false }. Pass requestedAppRole only for
// the "create" action so the Project-Owner role-ceiling check runs.
async function authorizeInviteAction(req, res, { projectId, action, requestedAppRole }) {
  if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
    return { ok: true, callerEmail: null, callerRole: 'admin' };
  }

  const callerEmail = req.authUser?.email ?? null;
  if (!callerEmail) {
    res.status(401).json({ error: 'Please sign in to manage invites for this project.' });
    return { ok: false };
  }

  if (isConfiguredAdminEmail(callerEmail)) {
    return { ok: true, callerEmail, callerRole: 'admin' };
  }

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required.' });
    return { ok: false };
  }

  const callerAppRole = await getCallerAppRoleForProject(projectId, callerEmail);
  if (callerAppRole !== 'project_owner') {
    await logInviteEvent({ projectId, teamMemberId: null, action: `${action}_denied`, performedBy: callerEmail }).catch(() => {});
    res.status(403).json({ error: 'Only the project owner or an app admin can manage invites for this project.' });
    return { ok: false };
  }

  if (requestedAppRole && appRoleRank(requestedAppRole) >= appRoleRank('project_owner')) {
    res.status(403).json({ error: 'Project Owner cannot grant a role equal to or higher than their own.' });
    return { ok: false };
  }

  return { ok: true, callerEmail, callerRole: 'project_owner' };
}

// Best-effort audit trail — never blocks the actual invite operation if
// logging fails (e.g. DB unavailable). teamMemberId may be null for
// create-denied events (no team_members row exists yet to attach to) — those
// are logged to the console instead since invite_log.team_member_id is NOT NULL.
async function logInviteEvent({ projectId, teamMemberId, action, performedBy }) {
  if (!dbPool || !projectId) return;
  if (!teamMemberId) {
    console.log(`[invite audit] project=${projectId} action=${action} by=${performedBy ?? 'unknown'} (no team_member row — logged to console only)`);
    return;
  }
  await dbPool.query(`
    INSERT INTO invite_log (project_id, team_member_id, action, performed_by)
    VALUES ($1, $2, $3, $4)
  `, [projectId, teamMemberId, action, performedBy ?? null]);
}

async function dbUpsertMember({ projectId, name, email, appRole, inviteTokenHash }) {
  if (!dbPool) return null;
  // NOTE: `role` (legacy user_role enum: 'admin' | 'product_owner') and
  // `app_role` (fine-grained RBAC enum: 'project_owner' | 'editor' | 'reviewer' | 'viewer')
  // are two different columns with two different enum types. This used to bind
  // appRole (e.g. 'editor') into BOTH columns, which fails with
  // "invalid input value for enum user_role" for any appRole that isn't
  // 'admin'/'product_owner' -- i.e. almost every real invite. `role` is left
  // out of the INSERT entirely so it takes its schema default
  // ('product_owner') and is left untouched on conflict.
  const { rows } = await dbPool.query(`
    INSERT INTO team_members (project_id, name, email, app_role, invite_token, invite_token_hash, invite_status, invited_at)
    VALUES ($1, $2, $3, $4, NULL, $5, 'pending', NOW())
    ON CONFLICT (project_id, email) DO UPDATE
      SET app_role = $4, invite_token = NULL, invite_token_hash = $5, invite_status = 'pending', invited_at = NOW(), accepted_at = NULL
    RETURNING id
  `, [projectId, name, email, appRole, inviteTokenHash]);
  return rows[0]?.id ?? null;
}

async function dbAcceptInvite(token, email) {
  if (!dbPool) return null;
  await ensureInviteSessionTable();
  const tokenHash = hashInviteToken(token);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // Look up by hash (current, secure path). The raw invite_token fallback
    // exists only for rows created before invite_token_hash existed — never
    // written for new invites (see dbUpsertMember).
    const pendingRes = await client.query(`
      SELECT tm.id, tm.project_id, tm.name, tm.email, tm.app_role
      FROM team_members tm
      WHERE (tm.invite_token_hash = $1 OR tm.invite_token = $2)
        AND lower(tm.email) = lower($3)
        AND tm.invite_status = 'pending'
      LIMIT 1
      FOR UPDATE
    `, [tokenHash, token, email]);

    const pending = pendingRes.rows[0];
    if (!pending) {
      await client.query('ROLLBACK');
      return null;
    }

    // Defense-in-depth: reject if the stored role somehow isn't one of the
    // roles invite links are allowed to grant (rule: "invite role is valid").
    if (!INVITABLE_APP_ROLES.includes(pending.app_role)) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Invite has an invalid role and cannot be accepted.'), { code: 'INVALID_ROLE' });
    }

    await client.query(`
      UPDATE team_members
      SET invite_status = 'accepted',
          accepted_at = COALESCE(accepted_at, NOW()),
          invite_token = NULL,
          invite_token_hash = NULL
      WHERE id = $1
    `, [pending.id]);

    await client.query(`
      INSERT INTO invite_log (project_id, team_member_id, action, performed_by)
      VALUES ($1, $2, 'accepted', $3)
    `, [pending.project_id, pending.id, email]);

    await client.query(`
      UPDATE invite_sessions
      SET revoked_at = NOW()
      WHERE member_id = $1 AND revoked_at IS NULL
    `, [pending.id]);

    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_SESSION_TTL_MS);
    await client.query(`
      INSERT INTO invite_sessions (token, member_id, project_id, email, app_role, name, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [sessionToken, pending.id, pending.project_id, pending.email, pending.app_role, pending.name ?? null, expiresAt.toISOString()]);

    const projectRow = await client.query(`SELECT name FROM projects WHERE id = $1`, [pending.project_id]);
    await client.query('COMMIT');
    return {
      ...pending,
      access_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      project_name: projectRow.rows?.[0]?.name ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function dbGetTeam(projectId) {
  if (!dbPool) return null;
  const { rows } = await dbPool.query(`
    SELECT id, name, email, role, app_role, invite_status, invited_at, accepted_at
    FROM team_members WHERE project_id = $1 ORDER BY invited_at ASC
  `, [projectId]);
  return rows;
}

// Resolves a raw client-supplied token to its team_members row (by hash,
// falling back to legacy raw-token rows) without mutating anything — used to
// authorize an action (revoke) against the invite's project before doing it.
async function dbFindInviteByToken(token) {
  if (!dbPool) return null;
  const tokenHash = hashInviteToken(token);
  const { rows } = await dbPool.query(`
    SELECT id, project_id, email, app_role, invite_status
    FROM team_members
    WHERE invite_token_hash = $1 OR invite_token = $2
    LIMIT 1
  `, [tokenHash, token]).catch(() => ({ rows: [] }));
  return rows[0] ?? null;
}

async function dbRevokeInvite(token, performedBy) {
  if (!dbPool) return;
  await ensureInviteSessionTable().catch(() => {});
  const tokenHash = hashInviteToken(token);
  // NOTE: invite_token_hash is deliberately KEPT (not nulled) on revoke.
  // It's a one-way SHA-256 hash, not the secret itself, so retaining it isn't
  // a security risk -- and /api/invite/validate needs it to still find this
  // row so it can report a clean "this invite is no longer valid" (409)
  // instead of a bare "not found" (404) once invite_status = 'revoked'.
  // invite_token (the legacy raw-token column) is still cleared since new
  // invites never populate it in the first place.
  const { rows } = await dbPool.query(`
    UPDATE team_members
    SET invite_status = 'revoked', invite_token = NULL
    WHERE invite_token_hash = $1 OR invite_token = $2
    RETURNING id, project_id
  `, [tokenHash, token]);
  await dbPool.query(`
    UPDATE invite_sessions
    SET revoked_at = NOW()
    WHERE token = $1 AND revoked_at IS NULL
  `, [token]).catch(() => {});
  const revoked = rows[0];
  if (revoked) {
    await logInviteEvent({ projectId: revoked.project_id, teamMemberId: revoked.id, action: 'revoked', performedBy }).catch(() => {});
  }
  return revoked ?? null;
}

async function dbSyncAcceptedMemberInProjectData(projectId, email, acceptedAtMs) {
  if (!dbPool) return;
  await dbPool.query(`
    UPDATE projects
    SET data = jsonb_set(
      COALESCE(data, '{}'::jsonb),
      '{teamMembers}',
      COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN lower(COALESCE(member->>'email', '')) = lower($2)
              THEN jsonb_set(
                jsonb_set(member, '{inviteStatus}', '"accepted"'::jsonb, true),
                '{acceptedAt}',
                to_jsonb($3::bigint),
                true
              )
            ELSE member
          END
        )
        FROM jsonb_array_elements(COALESCE(data->'teamMembers', '[]'::jsonb)) AS member
      ), '[]'::jsonb),
      true
    ),
    updated_at = NOW()
    WHERE id = $1
  `, [projectId, email, acceptedAtMs]).catch(() => {});
}

async function dbGetInviteSession(token) {
  if (!dbPool) return null;
  await ensureInviteSessionTable();
  const { rows } = await dbPool.query(`
    SELECT s.token, s.project_id, s.name, s.email, s.app_role, s.expires_at, tm.invite_status
    FROM invite_sessions s
    JOIN team_members tm ON tm.id = s.member_id
    WHERE s.token = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
    LIMIT 1
  `, [token]);
  const row = rows[0];
  if (!row || row.invite_status !== 'accepted') return null;
  return row;
}

// ── Email sender (Gmail SMTP) ─────────────────────────────────────────────────
// Resend (https://resend.com) — an HTTPS email API, not SMTP. Preferred over
// Gmail because Railway blocks outbound SMTP (ports 465/587) on Free/Trial/
// Hobby plans (only Pro+ has it unblocked), which is exactly what produced
// the "Connection timeout" errors nodemailer/Gmail was hitting in production.
// An HTTPS POST to api.resend.com goes out over normal outbound HTTP, which
// Railway never blocks, so this works on any plan.
// Returns null (not an error) when RESEND_API_KEY isn't set, so the caller
// can fall through to the next option; returns {ok, error?} once it actually
// attempts a send.
async function sendViaResend({ to, subject, html }) {
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return null;

  // resend.dev's shared sending domain works for any recipient without
  // verifying your own domain first — good enough until a custom domain is
  // verified in the Resend dashboard. Override with RESEND_FROM_EMAIL once
  // you've verified your own domain there.
  const from = (process.env.RESEND_FROM_EMAIL ?? '').trim() || 'Agentic SDLC <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, data: null, error: body?.message || `Resend API returned ${res.status}` };
    }
    return { ok: true, data: { messageId: body?.id }, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || 'Resend request failed.' };
  }
}

async function sendInviteEmail({ to, name, projectName, appRole, inviteLink, invitedBy, password, isReset = false }) {
  const roleLabel = {
    project_owner: 'Project Owner',
    editor: 'Editor',
    reviewer: 'Reviewer',
    viewer: 'Viewer',
  }[appRole] ?? appRole;

  const passwordBlock = password ? `
      <div style="margin:20px 0;padding:16px 20px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;">
        <p style="margin:0 0 6px;color:#3730a3;font-size:13px;font-weight:600;">Your temporary password</p>
        <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:16px;color:#1e1b4b;letter-spacing:0.02em;">${password}</p>
        <p style="margin:8px 0 0;color:#4338ca;font-size:12px;">You'll be asked to set a new password the first time you sign in.</p>
      </div>` : '';

  const html = isReset ? `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px;">
      <h2 style="color:#2E4057;margin-bottom:8px;">Your password has been reset</h2>
      <p style="color:#444;font-size:15px;">
        <strong>${invitedBy}</strong> reset your password for <strong>${projectName}</strong>
        on the Agentic SDLC Framework.
      </p>
      ${passwordBlock}
      <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Sign In
      </a>
      <p style="color:#999;font-size:12px;">If you were not expecting this, please contact your project owner.</p>
    </div>
  ` : `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px;">
      <h2 style="color:#2E4057;margin-bottom:8px;">You're invited to collaborate</h2>
      <p style="color:#444;font-size:15px;">
        <strong>${invitedBy}</strong> has invited you to join <strong>${projectName}</strong>
        on the Agentic SDLC Framework as a <strong>${roleLabel}</strong>.
      </p>
      <p style="color:#666;font-size:14px;">
        As a <strong>${roleLabel}</strong> you can:
        ${appRole === 'project_owner' ? 'run agents, edit settings, invite team members, and manage the project.' : ''}
        ${appRole === 'editor' ? 'run agents, upload documents, and edit project settings.' : ''}
        ${appRole === 'reviewer' ? 'view all agent outputs and approve review gates.' : ''}
        ${appRole === 'viewer' ? 'view all agent outputs (read-only).' : ''}
      </p>
      ${passwordBlock}
      <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Accept Invitation
      </a>
      <p style="color:#999;font-size:12px;">This link is valid for 7 days. If you were not expecting this invite, you can safely ignore this email.</p>
    </div>
  `;
  const subject = isReset ? `Your password has been reset — ${projectName}` : `You're invited to ${projectName}`;

  // 1. Resend (preferred — HTTPS API, works on any Railway plan)
  const resendResult = await sendViaResend({ to, subject, html });
  if (resendResult) {
    console.log(`[sendInviteEmail] sent via Resend ok=${resendResult.ok}${resendResult.error ? ` error=${resendResult.error}` : ''}`);
    return resendResult;
  }

  // 2. Gmail SMTP (fallback — only works if this Railway service is on a
  // Pro+ plan; Free/Trial/Hobby block outbound SMTP entirely)
  const transporter = getGmailTransporter();
  if (!transporter) {
    // Dev mode — log to console
    console.log(`\n[INVITE LINK - no RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD set]\nTo: ${to}\nLink: ${inviteLink}\n`);
    return { ok: true, dev: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Agentic SDLC" <${GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return { ok: true, data: { messageId: info?.messageId }, error: null };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err?.message || 'Gmail rejected the invite email.',
    };
  }
}

// Resolves the frontend's own base URL for building invite links. The
// frontend and this API are deployed on separate domains (e.g. Vercel +
// Railway), so the Origin header of the browser's own "send invite" request
// is the only reliable signal for the frontend's real URL per environment —
// req.headers.host would give this API's domain instead, which is wrong.
// Falls back to the configured APP_URL only when no Origin header is present
// (e.g. a non-browser/server-to-server caller).
function resolveInviteBaseUrl(req) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (origin) return origin.replace(/\/$/, '');
  return APP_URL.replace(/\/$/, '');
}

// ── POST /api/invite/send ─────────────────────────────────────────────────────
app.post('/api/invite/send', checkToken, inviteSendRateLimit, async (req, res) => {
  const { projectId, projectName, name, email, appRole, invitedBy } = req.body ?? {};

  if (!projectId || !email || !appRole) {
    return res.status(400).json({ error: 'projectId, email, and appRole are required' });
  }
  if (!INVITABLE_APP_ROLES.includes(appRole)) {
    return res.status(400).json({ error: `Invite links can grant only: ${INVITABLE_APP_ROLES.join(', ')}` });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid invite email is required' });
  }

  // Authorization: only an app Admin or this project's Project Owner may
  // create an invite, and a Project Owner cannot grant a role >= their own.
  const auth = await authorizeInviteAction(req, res, { projectId, action: 'create', requestedAppRole: appRole });
  if (!auth.ok) return; // response already sent

  // Provision the invitee's real Supabase Auth account up front, with a
  // generated default password, so they can sign in immediately instead of
  // waiting on a confirmation email. Must happen before any token/DB
  // bookkeeping below — if this fails there's no usable invite to hand out.
  let provisioned;
  try {
    provisioned = await provisionInviteeAccount({ email: normalizedEmail, name, actionDate: new Date() });
  } catch (err) {
    console.error(`[invite/send] provisionInviteeAccount failed: ${err?.message ?? err}`);
    return res.status(502).json({ error: "Could not create the team member's account. Please try again or contact support." });
  }

  const token = randomUUID();          // returned to the caller once — never persisted raw
  const tokenHash = hashInviteToken(token);
  const baseUrl = resolveInviteBaseUrl(req);
  const inviteLink = `${baseUrl}/invite?token=${token}&projectId=${encodeURIComponent(projectId)}&email=${encodeURIComponent(normalizedEmail)}`;

  console.log(
    `[invite/send] request received projectId=${projectId} appRole=${appRole} createdBy=${auth.callerEmail ?? '(admin-bypass)'} ` +
    `emailDomain=${normalizedEmail.split('@')[1] ?? '?'} gmailConfigured=${!!(GMAIL_USER && GMAIL_APP_PASSWORD)}`
  );

  // Store in memory (fallback path) — keyed by hash, matching the DB column,
  // so a tampered/guessed token never matches by construction.
  inviteStore.set(tokenHash, {
    projectId, projectName, email: normalizedEmail, name, appRole,
    invitedBy, invitedAt: Date.now(), acceptedAt: null,
  });

  // Persist to DB if available. Previously swallowed silently — now logged,
  // since a DB write failure here (e.g. no Postgres connection string
  // configured on this service) was indistinguishable from a healthy no-op
  // and made this flow much harder to debug from Railway logs alone.
  const teamMemberId = await dbUpsertMember({ projectId, name, email: normalizedEmail, appRole, inviteTokenHash: tokenHash }).catch((err) => {
    console.error(`[invite/send] dbUpsertMember failed (non-fatal, invite email still attempted): ${err?.message ?? err}`);
    return null;
  });
  await logInviteEvent({
    projectId,
    teamMemberId,
    action: 'sent',
    performedBy: auth.callerEmail ?? invitedBy ?? null,
  }).catch(() => {});

  // Send email (best-effort — this is now the fallback distribution channel,
  // not the only one: the inviteLink is always returned below so an
  // Admin/Project Owner can copy and share it manually regardless of
  // whether email sending is configured or succeeds).
  const emailResult = await sendInviteEmail({ to: normalizedEmail, name, projectName, appRole, inviteLink, invitedBy, password: provisioned.password });
  console.log(
    `[invite/send] sendInviteEmail result ok=${emailResult.ok} dev=${!!emailResult.dev}` +
    (emailResult.error ? ` error=${emailResult.error}` : '')
  );

  if (!emailResult.ok && !emailResult.dev) {
    return res.status(200).json({
      ok: true,
      inviteLink,
      token,
      password: provisioned.password,
      emailSent: false,
      emailError: emailResult.error ?? 'Invite email failed to send.',
      message: 'Invite link created. Email delivery failed — copy the link below and share it manually.',
    });
  }

  return res.json({
    ok: true,
    inviteLink,
    token,
    password: provisioned.password,
    emailSent: !emailResult.dev,
    message: emailResult.dev
      ? 'Invite link generated (no email sent — RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD not set). Copy the link to share manually.'
      : 'Invite email sent. You can also copy the link below to share it directly.',
  });
});

// ── POST /api/invite/reset-password ─────────────────────────────────────────
// Admin/project-owner-triggered password reset for an existing team member.
// Generates a fresh default-format password (dated to the reset action),
// updates the member's Supabase Auth account, and re-sets
// must_change_password so they're forced to pick their own on next sign-in.
app.post('/api/invite/reset-password', checkToken, async (req, res) => {
  const { projectId, projectName, email } = req.body ?? {};
  if (!projectId || !email) {
    return res.status(400).json({ error: 'projectId and email are required' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const auth = await authorizeInviteAction(req, res, { projectId, action: 'reset_password' });
  if (!auth.ok) return; // response already sent

  let member = null;
  if (dbPool) {
    const { rows } = await dbPool.query(
      `SELECT id, name, email FROM team_members WHERE project_id = $1 AND lower(email) = $2 LIMIT 1`,
      [projectId, normalizedEmail]
    ).catch(() => ({ rows: [] }));
    member = rows[0] ?? null;
  }
  if (!member) {
    return res.status(404).json({ error: 'No team member found with that email on this project.' });
  }

  let provisioned;
  try {
    provisioned = await provisionInviteeAccount({ email: normalizedEmail, name: member.name, actionDate: new Date() });
  } catch (err) {
    console.error(`[invite/reset-password] provisionInviteeAccount failed: ${err?.message ?? err}`);
    return res.status(502).json({ error: "Could not reset this team member's password. Please try again or contact support." });
  }

  await logInviteEvent({
    projectId,
    teamMemberId: member.id,
    action: 'password_reset',
    performedBy: auth.callerEmail ?? null,
  }).catch(() => {});

  const baseUrl = resolveInviteBaseUrl(req);
  const emailResult = await sendInviteEmail({
    to: normalizedEmail,
    name: member.name,
    projectName: projectName ?? '',
    appRole: null,
    inviteLink: baseUrl,
    invitedBy: auth.callerEmail ?? 'Your project owner',
    password: provisioned.password,
    isReset: true,
  });
  console.log(
    `[invite/reset-password] sendInviteEmail result ok=${emailResult.ok} dev=${!!emailResult.dev}` +
    (emailResult.error ? ` error=${emailResult.error}` : '')
  );

  return res.json({
    ok: true,
    password: provisioned.password,
    emailSent: !emailResult.dev && emailResult.ok,
    message: emailResult.dev
      ? 'Password reset. No email sent (RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD not set) — copy the password below and share it manually.'
      : 'Password reset. An email with the new password has been sent.',
  });
});

// Verifies the caller sent a valid, email-confirmed Supabase session and
// returns the verified (lowercased) email — or sends an error response and
// returns null. Invite acceptance requires this so a client can no longer
// "accept" an invite by simply POSTing an email string it doesn't control;
// the requester must actually own and have confirmed that mailbox first.
async function requireVerifiedInviteeEmail(req, res) {
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please sign in and confirm your email before accepting this invite.' });
    return null;
  }
  const supabaseClient = getSupabase();
  if (!supabaseClient) {
    res.status(503).json({ error: 'Account verification is not configured on this server.' });
    return null;
  }
  const jwt = authHeader.slice(7);
  const { data, error } = await supabaseClient.auth.getUser(jwt);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return null;
  }
  if (!data.user.email_confirmed_at) {
    res.status(403).json({ error: 'Please confirm your email before accepting this invite — check your inbox for the confirmation link.' });
    return null;
  }
  const email = (data.user.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Your account has no confirmed email address.' });
    return null;
  }
  return email;
}

// ── POST /api/invite/accept ───────────────────────────────────────────────────
// Accept an invite. Requires a valid, email-confirmed Supabase session — the
// invited email must match the session's verified email exactly, so access is
// tied to a real, confirmed account rather than a client-supplied string.
app.post('/api/invite/accept', async (req, res) => {
  const token = req.body?.token ?? req.query?.token;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const verifiedEmail = await requireVerifiedInviteeEmail(req, res);
  if (!verifiedEmail) return; // response already sent

  const tokenHash = hashInviteToken(token);

  if (dbPool) {
    const { rows } = await dbPool.query(`
      SELECT tm.id, tm.project_id, tm.name, tm.email, tm.app_role, tm.invite_status, p.name AS project_name
      FROM team_members tm
      JOIN projects p ON p.id = tm.project_id
      WHERE tm.invite_token_hash = $1 OR tm.invite_token = $2
      LIMIT 1
    `, [tokenHash, token]).catch(() => ({ rows: [] }));

    const existing = rows[0];
    if (existing) {
      if (existing.invite_status === 'revoked') {
        await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:revoked', performedBy: verifiedEmail }).catch(() => {});
        return res.status(410).json({ error: 'This invite is no longer valid.' });
      }
      if (existing.invite_status === 'accepted') {
        return res.status(409).json({ error: 'This invite has already been accepted.' });
      }
      if (existing.email && existing.email.toLowerCase() !== verifiedEmail) {
        await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:email_mismatch', performedBy: verifiedEmail }).catch(() => {});
        return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
      }
      if (isInviteExpired(existing.invited_at)) {
        await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:expired', performedBy: verifiedEmail }).catch(() => {});
        return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
      }
      let invalidRoleError = null;
      const dbRow = await dbAcceptInvite(token, verifiedEmail).catch((err) => {
        if (err?.code === 'INVALID_ROLE') { invalidRoleError = err; return null; }
        throw err;
      });
      if (invalidRoleError) {
        return res.status(409).json({ error: invalidRoleError.message });
      }
      if (dbRow) {
        await dbSyncAcceptedMemberInProjectData(dbRow.project_id, dbRow.email, Date.now());
        inviteStore.delete(tokenHash);
        return res.json({
          ok: true,
          accessToken: dbRow.access_token,
          projectId: dbRow.project_id,
          projectName: dbRow.project_name,
          appRole: dbRow.app_role,
          name: dbRow.name,
          email: dbRow.email,
          expiresAt: dbRow.expires_at,
        });
      }
      if (res.headersSent) return;
    }
  }

  const invite = inviteStore.get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
  if (invite.email !== verifiedEmail) return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

  if (isInviteExpired(invite.invitedAt)) {
    inviteStore.delete(tokenHash);
    return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
  }

  invite.acceptedAt = Date.now();
  inviteStore.set(tokenHash, invite);

  return res.json({
    ok: true,
    accessToken: token,
    projectId: invite.projectId,
    projectName: invite.projectName,
    appRole: invite.appRole,
    name: invite.name,
    email: invite.email,
    expiresAt: Date.now() + INVITE_SESSION_TTL_MS,
  });
});

// ── GET /api/invite/accept ────────────────────────────────────────────────────
// Legacy variant of the accept endpoint — same verified-session requirement
// as POST /api/invite/accept applies here (see requireVerifiedInviteeEmail).
app.get('/api/invite/accept', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const verifiedEmail = await requireVerifiedInviteeEmail(req, res);
  if (!verifiedEmail) return; // response already sent

  const tokenHash = hashInviteToken(token);

  // Try DB first
  let invalidRoleError = null;
  const dbRow = await dbAcceptInvite(token, verifiedEmail).catch((err) => {
    if (err?.code === 'INVALID_ROLE') { invalidRoleError = err; return null; }
    return null; // any other DB error: fall through to in-memory fallback below
  });
  if (invalidRoleError) {
    return res.status(409).json({ error: invalidRoleError.message });
  }
  if (dbRow) {
    await dbSyncAcceptedMemberInProjectData(dbRow.project_id, dbRow.email, Date.now());
    inviteStore.delete(tokenHash);
    return res.json({
      ok: true,
      projectId: dbRow.project_id,
      projectName: dbRow.project_name,
      appRole: dbRow.app_role,
      name: dbRow.name,
      email: dbRow.email,
      accessToken: dbRow.access_token,
      expiresAt: dbRow.expires_at,
    });
  }

  // Fallback to in-memory
  const invite = inviteStore.get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
  if (invite.email !== verifiedEmail) return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

  if (isInviteExpired(invite.invitedAt)) {
    inviteStore.delete(tokenHash);
    return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
  }

  invite.acceptedAt = Date.now();
  inviteStore.set(tokenHash, invite);

  return res.json({
    ok: true,
    projectId: invite.projectId,
    projectName: invite.projectName,
    appRole: invite.appRole,
    name: invite.name,
    email: invite.email,
    accessToken: token,
    expiresAt: Date.now() + INVITE_SESSION_TTL_MS,
  });
});

// ── GET /api/invite/validate ──────────────────────────────────────────────────
// Called by the frontend to preview invite details before the user clicks Accept.
app.get('/api/invite/validate', async (req, res) => {
  const { token, email } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const tokenHash = hashInviteToken(token);

  // DB lookup
  if (dbPool) {
    const { rows } = await dbPool.query(
      `SELECT tm.name, tm.email, tm.app_role, tm.invite_status, tm.invited_at, p.id AS project_id, p.name AS project_name, p.description AS project_description
       FROM team_members tm JOIN projects p ON p.id = tm.project_id
       WHERE tm.invite_token_hash = $1 OR tm.invite_token = $2`, [tokenHash, token]
    ).catch(() => ({ rows: [] }));
    if (rows[0]) {
      const r = rows[0];
      if (r.invite_status === 'revoked') return res.status(409).json({ error: 'This invite is no longer valid.' });
      if (isInviteExpired(r.invited_at)) {
        return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
      }
      if (r.invite_status !== 'pending') return res.status(409).json({ error: 'This invite has already been used.' });
      // Note: this endpoint only previews invite details for the "you've been
      // invited" landing page (no session required) — it never grants access.
      // Access is granted exclusively by /api/invite/accept, which requires a
      // verified session and re-validates every rule server-side.
      return res.json({
        ok: true,
        id: token,
        role: r.app_role,
        invitedEmail: r.email,
        expiresAt: r.invited_at ? new Date(new Date(r.invited_at).getTime() + INVITE_TOKEN_TTL_MS).toISOString() : null,
        project: {
          id: r.project_id,
          name: r.project_name,
          description: r.project_description ?? '',
        },
      });
    }
  }

  // In-memory fallback
  const invite = inviteStore.get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'Invite not found.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'Already accepted.' });
  if (isInviteExpired(invite.invitedAt)) {
    inviteStore.delete(tokenHash);
    return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
  }
  return res.json({
    ok: true,
    id: token,
    role: invite.appRole,
    invitedEmail: invite.email,
    expiresAt: new Date(invite.invitedAt + INVITE_TOKEN_TTL_MS).toISOString(),
    project: {
      id: invite.projectId,
      name: invite.projectName,
      description: '',
    },
  });
});

// ── DELETE /api/invite/revoke ─────────────────────────────────────────────────
app.delete('/api/invite/revoke', checkToken, async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ error: 'token is required' });

  const existing = await dbFindInviteByToken(token);
  const inviteFromMemory = existing ? null : inviteStore.get(hashInviteToken(token));
  const projectId = existing?.project_id ?? inviteFromMemory?.projectId ?? null;

  // If we can't resolve which project this token belongs to at all (DB
  // unavailable and not in the in-memory store either), there is nothing to
  // authorize against or to revoke — treat as not found rather than silently
  // "succeeding" with no authorization check performed.
  if (!projectId) {
    return res.status(404).json({ error: 'Invite not found.' });
  }

  const auth = await authorizeInviteAction(req, res, { projectId, action: 'revoke' });
  if (!auth.ok) return; // response already sent

  await dbRevokeInvite(token, auth.callerEmail).catch(() => {});
  inviteStore.delete(hashInviteToken(token));
  return res.json({ ok: true });
});

// ── Invite-scoped project API ────────────────────────────────────────────────
function getInviteBearer(req) {
  const auth = req.headers.authorization ?? '';
  return auth.startsWith('Bearer invite:') ? auth.slice('Bearer invite:'.length) : '';
}

app.get('/api/invite/projects', async (req, res) => {
  const inviteToken = getInviteBearer(req);
  if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
  const session = await dbGetInviteSession(inviteToken);
  if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
  if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

  const { rows } = await dbPool.query(`
    SELECT id, owner_id, name, description, domain, status, data, created_at, updated_at
    FROM projects
    WHERE id = $1
    LIMIT 1
  `, [session.project_id]).catch(() => ({ rows: [] }));

  return res.json(rows);
});

app.get('/api/invite/projects/:projectId', async (req, res) => {
  const inviteToken = getInviteBearer(req);
  if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
  const session = await dbGetInviteSession(inviteToken);
  if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
  if (session.project_id !== req.params.projectId) {
    return res.status(403).json({ error: 'This invite session can access only its assigned project.' });
  }
  if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

  const { rows } = await dbPool.query(`
    SELECT id, owner_id, name, description, domain, status, data, created_at, updated_at
    FROM projects
    WHERE id = $1
    LIMIT 1
  `, [session.project_id]).catch(() => ({ rows: [] }));

  if (!rows[0]) return res.status(404).json({ error: 'Project not found.' });
  return res.json(rows[0]);
});

app.patch('/api/invite/projects/:projectId', async (req, res) => {
  const inviteToken = getInviteBearer(req);
  if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
  const session = await dbGetInviteSession(inviteToken);
  if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
  if (session.project_id !== req.params.projectId) {
    return res.status(403).json({ error: 'This invite session can access only its assigned project.' });
  }
  if (session.app_role !== 'editor') {
    return res.status(403).json({ error: 'Your invite role does not allow editing project data.' });
  }
  if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

  const { name, description, domain, status, data } = req.body ?? {};
  const { rows } = await dbPool.query(`
    UPDATE projects
    SET
      name = COALESCE($2, name),
      description = COALESCE($3, description),
      domain = COALESCE($4, domain),
      status = COALESCE($5, status),
      data = COALESCE($6::jsonb, data),
      updated_at = NOW()
    WHERE id = $1
    RETURNING id, owner_id, name, description, domain, status, data, created_at, updated_at
  `, [session.project_id, name ?? null, description ?? null, domain ?? null, status ?? null, data ? JSON.stringify(data) : null]).catch((err) => {
    console.error('Invite project update error:', err.message);
    return { rows: [] };
  });

  if (!rows[0]) return res.status(404).json({ error: 'Project not found.' });
  return res.json(rows[0]);
});

// ── GET /api/invite/team/:projectId ──────────────────────────────────────────
app.get('/api/invite/team/:projectId', checkToken, async (req, res) => {
  const { projectId } = req.params;

  const auth = await authorizeInviteAction(req, res, { projectId, action: 'view' });
  if (!auth.ok) return; // response already sent

  const dbRows = await dbGetTeam(projectId).catch(() => null);
  if (dbRows) return res.json({ ok: true, members: dbRows });
  // In-memory: filter by projectId. Note: the map key is now a token hash,
  // not the raw token, so it is never returned to the client here either.
  const members = [];
  for (const [tokenHash, inv] of inviteStore.entries()) {
    if (inv.projectId === projectId) members.push({ ...inv, tokenHash });
  }
  return res.json({ ok: true, members });
});


app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Only bind a real port when this file is run directly (`node src/proxy.js`),
// not when it's `require()`d — e.g. from a test file that wants to exercise
// individual functions without starting a live server.
if (require.main === module) {
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
  // Exported for unit testing only (default-password invite provisioning):
  generateDefaultPassword,
  provisionInviteeAccount,
  findSupabaseUserByEmail,
  getSupabaseAdmin,
};
