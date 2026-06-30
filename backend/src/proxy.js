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

const app   = express();
const PORT  = process.env.PORT ?? 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL ?? 'gpt-4o';
const PROXY_TOKEN    = process.env.PROXY_TOKEN ?? '';
const SERVER_API_URL = (process.env.SERVER_API_URL ?? '').replace(/\/$/, '');
const ADMIN_BYPASS_BEARER = 'admin-local-bypass-token';

// H-05 fix: Supabase JWT verification as the primary auth mechanism.
// The frontend sends its Supabase session JWT as Authorization: Bearer <jwt>.
// This means VITE_PROXY_TOKEN no longer needs to be bundled in the frontend.
// PROXY_TOKEN remains as a fallback for admin-mode / server-to-server callers.
const SUPABASE_URL     = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
let _supabaseClient = null;
function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  } catch { return null; }
}

// Anthropic (Claude) — optional second provider
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const ANTHROPIC_ENABLED = String(process.env.ANTHROPIC_ENABLED ?? '').toLowerCase() === 'true' && !!ANTHROPIC_API_KEY;
const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER ?? 'openai').toLowerCase() === 'claude' ? 'claude' : 'openai';

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

if (!OPENAI_API_KEY) {
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
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkToken(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';

  // Admin-bypass bearer token — used by the frontend's local admin mode when
  // Supabase auth is intentionally bypassed. This mirrors the existing
  // admin-local session model and avoids requiring a public VITE_PROXY_TOKEN
  // in production for that one flow.
  if (authHeader === `Bearer ${ADMIN_BYPASS_BEARER}`) {
    req.authUser = { email: null, adminBypass: true };
    return next();
  }

  // Path 1: Supabase JWT (preferred — frontend sends session token, not a bundled secret)
  if (authHeader.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7);
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.auth.getUser(jwt);
      if (!error && data?.user) {
        req.authUser = { email: data.user.email?.toLowerCase?.() ?? null, user: data.user };
        return next();
      }
      // JWT present but invalid — reject immediately, don't fall through
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }
    // Supabase not configured — treat as admin-mode JWT-less call, fall through
  }

  // Path 2: Shared secret (PROXY_TOKEN) — used by admin-mode and server-to-server calls.
  // If neither SUPABASE_URL nor PROXY_TOKEN is set, allow (local dev with no auth configured).
  if (!PROXY_TOKEN && !SUPABASE_URL) return next();
  if (PROXY_TOKEN && req.headers['x-api-token'] === PROXY_TOKEN) return next();
  // If we have Supabase configured but no valid JWT arrived, reject
  if (SUPABASE_URL && !req.headers['authorization']) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  // PROXY_TOKEN set but header missing or wrong
  if (PROXY_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
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

app.use('/api/projects', checkToken, forwardToServer);
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
app.get('/api/settings', checkToken, (req, res) => {
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
    const resendFrom       = readKey('RESEND_FROM');
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
      resendFrom,
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

app.post('/api/settings', checkToken, (req, res) => {
  const {
    openaiApiKey, proxyToken, openaiModel,
    anthropicApiKey, anthropicModel, anthropicEnabled,
    defaultLlmProvider, agentProviderMap,
    resendApiKey, resendFrom, appUrl,
  } = req.body ?? {};
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../.env');

  const stringFields = {
    openaiApiKey, proxyToken, openaiModel,
    anthropicApiKey, anthropicModel,
    defaultLlmProvider, resendApiKey, resendFrom, appUrl,
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
    if (resendApiKey) upsert(lines, 'RESEND_API_KEY', resendApiKey);
    if (resendFrom)   upsert(lines, 'RESEND_FROM',    resendFrom);
    if (appUrl)       upsert(lines, 'APP_URL',         appUrl);

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


// ══════════════════════════════════════════════════════════════════════════════
// INVITE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
// In-memory store for invites (persistent via Postgres when DB is available).
// Falls back to in-memory map when POSTGRES_URL is not set — suitable for
// Railway/Render free-tier deployments where the DB is optional at first.

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

// Resend email client (optional — set RESEND_API_KEY to enable real emails)
const RESEND_API_KEY   = process.env.RESEND_API_KEY ?? '';
const RESEND_FROM      = process.env.RESEND_FROM ?? 'noreply@yourdomain.com';
const APP_URL          = process.env.APP_URL ?? 'http://localhost:5173';

// In-memory fallback when Postgres is unavailable
const inviteStore = new Map();

// M-NEW-03 fix: warn loudly at startup if invite tokens will not be persisted.
// A Railway restart (deploy, OOM, health-check failure) will silently drop all
// pending invites when running without a database.
if (!process.env.POSTGRES_URL) {
  console.warn(
    '[WARN] POSTGRES_URL is not set — invite tokens are stored in-memory only.\n' +
    '       All pending invites will be lost if the backend process restarts.\n' +
    '       Add POSTGRES_URL to your Railway environment to enable persistence.'
  );
} // token -> { projectId, projectName, email, name, appRole, invitedBy, invitedAt, acceptedAt }

// Stricter rate limit for invite sends specifically — the general /api 120/min
// limiter is far too loose for an action that triggers an outbound email and
// could otherwise be used to spam arbitrary addresses or enumerate emails.
// 5 invites per 15 minutes per IP.
const inviteSendRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite requests from this IP. Please try again in a few minutes.' },
});

// ── DB helpers (no-op if POSTGRES_URL not set) ────────────────────────────────
let dbPool = null;
if (process.env.POSTGRES_URL) {
  try {
    dbPool = new Pool({ connectionString: process.env.POSTGRES_URL });
    dbPool.query('SELECT 1').then(() => console.log('Invite system: DB connected')).catch(() => {
      console.warn('Invite system: DB connection failed, using in-memory store');
      dbPool = null;
    });
  } catch { dbPool = null; }
}

async function dbUpsertMember({ projectId, name, email, appRole, inviteToken }) {
  if (!dbPool) return;
  await dbPool.query(`
    INSERT INTO team_members (project_id, name, email, role, app_role, invite_token, invite_status, invited_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
    ON CONFLICT (project_id, email) DO UPDATE
      SET app_role = $5, invite_token = $6, invite_status = 'pending', invited_at = NOW()
  `, [projectId, name, email, appRole, appRole, inviteToken]);
}

async function dbAcceptInvite(token, email) {
  if (!dbPool) return null;
  const { rows } = await dbPool.query(`
    UPDATE team_members
    SET invite_status = 'accepted', accepted_at = NOW(), invite_token = NULL
    WHERE id IN (
      SELECT tm.id
      FROM team_members tm
      WHERE tm.invite_token = $1 AND tm.email = $2 AND tm.invite_status = 'pending'
    )
    RETURNING id, project_id, name, email, app_role
  `, [token, email]);
  if (!rows[0]) return null;
  const projectRow = await dbPool.query(`SELECT name FROM projects WHERE id = $1`, [rows[0].project_id]).catch(() => ({ rows: [] }));
  return { ...rows[0], project_name: projectRow.rows?.[0]?.name ?? null };
}

async function dbGetTeam(projectId) {
  if (!dbPool) return null;
  const { rows } = await dbPool.query(`
    SELECT id, name, email, role, app_role, invite_status, invited_at, accepted_at
    FROM team_members WHERE project_id = $1 ORDER BY invited_at ASC
  `, [projectId]);
  return rows;
}

async function dbRevokeInvite(token) {
  if (!dbPool) return;
  await dbPool.query(`
    UPDATE team_members SET invite_status = 'revoked', invite_token = NULL WHERE invite_token = $1
  `, [token]);
}

// ── Email sender (Resend) ─────────────────────────────────────────────────────
async function sendInviteEmail({ to, name, projectName, appRole, inviteLink, invitedBy }) {
  if (!RESEND_API_KEY) {
    // Dev mode — log to console
    console.log(`\n[INVITE LINK - no RESEND_API_KEY set]\nTo: ${to}\nLink: ${inviteLink}\n`);
    return { ok: true, dev: true };
  }

  const roleLabel = {
    project_owner: 'Project Owner',
    editor: 'Editor',
    reviewer: 'Reviewer',
    viewer: 'Viewer',
  }[appRole] ?? appRole;

  const html = `
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
      <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Accept Invitation
      </a>
      <p style="color:#999;font-size:12px;">This link is valid for 7 days. If you were not expecting this invite, you can safely ignore this email.</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to, subject: `You're invited to ${projectName}`, html }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    data,
    error: !res.ok ? (data?.message || data?.error || 'Resend rejected the invite email.') : null,
  };
}

// ── POST /api/invite/send ─────────────────────────────────────────────────────
app.post('/api/invite/send', checkToken, inviteSendRateLimit, async (req, res) => {
  const { projectId, projectName, name, email, appRole, invitedBy } = req.body ?? {};

  if (!projectId || !email || !appRole) {
    return res.status(400).json({ error: 'projectId, email, and appRole are required' });
  }
  const validRoles = ['project_owner', 'editor', 'reviewer', 'viewer'];
  if (!validRoles.includes(appRole)) {
    return res.status(400).json({ error: `appRole must be one of: ${validRoles.join(', ')}` });
  }

  const token = randomUUID();
  const inviteLink = `${APP_URL}/invite?token=${token}&email=${encodeURIComponent(email)}`;

  // Store in memory
  inviteStore.set(token, {
    projectId, projectName, email: email.toLowerCase(), name, appRole,
    invitedBy, invitedAt: Date.now(), acceptedAt: null,
  });

  // Persist to DB if available
  await dbUpsertMember({ projectId, name, email: email.toLowerCase(), appRole, inviteToken: token }).catch(() => {});

  // Send email
  const emailResult = await sendInviteEmail({ to: email, name, projectName, appRole, inviteLink, invitedBy });

  if (!emailResult.ok && !emailResult.dev) {
    return res.status(502).json({
      error: emailResult.error ?? 'Invite email failed to send.',
      inviteLink,
      token,
    });
  }

  return res.json({
    ok: true,
    inviteLink,
    token,
    dev: emailResult.dev ?? false,
    message: emailResult.dev
      ? 'Invite link generated (no email sent — RESEND_API_KEY not set). Copy the link to share manually.'
      : 'Invite email sent.',
  });
});

// ── POST /api/invite/accept ───────────────────────────────────────────────────
// Accept an invite after the user signs in. Uses the authenticated user's email
// when available so the invite link can open directly inside the app flow.
app.post('/api/invite/accept', checkToken, async (req, res) => {
  const token = req.body?.token ?? req.query?.token;
  const bodyEmail = typeof req.body?.email === 'string' ? req.body.email : null;
  const queryEmail = typeof req.query?.email === 'string' ? req.query.email : null;
  const email = (req.authUser?.email ?? bodyEmail ?? queryEmail ?? '').toLowerCase();

  if (!token) return res.status(400).json({ error: 'token is required' });
  if (!email) return res.status(400).json({ error: 'Authenticated user email is required to accept this invite.' });

  const dbRow = await dbAcceptInvite(token, email).catch(() => null);
  if (dbRow) {
    inviteStore.delete(token);
    return res.json({
      ok: true,
      projectId: dbRow.project_id,
      projectName: dbRow.project_name,
      appRole: dbRow.app_role,
      name: dbRow.name,
      email: dbRow.email,
    });
  }

  const invite = inviteStore.get(token);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
  if (invite.email !== email) return res.status(403).json({ error: 'Email does not match this invite.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - invite.invitedAt > SEVEN_DAYS) {
    inviteStore.delete(token);
    return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
  }

  invite.acceptedAt = Date.now();
  inviteStore.set(token, invite);

  return res.json({
    ok: true,
    projectId: invite.projectId,
    projectName: invite.projectName,
    appRole: invite.appRole,
    name: invite.name,
    email: invite.email,
  });
});

// ── GET /api/invite/accept ────────────────────────────────────────────────────
// Called by the frontend InviteAccept page when the invitee clicks "Accept".
app.get('/api/invite/accept', async (req, res) => {
  const { token, email } = req.query;
  if (!token || !email) return res.status(400).json({ error: 'token and email are required' });

  // Try DB first
  const dbRow = await dbAcceptInvite(token, email.toLowerCase()).catch(() => null);
  if (dbRow) {
    inviteStore.delete(token);
    return res.json({ ok: true, projectId: dbRow.project_id, appRole: dbRow.app_role, name: dbRow.name, email: dbRow.email });
  }

  // Fallback to in-memory
  const invite = inviteStore.get(token);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
  if (invite.email !== email.toLowerCase()) return res.status(403).json({ error: 'Email does not match this invite.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - invite.invitedAt > SEVEN_DAYS) {
    inviteStore.delete(token);
    return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
  }

  invite.acceptedAt = Date.now();
  inviteStore.set(token, invite);

  return res.json({ ok: true, projectId: invite.projectId, projectName: invite.projectName, appRole: invite.appRole, name: invite.name, email: invite.email });
});

// ── GET /api/invite/validate ──────────────────────────────────────────────────
// Called by the frontend to preview invite details before the user clicks Accept.
app.get('/api/invite/validate', async (req, res) => {
  const { token, email } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  // DB lookup
  if (dbPool) {
    const { rows } = await dbPool.query(
      `SELECT tm.name, tm.email, tm.app_role, tm.invite_status, p.id AS project_id, p.name AS project_name, p.description AS project_description
       FROM team_members tm JOIN projects p ON p.id = tm.project_id
       WHERE tm.invite_token = $1`, [token]
    ).catch(() => ({ rows: [] }));
    if (rows[0]) {
      const r = rows[0];
      if (r.invite_status !== 'pending') return res.status(409).json({ error: 'This invite is no longer valid.' });
      return res.json({
        ok: true,
        id: token,
        role: r.app_role,
        invitedEmail: r.email,
        expiresAt: null,
        project: {
          id: r.project_id,
          name: r.project_name,
          description: r.project_description ?? '',
        },
      });
    }
  }

  // In-memory fallback
  const invite = inviteStore.get(token);
  if (!invite) return res.status(404).json({ error: 'Invite not found.' });
  if (invite.acceptedAt) return res.status(409).json({ error: 'Already accepted.' });
  return res.json({
    ok: true,
    id: token,
    role: invite.appRole,
    invitedEmail: invite.email,
    expiresAt: null,
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
  await dbRevokeInvite(token).catch(() => {});
  inviteStore.delete(token);
  return res.json({ ok: true });
});

// ── GET /api/invite/team/:projectId ──────────────────────────────────────────
app.get('/api/invite/team/:projectId', checkToken, async (req, res) => {
  const { projectId } = req.params;
  const dbRows = await dbGetTeam(projectId).catch(() => null);
  if (dbRows) return res.json({ ok: true, members: dbRows });
  // In-memory: filter by projectId
  const members = [];
  for (const [token, inv] of inviteStore.entries()) {
    if (inv.projectId === projectId) members.push({ ...inv, token });
  }
  return res.json({ ok: true, members });
});


app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Agentic SDLC proxy  http://localhost:${PORT}  model=${OPENAI_MODEL}`);
  console.log(CORP_PROXY ? `Corporate proxy: ${CORP_PROXY}` : 'Direct connection (no proxy configured)');
});
