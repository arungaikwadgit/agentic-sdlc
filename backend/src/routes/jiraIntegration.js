// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Jira integration route group, added 2026-08-24 (item #23, "start with 2
// and 3" -- see docs/architecture/execution-status-2026-08-24.md Section 3).
// Scope decision (explicit user choice): credential connect/test/disconnect
// UI only. No issue-creation parity with GitHub's /api/github/issues, and no
// chat tool -- both logged as their own future backlog item, not built here.
// Mirrors routes/githubIntegration.js's structure (same checkToken gating,
// same "verify credentials read something real" shape for /test), but Jira
// Cloud's REST API uses HTTP Basic auth (email + API token), not a bearer
// token, and there's no repo-equivalent to encode in the URL path -- the
// closest read-only "does this work" check is GET /rest/api/3/myself, which
// returns the authenticated user's own profile with any valid credential
// pair, independent of whether projectKey is even a real project.

function createJiraIntegrationRouter({ checkToken }) {
  const { Router } = require('express');
  const https = require('https');
  const router = Router();

  // Server-side for the same reason as GitHub: Jira Cloud's REST API doesn't
  // send CORS headers permitting a browser-based Authorization header from
  // arbitrary origins.
  function jiraRequest(method, baseUrl, path, email, apiToken) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      } catch {
        reject(new Error('Invalid Jira base URL'));
        return;
      }
      const basicAuth = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64');
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method,
          headers: {
            'User-Agent': 'AgenticSDLC/1.0',
            'Accept': 'application/json',
            'Authorization': `Basic ${basicAuth}`,
          },
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
      req.end();
    });
  }

  // POST /api/jira/test -- verify baseUrl/email/apiToken can authenticate,
  // and (best-effort, does not fail the check) confirm projectKey resolves
  // to a real project the credential can see.
  router.post('/test', checkToken, async (req, res) => {
    const { baseUrl, email, apiToken, projectKey } = req.body ?? {};
    if (!baseUrl || !email || !apiToken || !projectKey)
      return res.status(400).json({ error: 'baseUrl, email, apiToken, and projectKey are required' });

    try {
      const auth = await jiraRequest('GET', baseUrl, '/rest/api/3/myself', email, apiToken);
      if (auth.status === 401 || auth.status === 403) {
        return res.json({ ok: false, message: 'Invalid email or API token.' });
      }
      if (auth.status !== 200) {
        return res.json({ ok: false, message: `Jira responded with HTTP ${auth.status} while verifying credentials.` });
      }

      const project = await jiraRequest(
        'GET',
        baseUrl,
        `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
        email,
        apiToken,
      );
      if (project.status === 200) {
        const name = project.body?.name ?? projectKey;
        return res.json({ ok: true, message: `Connected as ${auth.body?.emailAddress ?? email}, project "${name}" found.` });
      }
      if (project.status === 404) {
        return res.json({ ok: false, message: `Credentials are valid, but project "${projectKey}" was not found or isn't visible to this account.` });
      }
      return res.json({ ok: false, message: `Credentials are valid, but checking the project returned HTTP ${project.status}.` });
    } catch (err) {
      console.error('jira/test error:', err.message);
      return res.status(502).json({ error: `Failed to reach Jira: ${err.message}` });
    }
  });

  return router;
}

module.exports = { createJiraIntegrationRouter };
