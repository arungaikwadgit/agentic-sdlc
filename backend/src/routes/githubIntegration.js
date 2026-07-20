// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// The GitHub integration group: POST /api/github/test, POST
// /api/github/issues, plus their shared private helper githubRequest
// (used only by these two routes, grepped before extracting).
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createGithubIntegrationRouter({ checkToken }) {
  const { Router } = require('express');
  const https = require('https');
  const router = Router();

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
  router.post('/test', checkToken, async (req, res) => {
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
  router.post('/issues', checkToken, async (req, res) => {
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

  return router;
}

module.exports = { createGithubIntegrationRouter };
