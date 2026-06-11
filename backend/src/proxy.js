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
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkToken(req, res, next) {
  if (!PROXY_TOKEN) return next();
  if (req.headers['x-api-token'] !== PROXY_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });
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
  res.json({ status: 'ok', model: OPENAI_MODEL, proxy: CORP_PROXY || null, ts: Date.now() });
});

// ── Agent ─────────────────────────────────────────────────────────────────────
app.post('/api/agent', checkToken, async (req, res) => {
  const { systemPrompt, userPrompt, testMode } = req.body ?? {};

  if (!systemPrompt || !userPrompt)
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });

  // Test mode — no OpenAI call
  if (testMode) {
    return res.json({
      choices: [{ message: { role: 'assistant', content: '[TEST] ' + systemPrompt.slice(0, 80) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  const requestBody = JSON.stringify({
    model:    OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens:  4096,
  });

  try {
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
      return res.status(status).json({ error: `OpenAI error ${status}: ${body.slice(0, 200)}` });
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return res.status(502).json({ error: 'Invalid JSON from OpenAI', raw: body.slice(0, 200) });
    }

    return res.json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(502).json({ error: `Connection failed: ${err.message}` });
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

// ── Settings (write backend .env) ─────────────────────────────────────────────
app.post('/api/settings', checkToken, (req, res) => {
  const { openaiApiKey, proxyToken, openaiModel } = req.body ?? {};
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../.env');

  try {
    let lines = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, 'utf8').split('\n');
    }

    function upsert(arr, key, value) {
      if (!value) return arr;
      const idx = arr.findIndex((l) => l.startsWith(key + '='));
      const line = key + '=' + value;
      if (idx >= 0) arr[idx] = line;
      else arr.push(line);
      return arr;
    }

    if (openaiApiKey) upsert(lines, 'OPENAI_API_KEY', openaiApiKey);
    if (proxyToken)   upsert(lines, 'PROXY_TOKEN', proxyToken);
    if (openaiModel)  upsert(lines, 'OPENAI_MODEL', openaiModel);

    fs.writeFileSync(envPath, lines.filter((l) => l.trim()).join('\n') + '\n', 'utf8');
    return res.json({ ok: true, message: 'Settings saved. Restart the backend for changes to take effect.' });
  } catch (err) {
    console.error('Settings write error:', err.message);
    return res.status(500).json({ error: 'Failed to write settings: ' + err.message });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Agentic SDLC proxy  http://localhost:${PORT}  model=${OPENAI_MODEL}`);
  console.log(CORP_PROXY ? `Corporate proxy: ${CORP_PROXY}` : 'Direct connection (no proxy configured)');
});
