/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { Router } = require('express');

/**
 * GET /api/master-data/catalog + PUT /api/master-data/domains/:id --
 * verbatim extraction from proxy.js (architecture upgrade Phase 3).
 * dbGetMasterCatalog/dbUpsertDomain are proxy.js function DECLARATIONS
 * (hoisted, never reassigned), so they're passed by direct reference here
 * rather than through a getter -- unlike dbPool, there's no "not yet
 * initialized at this point in module load order" concern for either of
 * them.
 */
function createMasterDataRouter({ checkToken, requireAdmin, dbGetMasterCatalog, dbUpsertDomain }) {
  const router = Router();

  // Public, read-only bootstrap endpoint.
  // The frontend needs this before any sign-in flow completes so it can render
  // the app shell, labels, domains, phases, and role templates.
  router.get('/catalog', async (_req, res) => {
    try {
      const catalog = await dbGetMasterCatalog();
      return res.json(catalog ?? {});
    } catch (err) {
      console.error('Master catalog query failed:', err.message);
      return res.status(500).json({ error: 'Master data catalog is unavailable.' });
    }
  });

  // Admin-only: add a new domain (e.g. "Logistics") or update an existing one's
  // label/color/context. Lets an admin extend the built-in domain list from
  // Settings → Domains without a code deploy.
  router.put('/domains/:id', checkToken, requireAdmin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,49}$/.test(id)) {
      return res.status(400).json({
        error: 'Domain id must be 2-50 characters, start with a letter, and contain only letters, numbers, "-", or "_".',
      });
    }
    const { label, color, bgColor, context, template } = req.body ?? {};
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required.' });
    }
    if (!context || typeof context !== 'string' || !context.trim()) {
      return res.status(400).json({ error: 'context is required.' });
    }
    const hexColorRe = /^#[0-9a-fA-F]{6}$/;
    const colorVal = typeof color === 'string' && hexColorRe.test(color) ? color : '#64748b';
    const bgColorVal = typeof bgColor === 'string' && hexColorRe.test(bgColor) ? bgColor : '#e2e8f0';

    try {
      const domain = await dbUpsertDomain({
        id,
        label: label.trim(),
        color: colorVal,
        bgColor: bgColorVal,
        context: context.trim(),
        template: typeof template === 'string' ? template : '',
      });
      if (!domain) {
        return res.status(501).json({
          error: 'Adding domains requires a direct Postgres connection (POSTGRES_URL configured on the backend). ' +
            'This deployment does not have one configured, so this write is unavailable.',
        });
      }
      return res.json({ ok: true, domain });
    } catch (err) {
      console.error('Domain upsert failed:', err.message);
      return res.status(500).json({ error: 'Failed to save domain: ' + err.message });
    }
  });

  return router;
}

module.exports = { createMasterDataRouter };
