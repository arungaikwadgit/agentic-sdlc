/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

function createChatRouteHandler({ orchestrate }) {
  if (typeof orchestrate !== 'function') throw new Error('orchestrate dependency is required');

  return async function chatRouteHandler(req, res) {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication is required.' });
    }

    const caller = {
      email: req.authUser.email ?? null,
      userId: req.authUser.user?.id ?? null,
      adminBypass: req.authUser.adminBypass === true,
    };

    try {
      const result = await orchestrate({ request: req.body ?? {}, caller });
      return res.json(result);
    } catch (error) {
      const status = Number(error?.status);
      if ([400, 403, 404, 503].includes(status)) {
        return res.status(status).json({ error: String(error.message ?? 'Chat request failed.') });
      }
      console.error('[chat/respond] request failed with an unexpected internal error');
      return res.status(502).json({ error: 'The agentic chat service could not complete this request.' });
    }
  };
}

module.exports = { createChatRouteHandler };
