// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// The Figma integration group: POST /api/figma/styles plus its private
// helper figmaRequest, used only by this route (grepped before extracting).
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createFigmaIntegrationRouter({ checkToken }) {
  const { Router } = require('express');
  const https = require('https');
  const router = Router();

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
  router.post('/styles', checkToken, async (req, res) => {
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

  return router;
}

module.exports = { createFigmaIntegrationRouter };
