/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { authorizeChatProjectAccess } = require('../chat/chatEvidence');
const { getUserRecentMessages } = require('../chat/chatHistoryStore');

/**
 * GET /api/projects/:projectId/chat/messages -- private-view hydration for
 * the Agentic Help chatbot widget. Returns only the CALLER'S OWN persisted
 * turns for this project; this is deliberately not a "get everyone's chat"
 * endpoint -- the shared-context feature (bounded team-wide history feeding
 * the chat orchestrator's synthesis prompt) is a separate, server-internal
 * read wired directly into proxy.js's /api/chat/respond handler, and is
 * never exposed as raw per-teammate transcripts to the client. See
 * migrations/012_chat_messages.sql for the full rationale.
 *
 * Reuses authorizeChatProjectAccess (already the access rule for using the
 * chatbot in a project at all) rather than getCallerAppRoleForProject, so
 * "can you chat about this project" and "can you see your own chat history
 * for this project" never disagree.
 */
function createChatHistoryRouter({ getDb, checkToken, isAppAdmin = () => false }) {
  const { Router } = require('express');
  const router = Router();

  router.get('/:projectId/chat/messages', checkToken, async (req, res) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication is required.' });
    }

    const dbPool = getDb();
    if (!dbPool) {
      return res.status(503).json({ error: 'Project database is unavailable.' });
    }

    const { projectId } = req.params;
    const caller = {
      email: req.authUser.email ?? null,
      userId: req.authUser.user?.id ?? null,
      adminBypass: req.authUser.adminBypass === true,
    };

    try {
      await authorizeChatProjectAccess({ db: dbPool, caller, projectId, isAppAdmin });
    } catch (error) {
      const status = Number(error?.status);
      const safeStatus = [400, 403, 404, 503].includes(status) ? status : 500;
      return res.status(safeStatus).json({ error: String(error?.message ?? 'Access denied.') });
    }

    const messages = await getUserRecentMessages(dbPool, {
      projectId,
      userId: caller.userId,
      userEmail: caller.email,
    });
    return res.json({ messages });
  });

  return router;
}

module.exports = { createChatHistoryRouter };
