// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// The "branding/site-fetch" group: POST /api/fetch-site (used by the
// Branding Guidelines "replicate this site" feature) plus its two private
// helpers, httpsGet and extractBrandingSignals — used only by this route,
// nowhere else in proxy.js (grepped before extracting).
//
// This was the single cleanest extraction of Phase 3: the source region in
// proxy.js was one genuinely contiguous block (comment + httpsGet +
// extractBrandingSignals + the route handler, no interleaved shared code),
// unlike Phase 1b/2 and the rest of Phase 3.
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createBrandingFetchRouter({ checkToken }) {
  const { Router } = require('express');
  const https = require('https');
  const http = require('http');
  const router = Router();

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

  router.post('/', checkToken, async (req, res) => {
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

  return router;
}

module.exports = { createBrandingFetchRouter };
