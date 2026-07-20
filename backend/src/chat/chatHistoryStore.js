/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

/**
 * Persistence for the Agentic Help chatbot's conversation turns, backing two
 * distinct features on top of the same `chat_messages` table (see
 * migrations/012_chat_messages.sql for the full rationale):
 *
 *   - getTeamRecentMessages: a bounded recent window across the WHOLE
 *     project team, used to give the chat orchestrator "shared context" --
 *     any team member's prior questions/answers inform the next answer,
 *     regardless of who is asking now.
 *   - getUserRecentMessages: one caller's own turns only, used to hydrate
 *     the widget's "private view" on mount -- nobody sees a teammate's
 *     literal chat bubbles.
 *   - saveChatMessage: best-effort write. Chat history persistence must
 *     never be the reason a chat response fails or is delayed -- callers
 *     should fire-and-forget this and log failures, not await+throw on the
 *     response path.
 */

const DEFAULT_TEAM_HISTORY_LIMIT = 24;
const DEFAULT_USER_HISTORY_LIMIT = 50;
const MAX_TEXT_CHARS = 8_000;

function clampText(value) {
  return String(value ?? '').slice(0, MAX_TEXT_CHARS);
}

/**
 * Insert one chat turn. Intentionally does not throw -- a DB hiccup while
 * saving history must not surface as a chat-request failure to the user.
 * Callers should NOT await this in a way that blocks the HTTP response;
 * fire-and-forget with a `.catch()` (or await it after the response is
 * already sent) is the intended usage.
 */
async function saveChatMessage(db, { projectId = null, userId = null, userEmail = null, role, text, responseMode = null }) {
  if (!db) return null;
  if (role !== 'user' && role !== 'assistant') return null;
  const trimmed = clampText(text).trim();
  if (!trimmed) return null;
  try {
    const result = await db.query(
      `INSERT INTO chat_messages (project_id, user_id, user_email, role, text, response_mode)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [projectId, userId, userEmail, role, trimmed, responseMode],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('[chatHistoryStore] failed to save chat message (non-fatal):', error?.message ?? error);
    return null;
  }
}

/**
 * Bounded, most-recent-first window of every team member's turns for a
 * project, returned oldest-first (ready to inject into a synthesis/planner
 * prompt as conversational history). Returns [] on any error or when no db
 * is available -- callers should treat that as "no shared history available"
 * and fall back to whatever the client itself sent, not fail the request.
 */
async function getTeamRecentMessages(db, { projectId, limit = DEFAULT_TEAM_HISTORY_LIMIT } = {}) {
  if (!db || !projectId) return [];
  try {
    const result = await db.query(
      `SELECT role, text, user_email, created_at
         FROM chat_messages
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [projectId, limit],
    );
    return result.rows
      .reverse()
      .map((row) => ({ role: row.role, text: row.text, userEmail: row.user_email, createdAt: row.created_at }));
  } catch (error) {
    console.error('[chatHistoryStore] failed to load team chat history (non-fatal):', error?.message ?? error);
    return [];
  }
}

/**
 * One caller's own turns for a project, oldest-first -- private-view
 * hydration for the widget on mount. Scoped by user_id when available,
 * falling back to user_email (covers callers without a stable auth user id,
 * e.g. some admin-bypass paths).
 */
async function getUserRecentMessages(db, { projectId, userId = null, userEmail = null, limit = DEFAULT_USER_HISTORY_LIMIT } = {}) {
  if (!db || !projectId || (!userId && !userEmail)) return [];
  try {
    const result = await db.query(
      `SELECT id, role, text, created_at
         FROM chat_messages
        WHERE project_id = $1
          AND ((user_id IS NOT NULL AND user_id = $2) OR (user_id IS NULL AND LOWER(user_email) = LOWER($3)))
        ORDER BY created_at DESC
        LIMIT $4`,
      [projectId, userId, userEmail ?? '', limit],
    );
    return result.rows
      .reverse()
      .map((row) => ({ id: row.id, role: row.role, text: row.text, createdAt: row.created_at }));
  } catch (error) {
    console.error('[chatHistoryStore] failed to load user chat history (non-fatal):', error?.message ?? error);
    return [];
  }
}

module.exports = {
  saveChatMessage,
  getTeamRecentMessages,
  getUserRecentMessages,
};
